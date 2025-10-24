# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Backstage Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.prompt_templates import scope_limited_agent_instruction
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class BackstageAgent(BaseLangGraphAgent):
    """Backstage Agent for catalog and service management."""

    SYSTEM_INSTRUCTION = scope_limited_agent_instruction(
        service_name="Backstage",
        service_operations="manage and query information about services, components, APIs, and resources",
        additional_guidelines=[
            "Perform actions like creating, updating, or deleting catalog entities",
            "Manage documentation and handle plugin configurations"
        ],
        include_error_handling=True  # Real Backstage API calls
    )

    RESPONSE_FORMAT_INSTRUCTION = """Select status as completed if the request is complete.
    Select status as input_required if the input is a question to the user.
    Set response status to error if the input indicates an error."""

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "backstage"

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
        """Return MCP configuration for Backstage."""
        backstage_api_token = os.getenv("BACKSTAGE_API_TOKEN")
        if not backstage_api_token:
            raise ValueError("BACKSTAGE_API_TOKEN must be set as an environment variable.")

        backstage_url = os.getenv("BACKSTAGE_URL")
        if not backstage_url:
            raise ValueError("BACKSTAGE_URL must be set as an environment variable.")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "BACKSTAGE_API_TOKEN": backstage_api_token,
                "BACKSTAGE_URL": backstage_url,
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return 'Querying Backstage...'

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return 'Processing Backstage data...'

    @trace_agent_stream("backstage")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with backstage-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event
