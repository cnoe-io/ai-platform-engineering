# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Kubernetes Agent implementation using common A2A base classes."""

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


_prompt_config = load_subagent_prompt_config("kubernetes")


class KubernetesAgent(BaseLangGraphAgent):
    """Kubernetes Agent for managing Kubernetes cluster resources."""

    SYSTEM_INSTRUCTION = _prompt_config.get_system_instruction()
    RESPONSE_FORMAT_INSTRUCTION: str = _prompt_config.response_format_instruction

    def get_agent_name(self) -> str:
        return "kubernetes"

    def get_system_instruction(self) -> str:
        return self.SYSTEM_INSTRUCTION

    def get_response_format_instruction(self) -> str:
        return self.RESPONSE_FORMAT_INSTRUCTION

    def get_response_format_class(self) -> type[BaseModel]:
        return ResponseFormat

    def get_mcp_config(self, server_path: str) -> dict:
        """Return MCP configuration for Kubernetes."""
        kubeconfig = os.getenv("KUBECONFIG", os.path.expanduser("~/.kube/config"))

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "KUBECONFIG": kubeconfig,
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        return _prompt_config.tool_working_message

    def get_tool_processing_message(self) -> str:
        return _prompt_config.tool_processing_message

    @trace_agent_stream("kubernetes")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        import logging
        logger = logging.getLogger(__name__)
        try:
            async for event in super().stream(query, sessionId, trace_id):
                yield event
        except Exception as e:
            logger.error(f"Unexpected Kubernetes agent error: {str(e)}", exc_info=True)
            yield {
                'is_task_complete': True,
                'require_user_input': False,
                'kind': 'error',
                'content': f"An unexpected error occurred in Kubernetes: {str(e)}",
            }
