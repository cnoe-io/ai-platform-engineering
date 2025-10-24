# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Webex Agent using BaseLangGraphAgent for consistent streaming behavior.
"""

import logging
import os
from typing import Dict, Any, Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.prompt_templates import scope_limited_agent_instruction

logger = logging.getLogger(__name__)


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""
    status: Literal["input_required", "completed", "error"] = "input_required"
    message: str


class WebexAgent(BaseLangGraphAgent):
    """Webex Agent using BaseLangGraphAgent for consistent streaming."""

    SYSTEM_INSTRUCTION = scope_limited_agent_instruction(
        service_name="Webex",
        service_operations="look up rooms, send messages to users or spaces or rooms",
        additional_guidelines=["Always use the available Webex tools to interact with users on Webex"],
        include_error_handling=True  # Real Webex API calls
    )

    RESPONSE_FORMAT_INSTRUCTION = (
        "Select status as completed if the request is complete. "
        "Select status as input_required if the input is a question to the user. "
        "Set response status to error if the input indicates an error."
    )

    def __init__(self):
        """Initialize Webex agent."""
        self.mcp_mode = os.getenv("MCP_MODE", "stdio").lower()
        self.mcp_host = os.getenv("MCP_HOST")
        self.mcp_port = os.getenv("MCP_PORT")

        # Call parent constructor
        super().__init__()

    def get_agent_name(self) -> str:
        """Return the agent name."""
        return "webex"

    def get_mcp_http_config(self) -> Dict[str, Any] | None:
        """
        Return custom HTTP MCP configuration for Webex API if in HTTP mode.
        """
        if self.mcp_mode in ("http", "streamable_http") and self.mcp_host and self.mcp_port:
            mcp_url = f"http://{self.mcp_host}:{self.mcp_port}/mcp"
            logger.info(f"Using HTTP transport for Webex MCP: {mcp_url}")
            return {
                "url": mcp_url,
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
                f"Webex agent in {self.mcp_mode} mode should use get_mcp_http_config(). "
                "This method is only for stdio mode."
            )

        logger.info("Using stdio for Webex MCP client")

        # Get Webex token
        webex_token = os.getenv("WEBEX_TOKEN")
        if not webex_token:
            raise ValueError("WEBEX_TOKEN must be set as an environment variable.")

        # Default server path if not provided
        if not server_path:
            server_path = "./mcp/mcp_server_webex/"

        return {
            "webex": {
                "command": "uv",
                "args": [
                    "--directory",
                    server_path,
                    "run",
                    "mcp-server-webex",
                ],
                "env": {
                    "WEBEX_TOKEN": webex_token,
                },
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
