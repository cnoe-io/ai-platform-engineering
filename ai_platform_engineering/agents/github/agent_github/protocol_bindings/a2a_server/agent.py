# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import asyncio
import os
import uuid
from typing import Any, Literal, AsyncIterable, Optional
from contextvars import ContextVar

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from langchain_core.runnables.config import RunnableConfig
from pydantic import BaseModel

from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent

from cnoe_agent_utils import LLMFactory

# Conditional langfuse import based on ENABLE_TRACING
if os.getenv("ENABLE_TRACING", "false").lower() == "true":
    from langfuse import get_client
    from langfuse.langchain import CallbackHandler
    langfuse_handler = CallbackHandler()
else:
    langfuse_handler = None

logger = logging.getLogger(__name__)

# Local context variable for trace ID (since running in separate container)
current_trace_id: ContextVar[Optional[str]] = ContextVar('current_trace_id', default=None)

async def _process_graph_stream(graph, inputs, config):
    """Process graph stream and yield appropriate events."""
    async for item in graph.astream(inputs, config, stream_mode='values'):
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
            yield {
                'is_task_complete': False,
                'require_user_input': False,
                'content': 'Processing GitHub operations...',
            }
        elif isinstance(message, ToolMessage):
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
      'or use tools for other purposes.'
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

        # Initialize the agent
        asyncio.run(self._initialize_agent())

    async def _initialize_agent(self):
        """Initialize the agent with tools and configuration."""
        if not self.model:
            logger.error("Cannot initialize agent without a valid model")
            return

        logger.info("Launching GitHub MCP server")

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

            print('*'*80)
            print("Available GitHub Tools and Parameters:")
            for tool in client_tools:
                print(f"Tool: {tool.name}")
                print(f"  Description: {tool.description.strip().splitlines()[0]}")
                params = tool.args_schema.get('properties', {})
                if params:
                    print("  Parameters:")
                    for param, meta in params.items():
                        param_type = meta.get('type', 'unknown')
                        param_title = meta.get('title', param)
                        default = meta.get('default', None)
                        print(f"    - {param} ({param_type}): {param_title}", end='')
                        if default is not None:
                            print(f" [default: {default}]")
                        else:
                            print()
                else:
                    print("  Parameters: None")
                print()
            print('*'*80)

            # Create the agent with the tools
            self.graph = create_react_agent(
                self.model,
                client_tools,
                checkpointer=memory,
                prompt=self.SYSTEM_INSTRUCTION,
                response_format=(self.RESPONSE_FORMAT_INSTRUCTION, ResponseFormat),
            )

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

    async def stream(self, query: str, context_id: str, trace_id: str = None) -> AsyncIterable[dict[str, Any]]:
        """Stream responses from the agent."""
        logger.info(f"🔍 GitHub Agent stream started - query: {query}, context_id: {context_id}")
        logger.info(f"🔍 Tracing enabled: {langfuse_handler is not None}")
        
        if not self.graph:
            logger.error("Agent graph not initialized")
            yield {
                'is_task_complete': False,
                'require_user_input': True,
                'content': 'GitHub agent is not properly initialized. Please check the logs.',
            }
            return

        inputs: dict[str, Any] = {'messages': [HumanMessage(content=query)]}
        
        config: RunnableConfig = {'configurable': {'thread_id': context_id}}
        if langfuse_handler:
            logger.info(f"🔍 Adding Langfuse callback handler with context_id as trace_id: {context_id}")
            config['callbacks'] = [langfuse_handler]
        else:
            logger.info("🔍 No Langfuse handler - tracing disabled or not available")

        try:
            # Log trace ID status
            if not trace_id:
                logger.warning(f"🔍 GitHub Agent - NO trace_id provided from supervisor for context_id: {context_id}")
                logger.warning("🔍 GitHub Agent - This indicates a problem with trace ID propagation")
            else:
                logger.info(f"🔍 GitHub Agent - using SUPERVISOR trace_id: {trace_id} for context_id: {context_id}")
            
            # Set trace_id in context variable for tools to access
            current_trace_id.set(trace_id)
            
            if langfuse_handler:
                # Tracing execution path
                langfuse = get_client()
                with langfuse.start_as_current_span(
                    name="🤖-github-agent",
                    trace_context={"trace_id": trace_id}
                ) as span:
                    # Set trace name and metadata
                    span.update_trace(
                        name="🤖-github-agent",
                        input=query,
                        metadata={
                            "agent_type": "github",
                            "context_id": context_id,
                            "trace_id": trace_id
                        }
                    )
                    
                    async for event in _process_graph_stream(self.graph, inputs, config):
                        yield event
                    
                    # Get the final response before updating trace
                    result = self.get_agent_response(config)
                    span.update_trace(output=result['content'])
                    yield result
                    return
            else:
                # Non-tracing execution path
                async for event in _process_graph_stream(self.graph, inputs, config):
                    yield event
                
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

    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']