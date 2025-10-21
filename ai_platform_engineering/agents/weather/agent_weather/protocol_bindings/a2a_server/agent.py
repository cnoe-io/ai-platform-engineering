# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Weather Agent using BaseLangGraphAgent for consistent streaming behavior.
"""

import logging
import os
from typing import Dict, Any, Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent

logger = logging.getLogger(__name__)


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""
    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class WeatherAgent(BaseLangGraphAgent):
    """Weather Agent using BaseLangGraphAgent for consistent streaming."""

    SYSTEM_INSTRUCTION = (
        'You are an expert assistant for Weather integration and operations. '
        'Your purpose is to help users get weather information. '
        'Use the available Weather tools to interact with the Weather API and provide accurate, '
        'actionable responses. If the user asks about anything unrelated to Weather, politely state '
        'that you can only assist with Weather operations. Do not attempt to answer unrelated questions '
        'or use tools for other purposes. Show weather in Fahrenheit for US cities and Celsius for European cities.\n\n'

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

    RESPONSE_FORMAT_INSTRUCTION = (
        'Select status as completed if the request is complete. '
        'Select status as input_required if the input is a question to the user. '
        'Set response status to error if the input indicates an error.'
    )

    def __init__(self):
        """Initialize Weather agent."""
        self.mcp_mode = os.getenv("MCP_MODE", "stdio").lower()
        self.mcp_api_url = os.getenv("WEATHER_MCP_API_URL")
        
        # Defaults for HTTP transport mode
        if not self.mcp_api_url and self.mcp_mode != "stdio":
            self.mcp_api_url = "https://weather.outshift.io/mcp"
        
        # Call parent constructor
        super().__init__()

    def get_agent_name(self) -> str:
        """Return the agent name."""
        return "weather"

    def get_mcp_http_config(self) -> Dict[str, Any] | None:
        """
        Return custom HTTP MCP configuration for Weather API if in HTTP mode.
        """
        if self.mcp_mode in ("http", "streamable_http") and self.mcp_api_url:
            logger.info(f"Using HTTP transport for Weather MCP: {self.mcp_api_url}")
            return {
                "url": self.mcp_api_url,
                "headers": {},
            }
        return None

    def get_mcp_config(self, server_path: str | None = None) -> Dict[str, Any]:
        """
        Return MCP configuration for stdio mode.
        
        This is used when MCP_MODE is 'stdio' (default).
        """
        if self.mcp_mode != "stdio":
            raise NotImplementedError(
                f"Weather agent in {self.mcp_mode} mode should use get_mcp_http_config(). "
                "This method is only for stdio mode."
            )
        
        logger.info("Using Docker-in-Docker for Weather MCP client")
        
        # Prepare environment variables for Weather MCP server
        env_vars = []
        
        # Add optional Weather host if provided
        weather_host = os.getenv("WEATHER_HOST")
        if weather_host:
            env_vars.extend(["-e", f"WEATHER_HOST={weather_host}"])
        
        # Add toolsets configuration if provided
        toolsets = os.getenv("WEATHER_TOOLSETS")
        if toolsets:
            env_vars.extend(["-e", f"WEATHER_TOOLSETS={toolsets}"])
        
        # Add dynamic toolsets if enabled
        if os.getenv("WEATHER_DYNAMIC_TOOLSETS"):
            env_vars.extend(["-e", "WEATHER_DYNAMIC_TOOLSETS=true"])
        
        return {
            "weather": {
                "command": "docker",
                "args": [
                    "run",
                    "-i",
                    "--rm",
                ] + env_vars + [
                    "ghcr.io/cisco-outshift/mcp-server-weather:latest"
                ],
                "transport": "stdio",
            }
        }

    def get_system_instruction(self) -> str:
        """Return the system instruction for the agent."""
        return self.SYSTEM_INSTRUCTION

    def get_response_format_class(self):
        """Return the response format class."""
        return ResponseFormat

    def get_response_format_instruction(self) -> str:
        """Return the response format instruction."""
        return self.RESPONSE_FORMAT_INSTRUCTION

    def get_tool_working_message(self) -> str:
        """Return the message shown when a tool is being invoked."""
        return "🔧 Calling tool: **{tool_name}**"

    def get_tool_processing_message(self) -> str:
        """Return the message shown when processing tool results."""
        return "✅ Tool **{tool_name}** completed"
