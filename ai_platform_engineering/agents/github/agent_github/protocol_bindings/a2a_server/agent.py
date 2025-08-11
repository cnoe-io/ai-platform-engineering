# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import asyncio
import os
from typing import Any, Literal, AsyncIterable

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from langchain_core.runnables.config import RunnableConfig
from pydantic import BaseModel

from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent

from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream

logger = logging.getLogger(__name__)

memory = MemorySaver()

class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str

class GitHubAgent:
    """GitHub Agent using A2A protocol."""

    SYSTEM_INSTRUCTION = (
      'You are an expert assistant for GitHub integration and operations. '
      'Your purpose is to help users interact with GitHub repositories, issues, pull requests, and other GitHub features. '
      'Use the available GitHub tools to interact with the GitHub API and provide accurate, '
      'actionable responses. If the user asks about anything unrelated to GitHub, politely state '
      'that you can only assist with GitHub operations. Do not attempt to answer unrelated questions '
      'or use tools for other purposes.\n\n'
      'IMPORTANT: Before executing any tool, ensure that all required parameters are provided. '
      'If any required parameters are missing, ask the user to provide them. '
      'Always use the most appropriate tool for the requested operation and validate that '
      'the provided parameters match the expected format and requirements.'
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete. '
        'Select status as input_required if the input is a question to the user. '
        'Set response status to error if the input indicates an error.'
    )

    def __init__(self):
        self.github_token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
        if not self.github_token:
            logger.warning("GITHUB_PERSONAL_ACCESS_TOKEN not set, GitHub integration will be limited")

        self.model = LLMFactory().get_llm()
        self.graph = None
        self.tracing = TracingManager()
        
        # Add state management for analysis results
        self.analysis_states = {}  # Store analysis results by context_id

        # Initialize the agent
        asyncio.run(self._initialize_agent())

    async def _initialize_agent(self):
        """Initialize the agent with tools and configuration."""
        if not self.model:
            logger.error("Cannot initialize agent without a valid model")
            return

        logger.info("Launching GitHub MCP server")
        
        # Add print statement for agent initialization
        print("=" * 80)
        print("🔧 INITIALIZING GITHUB AGENT")
        print("=" * 80)
        print("📡 Launching GitHub MCP server...")

        try:
            # Prepare environment variables for GitHub MCP server
            env_vars = {
                "GITHUB_PERSONAL_ACCESS_TOKEN": self.github_token,
            }

            # Add optional GitHub Enterprise Server host if provided
            github_host = os.getenv("GITHUB_HOST")
            if github_host:
                env_vars["GITHUB_HOST"] = github_host

            # Add toolsets configuration if provided
            toolsets = os.getenv("GITHUB_TOOLSETS")
            if toolsets:
                env_vars["GITHUB_TOOLSETS"] = toolsets

            # Enable dynamic toolsets if configured
            if os.getenv("GITHUB_DYNAMIC_TOOLSETS"):
                env_vars["GITHUB_DYNAMIC_TOOLSETS"] = os.getenv("GITHUB_DYNAMIC_TOOLSETS")

            # Configure the GitHub MCP server client
            client = MultiServerMCPClient(
                {
                    "github": {
                        "command": "docker",
                        "args": [
                            "run",
                            "-i",
                            "--rm",
                            "-e", f"GITHUB_PERSONAL_ACCESS_TOKEN={self.github_token}",
                        ] + (["-e", f"GITHUB_HOST={github_host}"] if github_host else []) +
                        (["-e", f"GITHUB_TOOLSETS={toolsets}"] if toolsets else []) +
                        (["-e", "GITHUB_DYNAMIC_TOOLSETS=true"] if os.getenv("GITHUB_DYNAMIC_TOOLSETS") else []) +
                        ["ghcr.io/github/github-mcp-server:latest"],
                        "transport": "stdio",
                    }
                }
            )

            # Get tools via the client
            client_tools = await client.get_tools()
            
            # Store tools for later reference
            self.tools_info = {}

            print('*'*80)
            print("🔧 AVAILABLE GITHUB TOOLS AND PARAMETERS")
            print('*'*80)
            for tool in client_tools:
                print(f"📋 Tool: {tool.name}")
                print(f"📝 Description: {tool.description.strip()}")
                
                # Store tool info for later reference
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
                        
                        # Determine requirement status
                        req_status = "🔴 REQUIRED" if is_required else "🟡 OPTIONAL"
                        
                        print(f"   • {param} ({param_type}) - {req_status}")
                        print(f"     Title: {param_title}")
                        print(f"     Description: {param_description}")
                        
                        if default is not None:
                            print(f"     Default: {default}")
                        
                        # Show examples if available
                        if 'examples' in meta:
                            examples = meta['examples']
                            if examples:
                                print(f"     Examples: {examples}")
                        
                        # Show enum values if available
                        if 'enum' in meta:
                            enum_values = meta['enum']
                            print(f"     Allowed values: {enum_values}")
                        
                        print()
                else:
                    print("📥 Parameters: None")
                print("-" * 60)
            print('*'*80)

            # Create the agent with the tools
            print("🔧 Creating agent graph with tools...")
            self.graph = create_react_agent(
                self.model,
                client_tools,
                checkpointer=memory,
                prompt=self.SYSTEM_INSTRUCTION,
                response_format=(self.RESPONSE_FORMAT_INSTRUCTION, ResponseFormat),
            )
            print("✅ Agent graph created successfully!")

            # Test the agent with a simple query
            runnable_config = RunnableConfig(configurable={"thread_id": "init-thread"})
            try:
                llm_result = await self.graph.ainvoke(
                    {"messages": HumanMessage(content="Summarize what GitHub operations you can help with")},
                    config=runnable_config
                )

                # Try to extract meaningful content from the LLM result
                ai_content = None
                for msg in reversed(llm_result.get("messages", [])):
                    if hasattr(msg, "type") and msg.type in ("ai", "assistant") and getattr(msg, "content", None):
                        ai_content = msg.content
                        break
                    elif isinstance(msg, dict) and msg.get("type") in ("ai", "assistant") and msg.get("content"):
                        ai_content = msg["content"]
                        break

                # Print the agent's capabilities
                print("=" * 80)
                print(f"Agent GitHub Capabilities: {ai_content}")
                print("=" * 80)
            except Exception as e:
                logger.error(f"Error testing agent: {e}")
        except Exception as e:
            logger.exception(f"Error initializing agent: {e}")
            self.graph = None

    @trace_agent_stream("github")
    async def stream(self, query: str, context_id: str, trace_id: str = None) -> AsyncIterable[dict[str, Any]]:
        """Stream responses from the agent."""
        logger.info(f"Starting stream with query: {query} and sessionId: {context_id}")

        # Add print statement for new query processing
        print("=" * 80)
        print("🔄 PROCESSING NEW QUERY")
        print("=" * 80)
        print(f"📝 Query: {query}")
        print(f"🆔 Context ID: {context_id}")
        print(f"🔍 Trace ID: {trace_id}")
        print("=" * 80)

        if not self.graph:
            logger.error("Agent graph not initialized")
            yield {
                'is_task_complete': False,
                'require_user_input': True,
                'content': 'GitHub agent is not properly initialized. Please check the logs.',
            }
            return

        # First, analyze the request for tool discovery and missing variables
        # Check if we have a previous analysis for this context
        previous_analysis = self.analysis_states.get(context_id)
        
        if previous_analysis:
            # This is a follow-up message, update the analysis
            analysis_result = self.update_analysis_with_followup(previous_analysis, query)
            print("🔄 Processing follow-up message with updated parameters...")
        else:
            # This is a new request, perform fresh analysis
            analysis_result = self.analyze_request_and_discover_tool(query)
            # Store the analysis for potential follow-up messages
            self.analysis_states[context_id] = analysis_result
        
        # If no tool found or missing required parameters, ask for clarification
        if not analysis_result['tool_found'] or analysis_result['missing_params']:
            message = self.generate_missing_variables_message(analysis_result)
            
            # Create input_fields metadata for dynamic form generation
            input_fields = self.create_input_fields_metadata(analysis_result)
            
            # Create comprehensive metadata
            metadata = {
                'input_fields': input_fields,
                'tool_info': {
                    'name': analysis_result.get('tool_name', ''),
                    'description': analysis_result.get('tool_description', ''),
                    'operation': self.extract_operation_from_tool_name(analysis_result.get('tool_name', ''))
                },
                'context': {
                    'missing_required_count': len(analysis_result.get('missing_params', [])),
                    'total_fields_count': len(input_fields.get('fields', [])),
                    'extracted_count': len(analysis_result.get('extracted_params', {}))
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
        if context_id in self.analysis_states:
            del self.analysis_states[context_id]
        
        # Enhance the query with extracted parameters for better tool selection
        enhanced_query = self.enhance_query_with_parameters(query, analysis_result['extracted_params'])
        
        inputs: dict[str, Any] = {'messages': [HumanMessage(content=enhanced_query)]}
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
                    print("=" * 80)
                    print("🔧 TOOL CALL DETECTED")
                    print("=" * 80)
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
                            
                            print(f"   📥 Required Variables:")
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
                            
                            print(f"   🟡 Optional Variables:")
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
                                        print(f"       Default: None")
                                    print()
                            else:
                                print("     • No optional parameters")
                        else:
                            print(f"   • Tool Description: Not available")
                            print(f"   📥 Tool Arguments:")
                            if args:
                                for key, value in args.items():
                                    print(f"     - {key}: {value}")
                            else:
                                print("     - No arguments provided")
                        
                        print()
                    print("=" * 80)
                    
                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'content': 'Processing GitHub operations...',
                    }
                elif isinstance(message, ToolMessage):
                    # Add detailed print statements for tool results
                    print("=" * 80)
                    print("📤 TOOL RESULT RECEIVED")
                    print("=" * 80)
                    print(f"📋 Tool Name: {getattr(message, 'name', 'Unknown')}")
                    print(f"📋 Tool Call ID: {getattr(message, 'tool_call_id', 'Unknown')}")
                    print(f"📥 Tool Result Content:")
                    content = getattr(message, 'content', '')
                    if content:
                        # Truncate long content for readability
                        if len(content) > 500:
                            print(f"   {content[:500]}... (truncated)")
                        else:
                            print(f"   {content}")
                    else:
                        print("   No content")
                    print("=" * 80)
                    
                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'content': 'Interacting with GitHub API...',
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
                'content': f'An error occurred while processing your GitHub request: {str(e)}',
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
            'content': 'We are unable to process your GitHub request at the moment. Please try again.',
        }

    def analyze_request_and_discover_tool(self, query: str) -> dict:
        """
        Analyze the user's request to discover the appropriate tool and identify missing variables.
        Returns a dictionary with tool information and missing variables.
        """
        print("=" * 80)
        print("🔍 ANALYZING REQUEST FOR TOOL DISCOVERY")
        print("=" * 80)
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
            'create': ['create', 'new', 'make', 'add'],
            'list': ['list', 'get', 'show', 'find', 'search', 'view'],
            'update': ['update', 'modify', 'change', 'edit'],
            'delete': ['delete', 'remove', 'destroy'],
            'close': ['close', 'complete', 'finish'],
            'merge': ['merge', 'combine'],
            'review': ['review', 'approve', 'reject'],
            'comment': ['comment', 'reply', 'respond'],
            'star': ['star', 'favorite', 'bookmark'],
            'fork': ['fork', 'copy'],
            'clone': ['clone', 'download'],
            'push': ['push', 'upload'],
            'pull': ['pull', 'fetch'],
            'branch': ['branch', 'switch'],
            'tag': ['tag', 'release'],
            'issue': ['issue', 'bug', 'problem'],
            'pr': ['pull request', 'pr', 'merge request'],
            'repo': ['repository', 'repo', 'project'],
            'user': ['user', 'profile', 'account'],
            'org': ['organization', 'org', 'team'],
            'file': ['file', 'content', 'code'],
            'commit': ['commit', 'change', 'diff'],
            'workflow': ['workflow', 'action', 'ci'],
            'secret': ['secret', 'token', 'key'],
            'webhook': ['webhook', 'hook'],
            'milestone': ['milestone', 'goal'],
            'label': ['label', 'tag'],
            'assignee': ['assign', 'assignee'],
            'collaborator': ['collaborator', 'member', 'contributor']
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
            
            # Score based on resource keywords in tool name
            resource_keywords = ['repo', 'repository', 'issue', 'pr', 'pull', 'user', 'org', 'file', 'commit', 'branch', 'tag', 'milestone', 'label', 'secret', 'webhook', 'workflow']
            for resource in resource_keywords:
                if resource in name_lower and resource in query_lower:
                    score += 30
                    matched_keywords.append(f"resource:{resource}")
            
            # Special handling for common GitHub operations
            if 'create' in query_lower and 'repository' in query_lower:
                if 'create' in name_lower and 'repository' in name_lower:
                    score += 200  # Very high score for exact match
                    matched_keywords.append("exact_operation:create_repository")
            
            if 'create' in query_lower and 'issue' in query_lower:
                if 'create' in name_lower and 'issue' in name_lower:
                    score += 200
                    matched_keywords.append("exact_operation:create_issue")
            
            if 'create' in query_lower and ('pull' in query_lower or 'pr' in query_lower):
                if 'create' in name_lower and ('pull' in name_lower or 'pr' in name_lower):
                    score += 200
                    matched_keywords.append("exact_operation:create_pull_request")
            
            if 'list' in query_lower and 'repository' in query_lower:
                if 'list' in name_lower and 'repository' in name_lower:
                    score += 150
                    matched_keywords.append("exact_operation:list_repositories")
            
            if 'list' in query_lower and 'issue' in query_lower:
                if 'list' in name_lower and 'issue' in name_lower:
                    score += 150
                    matched_keywords.append("exact_operation:list_issues")
            
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
            
            # Bonus for exact phrase matches in description
            if 'create a new repository' in description.lower() and 'create' in query_lower and 'repository' in query_lower:
                score += 100
                matched_keywords.append("exact_phrase:create_repository")
            
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
            print("=" * 80)
            return {
                'tool_found': False,
                'message': 'No GitHub tools match your request. Please try rephrasing or ask for available operations.'
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
            print(f"🟡 Optional Parameters:")
            for param in optional_params:
                param_info = all_params.get(param, {})
                param_type = param_info.get('type', 'unknown')
                param_desc = param_info.get('description', 'No description')
                default = param_info.get('default', None)
                print(f"   • {param} ({param_type}): {param_desc}")
                if default is not None:
                    print(f"     Default: {default}")
                else:
                    print(f"     Default: None")
                print()
        
        print("=" * 80)
        
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
        Extract potential parameters from the user query using simple pattern matching.
        """
        extracted = {}
        query_lower = query.lower()
        
        for param_name, param_info in all_params.items():
            param_type = param_info.get('type', 'string')
            
            # Try to extract based on parameter name patterns
            if param_type == 'string':
                # Look for quoted strings or common patterns
                import re
                
                # Look for quoted strings
                quotes_pattern = rf'["\']([^"\']*{param_name}[^"\']*)["\']'
                quotes_match = re.search(quotes_pattern, query, re.IGNORECASE)
                if quotes_match:
                    extracted[param_name] = quotes_match.group(1)
                    continue
                
                # Look for parameter name followed by colon or equals
                param_pattern = rf'{param_name}\s*[:=]\s*([^\s,]+)'
                param_match = re.search(param_pattern, query, re.IGNORECASE)
                if param_match:
                    extracted[param_name] = param_match.group(1)
                    continue
                
                # Look for common GitHub patterns
                if param_name in ['owner', 'repo', 'repository']:
                    # Look for owner/repo pattern
                    owner_repo_pattern = r'([a-zA-Z0-9_-]+)/([a-zA-Z0-9_-]+)'
                    owner_repo_match = re.search(owner_repo_pattern, query)
                    if owner_repo_match:
                        if param_name == 'owner':
                            extracted[param_name] = owner_repo_match.group(1)
                        elif param_name in ['repo', 'repository']:
                            extracted[param_name] = owner_repo_match.group(2)
                        continue
                
                # Look for issue/PR numbers
                if param_name in ['issue_number', 'pull_number', 'number']:
                    number_pattern = r'#(\d+)'
                    number_match = re.search(number_pattern, query)
                    if number_match:
                        extracted[param_name] = int(number_match.group(1))
                        continue
                
                # Look for branch names
                if param_name in ['branch', 'ref']:
                    branch_pattern = r'branch\s+([a-zA-Z0-9_-]+)'
                    branch_match = re.search(branch_pattern, query, re.IGNORECASE)
                    if branch_match:
                        extracted[param_name] = branch_match.group(1)
                        continue
                
                # Look for commit hashes
                if param_name in ['sha', 'commit_sha']:
                    sha_pattern = r'[a-fA-F0-9]{7,40}'
                    sha_match = re.search(sha_pattern, query)
                    if sha_match:
                        extracted[param_name] = sha_match.group(0)
                        continue
                
                # Look for labels
                if param_name in ['labels', 'label']:
                    label_pattern = r'label[s]?\s+([a-zA-Z0-9_-]+)'
                    label_match = re.search(label_pattern, query, re.IGNORECASE)
                    if label_match:
                        extracted[param_name] = label_match.group(1)
                        continue
                
                # Look for state values
                if param_name in ['state', 'status']:
                    state_pattern = r'(open|closed|all)'
                    state_match = re.search(state_pattern, query, re.IGNORECASE)
                    if state_match:
                        extracted[param_name] = state_match.group(1).lower()
                        continue
            
            elif param_type == 'integer':
                # Look for numbers
                number_pattern = r'\b(\d+)\b'
                number_match = re.search(number_pattern, query)
                if number_match:
                    extracted[param_name] = int(number_match.group(1))
            
            elif param_type == 'boolean':
                # Look for boolean values
                if 'true' in query_lower or 'yes' in query_lower:
                    extracted[param_name] = True
                elif 'false' in query_lower or 'no' in query_lower:
                    extracted[param_name] = False
        
        return extracted
    
    def generate_missing_variables_message(self, analysis_result: dict) -> str:
        """
        Generate a user-friendly message asking for missing variables using the LLM.
        """
        if not analysis_result['tool_found']:
            return analysis_result['message']
        
        tool_name = analysis_result['tool_name']
        tool_description = analysis_result['tool_description']
        missing_params = analysis_result['missing_params']
        extracted_params = analysis_result['extracted_params']
        all_params = analysis_result['all_params']
        required_params = analysis_result['all_required_params']
        
        # Create a prompt for the LLM to generate a user-friendly message
        prompt = f"""You are a helpful GitHub assistant. The user wants to perform an operation, but some required information is missing.

User's request context: The user is trying to perform a GitHub operation.

Missing required information:
"""
        
        for param in missing_params:
            param_info = all_params.get(param['name'], {})
            param_desc = param_info.get('description', param['description'])
            param_type = param_info.get('type', param['type'])
            prompt += f"- {param['name']} ({param_type}): {param_desc}\n"
        
        if extracted_params:
            prompt += f"\nInformation already provided:\n"
            for param, value in extracted_params.items():
                prompt += f"- {param}: {value}\n"
        
        # Add optional parameters if any
        optional_params = [p for p in all_params.keys() if p not in required_params]
        if optional_params:
            prompt += f"\nOptional information (not required but can be provided):\n"
            for param in optional_params:
                param_info = all_params.get(param, {})
                param_desc = param_info.get('description', 'No description available')
                default = param_info.get('default', None)
                prompt += f"- {param}: {param_desc}"
                if default is not None:
                    prompt += f" (default: {default})"
                prompt += "\n"
        
        prompt += f"""
Please respond in a friendly, conversational way. Ask the user to provide the missing required information. 
Don't mention technical details like tool names or internal processes. 
Focus on what the user needs to provide to complete their request.
Be helpful and guide them naturally.

IMPORTANT: Present ALL fields (both required and optional) in a single list with bullet points.
List required fields first, then optional fields.
For each field, indicate if it's required or optional in the description.
Do not separate them into different sections.

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
                return self.generate_fallback_message(missing_params, extracted_params, optional_params_info)
            
            return response_text
            
        except Exception as e:
            print(f"🤖 LLM message generation failed: {e}")
            optional_params_info = self.get_optional_params_info(all_params, required_params)
            return self.generate_fallback_message(missing_params, extracted_params, optional_params_info)
    
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
    
    def generate_fallback_message(self, missing_params: list, extracted_params: dict, optional_params_info: list) -> str:
        """
        Generate a fallback message if LLM fails.
        """
        if not missing_params and not optional_params_info:
            return "I have all the information I need to help you with your GitHub request!"
        
        message = "I'd be happy to help you with that! Here's what I need:\n\n"
        
        # Combine all fields and sort: required first, then optional
        all_fields = []
        
        # Add missing required fields
        for param in missing_params:
            all_fields.append({
                'name': param['name'],
                'description': param['description'],
                'required': True
            })
        
        # Add optional fields
        for param in optional_params_info:
            all_fields.append({
                'name': param['name'],
                'description': param['description'],
                'required': False,
                'default': param.get('default')
            })
        
        # Sort: required first, then optional, then alphabetically within each group
        all_fields.sort(key=lambda x: (not x['required'], x['name']))
        
        # Generate the list
        for field in all_fields:
            status = "**REQUIRED**" if field['required'] else "optional"
            message += f"• **{field['name']}** ({status}): {field['description']}"
            if not field['required'] and field.get('default') is not None:
                message += f" (default: {field['default']})"
            message += "\n"
        
        if extracted_params:
            message += f"\n**I already have:** {', '.join([f'{k}: {v}' for k, v in extracted_params.items()])}\n"
        
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
        
        enhanced_query += "\nPlease use these parameters when executing the appropriate GitHub tool."
        
        return enhanced_query

    def update_analysis_with_followup(self, original_analysis: dict, followup_query: str) -> dict:
        """
        Update the original analysis with new parameters from a follow-up message.
        """
        if not original_analysis['tool_found']:
            return original_analysis
        
        # Extract additional parameters from the followup query
        additional_params = self.extract_parameters_from_query(followup_query, original_analysis['all_params'])
        
        # Merge with original extracted parameters
        updated_params = original_analysis['extracted_params'].copy()
        updated_params.update(additional_params)
        
        # Re-check for missing parameters
        missing_params = []
        for param in original_analysis['all_required_params']:
            if param not in updated_params:
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
            'extracted_params': updated_params,
            'missing_params': missing_params,
            'all_required_params': original_analysis['all_required_params'],
            'all_params': original_analysis['all_params']
        }

    def create_input_fields_metadata(self, analysis_result: dict) -> dict:
        """
        Create structured input fields metadata for dynamic form generation.
        """
        if not analysis_result['tool_found']:
            return {}
        
        all_params = analysis_result['all_params']
        required_params = analysis_result['all_required_params']
        extracted_params = analysis_result['extracted_params']
        
        input_fields = {
            'fields': [],
            'extracted': extracted_params
        }
        
        # Process all parameters (both required and optional)
        for param_name in all_params.keys():
            param_info = all_params.get(param_name, {})
            is_required = param_name in required_params
            
            # Only include missing required parameters and all optional parameters
            if is_required and param_name in extracted_params:
                continue  # Skip required params that are already provided
            
            field_info = {
                'name': param_name,
                'type': param_info.get('type', 'string'),
                'title': param_info.get('title', param_name),
                'description': param_info.get('description', 'No description available'),
                'required': is_required
            }
            
            # Add additional metadata
            if 'default' in param_info:
                field_info['default'] = param_info['default']
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
            
            input_fields['fields'].append(field_info)
        
        # Sort fields: required fields first, then optional fields
        input_fields['fields'].sort(key=lambda x: (not x['required'], x['name']))
        
        return input_fields

    def extract_operation_from_tool_name(self, tool_name: str) -> str:
        """
        Extract a human-readable operation name from the tool name.
        """
        if not tool_name:
            return ''
        
        # Common operation mappings
        operation_mappings = {
            'create_repository': 'Create Repository',
            'create_issue': 'Create Issue',
            'create_pull_request': 'Create Pull Request',
            'list_repositories': 'List Repositories',
            'list_issues': 'List Issues',
            'list_pull_requests': 'List Pull Requests',
            'update_issue': 'Update Issue',
            'close_issue': 'Close Issue',
            'merge_pull_request': 'Merge Pull Request',
            'add_comment': 'Add Comment',
            'star_repository': 'Star Repository',
            'fork_repository': 'Fork Repository',
            'create_branch': 'Create Branch',
            'delete_branch': 'Delete Branch',
            'create_tag': 'Create Tag',
            'create_milestone': 'Create Milestone',
            'add_label': 'Add Label',
            'assign_issue': 'Assign Issue',
            'add_collaborator': 'Add Collaborator',
            'create_webhook': 'Create Webhook',
            'create_secret': 'Create Secret'
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

    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

    def generate_low_confidence_message(self, query: str, candidate_tools: list) -> str:
        """
        Generate a message asking for clarification when tool selection confidence is low.
        """
        if not candidate_tools:
            return "I'm not sure what GitHub operation you'd like to perform. Could you please be more specific?"
        
        # Create a prompt for the LLM to generate a user-friendly clarification message
        prompt = f"""You are a helpful GitHub assistant. The user made a request, but I'm not completely confident about which GitHub operation they want to perform.

User's request: "{query}"

Possible operations I'm considering:
"""
        
        for i, tool in enumerate(candidate_tools):
            prompt += f"{i+1}. {tool['name']}: {tool['description']}\n"
        
        prompt += f"""
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
        message = f"I'm not completely sure what you'd like to do with GitHub. Could you please clarify?\n\n"
        message += "Based on your request, I think you might want to:\n"
        
        for i, tool in enumerate(candidate_tools[:3]):  # Show top 3
            # Extract a human-readable operation name
            operation_name = self.extract_operation_from_tool_name(tool['name'])
            message += f"• {operation_name}\n"
        
        message += f"\nCould you please be more specific about what you'd like to do?"
        
        return message