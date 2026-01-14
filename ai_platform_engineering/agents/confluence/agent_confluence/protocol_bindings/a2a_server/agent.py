# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Confluence Agent implementation using common A2A base classes."""

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
_prompt_config = load_subagent_prompt_config("confluence")


class ConfluenceAgent(BaseLangGraphAgent):
    """Confluence Agent for wiki and documentation management."""

    SYSTEM_INSTRUCTION = _prompt_config.get_system_instruction()

    RESPONSE_FORMAT_INSTRUCTION = _prompt_config.response_format_instruction

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "confluence"

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
        """Return MCP configuration for Confluence (stdio mode only)."""
        confluence_token = os.getenv("ATLASSIAN_TOKEN")
        if not confluence_token:
            raise ValueError("ATLASSIAN_TOKEN must be set as an environment variable.")

        confluence_api_url = os.getenv("CONFLUENCE_API_URL")
        if not confluence_api_url:
            raise ValueError("CONFLUENCE_API_URL must be set as an environment variable.")

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
                "ATLASSIAN_TOKEN": confluence_token,
                "CONFLUENCE_API_URL": confluence_api_url,
                "MCP_MODE": "stdio"
            },
            "transport": "stdio",
        }

    def get_mcp_http_config(self) -> dict | None:
        """
        Return custom HTTP MCP configuration for sooperset/mcp-atlassian.

        This overrides the default HTTP config to NOT send Authorization headers,
        since sooperset/mcp-atlassian handles auth via environment variables.
        """
        mcp_host = os.getenv("MCP_HOST", "localhost")
        mcp_port = os.getenv("MCP_PORT", "8000")

        return {
            "url": f"http://{mcp_host}:{mcp_port}/mcp/",
            # No Authorization header - server uses env vars for auth
            "headers": {},
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return _prompt_config.tool_working_message

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return _prompt_config.tool_processing_message

    @trace_agent_stream("confluence")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with confluence-specific tracing and safety-net error handling.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        import logging
        logger = logging.getLogger(__name__)
        try:
            async for event in super().stream(query, sessionId, trace_id):
                yield event
        except Exception as e:
            logger.error(f"Unexpected Confluence agent error: {str(e)}", exc_info=True)
            yield {
                'is_task_complete': True,
                'require_user_input': False,
                'kind': 'error',
                'content': f"❌ An unexpected error occurred in Confluence: {str(e)}\n\nPlease try again or contact support if the issue persists.",
            }
