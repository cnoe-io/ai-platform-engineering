# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Refactored GitHub Agent using BaseLangGraphAgent.

This version eliminates duplicate streaming and provides consistent behavior
with other agents (ArgoCD, Komodor, etc.).
"""

import logging
import os
from typing import Dict, Any, Literal
from dotenv import load_dotenv
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent

logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""
    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class GitHubAgent(BaseLangGraphAgent):
    """GitHub Agent using BaseLangGraphAgent for consistent streaming."""

    SYSTEM_INSTRUCTION = (
      'You are an expert assistant for GitHub integration and operations. '
      'Your purpose is to help users interact with GitHub repositories, issues, pull requests, and other GitHub features. '
      'Use the available GitHub tools to interact with the GitHub API and provide accurate, '
      'actionable responses. If the user asks about anything unrelated to GitHub, politely state '
      'that you can only assist with GitHub operations. Do not attempt to answer unrelated questions '
      'or use tools for other purposes.\n\n'
      'IMPORTANT: Before executing any tool, ensure that all required parameters are provided. '
      'If any required parameters are missing, ask the user to provide them. '
      'Always use the most appropriate tool for the requested operation and validate that '
      'the provided parameters match the expected format and requirements.'
    )

    RESPONSE_FORMAT_INSTRUCTION = (
        'Select status as completed if the request is complete. '
        'Select status as input_required if the input is a question to the user. '
        'Set response status to error if the input indicates an error.'
    )

    def __init__(self):
        """Initialize GitHub agent with token validation."""
        self.github_token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
        if not self.github_token:
            logger.warning("GITHUB_PERSONAL_ACCESS_TOKEN not set, GitHub integration will be limited")

        # Call parent constructor (no parameters needed)
        super().__init__()

    def get_agent_name(self) -> str:
        """Return the agent name."""
        return "github"

    def get_mcp_http_config(self) -> Dict[str, Any] | None:
        """
        Provide custom HTTP MCP configuration for GitHub Copilot API.

        Returns:
            Dictionary with GitHub Copilot API configuration
        """
        if not self.github_token:
            logger.error("Cannot configure GitHub MCP: GITHUB_PERSONAL_ACCESS_TOKEN not set")
            return None

        return {
                    "url": "https://api.githubcopilot.com/mcp",
                    "headers": {
                      "Authorization": f"Bearer {self.github_token}",
                    },
                  }

    def get_mcp_config(self, server_path: str | None = None) -> Dict[str, Any]:
        """
        Not used for GitHub agent (HTTP mode only).

        This method is required by the base class but not used since we
        override get_mcp_http_config() for HTTP-only operation.
        """
        raise NotImplementedError(
            "GitHub agent uses HTTP mode only. "
            "Use get_mcp_http_config() instead."
        )

    def get_system_instruction(self) -> str:
        """Return the system instruction for the agent."""
        return self.SYSTEM_INSTRUCTION

    def get_response_format_class(self):
        """Return the response format class."""
        return ResponseFormat

    def get_response_format_instruction(self) -> str:
        """Return the response format instruction."""
        return self.RESPONSE_FORMAT_INSTRUCTION

    def get_tool_working_message(self) -> str:
        """Return the message shown when a tool is being invoked."""
        return "🔧 Calling tool: **{tool_name}**"

    def get_tool_processing_message(self) -> str:
        """Return the message shown when processing tool results."""
        return "✅ Tool **{tool_name}** completed"

