# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Jira Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class JiraAgent(BaseLangGraphAgent):
    """Jira Agent for issue and project management."""

    SYSTEM_INSTRUCTION = (
      'You are an expert assistant for managing Jira resources. '
      'Your sole purpose is to help users perform CRUD (Create, Read, Update, Delete) operations on Jira applications, '
      'projects, and related resources. Always use the available Jira tools to interact with the Jira API and provide '
      'accurate, actionable responses. If the user asks about anything unrelated to Jira or its resources, politely state '
      'that you can only assist with Jira operations. Do not attempt to answer unrelated questions or use tools for other purposes.'
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete'
        'Select status as input_required if the input is a question to the user'
        'Set response status to error if the input indicates an error'
    )

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "jira"

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
        """Return MCP configuration for Jira."""
        jira_token = os.getenv("ATLASSIAN_TOKEN")
        if not jira_token:
            raise ValueError("ATLASSIAN_TOKEN must be set as an environment variable.")

        jira_api_url = os.getenv("ATLASSIAN_API_URL")
        if not jira_api_url:
            raise ValueError("ATLASSIAN_API_URL must be set as an environment variable.")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "ATLASSIAN_TOKEN": jira_token,
                "ATLASSIAN_API_URL": jira_api_url,
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return 'Querying Jira...'

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return 'Processing Jira data...'

    @trace_agent_stream("jira")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with jira-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event
