# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Petstore Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.prompt_templates import build_system_instruction, graceful_error_handling_template, SCOPE_LIMITED_GUIDELINES, STANDARD_RESPONSE_GUIDELINES, HUMAN_IN_LOOP_NOTES, LOGGING_NOTES, DATE_HANDLING_NOTES
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str

class PetStoreAgent(BaseLangGraphAgent):
    """Petstore Agent for managing Petstore API operations."""

    SYSTEM_INSTRUCTION = build_system_instruction(
        agent_name="PETSTORE AGENT",
        agent_purpose="You are an expert assistant for managing Petstore API operations. Your sole purpose is to help users perform CRUD operations on pets, store orders, and user accounts. Always return any Petstore resource links in markdown format.",
        response_guidelines=SCOPE_LIMITED_GUIDELINES + STANDARD_RESPONSE_GUIDELINES + [
            "Only use the available Petstore tools to interact with the Petstore API",
            "Do not provide general guidance from your knowledge base unless explicitly asked",
            "Always send tool results directly to the user without analyzing or interpreting",
            "When querying pets or resources with date-based filters, use the current date provided above as reference",
        ],
        important_notes=HUMAN_IN_LOOP_NOTES + LOGGING_NOTES + DATE_HANDLING_NOTES,
        graceful_error_handling=graceful_error_handling_template("Petstore")
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete. '
        'Select status as input_required if the input is a question to the user. '
        'Set response status to error if the input indicates an error.'
    )

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
        return 'Looking up Petstore information...'

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return 'Processing Petstore data...'

    @trace_agent_stream("petstore")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with petstore-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event