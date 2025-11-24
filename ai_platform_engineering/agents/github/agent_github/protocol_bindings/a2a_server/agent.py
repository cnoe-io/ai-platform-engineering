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
from ai_platform_engineering.utils.prompt_templates import scope_limited_agent_instruction

logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""
    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class GitHubAgent(BaseLangGraphAgent):
    """GitHub Agent using BaseLangGraphAgent for consistent streaming."""

    SYSTEM_INSTRUCTION = scope_limited_agent_instruction(
        service_name="GitHub",
        service_operations="interact with GitHub repositories, issues, pull requests, Actions workflows, code security, Dependabot, Projects, Organizations, Users, Gists, Discussions, Notifications, Stargazers, and Git operations",
        additional_guidelines=[
            "Before executing any tool, ensure that all required parameters are provided",
            "If any required parameters are missing, ask the user to provide them",
            "Always use the most appropriate tool for the requested operation and validate parameters",
            "When filtering issues, pull requests, or commits by date, use the current date provided above as reference",
            "**IMPORTANT - Repository References:** When the user mentions a repository name without specifying the organization/owner, "
            "ALWAYS ask them to clarify the organization name. DO NOT assume the organization name is the same as the repository name. "
            "Example: If user says 'show PRs in ai-platform-engineering', ask 'Which organization is the ai-platform-engineering repository under?' DO NOT assume it's 'ai-platform-engineering/ai-platform-engineering'",
            "Repository format is always 'organization/repository' or 'owner/repository'. Never duplicate the repository name as both organization and repository name",
            "**GitHub Actions Logs**: When workflow runs return log URLs, use `fetch_url` tool to download and present log content to users"
        ],
        include_error_handling=True,  # Real GitHub API calls
        include_date_handling=True    # Enable date handling
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

