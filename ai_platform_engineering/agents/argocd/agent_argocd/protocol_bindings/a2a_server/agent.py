# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""ArgoCD Agent implementation using common A2A base classes."""

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
_prompt_config = load_subagent_prompt_config("argocd")


class ArgoCDAgent(BaseLangGraphAgent):
    """ArgoCD Agent for managing ArgoCD resources."""

    SYSTEM_INSTRUCTION = _prompt_config.get_system_instruction()

    RESPONSE_FORMAT_INSTRUCTION: str = _prompt_config.response_format_instruction

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "argocd"

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
        """Return MCP configuration for ArgoCD."""
        argocd_token = os.getenv("ARGOCD_TOKEN")
        if not argocd_token:
            raise ValueError("ARGOCD_TOKEN must be set as an environment variable.")

        argocd_api_url = os.getenv("ARGOCD_API_URL")
        if not argocd_api_url:
            raise ValueError("ARGOCD_API_URL must be set as an environment variable.")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "ARGOCD_TOKEN": argocd_token,
                "ARGOCD_API_URL": argocd_api_url,
                "ARGOCD_VERIFY_SSL": "false"
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return _prompt_config.tool_working_message

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return _prompt_config.tool_processing_message

    @trace_agent_stream("argocd")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with argocd-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event