# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import asyncio
import os
from typing import Any, Literal, AsyncIterable
from dotenv import load_dotenv

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from langchain_core.runnables.config import RunnableConfig
from pydantic import BaseModel

from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent

from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream

logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

memory = MemorySaver()

# This flag enables or disables the MCP tool matching debug output.
# It reads the environment variable "ENABLE_MCP_TOOL_MATCH" (case-insensitive).
# If the variable is set to "true" (as a string), the flag is True; otherwise, it is False.
ENABLE_MCP_TOOL_MATCH = os.getenv("ENABLE_MCP_TOOL_MATCH", "false").lower() == "true"

class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class KubernetesAgent:
    """Kubernetes Agent using A2A protocol."""

    SYSTEM_INSTRUCTION = (
        'You are an expert assistant for Kubernetes integration and operations. '
        'Your purpose is to help users interact with Kubernetes clusters, resources, workloads, and configurations. '
        'Use the available Kubernetes tools to interact with the cluster and provide accurate, actionable responses. '
        'If the user asks about anything unrelated to Kubernetes, politely state that you can only assist with Kubernetes operations. '
        'Do not attempt to answer unrelated questions or use tools for other purposes.\n\n'
        'IMPORTANT: Before executing any tool, ensure that all required parameters are provided. '
        'If any required parameters are missing, ask the user to provide them. '
        'Always use the most appropriate tool for the requested operation and validate that the provided parameters match the expected format and requirements.'
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete. '
        'Select status as input_required if the input is a question to the user. '
        'Set response status to error if the input indicates an error.'
    )


    def __init__(self):
        self.kubeconfig = os.getenv("KUBE_CONFIG_PATH")
        if not self.kubeconfig:
            logger.warning("KUBECONFIG_PATH not set, Kubernetes integration will be limited")

        self.model = LLMFactory().get_llm()
        self.graph = None
        self.tracing = TracingManager()

        # Enhanced state management for analysis results and parameters
        self.analysis_states = {}  # Store analysis results by context_id
        self.parameter_states = {}  # Store accumulated parameters by context_id
        self.conversation_contexts = {}  # Store conversation context by context_id

        # Conversation tracking for A2A integration
        self.conversation_map = {}  # Map A2A contextId to stable conversation ID
        self.conversation_counter = 0  # Counter for generating stable conversation IDs

        # Initialize the agent - will be done in initialize() method
        self._initialized = False



    async def _initialize_agent(self):
        """Initialize the agent with tools and configuration."""

        if self._initialized:
            return

        if not self.model:
            logger.error("Cannot initialize agent without a valid model")
            return

        logger.info("Launching Kubernetes MCP server")

        print("=" * 50)
        print("🔧 INITIALIZING KUBERNETES AGENT")
        print("=" * 50)
        print("📡 Launching Kubernetes MCP server...")

        try:
            env_vars = {
                "KUBECONFIG": self.kubeconfig,
            }

            mcp_mode = os.getenv("MCP_MODE", "stdio").lower()
            if mcp_mode == "http" or mcp_mode == "streamable_http":
                logging.info("Using HTTP transport for MCP client")
                client = MultiServerMCPClient(
                    {
                        "kubernetes": {
                            "transport": "streamable_http",
                            "url": "https://api.kubernetescopilot.com/mcp",
                            "headers": {},
                        }
                    }
                )
            else:
                logging.info("Using Docker-in-Docker for MCP client")
                client = MultiServerMCPClient(
                    {
                        "kubernetes": {
                            "command": "docker",
                            "args": [
                                "run",
                                "-i",
                                "--rm",
                                "--mount",
                                f"type=bind,src={self.kubeconfig},dst=/home/mcp/.kube/config",
                                "ghcr.io/azure/mcp-kubernetes"
                            ],
                            "transport": "stdio",
                        }
                    }
                )

            client_tools = await client.get_tools()
            self.tools_info = {}

            print('*' * 50)
            print("🔧 AVAILABLE KUBERNETES TOOLS AND PARAMETERS")
            print('*' * 80)
            for tool in client_tools:
                print(f"📋 Tool: {tool.name}")
                print(f"📝 Description: {tool.description.strip()}")
                self.tools_info[tool.name] = {
                    'description': tool.description.strip(),
                    'parameters': tool.args_schema.get('properties', {}),
                    'required': tool.args_schema.get('required', [])
                }
                params = tool.args_schema.get('properties', {})
                required_params = tool.args_schema.get('required', [])
                if params:
                    print("📥 Parameters:")
                    for param, meta in params.items():
                        param_type = meta.get('type', 'unknown')
                        param_title = meta.get('title', param)
                        param_description = meta.get('description', 'No description available')
                        default = meta.get('default', None)
                        is_required = param in required_params
                        req_status = "🔴 REQUIRED" if is_required else "🟡 OPTIONAL"
                        print(f"   • {param} ({param_type}) - {req_status}")
                        print(f"     Title: {param_title}")
                        print(f"     Description: {param_description}")
                        if default is not None:
                            print(f"     Default: {default}")
                        if 'examples' in meta:
                            examples = meta['examples']
                            if examples:
                                print(f"     Examples: {examples}")
                        if 'enum' in meta:
                            enum_values = meta['enum']
                            print(f"     Allowed values: {enum_values}")
                        print()
                else:
                    print("📥 Parameters: None")
                print("-" * 60)
            print('*'*80)

            print("🔧 Creating agent graph with tools...")
            self.graph = create_react_agent(
                self.model,
                client_tools,
                checkpointer=memory,
                prompt=self.SYSTEM_INSTRUCTION,
                response_format=(self.RESPONSE_FORMAT_INSTRUCTION, ResponseFormat),
            )
            print("✅ Agent graph created successfully!")

            runnable_config = RunnableConfig(configurable={"thread_id": "init-thread"})
            try:
                llm_result = await self.graph.ainvoke(
                    {"messages": HumanMessage(content="Summarize what Kubernetes operations you can help with")},
                    config=runnable_config
                )
                ai_content = None
                for msg in reversed(llm_result.get("messages", [])):
                    if hasattr(msg, "type") and msg.type in ("ai", "assistant") and getattr(msg, "content", None):
                        ai_content = msg.content
                        break
                    elif isinstance(msg, dict) and msg.get("type") in ("ai", "assistant") and msg.get("content"):
                        ai_content = msg["content"]
                        break
                print("=" * 50)
                print(f"Agent Kubernetes Capabilities: {ai_content}")
                print("=" * 50)
            except Exception as e:
                logger.error(f"Error testing agent: {e}")
            self._initialized = True
        except Exception as e:
            logger.exception(f"Error initializing agent: {e}")
            self.graph = None

    def get_stable_conversation_id(self, context_id: str, task_id: str = None) -> str:
        """
        Generate a stable conversation ID that persists across multiple messages.
        This is needed because A2A generates new contextIds for each message.
        """
        if context_id in self.conversation_map:
            return self.conversation_map[context_id]

        # Generate a new stable conversation ID
        if task_id:
            stable_id = f"conv_{task_id}_{self.conversation_counter}"
        else:
            stable_id = f"conv_{context_id}_{self.conversation_counter}"

        self.conversation_counter += 1
        self.conversation_map[context_id] = stable_id

        print(f"🔗 Mapped A2A contextId '{context_id}' to stable conversation ID '{stable_id}'")
        return stable_id

    def cleanup_conversation_mapping(self, context_id: str):
        """
        Clean up the conversation mapping when a conversation is complete.
        """
        if context_id in self.conversation_map:
            stable_id = self.conversation_map[context_id]
            # Clean up all related states
            self.cleanup_session(stable_id)
            del self.conversation_map[context_id]
            print(f"🧹 Cleaned up conversation mapping for {context_id} -> {stable_id}")

    # Stream responses from the agent (Kubernetes context)
    async def stream(self, *args, **kwargs) -> AsyncIterable[dict[str, Any]]:
        """
        Stream responses from the agent.

        Note: Using flexible argument signature (*args, **kwargs) to handle different
        calling patterns from the A2A framework. The method extracts the expected
        parameters from the arguments dynamically.
        """

        # Initialize the agent if not already done
        await self._initialize_agent()

        # Comprehensive argument logging
        import inspect
        frame = inspect.currentframe()
        if frame:
            caller_info = inspect.getframeinfo(frame.f_back)
            logger.info(f"Method called from: {caller_info.filename}:{caller_info.lineno}")

        # Extract expected parameters from args and kwargs
        query = args[0] if len(args) > 0 else kwargs.get('query')
        context_id = args[1] if len(args) > 1 else kwargs.get('context_id')
        trace_id = args[2] if len(args) > 2 else kwargs.get('trace_id')
        task_id = args[3] if len(args) > 3 else kwargs.get('task_id')


        logger.info(f"Starting stream with query: {query} and sessionId: {context_id}")

        # Log all arguments for debugging
        logger.info(f"All arguments received: args={args}, kwargs={kwargs}")
        logger.info(f"Extracted parameters: query={query}, context_id={context_id}, trace_id={trace_id}, task_id={task_id}")

        # Validate required parameters
        if not query:
            logger.error("No query provided")
            yield {
                'is_task_complete': False,
                'require_user_input': True,
                'content': 'No query provided to the agent.',
            }
            return

        if not context_id:
            logger.error("No context_id provided")
            yield {
                'is_task_complete': False,
                'require_user_input': True,
                'content': 'No context ID provided to the agent.',
            }
            return

        # Generate stable conversation ID for better follow-up handling
        stable_conversation_id = self.get_stable_conversation_id(context_id, task_id)

        # Add print statement for new query processing
        print("=" * 50)
        print("🔄 PROCESSING NEW QUERY")
        print("=" * 50)
        print(f"📝 Query: {query}")
        print(f"🆔 A2A Context ID: {context_id}")
        print(f"🔗 Stable Conversation ID: {stable_conversation_id}")
        print(f"🔍 Trace ID: {trace_id}")
        print("=" * 50)

        if not self.graph:
            logger.error("Agent graph not initialized")
            yield {
                'is_task_complete': False,
                'require_user_input': True,
                'content': 'Kubernetes agent is not properly initialized. Please check the logs.',
            }
            return

        inputs: dict[str, Any] = {'messages': [HumanMessage(content=query)]}
        if ENABLE_MCP_TOOL_MATCH:
            # Enhanced parameter handling with better state management
            # FIRST: Check if this query is actually Kubernetes-related before any processing
            query_lower = query.lower()
            kubernetes_related_keywords = [
                'kubernetes', 'cluster', 'pod', 'deployment', 'service', 'namespace', 'context', 'node', 'config', 'workload', 'resource', 'replica', 'scale', 'status', 'describe', 'logs', 'events', 'apply', 'delete', 'create', 'update', 'get', 'list', 'switch', 'permission', 'role', 'rbac', 'secret', 'configmap', 'ingress', 'cronjob', 'statefulset', 'daemonset', 'job', 'container', 'image', 'restart', 'cordon', 'drain', 'taint', 'helm', 'cilium', 'hubble', 'kubectl', 'kubeconfig', 'current context', 'available contexts', 'switch context', 'production', 'dev', 'test', 'admin', 'readonly', 'readwrite'
            ]

            is_kubernetes_related = any(keyword in query_lower for keyword in kubernetes_related_keywords)

            if not is_kubernetes_related:
                print(f"🔍 Query '{query}' is not Kubernetes-related, informing user of limitations...")
                query_lower = query.lower().strip()
                if query_lower in ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'absolutely', 'definitely']:
                    yield {
                        'is_task_complete': True,
                        'require_user_input': False,
                        'content': (
                            "Great! I'm excited to help you with Kubernetes! 🎉\n\n"
                            "Here are some things I can help you with:\n"
                            "• Query cluster status and resources\n"
                            "• Troubleshoot pods and workloads\n"
                            "• Scale deployments and manage replicas\n"
                            "• Switch contexts and view configurations\n"
                            "• Check permissions and RBAC\n"
                            "• View logs, events, and diagnostics\n\n"
                            "What would you like to do? You can say something like:\n"
                            "• \"What is the status of my Kubernetes cluster?\"\n"
                            "• \"Show me all deployments in the production namespace\"\n"
                            "• \"Scale my web deployment to 5 replicas\"\n"
                            "• \"Switch to the production context\""
                        )
                    }
                    return
                else:
                    yield {
                        'is_task_complete': True,
                        'require_user_input': False,
                        'content': (
                            "I'm a Kubernetes operations specialist and can only help you with Kubernetes-related tasks like managing clusters, resources, workloads, and configurations. "
                            "I can't help with general questions like weather, math, or other non-Kubernetes topics. "
                            "Is there something Kubernetes-related I can help you with?"
                        )
                    }
                    return

          # Check if we have a previous analysis for this context

            # Check if we have a previous analysis for this context
            previous_analysis = self.analysis_states.get(stable_conversation_id)
            accumulated_params = self.parameter_states.get(stable_conversation_id, {})

            print(f"🔍 Context check for {stable_conversation_id}:")
            print(f"   • Has previous analysis: {previous_analysis is not None}")
            print(f"   • Has accumulated params: {bool(accumulated_params)}")
            print(f"   • Accumulated params: {accumulated_params}")

            if previous_analysis:
                # This is a follow-up message, update the analysis with accumulated parameters
                print("🔄 Processing follow-up message with accumulated parameters...")
                print(f"📊 Previously accumulated parameters: {accumulated_params}")
                print(f"📊 Previous analysis tool: {previous_analysis.get('tool_name', 'Unknown')}")
                print(f"📊 Previous missing params: {[p['name'] for p in previous_analysis.get('missing_params', [])]}")

                # Extract new parameters from the followup query
                new_params = self.extract_parameters_from_query(query, previous_analysis['all_params'])
                print(f"🆕 New parameters extracted: {new_params}")

                # Merge with accumulated parameters
                updated_params = accumulated_params.copy()
                updated_params.update(new_params)
                print(f"🔄 Merged parameters: {updated_params}")

                # Update the analysis with the merged parameters
                analysis_result = self.update_analysis_with_parameters(previous_analysis, updated_params)

                # Update stored parameters
                self.parameter_states[stable_conversation_id] = updated_params

                # Check if we now have all required parameters
                if not analysis_result['missing_params']:
                    print("✅ All required parameters now available. Proceeding with execution...")
                    # Clear the stored states since we're proceeding
                    if stable_conversation_id in self.analysis_states:
                        del self.analysis_states[stable_conversation_id]
                    if stable_conversation_id in self.parameter_states:
                        del self.parameter_states[stable_conversation_id]
                    if stable_conversation_id in self.conversation_contexts:
                        del self.conversation_contexts[stable_conversation_id]
                else:
                    # Still missing parameters, ask for them
                    print(f"❌ Still missing parameters: {[p['name'] for p in analysis_result['missing_params']]}")
            else:
                # This is a new request, perform fresh analysis
                print("🆕 New request detected. Performing fresh analysis...")
                analysis_result = self.analyze_request_and_discover_tool(query)

                # Store the analysis for potential follow-up messages
                self.analysis_states[stable_conversation_id] = analysis_result

                # Initialize parameter state
                extracted_params = analysis_result.get('extracted_params', {})
                self.parameter_states[stable_conversation_id] = extracted_params

                # Store conversation context
                self.conversation_contexts[stable_conversation_id] = {
                    'original_query': query,
                    'tool_name': analysis_result.get('tool_name', ''),
                    'timestamp': asyncio.get_event_loop().time(),
                    'a2a_context_id': context_id,
                    'stable_conversation_id': stable_conversation_id
                }

                print(f"📊 Stored analysis for {stable_conversation_id}:")
                print(f"   • Tool: {analysis_result.get('tool_name', 'Unknown')}")
                print(f"   • Extracted params: {extracted_params}")
                print(f"   • Missing params: {[p['name'] for p in analysis_result.get('missing_params', [])]}")

            # If no tool found or missing required parameters, ask for clarification
            if not analysis_result['tool_found'] or analysis_result['missing_params']:
                message = self.generate_missing_variables_message(analysis_result)

                # Create input_fields metadata for dynamic form generation
                input_fields = self.create_input_fields_metadata(analysis_result)

                # Generate meaningful explanation for why the form is needed using LLM
                form_explanation = self.generate_form_explanation_with_llm(analysis_result)

                # Create comprehensive metadata with conversation context
                metadata = {
                    'input_fields': input_fields,
                    'form_explanation': form_explanation,
                    'tool_info': {
                        'name': analysis_result.get('tool_name', ''),
                        'description': analysis_result.get('tool_description', ''),
                        'operation': self.extract_operation_from_tool_name(analysis_result.get('tool_name', ''))
                    },
                    'context': {
                        'missing_required_count': len(analysis_result.get('missing_params', [])),
                        'total_fields_count': len(input_fields.get('fields', [])),
                        'extracted_count': len(analysis_result.get('extracted_params', {})),
                        'conversation_context': self.conversation_contexts.get(stable_conversation_id, {}),
                        'is_followup': previous_analysis is not None,
                        'stable_conversation_id': stable_conversation_id
                    }
                }

                yield {
                    'is_task_complete': False,
                    'require_user_input': True,
                    'content': message,
                    'metadata': metadata
                }
                return

            # If we have all required parameters, proceed with the normal agent flow
            print("✅ All required parameters found. Proceeding with tool execution...")

            # Clear the analysis state since we're proceeding with execution
            if stable_conversation_id in self.analysis_states:
                del self.analysis_states[stable_conversation_id]
            if stable_conversation_id in self.parameter_states:
                del self.parameter_states[stable_conversation_id]
            if stable_conversation_id in self.conversation_contexts:
                del self.conversation_contexts[stable_conversation_id]

            # Clean up the conversation mapping
            self.cleanup_conversation_mapping(context_id)

            # Enhance the query with extracted parameters for better tool selection
            enhanced_query = self.enhance_query_with_parameters(query, analysis_result['extracted_params'])

            inputs: dict[str, Any] = {'messages': [HumanMessage(content=enhanced_query)]}

            config: RunnableConfig = self.tracing.create_config(stable_conversation_id)
        else:
            config: RunnableConfig = self.tracing.create_config(context_id)

        try:
            async for item in self.graph.astream(inputs, config, stream_mode='values'):
                message = item.get('messages', [])[-1] if item.get('messages') else None

                if not message:
                    continue

                logger.debug(f"Streamed message type: {type(message)}")

                if (
                    isinstance(message, AIMessage)
                    and hasattr(message, 'tool_calls')
                    and message.tool_calls
                    and len(message.tool_calls) > 0
                ):
                    # Add detailed print statements for tool calls
                    print("=" * 50)
                    print("🔧 TOOL CALL DETECTED")
                    print("=" * 50)
                    for i, tool_call in enumerate(message.tool_calls):
                        tool_name = tool_call.get('name', 'Unknown')
                        tool_id = tool_call.get('id', 'Unknown')
                        args = tool_call.get('args', {})

                        print(f"📋 Tool Call #{i+1}:")
                        print(f"   • Tool Name: {tool_name}")
                        print(f"   • Tool ID: {tool_id}")

                        # Display tool description and required variables
                        if hasattr(self, 'tools_info') and tool_name in self.tools_info:
                            tool_info = self.tools_info[tool_name]
                            print(f"   • Tool Description: {tool_info['description']}")

                            # Show required vs optional parameters
                            required_params = tool_info['required']
                            all_params = tool_info['parameters']

                            print("   📥 Required Variables:")
                            if required_params:
                                for param in required_params:
                                    param_info = all_params.get(param, {})
                                    param_type = param_info.get('type', 'unknown')
                                    param_desc = param_info.get('description', 'No description')
                                    provided = param in args
                                    status = "✅ PROVIDED" if provided else "❌ MISSING"
                                    print(f"     • {param} ({param_type}) - {status}")
                                    print(f"       Description: {param_desc}")
                                    if provided:
                                        print(f"       Value: {args[param]}")
                                    print()
                            else:
                                print("     • No required parameters")

                            print("   🟡 Optional Variables:")
                            optional_params = [p for p in all_params.keys() if p not in required_params]
                            if optional_params:
                                for param in optional_params:
                                    param_info = all_params.get(param, {})
                                    param_type = param_info.get('type', 'unknown')
                                    param_desc = param_info.get('description', 'No description')
                                    provided = param in args
                                    status = "✅ PROVIDED" if provided else "⏭️  NOT PROVIDED"
                                    print(f"     • {param} ({param_type}) - {status}")
                                    print(f"       Description: {param_desc}")
                                    if provided:
                                        print(f"       Value: {args[param]}")
                                    elif 'default' in param_info:
                                        print(f"       Default: {param_info['default']}")
                                    else:
                                        print("       Default: None")
                                    print()
                            else:
                                print("     • No optional parameters")
                        else:
                            print("   • Tool Description: Not available")
                            print("   📥 Tool Arguments:")
                            if args:
                                for key, value in args.items():
                                    print(f"     - {key}: {value}")
                            else:
                                print("     - No arguments provided")

                        print()
                    print("=" * 50)

                    yield {
                          'is_task_complete': False,
                          'require_user_input': False,
                          'content': 'Processing Kubernetes operations...',
                      }
                elif isinstance(message, ToolMessage):
                    # Add detailed print statements for tool results
                    print("=" * 50)
                    print("📤 TOOL RESULT RECEIVED")
                    print("=" * 50)
                    print(f"📋 Tool Name: {getattr(message, 'name', 'Unknown')}")
                    print(f"📋 Tool Call ID: {getattr(message, 'tool_call_id', 'Unknown')}")
                    print("📥 Tool Result Content:")
                    content = getattr(message, 'content', '')
                    if content:
                        # Truncate long content for readability
                        if len(content) > 500:
                            print(f"   {content[:500]}... (truncated)")
                        else:
                            print(f"   {content}")
                    else:
                        print("   No content")
                    print("=" * 50)

                    yield {
                          'is_task_complete': False,
                          'require_user_input': False,
                          'content': 'Interacting with Kubernetes API...',
                      }

                elif isinstance(message, AIMessage) and message.content:
                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'content': message.content,
                    }

            yield self.get_agent_response(config)
        except Exception as e:
            logger.exception(f"Error in stream: {e}")
            yield {
                  'is_task_complete': False,
                  'require_user_input': True,
                  'content': f'An error occurred while processing your Kubernetes request: {str(e)}',
              }

    def get_agent_response(self, config: RunnableConfig) -> dict[str, Any]:
        """Get the final response from the agent."""
        logger.debug(f"Fetching agent response with config: {config}")

        try:
            current_state = self.graph.get_state(config)
            logger.debug(f"Current state values: {current_state.values}")

            structured_response = current_state.values.get('structured_response')
            logger.debug(f"Structured response: {structured_response}")

            if structured_response and isinstance(structured_response, ResponseFormat):
                logger.debug(f"Structured response is valid: {structured_response.status}")
                if structured_response.status in {'input_required', 'error'}:
                    return {
                        'is_task_complete': False,
                        'require_user_input': True,
                        'content': structured_response.message,
                    }
                if structured_response.status == 'completed':
                    return {
                        'is_task_complete': True,
                        'require_user_input': False,
                        'content': structured_response.message,
                    }

            # If we couldn't get a structured response, try to get the last message
            messages = []
            for item in current_state.values.get('messages', []):
                if isinstance(item, AIMessage) and item.content:
                    messages.append(item.content)

            if messages:
                return {
                    'is_task_complete': True,
                    'require_user_input': False,
                    'content': messages[-1],
                }

        except Exception as e:
            logger.exception(f"Error getting agent response: {e}")

        logger.warning("Unable to process request, returning fallback response")
        return {
                  'is_task_complete': False,
                  'require_user_input': True,
                  'content': 'We are unable to process your Kubernetes request at the moment. Try again.',
              }
    # Enhanced parameter extraction with better pattern matching for Kubernetes operations.

    def analyze_request_and_discover_tool(self, query: str) -> dict:
        """
        Analyze the user's request to discover the appropriate tool and identify missing variables.
        Returns a dictionary with tool information and missing variables.
        """
        print("=" * 50)
        print("🔍 ANALYZING REQUEST FOR TOOL DISCOVERY")
        print("=" * 50)
        print(f"📝 User Query: {query}")

        if not hasattr(self, 'tools_info') or not self.tools_info:
            return {
                'tool_found': False,
                'message': 'No tools available for analysis'
            }

        # Enhanced keyword-based tool matching with better scoring
        query_lower = query.lower()
        query_words = set(query_lower.split())
        matched_tools = []

        # Define action keywords and their associated tool patterns
        action_keywords = {
            'create': ['create', 'new', 'add', 'apply'],
            'list': ['list', 'get', 'show', 'find', 'search', 'view'],
            'update': ['update', 'modify', 'change', 'edit', 'patch'],
            'delete': ['delete', 'remove', 'destroy'],
            'scale': ['scale', 'replica', 'resize'],
            'describe': ['describe', 'details', 'info'],
            'logs': ['logs', 'output', 'events'],
            'restart': ['restart', 'reload'],
            'switch': ['switch', 'context', 'namespace'],
            'status': ['status', 'health', 'state'],
            'config': ['config', 'configuration', 'settings'],
            'permission': ['permission', 'role', 'rbac', 'access'],
            'resource': ['resource', 'object', 'kind'],
            'container': ['container', 'image'],
            'node': ['node', 'worker', 'master'],
            'pod': ['pod'],
            'deployment': ['deployment'],
            'service': ['service'],
            'namespace': ['namespace'],
            'ingress': ['ingress'],
            'configmap': ['configmap'],
            'secret': ['secret'],
            'cronjob': ['cronjob'],
            'statefulset': ['statefulset'],
            'daemonset': ['daemonset'],
            'job': ['job'],
            'helm': ['helm'],
            'kubectl': ['kubectl'],
            'kubeconfig': ['kubeconfig'],
            'cilium': ['cilium'],
            'hubble': ['hubble']
        }

        for tool_name, tool_info in self.tools_info.items():
            description = tool_info['description'].lower()
            name_lower = tool_name.lower()

            # Initialize score
            score = 0
            matched_keywords = []

            # Score based on exact tool name matches (highest priority)
            if name_lower in query_lower:
                score += 100
                matched_keywords.append(f"exact_name:{name_lower}")

            # Score based on action keywords in tool name
            for action, keywords in action_keywords.items():
                if action in name_lower:
                    for keyword in keywords:
                        if keyword in query_lower:
                            score += 50
                            matched_keywords.append(f"action:{action}")
                            break


            # Score based on Kubernetes resource keywords in tool name
            resource_keywords = [
                'pod', 'deployment', 'service', 'namespace', 'node', 'configmap', 'secret', 'ingress', 'cronjob', 'statefulset', 'daemonset', 'job', 'container', 'image', 'helm', 'kubectl', 'kubeconfig', 'cilium', 'hubble'
            ]
            for resource in resource_keywords:
                if resource in name_lower and resource in query_lower:
                    score += 30
                    matched_keywords.append(f"resource:{resource}")

            # Score based on description relevance
            desc_words = set(description.split())
            common_words = query_words.intersection(desc_words)
            if common_words:
                score += len(common_words) * 10
                matched_keywords.extend([f"desc:{word}" for word in common_words])

            # Penalize overly generic matches
            if len(name_lower.split('_')) > 4:  # Very long tool names
                score -= 20

            # Penalize matches that are too generic
            generic_terms = ['get', 'list', 'show', 'find']
            if all(term in name_lower for term in generic_terms):
                score -= 10

            # Only include tools with meaningful scores
            if score > 0:
                matched_tools.append({
                    'name': tool_name,
                    'description': tool_info['description'],
                    'score': score,
                    'matched_keywords': matched_keywords,
                    'required_params': tool_info['required'],
                    'all_params': tool_info['parameters']
                })

        # Sort by relevance score
        matched_tools.sort(key=lambda x: x['score'], reverse=True)

        # Debug: Print all matches with scores
        print("🔍 Tool Matching Results:")
        for i, tool in enumerate(matched_tools[:5]):  # Show top 5
            print(f"   {i+1}. {tool['name']} (Score: {tool['score']})")
            print(f"      Keywords: {tool['matched_keywords']}")
            print(f"      Description: {tool['description'][:100]}...")
            print()

        if not matched_tools:
            print("❌ No matching tools found for this request")
            print("=" * 50)
            return {
                'tool_found': False,
                'message': 'No Kubernetes tools match your request. Please try rephrasing or ask for available operations.'
            }

        # If we have multiple close matches, use LLM to help decide
        if len(matched_tools) > 1 and matched_tools[0]['score'] - matched_tools[1]['score'] < 50:
            print("🤔 Multiple close matches detected. Using LLM to help decide...")
            best_tool = self.use_llm_for_tool_selection(query, matched_tools[:3])
        else:
            best_tool = matched_tools[0]

        # Check if the confidence score is high enough
        confidence_threshold = 80  # Minimum score to be confident about tool selection
        print(f"🎯 Best tool score: {best_tool['score']} (threshold: {confidence_threshold})")

        if best_tool['score'] < confidence_threshold:
            print(f"⚠️  Low confidence score ({best_tool['score']}) for tool selection. Asking for clarification.")
            return {
                'tool_found': False,
                'message': self.generate_low_confidence_message(query, matched_tools[:3])
            }

        print(f"✅ High confidence score ({best_tool['score']}). Proceeding with tool selection.")

        tool_name = best_tool['name']
        required_params = best_tool['required_params']
        all_params = best_tool['all_params']

        print(f"🎯 Best Matching Tool: {tool_name}")
        print(f"📝 Description: {best_tool['description']}")
        print(f"📊 Relevance Score: {best_tool['score']}")
        print(f"🔑 Matched Keywords: {best_tool['matched_keywords']}")

        # Extract potential parameters from the query
        extracted_params = self.extract_parameters_from_query(query, all_params)

        # Check for missing required parameters
        missing_params = []
        for param in required_params:
            if param not in extracted_params:
                param_info = all_params.get(param, {})
                missing_params.append({
                    'name': param,
                    'type': param_info.get('type', 'unknown'),
                    'description': param_info.get('description', 'No description available'),
                    'title': param_info.get('title', param)
                })

        print(f"📥 Extracted Parameters: {extracted_params}")
        print(f"❌ Missing Required Parameters: {[p['name'] for p in missing_params]}")

        # Show optional parameters and their defaults
        optional_params = [p for p in all_params.keys() if p not in required_params]
        if optional_params:
            print("🟡 Optional Parameters:")
            for param in optional_params:
                param_info = all_params.get(param, {})
                param_type = param_info.get('type', 'unknown')
                param_desc = param_info.get('description', 'No description')
                default = param_info.get('default', None)
                print(f"   • {param} ({param_type}): {param_desc}")
                if default is not None:
                    print(f"     Default: {default}")
                else:
                    print("     Default: None")
                print()

        print("=" * 50)

        return {
            'tool_found': True,
            'tool_name': tool_name,
            'tool_description': best_tool['description'],
            'extracted_params': extracted_params,
            'missing_params': missing_params,
            'all_required_params': required_params,
            'all_params': all_params
        }

    def use_llm_for_tool_selection(self, query: str, candidate_tools: list) -> dict:
        """
        Use the LLM to help select the best tool when keyword matching is ambiguous.
        """
        try:
            # Create a prompt for the LLM to select the best tool
            prompt = f"""Given the user request: "{query}"

Available tools:
"""
            for i, tool in enumerate(candidate_tools):
                prompt += f"{i+1}. {tool['name']}: {tool['description']}\n"

            prompt += f"""
Please select the most appropriate tool for this request. Respond with only the number (1-{len(candidate_tools)}) of the best tool.

Selection:"""

            # Use the LLM to get a response
            response = self.model.invoke(prompt)
            response_text = response.content if hasattr(response, 'content') else str(response)

            # Extract the number from the response
            import re
            number_match = re.search(r'\d+', response_text)
            if number_match:
                selected_index = int(number_match.group()) - 1
                if 0 <= selected_index < len(candidate_tools):
                    print(f"🤖 LLM selected: {candidate_tools[selected_index]['name']}")
                    return candidate_tools[selected_index]

            # Fallback to the highest scored tool
            print(f"🤖 LLM selection failed, using highest scored tool: {candidate_tools[0]['name']}")
            return candidate_tools[0]

        except Exception as e:
            print(f"🤖 LLM tool selection failed: {e}, using highest scored tool: {candidate_tools[0]['name']}")
            return candidate_tools[0]

    def extract_parameters_from_query(self, query: str, all_params: dict) -> dict:
        """
        Enhanced parameter extraction with better pattern matching for Kubernetes operations.
        Only extracts parameters that the user actually specified in their query.
        """
        import re

        extracted = {}

        print(f"🔍 Extracting parameters from query: '{query}'")
        print(f"🔍 Available parameters: {list(all_params.keys())}")

        # Only extract parameters relevant to Kubernetes resources and operations
        for param_name, param_info in all_params.items():
            param_type = param_info.get('type', 'string')
            print(f"🔍 Processing parameter: {param_name} (type: {param_type})")

            # Try LLM-based extraction for intelligent understanding
            llm_extracted = self.extract_parameter_with_llm(query, param_name, param_info)
            if llm_extracted is not None:
                extracted[param_name] = llm_extracted
                print(f"✅ Extracted {param_name} using LLM: {extracted[param_name]}")
                continue

            # Fallback to pattern matching for Kubernetes resource names and values
            if param_type == 'string':
                # Look for quoted resource names
                quotes_pattern = rf'"([^"]*{param_name}[^"]*)"'
                quotes_match = re.search(quotes_pattern, query, re.IGNORECASE)
                if quotes_match:
                    extracted[param_name] = quotes_match.group(1)
                    print(f"✅ Extracted {param_name} from quotes: {extracted[param_name]}")
                    continue

                # Look for parameter name followed by colon or equals
                param_pattern = rf'{param_name}\s*[:=]\s*([^\s,]+)'
                param_match = re.search(param_pattern, query, re.IGNORECASE)
                if param_match:
                    extracted[param_name] = param_match.group(1)
                    print(f"✅ Extracted {param_name} from key-value: {extracted[param_name]}")
                    continue

                # Kubernetes resource-specific patterns
                if param_name in ['pod', 'deployment', 'service', 'namespace', 'node', 'configmap', 'secret', 'ingress', 'cronjob', 'statefulset', 'daemonset', 'job', 'container', 'image', 'helm', 'kubeconfig', 'context']:
                    # Look for resource name after keywords
                    resource_pattern = rf'{param_name}\s+([a-zA-Z0-9_-]+)'
                    resource_match = re.search(resource_pattern, query, re.IGNORECASE)
                    if resource_match:
                        extracted[param_name] = resource_match.group(1)
                        print(f"✅ Extracted {param_name} from resource pattern: {extracted[param_name]}")
                        continue

            elif param_type == 'integer':
                # Look for numbers
                number_pattern = r'\b(\d+)\b'
                number_match = re.search(number_pattern, query)
                if number_match:
                    extracted[param_name] = int(number_match.group(1))
                    print(f"✅ Extracted {param_name} from number: {extracted[param_name]}")

            elif param_type == 'boolean':
                # Look for boolean indicators
                if re.search(rf'{param_name}\s+(true|yes|enabled|on)', query, re.IGNORECASE):
                    extracted[param_name] = True
                    print(f"✅ Extracted {param_name} as True")
                elif re.search(rf'{param_name}\s+(false|no|disabled|off)', query, re.IGNORECASE):
                    extracted[param_name] = False
                    print(f"✅ Extracted {param_name} as False")

        print(f"🔍 Final extracted parameters: {extracted}")
        return extracted



    def generate_missing_variables_message(self, analysis_result: dict) -> str:
        """
        Enhanced message generation that better handles follow-up conversations.
        Only shows parameters that actually exist in the tool.
        """
        if not analysis_result['tool_found']:
            return analysis_result['message']

        tool_name = analysis_result['tool_name']
        tool_description = analysis_result['tool_description']
        missing_params = analysis_result['missing_params']
        extracted_params = analysis_result['extracted_params']
        all_params = analysis_result['all_params']
        required_params = analysis_result['all_required_params']

        print("🔍 DEBUG: generate_missing_variables_message called with:")
        print(f"🔍 DEBUG: tool_name: {tool_name}")
        print(f"🔍 DEBUG: all_params keys: {list(all_params.keys())}")
        print(f"🔍 DEBUG: required_params: {required_params}")
        print(f"🔍 DEBUG: missing_params: {missing_params}")
        print(f"🔍 DEBUG: extracted_params: {extracted_params}")

        # Check if this is a follow-up conversation
        # Only treat as follow-up if we actually extracted meaningful parameters for the Kubernetes operation
        meaningful_params = {}
        for param_name, value in extracted_params.items():
            # Only include parameters that are actually part of the Kubernetes tool
            if param_name in all_params:
                meaningful_params[param_name] = value

        is_followup = bool(meaningful_params) and len(meaningful_params) > 0

        print(f"🔍 DEBUG: extracted_params: {extracted_params}")
        print(f"🔍 DEBUG: meaningful_params: {meaningful_params}")
        print(f"🔍 DEBUG: is_followup: {is_followup}")

        if is_followup:
            prompt = f"""You are a helpful Kubernetes assistant. The user is providing additional information for an ongoing request.

Current context: The user is trying to perform a Kubernetes operation: {tool_description}

Information already provided:
"""
            for param, value in meaningful_params.items():
                prompt += f"- {param}: {value}\n"

            prompt += """

Please respond in a friendly, conversational way. Thank them for the additional information they've provided,
then show the complete parameter list in exactly the same format as before.

IMPORTANT:
- Thank them briefly for the additional information they've provided (be generic, don't mention specific parameters)
- Explain what's still needed: "In order to [operation] I still need at least the required parameters from the list of parameters:"
- Show ALL parameters again in the EXACT same simple format as the first message
- Use the format: "**param_name** (type): REQUIRED/optional - Description - Default: **value**"
- For parameters with current values, show " - Current value: **value**" instead of the default
- Do NOT show both default and current value for the same parameter
- IMPORTANT: Use lowercase boolean values (true/false, not True/False)
- Keep it simple and clean, just like the first message
- Do NOT add extra text, extra formatting, or verbose explanations
- Show required parameters first, then optional ones, but keep them in one continuous list

Here are ALL the parameters for this tool:
"""
            # List only the actual tool parameters in the simple format
            # First show required parameters, then optional ones
            required_param_names = [p for p in all_params.keys() if p in required_params]
            optional_param_names = [p for p in all_params.keys() if p not in required_params]

            # Show required parameters first
            for param_name in required_param_names:
                param_info = all_params[param_name]
                param_desc = param_info.get('description', 'No description available')
                req_status = "REQUIRED"

                if param_name in meaningful_params:
                    # Show current value for provided parameters
                    current_value = meaningful_params[param_name]
                    # Convert boolean values to lowercase
                    if isinstance(current_value, bool):
                        current_value_str = str(current_value).lower()
                    else:
                        current_value_str = str(current_value)
                    prompt += f"**{param_name}** ({param_info.get('type', 'unknown')}): {req_status} - {param_desc} - Current value: **{current_value_str}**\n"
                else:
                    # Show default value for non-provided parameters
                    default = param_info.get('default', None)
                    if default is not None:
                        # Convert boolean values to lowercase
                        if isinstance(default, bool):
                            default_str = str(default).lower()
                        else:
                            default_str = str(default)
                        prompt += f"**{param_name}** ({param_info.get('type', 'unknown')}): {req_status} - {param_desc} - Default: **{default_str}**\n"
                    else:
                        prompt += f"**{param_name}** ({param_info.get('type', 'unknown')}): {req_status} - {param_desc}\n"

            # Then show optional parameters
            for param_name in optional_param_names:
                param_info = all_params[param_name]
                param_desc = param_info.get('description', 'No description available')
                req_status = "optional"

                if param_name in meaningful_params:
                    # Show current value for provided parameters
                    current_value = meaningful_params[param_name]
                    # Convert boolean values to lowercase
                    if isinstance(current_value, bool):
                        current_value_str = str(current_value).lower()
                    else:
                        current_value_str = str(current_value)
                    prompt += f"**{param_name}** ({param_info.get('type', 'unknown')}): {req_status} - {param_desc} - Current value: **{current_value_str}**\n"
                else:
                    # Show default value for non-provided parameters
                    default = param_info.get('default', None)
                    if default is not None:
                        # Convert boolean values to lowercase
                        if isinstance(default, bool):
                            default_str = str(default).lower()
                        else:
                            default_str = str(default)
                        prompt += f"**{param_name}** ({param_info.get('type', 'unknown')}): {req_status} - {param_desc} - Default: **{default_str}**\n"
                    else:
                        prompt += f"**{param_name}** ({param_info.get('type', 'unknown')}): {req_status} - {param_desc}\n"

            prompt += """

Example format for the second message:
Thanks for the additional information! In order to perform the requested Kubernetes operation I still need at least the required parameters from the list of parameters:

**resource_name** (string): REQUIRED - Name of the resource
**namespace** (string): optional - Namespace for the resource - Default: **default**
**description** (string): optional - Resource description - Default: **""**
**replicas** (integer): optional - Number of replicas - Current value: **1**

Response:"""
        else:
            prompt = f"""You are a helpful Kubernetes assistant. The user wants to perform an operation, but some required information is missing.

User's request context: The user is trying to perform a Kubernetes operation: {tool_description}

Please provide a simple, clean list of ALL parameters for this tool. Use this exact format:

"""
            # List only the actual tool parameters in the simple format
            # First show required parameters, then optional ones
            required_param_names = [p for p in all_params.keys() if p in required_params]
            optional_param_names = [p for p in all_params.keys() if p not in required_params]

            # Show required parameters first
            for param_name in required_param_names:
                param_info = all_params[param_name]
                param_desc = param_info.get('description', 'No description available')
                req_status = "REQUIRED"

                default = param_info.get('default', None)
                if default is not None:
                    # Convert boolean values to lowercase
                    if isinstance(default, bool):
                        default_str = str(default).lower()
                    else:
                        default_str = str(default)
                    prompt += f"**{param_name}** ({param_info.get('type', 'unknown')}): {req_status} - {param_desc} - Default: **{default_str}**\n"
                else:
                    prompt += f"**{param_name}** ({param_info.get('type', 'unknown')}): {req_status} - {param_desc}\n"

            # Then show optional parameters
            for param_name in optional_param_names:
                param_info = all_params[param_name]
                param_desc = param_info.get('description', 'No description available')
                req_status = "optional"

                default = param_info.get('default', None)
                if default is not None:
                    # Convert boolean values to lowercase
                    if isinstance(default, bool):
                        default_str = str(default).lower()
                    else:
                        default_str = str(default)
                    prompt += f"**{param_name}** ({param_info.get('type', 'unknown')}): {req_status} - {param_desc} - Default: **{default_str}**\n"
                else:
                    prompt += f"**{param_name}** ({param_info.get('type', 'unknown')}): {req_status} - {param_desc}\n"

            prompt += """

Please respond in a friendly, conversational way. Present the parameter list in the simple format shown above.

IMPORTANT:
- Use the exact format: "**param_name** (type): REQUIRED/optional - Description - Default: **value**"
- The **param_name** should be bold
- The **Default: value** should be bold
- Keep it simple and clean
- Do NOT add extra formatting, bullet points, or verbose explanations
- Just show the parameters in the simple format with proper bold formatting
- Show required parameters first, then optional ones, but keep them in one continuous list

Response:"""

        try:
            # Use the LLM to generate a user-friendly message
            response = self.model.invoke(prompt)
            response_text = response.content if hasattr(response, 'content') else str(response)

            # Clean up the response
            response_text = response_text.strip()

            # If the LLM response is too short or generic, provide a fallback
            if len(response_text) < 50:
                optional_params_info = self.get_optional_params_info(all_params, required_params)
                return self.generate_fallback_message(missing_params, extracted_params, optional_params_info, is_followup)

            return response_text

        except Exception as e:
            print(f"🤖 LLM message generation failed: {e}")
            optional_params_info = self.get_optional_params_info(all_params, required_params)
            return self.generate_fallback_message(missing_params, extracted_params, optional_params_info, is_followup)

    def get_optional_params_info(self, all_params: dict, required_params: list) -> list:
        """
        Get optional parameters with their full information.
        """
        optional_params_info = []
        optional_param_names = [p for p in all_params.keys() if p not in required_params]

        for param_name in optional_param_names:
            param_info = all_params.get(param_name, {})
            optional_params_info.append({
                'name': param_name,
                'description': param_info.get('description', 'No description available'),
                'type': param_info.get('type', 'unknown'),
                'default': param_info.get('default', None)
            })

        return optional_params_info

    def generate_fallback_message(self, missing_params: list, extracted_params: dict, optional_params_info: list, is_followup: bool = False) -> str:
        """
        Enhanced fallback message generation that handles follow-up conversations.
        Shows all parameters in a unified list format.
        """
        if not missing_params and not optional_params_info:
            return "I have all the information I need to help you with your Kubernetes request!"

        if is_followup:
            message = "Thanks for the additional information! "
            if extracted_params:
                message += f"I now have: {', '.join([f'{k}: {v}' for k, v in extracted_params.items()])}. "
            message += "Here's what I still need for your Kubernetes operation:\n\n"
        else:
            message = "I'd be happy to help you with that! Here's what I need for your Kubernetes operation:\n\n"

        # Get all parameters (both required and optional) with their current status
        all_fields = []

        # Add all required parameters first (both missing and already provided)
        for param_name in [p['name'] for p in missing_params]:
            param_info = next((p for p in missing_params if p['name'] == param_name), {})
            current_value = extracted_params.get(param_name)

            all_fields.append({
                'name': param_name,
                'description': param_info.get('description', 'No description available'),
                'required': True,
                'current_value': current_value,
                'status': 'provided' if current_value else 'missing'
            })

        # Add all optional parameters after required ones
        for param in optional_params_info:
            current_value = extracted_params.get(param['name'])

            all_fields.append({
                'name': param['name'],
                'description': param['description'],
                'required': False,
                'current_value': current_value,
                'default': param.get('default'),
                'status': 'available'
            })

        # Sort: required first, then optional, then by status (missing first), then alphabetically
        all_fields.sort(key=lambda x: (not x['required'], x['status'] != 'missing', x['name']))

        # Generate the unified list
        for field in all_fields:
            status = "REQUIRED" if field['required'] else "optional"
            message += f"**{field['name']}** ({field.get('type', 'unknown')}): {status} - {field['description']}"

            # Show current value if provided
            if field['current_value'] is not None:
                # Convert boolean values to lowercase
                if isinstance(field['current_value'], bool):
                    current_value_str = str(field['current_value']).lower()
                else:
                    current_value_str = str(field['current_value'])
                message += f" - Current value: **{current_value_str}**"

            # Show default value for optional parameters
            if not field['required'] and field.get('default') is not None:
                # Convert boolean values to lowercase and make them bold
                if isinstance(field['default'], bool):
                    default_str = str(field['default']).lower()
                else:
                    default_str = str(field['default'])
                message += f" - Default: **{default_str}**"

            message += "\n"

        if is_followup:
            message += "\nCould you please provide the remaining information?"
        else:
            message += "\nCould you please provide the missing information?"

        return message

    def enhance_query_with_parameters(self, original_query: str, extracted_params: dict) -> str:
        """
        Enhance the original query with extracted parameters to help the LLM make better tool selections.
        """
        if not extracted_params:
            return original_query

        enhanced_query = original_query + "\n\n"
        enhanced_query += "Extracted parameters from your request:\n"
        for param, value in extracted_params.items():
            enhanced_query += f"- {param}: {value}\n"

        enhanced_query += "\nPlease use these parameters when executing the appropriate Kubernetes tool."

        return enhanced_query

    def update_analysis_with_parameters(self, original_analysis: dict, updated_params: dict) -> dict:
        """
        Update the original analysis with new accumulated parameters.
        This is an enhanced version that better handles parameter accumulation.
        """
        if not original_analysis['tool_found']:
            return original_analysis

        # Validate parameters as they come in
        validated_params = self.validate_parameters(updated_params, original_analysis['all_params'])

        # Re-check for missing parameters
        missing_params = []
        for param in original_analysis['all_required_params']:
            if param not in validated_params:
                param_info = original_analysis['all_params'].get(param, {})
                missing_params.append({
                    'name': param,
                    'type': param_info.get('type', 'unknown'),
                    'description': param_info.get('description', 'No description available'),
                    'title': param_info.get('title', param)
                })

        return {
            'tool_found': True,
            'tool_name': original_analysis['tool_name'],
            'tool_description': original_analysis['tool_description'],
            'extracted_params': validated_params,
            'missing_params': missing_params,
            'all_required_params': original_analysis['all_required_params'],
            'all_params': original_analysis['all_params']
        }

    def validate_parameters(self, params: dict, all_params: dict) -> dict:
        """
        Validate parameters against their expected types and constraints.
        """
        validated = {}

        for param_name, value in params.items():
            if param_name not in all_params:
                continue  # Skip unknown parameters

            param_info = all_params[param_name]
            param_type = param_info.get('type', 'string')

            try:
                # Type validation for Kubernetes resource parameters
                if param_type == 'integer':
                    validated[param_name] = int(value)
                elif param_type == 'boolean':
                    if isinstance(value, str):
                        validated[param_name] = value.lower() in ['true', 'yes', '1', 'on']
                    else:
                        validated[param_name] = bool(value)
                elif param_type == 'string':
                    validated[param_name] = str(value)
                else:
                    validated[param_name] = value

                # Additional validation for Kubernetes resource names
                if param_name in ['pod', 'deployment', 'service', 'namespace', 'node', 'configmap', 'secret', 'ingress', 'cronjob', 'statefulset', 'daemonset', 'job', 'container', 'image', 'helm', 'kubeconfig', 'context']:
                    # Ensure resource names are non-empty strings
                    if not str(value).strip():
                        continue

            except (ValueError, TypeError):
                # Skip invalid parameters
                continue

        return validated

    def create_input_fields_metadata(self, analysis_result: dict) -> dict:
        """
        Create structured input fields metadata for dynamic form generation.
        Enhanced to better handle follow-up scenarios.
        """
        if not analysis_result['tool_found']:
            return {}

        all_params = analysis_result['all_params']
        required_params = analysis_result['all_required_params']
        extracted_params = analysis_result['extracted_params']

        input_fields = {
            'fields': [],
            'summary': {
                'total_required': len(required_params),
                'total_optional': len(all_params) - len(required_params),
                'provided_required': len([p for p in required_params if p in extracted_params]),
                'provided_optional': len([p for p in all_params.keys() if p not in required_params and p in extracted_params]),
                'missing_required': len([p for p in required_params if p not in extracted_params])
            }
        }

        # Process all parameters (both required and optional)
        for param_name in all_params.keys():
            param_info = all_params.get(param_name, {})
            is_required = param_name in required_params
            is_provided = param_name in extracted_params

            # Only include missing required parameters and all optional parameters
            if is_required and param_name in extracted_params:
                continue  # Skip required params that are already provided

            field_info = {
                'name': param_name,
                'type': param_info.get('type', 'string'),
                'title': param_info.get('title', param_name),
                'description': param_info.get('description', 'No description available'),
                'required': is_required,
                'status': 'provided' if is_provided else 'missing'
            }

            # Add default value if available
            if 'default' in param_info and param_info['default'] is not None:
                field_info['default_value'] = param_info['default']

            # Add additional metadata
            if 'enum' in param_info:
                field_info['enum'] = param_info['enum']
            if 'examples' in param_info:
                field_info['examples'] = param_info['examples']
            if 'minimum' in param_info:
                field_info['minimum'] = param_info['minimum']
            if 'maximum' in param_info:
                field_info['maximum'] = param_info['maximum']
            if 'pattern' in param_info:
                field_info['pattern'] = param_info['pattern']

            # Add provided value if available
            if is_provided:
                field_info['provided_value'] = extracted_params[param_name]

            input_fields['fields'].append(field_info)

        # Sort fields: required fields first, then optional fields
        input_fields['fields'].sort(key=lambda x: (not x['required'], x['name']))

        return input_fields

    def generate_form_explanation_with_llm(self, analysis_result: dict) -> str:
        """
        Generate a meaningful explanation for why the form generated by input_fields is needed.
        Uses the LLM to create a natural, user-friendly explanation.
        """
        if not analysis_result['tool_found']:
            return "Please provide additional information to help with your request."

        tool_name = analysis_result['tool_name']
        tool_description = analysis_result['tool_description']
        operation = self.extract_operation_from_tool_name(tool_name)

        # Create a prompt for the LLM to generate a user-friendly explanation
        prompt = f"""You are a helpful Kubernetes assistant. I need to generate a brief, friendly explanation for why a form is needed.

Tool Information:
- Tool Name: {tool_name}
- Tool Description: {tool_description}
- Operation: {operation}

Please generate a simple, user-friendly explanation that tells the user why they need to fill out a form.
The explanation should be in the format: "Here's the list of parameters you'll need to [operation]:"

Examples:
- For creating a repository: "Here's the list of parameters you'll need to create a new GitHub repository:"
- For creating an issue: "Here's the list of parameters you'll need to create a new GitHub issue:"
- For listing repositories: "Here's the list of parameters you'll need to list GitHub repositories:"
- For updating an issue: "Here's the list of parameters you'll need to update a GitHub issue:"

Keep it simple, friendly, and consistent with the examples above. Just return the explanation text, nothing else.

Response:"""

        try:
            # Use the LLM to generate a user-friendly explanation
            response = self.model.invoke(prompt)
            response_text = response.content if hasattr(response, 'content') else str(response)

            # Clean up the response
            response_text = response_text.strip()

            # If the LLM response is too short or generic, provide a fallback
            if len(response_text) < 20:
                return f"Here's the list of parameters you'll need to {operation.lower()}:"

            return response_text

        except Exception as e:
            print(f"🤖 LLM form explanation generation failed: {e}")
            # Fallback to a generic explanation
            return f"Here's the list of parameters you'll need to {operation.lower()}:"

    def extract_operation_from_tool_name(self, tool_name: str) -> str:
        """
        Extract a human-readable operation name from the tool name.
        """
        if not tool_name:
            return ''

        # Common operation mappings
        operation_mappings = {
            'create_deployment': 'Create Deployment',
            'create_service': 'Create Service',
            'create_pod': 'Create Pod',
            'list_pods': 'List Pods',
            'list_services': 'List Services',
            'list_deployments': 'List Deployments',
            'update_deployment': 'Update Deployment',
            'delete_pod': 'Delete Pod',
            'scale_deployment': 'Scale Deployment',
            'get_logs': 'Get Logs',
            'describe_resource': 'Describe Resource',
            'apply_manifest': 'Apply Manifest',
            'get_events': 'Get Events',
            'switch_context': 'Switch Context',
            'get_configmap': 'Get ConfigMap',
            'get_secret': 'Get Secret',
            'restart_pod': 'Restart Pod',
            'cordon_node': 'Cordon Node',
            'drain_node': 'Drain Node',
            'taint_node': 'Taint Node',
            'create_namespace': 'Create Namespace',
            'delete_namespace': 'Delete Namespace',
            'get_status': 'Get Status',
            'get_metrics': 'Get Metrics',
            'get_hubble_flows': 'Get Hubble Flows',
            'get_cilium_status': 'Get Cilium Status'
        }

        # Try exact match first
        if tool_name in operation_mappings:
            return operation_mappings[tool_name]

        # Try to extract operation from tool name
        parts = tool_name.split('_')
        if len(parts) >= 2:
            action = parts[0].title()
            resource = ' '.join(parts[1:]).title()
            return f"{action} {resource}"

        # Fallback to title case
        return tool_name.replace('_', ' ').title()

    def cleanup_session(self, context_id: str):
        """
        Clean up all stored session data for a given context.
        """
        if context_id in self.analysis_states:
            del self.analysis_states[context_id]
        if context_id in self.parameter_states:
            del self.parameter_states[context_id]
        if context_id in self.conversation_contexts:
            del self.conversation_contexts[context_id]
        print(f"🧹 Cleaned up session data for context: {context_id}")

    def get_session_status(self, context_id: str) -> dict:
        """
        Get the current status of a session for debugging purposes.
        """
        return {
            'has_analysis': context_id in self.analysis_states,
            'has_parameters': context_id in self.parameter_states,
            'has_context': context_id in self.conversation_contexts,
            'analysis': self.analysis_states.get(context_id, {}),
            'parameters': self.parameter_states.get(context_id, {}),
            'conversation_context': self.conversation_contexts.get(context_id, {})
        }

    def show_conversation_state(self):
        """
        Show the current state of all conversations for debugging.
        """
        print("=" * 50)
        print("🔍 CURRENT CONVERSATION STATE")
        print("=" * 50)

        print(f"📊 Conversation Map ({len(self.conversation_map)} mappings):")
        for a2a_id, stable_id in self.conversation_map.items():
            print(f"   • {a2a_id} -> {stable_id}")

        print(f"\n📊 Analysis States ({len(self.analysis_states)}):")
        for conv_id, analysis in self.analysis_states.items():
            tool_name = analysis.get('tool_name', 'Unknown')
            missing_count = len(analysis.get('missing_params', []))
            print(f"   • {conv_id}: {tool_name} (missing: {missing_count})")

        print(f"\n📊 Parameter States ({len(self.parameter_states)}):")
        for conv_id, params in self.parameter_states.items():
            param_count = len(params)
            print(f"   • {conv_id}: {param_count} parameters")
            for param, value in params.items():
                print(f"     - {param}: {value}")

        print(f"\n📊 Conversation Contexts ({len(self.conversation_contexts)}):")
        for conv_id, context in self.conversation_contexts.items():
            tool_name = context.get('tool_name', 'Unknown')
            timestamp = context.get('timestamp', 0)
            print(f"   • {conv_id}: {tool_name} at {timestamp}")

        print("=" * 50)

    def reset_session(self, context_id: str):
        """
        Reset a session to start fresh.
        """
        self.cleanup_session(context_id)
        print(f"🔄 Reset session for context: {context_id}")

    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

    def generate_low_confidence_message(self, query: str, candidate_tools: list) -> str:
        """
        Generate a message asking for clarification when tool selection confidence is low.
        """
        if not candidate_tools:
            return "I'm not sure what Kubernetes operation you'd like to perform. Could you please be more specific?"

        # Create a prompt for the LLM to generate a user-friendly clarification message
        prompt = f"""You are a helpful Kubernetes assistant. The user made a request, but I'm not completely confident about which Kubernetes operation they want to perform.

User's request: "{query}"

Possible operations I'm considering:
"""

        for i, tool in enumerate(candidate_tools):
            prompt += f"{i+1}. {tool['name']}: {tool['description']}\n"

        prompt += """
Please respond in a friendly, conversational way. Ask the user to clarify what they want to do.
Suggest the most likely operations and ask them to confirm or provide more details.
Don't mention technical details like tool names or scores.

Response:"""

        try:
            # Use the LLM to generate a user-friendly clarification message
            response = self.model.invoke(prompt)
            response_text = response.content if hasattr(response, 'content') else str(response)

            # Clean up the response
            response_text = response_text.strip()

            # If the LLM response is too short or generic, provide a fallback
            if len(response_text) < 50:
                return self.generate_fallback_clarification_message(query, candidate_tools)

            return response_text

        except Exception as e:
            print(f"🤖 LLM clarification message generation failed: {e}")
            return self.generate_fallback_clarification_message(query, candidate_tools)

    def generate_fallback_clarification_message(self, query: str, candidate_tools: list) -> str:
        """
        Generate a fallback clarification message if LLM fails.
        """
        message = "I'm not completely sure what you'd like to do with Kubernetes. Could you please clarify?\n\n"
        message += "Based on your request, I think you might want to:\n"

        for i, tool in enumerate(candidate_tools[:3]):  # Show top 3
            # Extract a human-readable operation name
            operation_name = self.extract_operation_from_tool_name(tool['name'])
            message += f"• {operation_name}\n"

        message += "\nCould you please be more specific about what you'd like to do?"

        return message

    def extract_boolean_with_llm(self, query: str, param_name: str, query_lower: str) -> bool:
        """
        Use the LLM to intelligently extract boolean values from natural language.
        Handles cases like "make it private", "should be private", "enable autoinit".
        """
        try:
            prompt = f"""Given the user's query: "{query}" and the parameter name: "{param_name}",
determine if the user wants to set this parameter to True or False.

If the user's query strongly implies True, return True.
If the user's query strongly implies False, return False.
If the user's query is neutral or ambiguous, return None.

Query: "{query}"
Parameter: "{param_name}"

Response:"""

            response = self.model.invoke(prompt)
            response_text = response.content if hasattr(response, 'content') else str(response)

            # Clean up the response
            response_text = response_text.strip()

            if response_text.lower() in ['true', 'yes', '1', 'on']:
                print(f"🤖 LLM determined {param_name} should be True.")
                return True
            elif response_text.lower() in ['false', 'no', '0', 'off']:
                print(f"🤖 LLM determined {param_name} should be False.")
                return False
            else:
                # Check if the response implies a boolean value
                if any(word in response_text.lower() for word in ['true', 'yes', 'enable', 'on']):
                    return True
                elif any(word in response_text.lower() for word in ['false', 'no', 'disable', 'off']):
                    return False
                return None
        except Exception as e:
            print(f"🤖 LLM boolean extraction failed for {param_name}: {e}")
            return None

    def extract_string_with_llm(self, query: str, param_name: str, param_info: dict) -> str | None:
        """
        Use the LLM to extract a string value from a natural language query.
        This is particularly useful for complex expressions or when the query
        doesn't directly match a rigid pattern.
        """
        try:
            prompt = f"""Given the user's query: "{query}" and the parameter name: "{param_name}",
extract the value for this parameter.

If the user's query directly provides the value, return it.
If the user's query implies the value, return it.
If the user's query is ambiguous or doesn't provide a clear value, return None.

Query: "{query}"
Parameter: "{param_name}"
Parameter Type: "{param_info.get('type', 'string')}"

Response:"""

            response = self.model.invoke(prompt)
            response_text = response.content if hasattr(response, 'content') else str(response)

            # Clean up the response
            response_text = response_text.strip()

            # If the LLM response is a direct value, return it
            if response_text.lower() in ['true', 'false', 'yes', 'no', 'on', 'off', '1', '0']:
                return response_text

            # If the LLM response is a number
            if response_text.isdigit():
                return int(response_text)

            # If the LLM response is a string value
            if response_text:
                return response_text

            return None
        except Exception as e:
            print(f"🤖 LLM string extraction failed for {param_name}: {e}")
            return None

    def extract_integer_with_llm(self, query: str, param_name: str, param_info: dict) -> int | None:
        """
        Use the LLM to extract an integer value from a natural language query.
        This is particularly useful for complex expressions or when the query
        doesn't directly match a rigid pattern.
        """
        try:
            prompt = f"""Given the user's query: "{query}" and the parameter name: "{param_name}",
extract the integer value for this parameter.

If the user's query directly provides the value, return it.
If the user's query implies the value, return it.
If the user's query is ambiguous or doesn't provide a clear integer value, return None.

Query: "{query}"
Parameter: "{param_name}"
Parameter Type: "{param_info.get('type', 'string')}"

Response:"""

            response = self.model.invoke(prompt)
            response_text = response.content if hasattr(response, 'content') else str(response)

            # Clean up the response
            response_text = response_text.strip()

            # If the LLM response is a direct integer value
            if response_text.isdigit():
                return int(response_text)

            # If the LLM response is a string value that can be converted to an integer
            if response_text:
                try:
                    return int(response_text)
                except ValueError:
                    pass # Not an integer, continue to other extraction methods

            return None
        except Exception as e:
            print(f"🤖 LLM integer extraction failed for {param_name}: {e}")
            return None

    def extract_parameter_with_llm(self, query: str, param_name: str, param_info: dict) -> Any:
        """
        Use the LLM to intelligently extract parameter values from natural language.
        This method understands context and can handle various ways users express their intent.
        Only extracts parameters when there's high confidence they were specified.

        Examples:
        - "make it private" → private: True
        - "should be autoinit" → autoInit: True
        - "the name is MyRepo" → name: "MyRepo"
        - "issue number 123" → issue_number: 123
        """
        try:
            param_type = param_info.get('type', 'string')
            param_description = param_info.get('description', 'No description available')

            prompt = f"""Given the user's query: "{query}" and the parameter: "{param_name}",
determine if the user is explicitly specifying a value for this parameter.

Parameter Details:
- Name: {param_name}
- Type: {param_type}
- Description: {param_description}

User Query: "{query}"

Instructions:
1. ONLY extract a value if the user's query CLEARLY and EXPLICITLY specifies a value for this parameter
2. If the user's query implies a value (e.g., "make it private" implies private: true), extract and return it
3. If the user's query is ambiguous or doesn't provide a clear value, return None
4. Be CONSERVATIVE - only extract when you're very confident the user specified this parameter
5. Return the value in the appropriate type (boolean, integer, string, etc.)

Examples of CLEAR specifications:
- "make it private" → True (for boolean parameter 'private')
- "should be autoinit" → True (for boolean parameter 'autoInit')
- "the name is MyRepo" → "MyRepo" (for string parameter 'name')
- "issue number 123" → 123 (for integer parameter 'issue_number')
- "set state to open" → "open" (for string parameter 'state')

Examples of UNCLEAR or AMBIGUOUS (should return None):
- "create a repository" → None (no specific name mentioned)
- "I want to create something" → None (too vague)
- "make it good" → None (subjective, not specific)

Response (just the value, or "None" if unclear):"""

            response = self.model.invoke(prompt)
            response_text = response.content if hasattr(response, 'content') else str(response)

            # Clean up the response
            response_text = response_text.strip()

            print(f"🤖 LLM response for {param_name}: '{response_text}'")

            # If the LLM says "None" or similar, return None
            if response_text.lower() in ['none', 'null', 'undefined', 'n/a', 'not specified', 'unclear', 'ambiguous']:
                print(f"🤖 LLM determined {param_name} is not specified")
                return None

            # Handle different parameter types
            if param_type == 'boolean':
                if response_text.lower() in ['true', 'yes', '1', 'on', 'enabled']:
                    return True
                elif response_text.lower() in ['false', 'no', '0', 'off', 'disabled']:
                    return False
                else:
                    # Check if the response implies a boolean value
                    if any(word in response_text.lower() for word in ['true', 'yes', 'enable', 'on']):
                        return True
                    elif any(word in response_text.lower() for word in ['false', 'no', 'disable', 'off']):
                        return False
                    return None

            elif param_type == 'integer':
                try:
                    return int(response_text)
                except ValueError:
                    # Try to extract numbers from the response
                    import re
                    number_match = re.search(r'\d+', response_text)
                    if number_match:
                        return int(number_match.group())
                    return None

            elif param_type == 'string':
                # Return the response text if it's not empty and not a "none" indicator
                if response_text and response_text.lower() not in ['none', 'null', 'undefined', 'n/a']:
                    return response_text
                return None

            else:
                # For unknown types, return the response as-is
                return response_text if response_text else None

        except Exception as e:
            print(f"🤖 LLM parameter extraction failed for {param_name}: {e}")
            return None