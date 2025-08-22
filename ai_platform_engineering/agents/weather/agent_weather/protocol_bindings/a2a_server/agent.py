# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import os
import re
from datetime import datetime
from typing import Any, Literal, AsyncIterable, Type, Optional

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from langchain_core.runnables.config import RunnableConfig
from langchain_core.tools import BaseTool
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

class WeatherAgent:
    """Weather Agent using A2A protocol."""

    SYSTEM_INSTRUCTION = (
      'You are an expert assistant for Weather integration and operations. '
      'Your purpose is to help users get weather information. '
      'Use the available Weather tools to interact with the Weather API and provide accurate, '
      'actionable responses. If the user asks about anything unrelated to Weather, politely state '
      'that you can only assist with Weather operations. Do not attempt to answer unrelated questions '
      'or use tools for other purposes.\n\n'

      'TOOL USAGE GUIDELINES:\n'
      '1. get_current_weather: Use for current weather conditions (e.g., "What\'s the weather like now in Paris?")\n'
      '2. get_weather_by_datetime_range: Use for future or past weather within a date range (e.g., "Will it rain tomorrow?", "Weather forecast for next week")\n'
      '3. get_current_datetime: Use to get the current time in any timezone when you need to calculate relative dates\n\n'

      'HANDLING RELATIVE DATES:\n'
      '- For questions about "tomorrow", "next week", "yesterday", etc., FIRST call get_current_datetime to get the current date\n'
      '- Then calculate the target date(s) and use get_weather_by_datetime_range\n'
      '- Always use YYYY-MM-DD format for dates in API calls\n'
      '- For "tomorrow" queries, set start_date and end_date to the same date (tomorrow\'s date)\n\n'

      'EXAMPLES:\n'
      '- "Will it rain tomorrow in Paris?" → get_current_datetime(timezone_name="Europe/Paris") → get_weather_by_datetime_range(city="Paris", start_date="2024-01-15", end_date="2024-01-15")\n'
      '- "What\'s the weather now?" → get_current_weather(city="[location]")\n'
      '- "Weather forecast for this weekend?" → get_current_datetime → get_weather_by_datetime_range with weekend dates'
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete. '
        'Select status as input_required if the input is a question to the user. '
        'Set response status to error if the input indicates an error.'
    )

    def __init__(self):
        self.model = LLMFactory().get_llm()
        self.graph = None
        self.tracing = TracingManager()
        self._initialized = False

        self.mcp_mode = os.getenv("MCP_MODE", "stdio").lower()

        self.mcp_api_key = os.getenv("WEATHER_MCP_API_KEY")
        if not self.mcp_api_key and self.mcp_mode != "stdio":
            raise ValueError("WEATHER_MCP_API_KEY must be set as an environment variable for HTTP transport.")

        self.mcp_api_url = os.getenv("WEATHER_MCP_API_URL")
        # Defaults for each transport mode
        if not self.mcp_api_url and self.mcp_mode != "stdio":
            self.mcp_api_url = "https://weather.outshift.io/mcp"

    async def _initialize_agent(self):
        """Initialize the agent with tools and configuration."""
        if self._initialized:
            return

        if not self.model:
            logger.error("Cannot initialize agent without a valid model")
            return

        logger.info("Launching Weather MCP server")

        try:
            # Prepare environment variables for Weather MCP server
            env_vars = {}

            # Add optional Weather Enterprise Server host if provided
            weather_host = os.getenv("WEATHER_HOST")
            if weather_host:
                env_vars["WEATHER_HOST"] = weather_host

            # Add toolsets configuration if provided
            toolsets = os.getenv("WEATHER_TOOLSETS")
            if toolsets:
                env_vars["WEATHER_TOOLSETS"] = toolsets

            # Enable dynamic toolsets if configured
            if os.getenv("WEATHER_DYNAMIC_TOOLSETS"):
                env_vars["WEATHER_DYNAMIC_TOOLSETS"] = os.getenv("WEATHER_DYNAMIC_TOOLSETS")

            # Log what's being requested and current support
            if self.mcp_mode == "http" or self.mcp_mode == "streamable_http":

                logger.info(f"Using HTTP transport for MCP client: {self.mcp_api_url}")

                client = MultiServerMCPClient(
                    {
                        "weather": {
                            "transport": "streamable_http",
                            "url": self.mcp_api_url,
                            "headers": {
                                "Authorization": f"Bearer {self.mcp_api_key}",
                            },
                        }
                    }
                )

            else:
                logger.info("Using mcp_weather_server package with stdio transport")

                client = MultiServerMCPClient(
                    {
                        "weather": {
                            "command": "uv",
                            "args": ["run", "mcp_weather_server"],
                            "env": env_vars,
                            "transport": "stdio",
                        }
                    }
                )

            # Get tools via the client
            client_tools = await client.get_tools()

            # Create wrapper tools to fix TimeResult issue
            def create_tool_wrapper(original_tool):
                """Create a wrapper tool that fixes TimeResult issues"""

                class WrappedTool(BaseTool):
                    name: str = original_tool.name
                    description: str = original_tool.description
                    args_schema: Optional[Type[BaseModel]] = original_tool.args_schema

                    async def _arun(self, **kwargs) -> Any:
                        """Wrapper tool that fixes TimeResult object conversion to string"""
                        try:
                            # Call the original tool with the input dictionary
                            result = await original_tool.ainvoke(kwargs)

                            # Fix get_current_datetime TimeResult bug
                            if original_tool.name == 'get_current_datetime':
                                logger.debug(f"🔧 Processing get_current_datetime result: {result} (type: {type(result)})")

                                # Check if result is a TimeResult object directly
                                if hasattr(result, 'current_time'):
                                    fixed_time = str(result.current_time)
                                    logger.info(f"🔧 Fixed TimeResult bug: extracted current_time={fixed_time}")
                                    return fixed_time

                                # Fallback: Check if result contains TimeResult in string representation
                                result_str = str(result)
                                if 'TimeResult' in result_str:
                                    # Extract the actual time from TimeResult string
                                    datetime_match = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})', result_str)
                                    if datetime_match:
                                        fixed_time = datetime_match.group(1)
                                        logger.info(f"🔧 Fixed TimeResult bug via regex: extracted {fixed_time}")
                                        return fixed_time

                            return result
                        except Exception as e:
                                                        # Special handling for get_current_datetime TimeResult validation errors
                            if original_tool.name == 'get_current_datetime' and 'TimeResult' in str(e):
                                logger.info(f"🔧 Caught TimeResult validation error: {e}")

                                # Extract datetime from the error message - handle truncated format
                                error_str = str(e)

                                # Pattern 1: Look for any ISO datetime in the error (most reliable)
                                datetime_match = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})', error_str)
                                if datetime_match:
                                    fixed_time = datetime_match.group(1)
                                    logger.info(f"🔧 Fixed TimeResult from exception (ISO format): extracted {fixed_time}")
                                    return fixed_time

                                # Pattern 2: Handle truncated timezone format like "TimeResult(timezone='Euro...5-08-18T15:05:53+02:00')"
                                truncated_match = re.search(r"TimeResult\(timezone='[^']*\.\.\.(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})", error_str)
                                if truncated_match:
                                    fixed_time = truncated_match.group(1)
                                    logger.info(f"🔧 Fixed TimeResult from truncated pattern: extracted {fixed_time}")
                                    return fixed_time

                                # Pattern 3: Try the full format (fallback)
                                timezone_match = re.search(r"TimeResult\(timezone='([^']+)', current_time='([^']+)'\)", error_str)
                                if timezone_match:
                                    fixed_time = timezone_match.group(2)
                                    logger.info(f"🔧 Fixed TimeResult from full pattern: extracted {fixed_time}")
                                    return fixed_time

                                logger.warning(f"🔧 Could not extract datetime from TimeResult error: {error_str}")
                                # Return a fallback datetime if we can't extract it
                                fallback_time = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
                                logger.info(f"🔧 Using fallback datetime: {fallback_time}")
                                return fallback_time

                            logger.error(f"Error in wrapper tool {original_tool.name}: {e}")
                            raise e  # Re-raise the exception if we can't fix it

                    def _run(self, **kwargs) -> Any:
                        """Sync version - not used but required by BaseTool"""
                        raise NotImplementedError("Use async version")

                return WrappedTool()

            # Apply tool wrappers to fix specific issues
            wrapped_tools = []
            for tool in client_tools:
                if tool.name == 'get_current_datetime':
                    # Apply wrapper to fix TimeResult issue
                    wrapped_tool = create_tool_wrapper(tool)
                    wrapped_tools.append(wrapped_tool)
                    logger.info(f"🔧 Applied TimeResult fix wrapper to {tool.name}")
                else:
                    # Use original tool as-is
                    wrapped_tools.append(tool)

            client_tools = wrapped_tools

            print('*'*80)
            print("Available Weather Tools and Parameters:")
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
                    {"messages": HumanMessage(content="Summarize what Weather operations you can help with")},
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
                print(f"Agent Weather Capabilities: {ai_content}")
                print("=" * 80)
            except Exception as e:
                logger.error(f"Error testing agent: {e}")

            self._initialized = True
        except Exception as e:
            logger.exception(f"Error initializing agent: {e}")
            self.graph = None

    @trace_agent_stream("weather")
    async def stream(self, query: str, context_id: str, trace_id: str = None) -> AsyncIterable[dict[str, Any]]:
        """Stream responses from the agent."""
        logger.info(f"Starting stream with query: {query} and sessionId: {context_id}")

        # Initialize the agent if not already done
        await self._initialize_agent()

        if not self.graph:
            logger.error("Agent graph not initialized")
            yield {
                'is_task_complete': False,
                'require_user_input': True,
                'content': 'Weather agent is not properly initialized. Please check the logs.',
            }
            return

        inputs: dict[str, Any] = {'messages': [HumanMessage(content=query)]}
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
                    # Log tool calls for debugging
                    for tool_call in message.tool_calls:
                        logger.info(f"🔧 LLM calling tool: {tool_call['name']} with args: {tool_call['args']}")

                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'content': 'Processing Weather operations...',
                    }
                elif isinstance(message, ToolMessage):
                    # Log tool results for debugging
                    tool_name = getattr(message, 'name', 'unknown')
                    logger.info(f"🛠️ Tool result from {tool_name}: {message.content[:200]}...")

                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'content': 'Interacting with Weather API...',
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
                'content': f'An error occurred while processing your Weather request: {str(e)}',
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
            'content': 'We are unable to process your Weather request at the moment. Please try again.',
        }
