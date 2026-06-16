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
from langgraph.prebuilt import create_react_agent
from pydantic import BaseModel

from ai_platform_engineering.agents.github.agent_github.tools import (
    get_gh_cli_tool,
    get_gh_file_contents_tool,
)
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent, memory
from ai_platform_engineering.utils.github_app_token_provider import is_github_app_mode
from ai_platform_engineering.utils.subagent_prompts import load_subagent_prompt_config
from ai_platform_engineering.utils.token_sanitizer import sanitize_output

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
        2. PAT (fallback): Set GITHUB_PERSONAL_ACCESS_TOKEN, GH_TOKEN, or
           GITHUB_TOKEN for static token auth.

        GitHub operations are handled by local gh CLI-backed tools. The
        GitHub MCP server may still exist elsewhere in the platform, but this
        agent does not load remote or local GitHub MCP tools.
        """
        self._use_app_auth = is_github_app_mode()
        if self._use_app_auth:
            logger.info("GitHub agent using GitHub App authentication (auto-refreshing tokens)")
        else:
            token = (
                os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
                or os.getenv("GH_TOKEN")
                or os.getenv("GITHUB_TOKEN")
            )
            if not token:
                logger.warning("No GitHub auth configured. Set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + "
                               "GITHUB_APP_INSTALLATION_ID for App auth, or GITHUB_PERSONAL_ACCESS_TOKEN, "
                               "GH_TOKEN, or GITHUB_TOKEN for PAT auth.")

        super().__init__()

    def get_agent_name(self) -> str:
        """Return the agent name."""
        return "github"

    async def _load_mcp_tools(self, args: dict | None = None, include_fallback: bool = True) -> list:
        """Disable GitHub MCP loading and use gh CLI-backed tools instead."""
        logger.info("GitHub agent: MCP tool loading disabled; using gh CLI-backed tools only")
        if include_fallback:
            return self.get_additional_tools()
        return []

    async def _setup_mcp_and_graph(self, config: Any) -> None:
        """Create the agent graph with gh CLI-backed tools only."""
        agent_name = self.get_agent_name()
        tools = self.get_additional_tools()

        logger.info("=" * 50)
        logger.info("🔧 INITIALIZING %s AGENT", agent_name.upper())
        logger.info("=" * 50)
        logger.info("%s: Using gh CLI-backed tools only; GitHub MCP loading is disabled", agent_name)

        self.tools_info = {}
        for tool in tools:
            args_schema = tool.args_schema if tool.args_schema is not None else {}
            if hasattr(args_schema, "model_json_schema"):
                args_schema = args_schema.model_json_schema()
            elif not isinstance(args_schema, dict):
                args_schema = {}

            self.tools_info[tool.name] = {
                "description": tool.description.strip(),
                "parameters": args_schema.get("properties", {}),
                "required": args_schema.get("required", []),
            }

        model_with_name = self.model.with_config(
            run_name=agent_name,
            tags=[f"agent:{agent_name}"],
            metadata={"agent_name": agent_name},
        )

        create_agent_kwargs: Dict[str, Any] = {
            "checkpointer": memory,
            "prompt": self._get_system_instruction_with_date(),
            "response_format": (
                self.get_response_format_instruction(),
                self.get_response_format_class(),
            ),
        }

        if self.enable_auto_compression:
            create_agent_kwargs["pre_model_hook"] = self._build_pre_model_hook()
            logger.info(
                "%s: pre_model_hook enabled for inter-iteration context compression "
                "(threshold: %s tokens)",
                agent_name,
                int(self.max_context_tokens * 0.8),
            )

        self.graph = create_react_agent(
            model_with_name,
            tools,
            **create_agent_kwargs,
        )

        logger.info("✅ %s agent initialized with %s gh CLI-backed tools", agent_name, len(tools))

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
        """Provide gh CLI-backed tools for GitHub operations."""
        tools = []
        gh_tool = get_gh_cli_tool()
        if gh_tool:
            tools.append(gh_tool)
            logger.info("GitHub agent: Added gh CLI tool (gh_cli_execute)")
        gh_file_tool = get_gh_file_contents_tool()
        if gh_file_tool:
            tools.append(gh_file_tool)
            logger.info("GitHub agent: Added gh file contents tool (get_file_contents)")
        return tools

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
            return (
                "GitHub authentication failed or insufficient permissions. Please check "
                "GITHUB_PERSONAL_ACCESS_TOKEN, GH_TOKEN, or GITHUB_TOKEN."
            )
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

        Tool-level errors are handled by the gh-backed tools, but this catches
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
            error_content = (
                f"❌ An unexpected error occurred: {sanitize_output(str(e))}\n\n"
                "Please try again or contact support if the issue persists."
            )
            yield {
                'is_task_complete': True,
                'require_user_input': False,
                'kind': 'error',
                'content': error_content,
            }
