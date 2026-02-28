# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Network Utility Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.subagent_prompts import load_subagent_prompt_config
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal["input_required", "completed", "error"] = "input_required"
    message: str


_prompt_config = load_subagent_prompt_config("network-utility")


class NetworkUtilityAgent(BaseLangGraphAgent):
    """Network Utility Agent for DNS, DHCP, and network diagnostics."""

    SYSTEM_INSTRUCTION = _prompt_config.get_system_instruction()

    RESPONSE_FORMAT_INSTRUCTION: str = _prompt_config.response_format_instruction

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "network-utility"

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
        """Return MCP configuration for Network Utility (stdio mode)."""
        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "DNSMASQ_CONFIG_DIR": os.getenv("DNSMASQ_CONFIG_DIR", "/mnt/config"),
                "DNSMASQ_LEASE_FILE": os.getenv("DNSMASQ_LEASE_FILE", "/var/lib/misc/dnsmasq.leases"),
                "DNSMASQ_LOG_DIR": os.getenv("DNSMASQ_LOG_DIR", "/mnt/logs"),
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return _prompt_config.tool_working_message

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return _prompt_config.tool_processing_message

    @trace_agent_stream("network-utility")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with network-utility-specific tracing and error handling.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        import logging

        logger = logging.getLogger(__name__)
        try:
            async for event in super().stream(query, sessionId, trace_id):
                yield event
        except Exception as e:
            logger.error(f"Unexpected Network Utility agent error: {str(e)}", exc_info=True)
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "kind": "error",
                "content": (
                    f"❌ An unexpected error occurred in Network Utility: {str(e)}"
                    "\n\nPlease try again or contact support if the issue persists."
                ),
            }
