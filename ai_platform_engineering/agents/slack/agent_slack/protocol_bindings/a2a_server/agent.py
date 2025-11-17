# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Slack Agent implementation using common A2A base classes."""

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


class SlackAgent(BaseLangGraphAgent):
    """Slack Agent for workspace and channel management."""

    # Using common utilities - eliminates 19 lines of duplicated code!
    # Slack makes real API calls, so include error handling
    SYSTEM_INSTRUCTION = scope_limited_agent_instruction(
        service_name="Slack",
        service_operations="interact with Slack workspaces, channels, and messages",
        additional_guidelines=[
            "Use the available Slack tools to interact with the Slack API",
            "When searching for messages or filtering by time, use the current date provided above as reference"
        ],
        include_error_handling=True,  # Real API calls can fail
        include_date_handling=True    # Enable date handling
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete. '
        'Select status as input_required if the input is a question to the user. '
        'Set response status to error if the input indicates an error.'
    )

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "slack"

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
        """Return MCP configuration for Slack."""
        slack_token = os.getenv("SLACK_BOT_TOKEN")
        if not slack_token:
            raise ValueError("SLACK_BOT_TOKEN must be set as an environment variable.")

        slack_team_id = os.getenv("SLACK_TEAM_ID")
        if not slack_team_id:
            raise ValueError("SLACK_TEAM_ID must be set as an environment variable.")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "SLACK_BOT_TOKEN": slack_token,
                "SLACK_TEAM_ID": slack_team_id,
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return 'Querying Slack...'

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return 'Processing Slack data...'

    @trace_agent_stream("slack")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with slack-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event
