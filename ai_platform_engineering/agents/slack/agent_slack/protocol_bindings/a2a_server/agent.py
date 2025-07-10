# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import asyncio
import os
import importlib.util
from pathlib import Path
from typing import Any, Literal, AsyncIterable

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from langchain_core.runnables.config import RunnableConfig
from pydantic import BaseModel

from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent

from cnoe_agent_utils import LLMFactory

logger = logging.getLogger(__name__)

memory = MemorySaver()

class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str

class SlackAgent:
    """Slack Agent using A2A protocol."""

    SYSTEM_INSTRUCTION = (
      'You are an expert assistant for Slack integration and operations. '
      'Your purpose is to help users interact with Slack workspaces, channels, and messages. '
      'Use the available Slack tools to interact with the Slack API and provide accurate, '
      'actionable responses. If the user asks about anything unrelated to Slack, politely state '
      'that you can only assist with Slack operations. Do not attempt to answer unrelated questions '
      'or use tools for other purposes.'
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete. '
        'Select status as input_required if the input is a question to the user. '
        'Set response status to error if the input indicates an error.'
    )

    def __init__(self):
        self.slack_token = os.getenv("SLACK_BOT_TOKEN")
        if not self.slack_token:
            logger.warning("SLACK_BOT_TOKEN not set, Slack integration will be limited")

        # Initialize the model if credentials are available
        self.model = LLMFactory().get_llm()

        self.graph = None

        # Find installed path of the slack_mcp sub-module
        spec = importlib.util.find_spec("agent_slack.protocol_bindings.mcp_server.mcp_slack.server")
        if not spec or not spec.origin:
            try:
                spec = importlib.util.find_spec("agent_slack.protocol_bindings.mcp_server.mcp_slack.server")
                if not spec or not spec.origin:
                    raise ImportError("Cannot find slack_mcp server module")
            except ImportError:
                logger.error("Cannot find slack_mcp server module in any known location")
                raise ImportError("Cannot find slack_mcp server module in any known location")

        self.server_path = str(Path(spec.origin).resolve())
        logger.info(f"Found Slack MCP server path: {self.server_path}")

        # Initialize the agent
        asyncio.run(self._initialize_agent())

    async def _initialize_agent(self):
        """Initialize the agent with tools and configuration."""
        if not self.model:
            logger.error("Cannot initialize agent without a valid model")
            return

        logger.info(f"Launching MCP server at: {self.server_path}")

        try:
            client = MultiServerMCPClient(
                {
                    "slack": {
                        "command": "uv",
                        "args": ["run", self.server_path],
                        "env": {
                            "SLACK_BOT_TOKEN": self.slack_token,
                        },
                        "transport": "stdio",
                    }
                }
            )

            # Get tools via the client
            client_tools = await client.get_tools()

            print('*'*80)
            print("Available Slack Tools and Parameters:")
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
                    {"messages": HumanMessage(content="Summarize what Slack operations you can help with")},
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
                print(f"Agent Slack Capabilities: {ai_content}")
                print("=" * 80)
            except Exception as e:
                logger.error(f"Error testing agent: {e}")
        except Exception as e:
            logger.exception(f"Error initializing agent: {e}")
            self.graph = None

    async def stream(self, query: str, context_id: str) -> AsyncIterable[dict[str, Any]]:
        """Stream responses from the agent."""
        logger.info(f"Starting stream with query: {query} and context_id: {context_id}")

        if not self.graph:
            logger.error("Agent graph not initialized")
            yield {
                'is_task_complete': False,
                'require_user_input': True,
                'content': 'Slack agent is not properly initialized. Please check the logs.',
            }
            return

        inputs: dict[str, Any] = {'messages': [HumanMessage(content=query)]}
        config: RunnableConfig = {'configurable': {'thread_id': context_id}}

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
                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'content': 'Processing Slack operations...',
                    }
                elif isinstance(message, ToolMessage):
                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'content': 'Interacting with Slack API...',
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
                'content': f'An error occurred while processing your Slack request: {str(e)}',
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
            'content': 'We are unable to process your Slack request at the moment. Please try again.',
        }

    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']