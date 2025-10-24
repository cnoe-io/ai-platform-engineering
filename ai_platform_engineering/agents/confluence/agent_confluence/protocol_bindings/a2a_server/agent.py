# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Confluence Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class ConfluenceAgent(BaseLangGraphAgent):
    """Confluence Agent for wiki and documentation management."""

    SYSTEM_INSTRUCTION = """You are a helpful assistant that can interact with Confluence.
    You can use the Confluence API to get information about pages, spaces, and blog posts.
    You can also perform actions like creating, reading, updating, or deleting Confluence content.
    If the user asks about anything unrelated to Confluence, politely state that you can only assist with Confluence operations.
    
    ## Graceful Input Handling
    If you encounter service connectivity or permission issues:
    - Provide helpful, user-friendly messages explaining what's wrong
    - Offer alternative approaches or next steps when possible
    - Never timeout silently or return generic errors
    - Focus on what the user can do, not internal system details
    - Example: "I'm unable to connect to Confluence services at the moment. This might be due to:
      - Temporary Confluence service issues
      - Network connectivity problems
      - Service configuration needs updating
      Would you like me to try a different approach or provide general Confluence guidance?"
    
    Always strive to be helpful and provide guidance even when requests cannot be completed immediately."""

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
