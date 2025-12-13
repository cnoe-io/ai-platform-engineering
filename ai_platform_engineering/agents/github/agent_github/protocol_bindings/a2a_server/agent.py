# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Refactored GitHub Agent using BaseLangGraphAgent.

This version eliminates duplicate streaming and provides consistent behavior
with other agents (ArgoCD, Komodor, etc.).
"""

import logging
import os
import re
from typing import Dict, Any, Literal, AsyncIterable
from dotenv import load_dotenv
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.subagent_prompts import load_subagent_prompt_config

logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""
    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


# Load prompt configuration from YAML
_prompt_config = load_subagent_prompt_config("github")


class GitHubAgent(BaseLangGraphAgent):
    """GitHub Agent using BaseLangGraphAgent for consistent streaming."""

    SYSTEM_INSTRUCTION = _prompt_config.get_system_instruction()

    RESPONSE_FORMAT_INSTRUCTION = _prompt_config.response_format_instruction

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
        return _prompt_config.tool_working_message

    def get_tool_processing_message(self) -> str:
        """Return the message shown when processing tool results."""
        return _prompt_config.tool_processing_message

    def _parse_tool_error(self, error: Exception, tool_name: str) -> str:
        """
        Parse GitHub API errors for user-friendly messages.
        
        Overrides base class to provide GitHub-specific error parsing.
        
        Args:
            error: The exception that was raised
            tool_name: Name of the tool that failed
            
        Returns:
            User-friendly error message
        """
        error_str = str(error)
        
        # Parse common GitHub API errors for better user messages
        if "404 Not Found" in error_str:
            # Extract repo name from URL if possible
            repo_match = re.search(r'/repos/([^/]+/[^/]+)/', error_str)
            repo_name = repo_match.group(1) if repo_match else "repository"
            return f"Repository '{repo_name}' not found. Please check the organization and repository names are correct."
        elif "401" in error_str or "403" in error_str:
            return "GitHub authentication failed or insufficient permissions. Please check your GITHUB_PERSONAL_ACCESS_TOKEN."
        elif "rate limit" in error_str.lower():
            return "GitHub API rate limit exceeded. Please wait before trying again."
        else:
            return f"Error executing {tool_name}: {error_str}"

    async def stream(
        self, query: str, sessionId: str, trace_id: str = None
    ) -> AsyncIterable[dict[str, Any]]:
        """
        Stream responses with safety-net error handling.

        Tool-level errors are handled by _wrap_mcp_tools(), but this catches
        any other unexpected failures (LLM errors, graph errors, etc.) as a last resort.

        Args:
            query: User's input query
            sessionId: Session ID for this conversation
            trace_id: Optional trace ID for observability

        Yields:
            Streaming response chunks
        """
        try:
            async for chunk in super().stream(query, sessionId, trace_id):
                yield chunk
        except Exception as e:
            # This should rarely trigger since tool errors are handled at tool level
            logger.error(f"Unexpected GitHub agent error: {str(e)}", exc_info=True)
            yield {
                'is_task_complete': True,
                'require_user_input': False,
                'kind': 'error',
                'content': f"❌ An unexpected error occurred: {str(e)}\n\nPlease try again or contact support if the issue persists.",
            }

