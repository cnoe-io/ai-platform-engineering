# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Petstore Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.subagent_prompts import load_subagent_prompt_config
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


# Load prompt configuration from YAML
_prompt_config = load_subagent_prompt_config("petstore")


class PetStoreAgent(BaseLangGraphAgent):
    """Petstore Agent for managing Petstore API operations."""

    SYSTEM_INSTRUCTION = _prompt_config.get_system_instruction()

    RESPONSE_FORMAT_INSTRUCTION: str = _prompt_config.response_format_instruction

    def __init__(self):
        # Call parent __init__ first to set up model, tracing, etc.
        super().__init__()

        # Preserve existing MCP configuration logic for HTTP mode support
        self.mcp_mode = os.getenv("MCP_MODE", "stdio").lower()

        # Support both PETSTORE_MCP_API_KEY and PETSTORE_API_KEY for backward compatibility
        self.mcp_api_key = (
            os.getenv("PETSTORE_MCP_API_KEY")
            or os.getenv("PETSTORE_API_KEY")
        )
        if not self.mcp_api_key and self.mcp_mode != "stdio":
            raise ValueError(
                "PETSTORE_MCP_API_KEY or PETSTORE_API_KEY must be set as an environment variable for HTTP transport."
            )

        self.mcp_api_url = os.getenv("PETSTORE_MCP_API_URL")
        # Defaults for each transport mode
        if not self.mcp_api_url:
            if self.mcp_mode == "stdio":
                self.mcp_api_url = "https://petstore.swagger.io/v2"
            else:
                self.mcp_api_url = "https://petstore.outshift.io/mcp"

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "petstore"

    def get_system_instruction(self) -> str:
        """Return the system instruction for the agent."""
        return self.SYSTEM_INSTRUCTION

    def get_response_format_instruction(self) -> str:
        """Return the response format instruction."""
        return self.RESPONSE_FORMAT_INSTRUCTION

    def get_response_format_class(self) -> type[BaseModel]:
        """Return the response format class."""
        return ResponseFormat

    def get_mcp_config(self, server_path: str) -> dict:
        """Return MCP configuration for Petstore."""
        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "MCP_API_KEY": self.mcp_api_key or "",
                "MCP_API_URL": self.mcp_api_url
            },
            "transport": "stdio",
        }

    def get_mcp_http_config(self) -> dict | None:
        """Return HTTP MCP configuration for Petstore."""
        if self.mcp_mode not in ("http", "streamable_http"):
            return None

        return {
            "url": self.mcp_api_url,
            "headers": {
                "Authorization": f"Bearer {self.mcp_api_key}",
            },
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return _prompt_config.tool_working_message

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return _prompt_config.tool_processing_message

    @trace_agent_stream("petstore")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with petstore-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event