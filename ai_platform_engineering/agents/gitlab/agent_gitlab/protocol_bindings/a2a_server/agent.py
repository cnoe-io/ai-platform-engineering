# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
GitLab Agent using BaseLangGraphAgent.

This agent supports both HTTP and stdio MCP modes:
- HTTP mode: Uses GitLab's official MCP server at https://{gitlab_host}/-/mcp
- stdio mode: Uses @zereight/mcp-gitlab OSS MCP server

Both modes are supplemented with bash_command tool for git operations (clone, push, etc.)
and file operations that require shell command execution.
"""

import logging
import os
from typing import Dict, Any, Literal, AsyncIterable
from dotenv import load_dotenv
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.subagent_prompts import load_subagent_prompt_config
from agent_gitlab.tools import get_bash_command_tool

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
        Provide custom HTTP MCP configuration for GitLab's official MCP server.

        Uses GitLab's official MCP server endpoint at /-/mcp
        https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/

        Returns:
            Dictionary with GitLab MCP API configuration
        """
        if not self.gitlab_token:
            logger.error("Cannot configure GitLab MCP: GITLAB_TOKEN not set")
            return None

        gitlab_host = os.getenv("GITLAB_HOST", "gitlab.com")

        return {
            "url": f"https://{gitlab_host}/-/mcp",
            "headers": {
                "Authorization": f"Bearer {self.gitlab_token}",
            },
        }

    def get_mcp_config(self, server_path: str | None = None) -> Dict[str, Any]:
        """
        Provide stdio MCP configuration for GitLab using OSS MCP server.

        Uses @zereight/mcp-gitlab which connects directly to GitLab API
        with PAT authentication. This is used when MCP_MODE=stdio.

        When MCP_MODE=http, the official GitLab MCP server is used instead
        (see get_mcp_http_config).

        Returns:
            Dictionary with command and environment for stdio MCP
        """
        if not self.gitlab_token:
            logger.error("Cannot configure GitLab MCP: GITLAB_TOKEN not set")
            return {}

        gitlab_host = os.getenv("GITLAB_HOST", "gitlab.com")

        return {
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@zereight/mcp-gitlab"],
            "env": {
                "GITLAB_API_URL": f"https://{gitlab_host}/api/v4",
                "GITLAB_PERSONAL_ACCESS_TOKEN": self.gitlab_token,
                "USE_PIPELINE": "true",
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

    def get_additional_tools(self) -> list:
        """
        Provide additional custom tools for GitLab agent.

        Returns bash_command tool for git and file operations.

        Returns:
            List containing bash_command tool
        """
        tools = []

        bash_tool = get_bash_command_tool()
        if bash_tool:
            tools.append(bash_tool)
            logger.info("GitLab agent: Added bash command tool (bash_command)")

        return tools

    def _filter_mcp_tools(self, tools: list) -> list:
        """
        Filter MCP tools based on GitLab permission settings.

        Uses environment variables to control tool access:
        - GITLAB_READ_ONLY_MODE: If true, filters out all create/update/delete tools
        - GITLAB_ALLOW_CREATE: If false, filters out create tools
        - GITLAB_ALLOW_UPDATE: If false, filters out update/edit tools

        Delete operations are always filtered out for safety.

        Uses keyword matching to be resilient to tool name transformations by LangChain.

        Args:
            tools: List of MCP tools

        Returns:
            Filtered list of tools
        """
        read_only_mode = os.getenv("GITLAB_READ_ONLY_MODE", "false").lower() == "true"
        allow_create = os.getenv("GITLAB_ALLOW_CREATE", "false").lower() == "true"
        allow_update = os.getenv("GITLAB_ALLOW_UPDATE", "false").lower() == "true"

        # Keywords for DELETE operations (always blocked)
        delete_keywords = ["delete", "remove"]

        # Keywords for CREATE operations (require GITLAB_ALLOW_CREATE=true)
        # Note: "create" also matches "create_or_update" which is correct (it's a write operation)
        create_keywords = ["create", "fork", "new"]

        # Keywords for UPDATE operations (require GITLAB_ALLOW_UPDATE=true)
        update_keywords = [
            "update", "edit", "merge", "push", "publish", "retry", "cancel",
            "play", "promote", "upload"
        ]

        filtered_tools = []
        for tool in tools:
            tool_name_lower = tool.name.lower()

            # FIRST: Always block delete operations
            if any(keyword in tool_name_lower for keyword in delete_keywords):
                logger.info(f"GitLab agent: Filtered out delete tool: {tool.name}")
                continue

            # SECOND: If in read-only mode, block all write operations
            if read_only_mode:
                is_create = any(keyword in tool_name_lower for keyword in create_keywords)
                is_update = any(keyword in tool_name_lower for keyword in update_keywords)
                if is_create or is_update:
                    logger.info(f"GitLab agent: Filtered out write tool (read-only mode): {tool.name}")
                    continue

            # THIRD: Check create operations
            if not allow_create:
                if any(keyword in tool_name_lower for keyword in create_keywords):
                    logger.info(f"GitLab agent: Filtered out create tool (GITLAB_ALLOW_CREATE=false): {tool.name}")
                    continue

            # FOURTH: Check update operations
            if not allow_update:
                if any(keyword in tool_name_lower for keyword in update_keywords):
                    logger.info(f"GitLab agent: Filtered out update tool (GITLAB_ALLOW_UPDATE=false): {tool.name}")
                    continue

            # Tool passed all filters
            filtered_tools.append(tool)

        num_filtered = len(tools) - len(filtered_tools)
        if num_filtered > 0:
            logger.info(
                f"GitLab agent: Filtered {num_filtered} tools. "
                f"Remaining: {len(filtered_tools)} tools. "
                f"(read_only={read_only_mode}, allow_create={allow_create}, allow_update={allow_update})"
            )

        return filtered_tools

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
