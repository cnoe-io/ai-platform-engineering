# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Splunk Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class SplunkAgent(BaseLangGraphAgent):
    """Splunk Agent for log search and alert management."""

    SYSTEM_INSTRUCTION = """You are a helpful assistant that can interact with Splunk.
    You can use the Splunk API to search logs, manage alerts, get system status, and perform various operations.
    You can search for data, create alerts, manage detectors, and work with teams and incidents."""

    RESPONSE_FORMAT_INSTRUCTION = """Select status as completed if the request is complete.
    Select status as input_required if the input is a question to the user.
    Set response status to error if the input indicates an error."""

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "splunk"

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
        """Return MCP configuration for Splunk."""
        splunk_token = os.getenv("SPLUNK_TOKEN")
        if not splunk_token:
            raise ValueError("SPLUNK_TOKEN must be set as an environment variable.")

        splunk_api_url = os.getenv("SPLUNK_API_URL")
        if not splunk_api_url:
            raise ValueError("SPLUNK_API_URL must be set as an environment variable.")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "SPLUNK_TOKEN": splunk_token,
                "SPLUNK_API_URL": splunk_api_url,
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return 'Querying Splunk...'

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return 'Processing Splunk data...'

    @trace_agent_stream("splunk")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with splunk-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event
