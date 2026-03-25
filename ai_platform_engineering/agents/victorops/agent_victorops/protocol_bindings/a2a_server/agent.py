# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""VictorOps Agent implementation using common A2A base classes."""

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
_prompt_config = load_subagent_prompt_config("victorops")


class VictorOpsAgent(BaseLangGraphAgent):
    """VictorOps Agent for managing VictorOps incidents and services."""

    SYSTEM_INSTRUCTION = _prompt_config.get_system_instruction()

    RESPONSE_FORMAT_INSTRUCTION: str = _prompt_config.response_format_instruction

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "victorops"

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
        """Return MCP configuration for VictorOps."""
        env: dict[str, str] = {}

        victorops_orgs = os.getenv("VICTOROPS_ORGS")
        if victorops_orgs:
            env["VICTOROPS_ORGS"] = victorops_orgs
        else:
            victorops_api_url = os.getenv("VICTOROPS_API_URL")
            if not victorops_api_url:
                raise ValueError("VICTOROPS_API_URL must be set as an environment variable.")

            x_vo_key = os.getenv("X_VO_API_KEY")
            if not x_vo_key:
                raise ValueError("X_VO_API_KEY must be set as an environment variable.")

            x_vo_key_id = os.getenv("X_VO_API_ID")
            if not x_vo_key_id:
                raise ValueError("X_VO_API_ID must be set as an environment variable.")

            env["VICTOROPS_API_URL"] = victorops_api_url
            env["X_VO_API_KEY"] = x_vo_key
            env["X_VO_API_ID"] = x_vo_key_id

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": env,
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return _prompt_config.tool_working_message

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return _prompt_config.tool_processing_message

    @trace_agent_stream("victorops")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with victorops-specific tracing and safety-net error handling.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        import logging
        logger = logging.getLogger(__name__)
        try:
            async for event in super().stream(query, sessionId, trace_id):
                yield event
        except Exception as e:
            logger.error(f"Unexpected VictorOps agent error: {str(e)}", exc_info=True)
            yield {
                'is_task_complete': True,
                'require_user_input': False,
                'kind': 'error',
                'content': f"❌ An unexpected error occurred in VictorOps: {str(e)}\n\nPlease try again or contact support if the issue persists.",
            }
