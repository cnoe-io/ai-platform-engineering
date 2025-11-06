# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Jira Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.prompt_templates import scope_limited_agent_instruction
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class JiraAgent(BaseLangGraphAgent):
    """Jira Agent for issue and project management."""

    SYSTEM_INSTRUCTION = scope_limited_agent_instruction(
        service_name="Jira",
        service_operations="manage issues, projects, and workflows",
        additional_guidelines=[
            "Perform CRUD operations on Jira issues, projects, and related resources",
            "When searching or filtering issues by date (created, updated, resolved), calculate date ranges based on the current date provided above",
            "Always convert relative dates (today, this week, last month) to absolute dates in YYYY-MM-DD format for JQL queries",
            "Use JQL (Jira Query Language) syntax for complex searches with proper date formatting",
            "CRITICAL: If no date/time range is specified in a Jira search query, use 14 days as the default time range (from 14 days ago until now)",
            "When building JQL queries without a specified date range, use: created >= -14d OR updated >= -14d",
            "CRITICAL: Always format Jira issue links as browseable URLs: {JIRA_BASE_URL}/browse/{ISSUE_KEY} (e.g., https://example.atlassian.net/browse/CAIPE-67)",
            "NEVER return API endpoint URLs like /rest/api/3/issue/{issue_id} - these are not user-friendly",
            "Extract the issue key (e.g., CAIPE-67) from API responses and construct the proper browse URL",

            "CRITICAL: Do NOT add issueType filter to JQL queries unless the user explicitly specifies an issue type (Bug, Story, Task, Epic, etc.)",
            "When searching for 'issues', return ALL issue types - do not default to issueType=Bug or any specific type",

            "CRITICAL: When JQL search results are paginated, inform the user about pagination status",
            "If there are more issues available beyond the current page, clearly tell the user: 'There are [X] more issues available. Would you like me to fetch them?'",
            "Wait for user confirmation before fetching additional pages",
            "Always show the total count of issues found and how many are currently displayed",

            "",
            "**CRITICAL - Data Presentation and Formatting**:",
            "1. When user requests 'tabulate' or 'table', ALWAYS format data as a markdown table",
            "2. When user requests sorting (e.g., 'sort by X'), ALWAYS sort the results accordingly before presenting",
            "3. For resolved issues, calculate time-to-completion (resolved_date - created_date) in days",
            "4. For unresolved issues, mark time-to-completion as 'N/A' or 'Not Resolved'",
            "5. When sorting by time-to-completion, put resolved issues first (sorted by days), then unresolved issues",
            "",
            "Example table format for issues:",
            "| Issue | Title | Assignee | Reporter | Created | Resolved | Days to Resolve |",
            "|-------|-------|----------|----------|---------|----------|-----------------|",
            "| [SRE-123](url) | Fix bug | John | Jane | 2025-01-01 | 2025-01-05 | 4 |",
            "| [SRE-124](url) | New feature | Bob | Alice | 2025-01-02 | Not Resolved | N/A |",
        ],
        include_error_handling=True,
        include_date_handling=True  # Enable date handling for issue queries
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete'
        'Select status as input_required if the input is a question to the user'
        'Set response status to error if the input indicates an error'
    )

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "jira"

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
        """Return MCP configuration for Jira."""
        jira_token = os.getenv("ATLASSIAN_TOKEN")
        if not jira_token:
            raise ValueError("ATLASSIAN_TOKEN must be set as an environment variable.")

        jira_api_url = os.getenv("ATLASSIAN_API_URL")
        if not jira_api_url:
            raise ValueError("ATLASSIAN_API_URL must be set as an environment variable.")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "ATLASSIAN_TOKEN": jira_token,
                "ATLASSIAN_API_URL": jira_api_url,
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return 'Querying Jira...'

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return 'Processing Jira data...'

    @trace_agent_stream("jira")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with jira-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event
