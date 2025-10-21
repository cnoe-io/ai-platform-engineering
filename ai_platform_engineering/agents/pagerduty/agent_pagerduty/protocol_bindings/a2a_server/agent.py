# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""PagerDuty Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class PagerDutyAgent(BaseLangGraphAgent):
    """PagerDuty Agent for incident and schedule management."""

    SYSTEM_INSTRUCTION = """You are a helpful assistant that can interact with PagerDuty.
    You can use the PagerDuty API to get information about incidents, services, and schedules.
    You can also perform actions like creating, updating, or resolving incidents."""

    RESPONSE_FORMAT_INSTRUCTION = """Select status as completed if the request is complete.
    Select status as input_required if the input is a question to the user.
    Set response status to error if the input indicates an error."""

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "pagerduty"

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
        """Return MCP configuration for PagerDuty."""
        pagerduty_api_key = os.getenv("PAGERDUTY_API_KEY")
        if not pagerduty_api_key:
            raise ValueError("PAGERDUTY_API_KEY must be set as an environment variable.")

        pagerduty_api_url = os.getenv("PAGERDUTY_API_URL", "https://api.pagerduty.com")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "PAGERDUTY_API_KEY": pagerduty_api_key,
                "PAGERDUTY_API_URL": pagerduty_api_url,
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return 'Querying PagerDuty...'

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return 'Processing PagerDuty data...'

    @trace_agent_stream("pagerduty")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with pagerduty-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event
