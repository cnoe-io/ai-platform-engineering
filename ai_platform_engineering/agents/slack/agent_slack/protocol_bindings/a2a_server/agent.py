# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Slack Agent implementation using common A2A base classes."""

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
_prompt_config = load_subagent_prompt_config("slack")


class SlackAgent(BaseLangGraphAgent):
    """Slack Agent for workspace and channel management."""

    SYSTEM_INSTRUCTION = _prompt_config.get_system_instruction()

    RESPONSE_FORMAT_INSTRUCTION: str = _prompt_config.response_format_instruction

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

        project_dir = os.path.dirname(os.path.dirname(server_path))
        venv_python = os.path.join(project_dir, ".venv/bin/python")
        
        if os.path.exists(venv_python):
             command = venv_python
             args = [server_path]
        else:
             command = "uv"
             args = ["run", "--quiet", "--project", project_dir, server_path]

        return {
            "command": command,
            "args": args,
            "env": {
                "SLACK_BOT_TOKEN": slack_token,
                "SLACK_TEAM_ID": slack_team_id,
                "MCP_MODE": "stdio"
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return _prompt_config.tool_working_message

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return _prompt_config.tool_processing_message

    @trace_agent_stream("slack")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with slack-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event
