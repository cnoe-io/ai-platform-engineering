# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
GitLab Agent using BaseLangGraphAgent.

This agent supports both HTTP and stdio MCP modes:
- HTTP mode: Uses @zereight/mcp-gitlab as a local MCP server (via mcp-gitlab container)
- stdio mode: Uses @zereight/mcp-gitlab as a subprocess

Both modes are supplemented with shared agent tools (git, grep, glob_find, file I/O)
for repository operations that require shell command execution.

Native permission filtering is handled via GITLAB_DENIED_TOOLS_REGEX environment variable
on the MCP server
"""

import logging
import os
from typing import Dict, Any, List, Literal, AsyncIterable
from dotenv import load_dotenv
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.subagent_prompts import load_subagent_prompt_config
from ai_platform_engineering.utils.agent_tools import (
    git, grep, glob_find, read_file, write_file, edit_file, append_file, list_files
)

logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""
    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


# Load prompt configuration from YAML
_prompt_config = load_subagent_prompt_config("gitlab")


class GitLabAgent(BaseLangGraphAgent):
    """GitLab Agent using BaseLangGraphAgent for consistent streaming."""

    SYSTEM_INSTRUCTION = _prompt_config.get_system_instruction()

    RESPONSE_FORMAT_INSTRUCTION = _prompt_config.response_format_instruction

    def __init__(self):
        """Initialize GitLab agent with token validation."""
        self.gitlab_token = os.getenv("GITLAB_TOKEN")
        if not self.gitlab_token:
            logger.warning("GITLAB_TOKEN not set, GitLab integration will be limited")

        # Call parent constructor (no parameters needed)
        super().__init__()

    def get_agent_name(self) -> str:
        """Return the agent name."""
        return "gitlab"

    def get_mcp_http_config(self) -> Dict[str, Any] | None:
        """
        Provide HTTP MCP configuration for local @zereight/mcp-gitlab server.

        Uses the mcp-gitlab container running in HTTP mode (STREAMABLE_HTTP=true).
        The MCP server is pre-configured with GitLab credentials and permission
        filtering via GITLAB_DENIED_TOOLS_REGEX.

        Returns:
            Dictionary with MCP server URL configuration
        """
        mcp_host = os.getenv("MCP_HOST", "localhost")
        mcp_port = os.getenv("MCP_PORT", "8000")

        return {
            "url": f"http://{mcp_host}:{mcp_port}/mcp",
        }

    def _get_denied_tools_regex(self) -> str:
        """
        Get GITLAB_DENIED_TOOLS_REGEX for MCP server tool filtering.

        Returns the regex pattern from environment variable. Users should set this
        directly based on their desired permission level.

        Example patterns (uses ^ for prefix matching):

        READ-ONLY (default) - blocks all write operations:
          ^(delete_|remove_|create_|fork_|new_|update_|edit_|merge_|push_|publish_|retry_|cancel_|play_|promote_|upload_|resolve_|bulk_)|^(execute_graphql)$

        ALLOW CREATE - blocks delete/update:
          ^(delete_|remove_|update_|edit_|merge_|push_|publish_|retry_|cancel_|play_|promote_|upload_|resolve_|bulk_)|^(execute_graphql)$

        ALLOW UPDATE - blocks delete/create:
          ^(delete_|remove_|create_|fork_|new_)|^(execute_graphql)$

        ALLOW CREATE + UPDATE - blocks only delete:
          ^(delete_|remove_)|^(execute_graphql)$

        To block specific tools, add them as exact matches: |^(tool1|tool2)$
        Example: ...|^(execute_graphql|approve_merge_request|unapprove_merge_request)$

        Note: execute_graphql is always blocked as it bypasses prefix-based permission controls

        Returns:
            Regex pattern string for denied tools
        """
        # Default: READ-ONLY mode (blocks all create/update/delete operations)
        default_regex = (
            "^(delete_|remove_|create_|fork_|new_|update_|edit_|merge_|push_|publish_|"
            "retry_|cancel_|play_|promote_|upload_|resolve_|bulk_)|"
            "^(execute_graphql)$"
        )
        regex = os.getenv("GITLAB_DENIED_TOOLS_REGEX", default_regex)
        logger.info(f"GitLab agent: Using denied tools regex: {regex}")
        return regex

    def get_mcp_config(self, server_path: str | None = None) -> Dict[str, Any]:
        """
        Provide stdio MCP configuration for GitLab using @zereight/mcp-gitlab.

        Uses @zereight/mcp-gitlab which connects directly to GitLab API
        with PAT authentication. This is used when MCP_MODE=stdio.

        Includes GITLAB_DENIED_TOOLS_REGEX for native permission filtering
        at the MCP server level.

        Returns:
            Dictionary with command and environment for stdio MCP
        """
        if not self.gitlab_token:
            logger.error("Cannot configure GitLab MCP: GITLAB_TOKEN not set")
            return {}

        gitlab_host = os.getenv("GITLAB_HOST", "gitlab.com")
        denied_tools_regex = self._get_denied_tools_regex()

        return {
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@zereight/mcp-gitlab"],
            "env": {
                "GITLAB_API_URL": f"https://{gitlab_host}/api/v4",
                "GITLAB_PERSONAL_ACCESS_TOKEN": self.gitlab_token,
                "USE_PIPELINE": "true",
                "GITLAB_DENIED_TOOLS_REGEX": denied_tools_regex,
            }
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

    def get_additional_tools(self) -> List:
        """
        Provide shared tools for GitLab agent.

        Returns shared agent tools for git operations, file search, and file I/O.
        These tools auto-authenticate with GitLab using GITLAB_TOKEN.

        Returns:
            List of shared agent tools
        """
        tools = [
            git,           # git clone, checkout, commit, push (auto-authenticates)
            grep,          # grep -rn pattern .
            glob_find,     # find files by pattern
            read_file,     # read file contents
            write_file,    # write file contents (full rewrite)
            edit_file,     # edit file contents (search-and-replace, more efficient)
            append_file,   # append to file
            list_files,    # list directory contents
        ]
        logger.info(
            "GitLab agent: Added shared agent tools "
            "(git, grep, glob_find, read_file, write_file, edit_file, append_file, list_files)"
        )
        return tools

    def _filter_mcp_tools(self, tools: list) -> list:
        """
        Log available MCP tools after MCP server-side filtering.

        Tool filtering is handled entirely by the MCP server via GITLAB_DENIED_TOOLS_REGEX

        This method just logs the tools for visibility.

        Args:
            tools: List of MCP tools (already filtered by MCP server)

        Returns:
            The same list of tools (no additional filtering)
        """
        available_tool_names = sorted([t.name for t in tools])
        logger.info(f"GitLab agent: Received {len(tools)} MCP tools (filtered by MCP server)")
        logger.info(f"GitLab agent: Available MCP tools: {available_tool_names}")

        return tools

    def _parse_tool_error(self, error: Exception, tool_name: str) -> str:
        """
        Parse GitLab API errors for user-friendly messages.

        Overrides base class to provide GitLab-specific error parsing.

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

        return f"Error executing {tool_name}: {error_str}"

    async def stream(
        self, query: str, sessionId: str, trace_id: str = None
    ) -> AsyncIterable[dict[str, Any]]:
        """
        Stream responses with safety-net error handling.

        Tool-level errors are handled by the CLI tool itself and in the base class,
        but this catches any other unexpected failures (LLM errors, graph errors, etc.)
        as a last resort.

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
            logger.error(f"Unexpected GitLab agent error: {str(e)}", exc_info=True)
            yield {
                'is_task_complete': True,
                'require_user_input': False,
                'kind': 'error',
                'content': f"❌ An unexpected error occurred: {str(e)}\n\nPlease try again or contact support if the issue persists.",
            }
