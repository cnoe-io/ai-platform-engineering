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
import shutil
from typing import Dict, Any, Literal, AsyncIterable
from dotenv import load_dotenv
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.github_app_token_provider import get_github_token, is_github_app_mode
from ai_platform_engineering.utils.subagent_prompts import load_subagent_prompt_config
from ai_platform_engineering.utils.token_sanitizer import sanitize_output
from ai_platform_engineering.agents.github.agent_github.tools import get_gh_cli_tool

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
        """Initialize GitHub agent with token validation.

        Supports two authentication modes:
        1. GitHub App (recommended): Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY,
           and GITHUB_APP_INSTALLATION_ID for auto-refreshing tokens.
        2. PAT (fallback): Set GITHUB_PERSONAL_ACCESS_TOKEN for static token auth.

        MCP server: Uses github-mcp-server via ``go run`` over STDIO.
        Source lives at ``ai_platform_engineering/mcp/mcp_github/``.
        Override with ``GITHUB_MCP_SERVER_DIR`` env var if needed.
        """
        self._use_app_auth = is_github_app_mode()
        if self._use_app_auth:
            logger.info("GitHub agent using GitHub App authentication (auto-refreshing tokens)")
        else:
            token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
            if not token:
                logger.warning("No GitHub auth configured. Set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + "
                               "GITHUB_APP_INSTALLATION_ID for App auth, or GITHUB_PERSONAL_ACCESS_TOKEN for PAT auth.")

        super().__init__()

    def get_agent_name(self) -> str:
        """Return the agent name."""
        return "github"

    def get_mcp_http_config(self) -> Dict[str, Any] | None:
        """Not used — GitHub MCP runs as a local STDIO process."""
        return None

    def _get_github_mcp_server_dir(self) -> str:
        """Resolve the github-mcp-server Go project directory.

        Lookup order:
        1. ``GITHUB_MCP_SERVER_DIR`` environment variable (explicit override)
        2. ``ai_platform_engineering/mcp/mcp_github/`` relative to the
           project root — works in Docker (``/app``) and local dev alike.
        """
        explicit = os.getenv("GITHUB_MCP_SERVER_DIR")
        if explicit:
            return explicit
        # Derive project root from this file's location:
        #   agents/github/agent_github/protocol_bindings/a2a_server/agent.py
        #   → up 6 dirs → ai_platform_engineering/
        ai_pkg_dir = os.path.dirname(os.path.abspath(__file__))
        for _ in range(5):
            ai_pkg_dir = os.path.dirname(ai_pkg_dir)
        return os.path.join(ai_pkg_dir, "mcp", "mcp_github")

    def get_mcp_config(self, server_path: str | None = None) -> Dict[str, Any]:
        """Configure STDIO transport via ``go run`` against the local source.

        Set ``GITHUB_MCP_SERVER_DIR`` to override the default project
        location (``~/outshift/github-mcp-server``).
        """
        token = get_github_token()
        if not token:
            raise ValueError(
                "No GitHub token configured. "
                "Set GITHUB_PERSONAL_ACCESS_TOKEN or configure GitHub App auth."
            )

        go_bin = shutil.which("go") or "go"
        mcp_dir = self._get_github_mcp_server_dir()
        logger.info("GitHub MCP: go run from %s", mcp_dir)

        env = {"GITHUB_PERSONAL_ACCESS_TOKEN": token}
        for key in ("HOME", "PATH", "GOPATH", "GOMODCACHE", "GOCACHE", "TMPDIR"):
            val = os.environ.get(key)
            if val:
                env[key] = val

        return {
            "command": go_bin,
            "args": ["run", "./cmd/github-mcp-server", "stdio"],
            "env": env,
            "transport": "stdio",
            "cwd": mcp_dir,
        }

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

    def get_additional_tools(self) -> list:
        """Provide gh CLI as a fallback tool.

        The base class calls this when MCP STDIO fails to start (e.g. Go
        not installed, missing source directory).  When MCP loads
        successfully the base class does NOT call this method from
        ``_load_mcp_tools``; only ``create_subagent_def`` adds these on
        top, which is acceptable — the LLM will prefer the richer MCP
        tools over the generic gh CLI wrapper.
        """
        tools = []
        gh_tool = get_gh_cli_tool()
        if gh_tool:
            tools.append(gh_tool)
            logger.info("GitHub agent: gh CLI tool available as fallback")
        return tools

    def _wrap_mcp_tools(self, tools: list, context_id: str) -> list:
        """
        Wrap MCP tools with token sanitization on top of base class error handling.

        SECURITY: GitHub MCP (Copilot API) responses may contain tokens or
        auth info in error messages. This override ensures all MCP tool output
        is passed through sanitize_output() before reaching the LLM or user.
        """
        from functools import wraps

        # First apply base class wrapping (error handling + truncation)
        wrapped = super()._wrap_mcp_tools(tools, context_id)

        # Then add token sanitization on top
        for tool in wrapped:
            if hasattr(tool, '_run'):
                original_run = tool._run

                @wraps(original_run)
                def sanitized_run(*args, _orig=original_run, **kwargs):
                    result = _orig(*args, **kwargs)
                    if isinstance(result, str):
                        return sanitize_output(result)
                    return result

                tool._run = sanitized_run

            if hasattr(tool, '_arun'):
                original_arun = tool._arun

                @wraps(original_arun)
                async def sanitized_arun(*args, _orig=original_arun, **kwargs):
                    result = await _orig(*args, **kwargs)
                    if isinstance(result, str):
                        return sanitize_output(result)
                    return result

                tool._arun = sanitized_arun

        logger.info(f"GitHub agent: Applied token sanitization to {len(wrapped)} MCP tools")
        return wrapped

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
        # Handle TaskGroup/ExceptionGroup errors by extracting underlying exceptions
        underlying_error = error
        if hasattr(error, 'exceptions') and error.exceptions:
            # ExceptionGroup (Python 3.11+) or TaskGroup error
            underlying_error = error.exceptions[0]
            logger.debug(f"Extracted underlying error from TaskGroup: {underlying_error}")

        error_str = str(underlying_error)

        # Parse common GitHub API errors for better user messages
        if "404 Not Found" in error_str or "404" in error_str:
            # Extract repo name from URL if possible
            repo_match = re.search(r'/repos/([^/]+/[^/]+)/', error_str)
            repo_name = repo_match.group(1) if repo_match else "repository"
            return f"Repository '{repo_name}' not found. Please check the organization and repository names are correct."
        elif "401" in error_str or "403" in error_str:
            return "GitHub authentication failed or insufficient permissions. Please check your GITHUB_PERSONAL_ACCESS_TOKEN."
        elif "rate limit" in error_str.lower() or "429" in error_str:
            return "GitHub API rate limit exceeded. Please wait a few minutes before trying again."
        elif "timeout" in error_str.lower() or "timed out" in error_str.lower():
            return f"GitHub API request timed out for {tool_name}. The server may be slow or overloaded. Please try again."
        elif "connection" in error_str.lower() or "connect" in error_str.lower():
            return f"Failed to connect to GitHub API for {tool_name}. Please check your network connection."
        elif "unhandled errors in a TaskGroup" in error_str:
            # Generic TaskGroup error without specific cause
            return f"GitHub API request failed for {tool_name}. The API may be temporarily unavailable. Please try again."
        else:
            # SECURITY: sanitize error_str as it may contain tokens (e.g., in URLs)
            return f"Error executing {tool_name}: {sanitize_output(error_str)}"

    async def stream(
        self, query: str, sessionId: str, trace_id: str = None
    ) -> AsyncIterable[dict[str, Any]]:
        """
        Stream responses with safety-net error handling.

        Tool-level errors are handled by _wrap_mcp_tools(), but this catches
        any other unexpected failures (LLM errors, graph errors, etc.) as a last resort.

        Note: CancelledError is handled gracefully in the base class (BaseLangGraphAgent).

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
            # Note: CancelledError is handled in base class, won't reach here
            logger.error(f"Unexpected GitHub agent error: {str(e)}", exc_info=True)
            yield {
                'is_task_complete': True,
                'require_user_input': False,
                'kind': 'error',
                'content': f"❌ An unexpected error occurred: {sanitize_output(str(e))}\n\nPlease try again or contact support if the issue persists.",
            }

