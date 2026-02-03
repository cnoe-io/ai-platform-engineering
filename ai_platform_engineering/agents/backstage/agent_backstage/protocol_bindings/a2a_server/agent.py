# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Backstage Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

# Ensure .env is loaded before accessing env vars
from dotenv import load_dotenv
load_dotenv()

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.subagent_prompts import load_subagent_prompt_config
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


# Load prompt configuration from YAML
_prompt_config = load_subagent_prompt_config("backstage")


class BackstageAgent(BaseLangGraphAgent):
    """Backstage Agent for catalog and service management."""

    SYSTEM_INSTRUCTION = _prompt_config.get_system_instruction()

    RESPONSE_FORMAT_INSTRUCTION = _prompt_config.response_format_instruction

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "backstage"

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
        """Return MCP configuration for Backstage."""
        import logging
        logger = logging.getLogger(__name__)
        
        backstage_api_token = os.getenv("BACKSTAGE_API_TOKEN")
        backstage_url = os.getenv("BACKSTAGE_URL")
        
        logger.info(f"[BackstageAgent] BACKSTAGE_URL from env: {backstage_url}")
        logger.info(f"[BackstageAgent] BACKSTAGE_API_TOKEN present: {bool(backstage_api_token)}")
        
        if not backstage_api_token:
            raise ValueError("BACKSTAGE_API_TOKEN must be set as an environment variable.")

        if not backstage_url:
            raise ValueError("BACKSTAGE_URL must be set as an environment variable.")
        
        # Validate URL has protocol
        if not backstage_url.startswith(("http://", "https://")):
            raise ValueError(f"BACKSTAGE_URL must start with http:// or https://, got: {backstage_url}")

        # Project path is the mcp/ directory (parent of mcp_backstage/) where pyproject.toml lives
        # server_path is .../mcp/mcp_backstage/__main__.py
        # We need .../mcp/ for the project
        project_path = os.path.dirname(os.path.dirname(server_path))
        logger.info(f"[BackstageAgent] MCP project path: {project_path}")

        return {
            "command": "uv",
            "args": ["run", "--project", project_path, server_path],
            "env": {
                "BACKSTAGE_API_TOKEN": backstage_api_token,
                "BACKSTAGE_URL": backstage_url,
                # Also set BACKSTAGE_API_URL since client.py checks it first
                "BACKSTAGE_API_URL": backstage_url,
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return _prompt_config.tool_working_message

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return _prompt_config.tool_processing_message

    @trace_agent_stream("backstage")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with backstage-specific tracing and safety-net error handling.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        import logging
        logger = logging.getLogger(__name__)
        try:
            async for event in super().stream(query, sessionId, trace_id):
                yield event
        except Exception as e:
            logger.error(f"Unexpected Backstage agent error: {str(e)}", exc_info=True)
            yield {
                'is_task_complete': True,
                'require_user_input': False,
                'kind': 'error',
                'content': f"❌ An unexpected error occurred in Backstage: {str(e)}\n\nPlease try again or contact support if the issue persists.",
            }
