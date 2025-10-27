# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Confluence Agent implementation using common A2A base classes."""

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


class ConfluenceAgent(BaseLangGraphAgent):
    """Confluence Agent for wiki and documentation management."""

    SYSTEM_INSTRUCTION = scope_limited_agent_instruction(
        service_name="Confluence",
        service_operations="manage pages, spaces, and blog posts",
        additional_guidelines=[
            "Perform CRUD operations on Confluence content",
            "When searching or filtering pages by date (created, modified), use the current date provided above as reference",
            "Help users find recently updated or created documentation"
        ],
        include_error_handling=True,  # Real Confluence API calls
        include_date_handling=True    # Enable date handling
    )

    RESPONSE_FORMAT_INSTRUCTION = """Select status as completed if the request is complete.
    Select status as input_required if the input is a question to the user.
    Set response status to error if the input indicates an error."""

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "confluence"

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
        """Return MCP configuration for Confluence."""
        confluence_token = os.getenv("ATLASSIAN_TOKEN")
        if not confluence_token:
            raise ValueError("ATLASSIAN_TOKEN must be set as an environment variable.")

        confluence_api_url = os.getenv("CONFLUENCE_API_URL")
        if not confluence_api_url:
            raise ValueError("CONFLUENCE_API_URL must be set as an environment variable.")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "ATLASSIAN_TOKEN": confluence_token,
                "CONFLUENCE_API_URL": confluence_api_url,
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return 'Querying Confluence...'

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return 'Processing Confluence data...'

    @trace_agent_stream("confluence")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with confluence-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event
