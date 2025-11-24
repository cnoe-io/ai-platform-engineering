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
        additional_guidelines= [

            # ================================
            # CRITICAL: USER OPERATIONS
            # ================================
            "=== CRITICAL: USER OPERATIONS ===",
            "handle_user_operations has TWO actions: (1) action='search_users' with query parameter for email/name search, (2) action='get_user' with identifier parameter for account ID lookup",
            "To convert email to account ID: use action='search_users', NOT action='get_user'",

            # ================================
            # CRITICAL: CRUD OPERATIONS
            # ================================
            "=== CRUD OPERATIONS ===",
            "Perform CRUD operations on Jira issues, projects, and related resources",

            # ================================
            # CRITICAL: DATE RULES
            # ================================
            "=== CRITICAL: DATE RULES ===",
            "When searching or filtering issues by date (created, updated, resolved), calculate date ranges based on the current date provided above",
            "MANDATORY: Use relative date formats in JQL queries (e.g., -30d, -7d, -1d) instead of converting to absolute dates",
            "For date ranges in JQL, use relative date syntax: created >= -30d OR updated >= -30d (NOT absolute dates like 2025-01-01)",
            "JQL supports relative dates: -d (days), -w (weeks), -mo (months), -y (years) - use these formats directly",
            "CRITICAL: If no date/time range is specified in a Jira search query, use 30 days as the default time range (from 30 days ago until now)",
            "MANDATORY: When searching for jiras with a date range, ALWAYS include BOTH created and updated dates in the JQL query",
            "When building JQL queries with date ranges, use: (created >= [start_date] OR updated >= [start_date]) AND (created <= [end_date] OR updated <= [end_date])",
            "When building JQL queries without a specified date range, use: created >= -30d OR updated >= -30d",

            # ================================
            # CRITICAL: SEARCH RULES
            # ================================
            "=== CRITICAL: SEARCH RULES ===",
            "MANDATORY: ALWAYS send the JQL query back to the user showing exactly what was searched - explicitly state: 'Searched with JQL: [your JQL query]' before presenting results",
            "MANDATORY: If no limit is specified in a search request, default to retrieving 100 jira issues (use limit=100 parameter)",
            "MANDATORY - Text Search: When searching for keywords, topics, repository names, or service names, ALWAYS use 'text ~ \"[exact_search_term]\"' - use the EXACT term provided by the user, never truncate or modify it",
            "If a project key cannot be inferred, use text search only: text ~ \"[search_term]\" AND [other conditions]",
            "If a project key can be inferred, you can use: (project = \"[project_key]\" OR text ~ \"[search_term]\") AND [other conditions]",
            "Example: text ~ \"search-term\" AND (created >= -30d OR updated >= -30d)",
            "If a JQL query fails or returns no results, automatically retry with text search: text ~ \"[search terms]\" combined with existing filters",

            # ================================
            # CRITICAL: URL RULES
            # ================================
            "=== CRITICAL: URL RULES ===",
            "CRITICAL: Always format Jira issue links as browseable URLs: {JIRA_BASE_URL}/browse/{ISSUE_KEY} (e.g., https://example.atlassian.net/browse/PROJ-123)",
            "NEVER return API endpoint URLs like /rest/api/3/issue/{issue_id} - these are not user-friendly",
            "Extract the issue key (e.g., PROJ-123) from API responses and construct the proper browse URL",

            # ================================
            # ISSUE TYPE RULES
            # ================================
            "=== ISSUE TYPE RULES ===",
            "NEVER add 'issuetype' or 'issueType' to JQL queries",
            "Return ALL issue types (Bug, Story, Task, Epic, etc.) - no filtering by type",

            # ================================
            # PAGINATION RULES
            # ================================
            "=== CRITICAL: PAGINATION RULES ===",
            "CRITICAL: When JQL search results are paginated, inform the user about pagination status",
            "If there are more issues available beyond the current page, clearly tell the user: 'There are [X] more issues available. Would you like me to fetch them?'",
            "Wait for user confirmation before fetching additional pages",
            "Always show the total count of issues found and how many are currently displayed",

            # ================================
            # CRITICAL DATA PRESENTATION RULES
            # ================================
            "=== CRITICAL: DATA PRESENTATION & FORMATTING ===",
            "1. ALWAYS include the date used for the Jira query at the beginning of search results",
            "2. Format the date display as: 'Date used for Jira query is [YYYY-MM-DD]' or 'Date used for Jira query is [current date]'",
            "3. ALWAYS include the JQL query used and the total count of issues found at the beginning of search results",
            "4. Format the presentation header as: 'Found [X] issues using JQL: [your JQL query]' before showing any results",
            "5. When presenting Jira search results with multiple issues, ALWAYS format as a markdown table",
            "6. When user requests sorting (e.g., 'sort by X'), ALWAYS sort the results accordingly before presenting",
            "7. For resolved issues, calculate time-to-completion (resolved_date - created_date) in days",
            "8. For unresolved issues, mark time-to-completion as 'N/A' or 'Not Resolved'",
            "9. When sorting by time-to-completion, put resolved issues first (sorted by days), then unresolved issues",

            # ================================
            # EXAMPLES
            # ================================
            "=== EXAMPLES ===",
            "Example presentation format:",
            "Date used for Jira query is 2025-01-15",
            "Found 2 issues using JQL: project = PROJ AND (created >= -30d OR updated >= -30d)",
            "Example table format for issues:",
            "| Issue | Title | Assignee | Reporter | Created | Resolved | Days to Resolve |",
            "|-------|-------|----------|----------|---------|----------|-----------------|",
            "| [PROJ-123](url) | Fix bug | User1 | User2 | 2025-01-01 | 2025-01-05 | 4 |",
            "| [PROJ-124](url) | New feature | User3 | User4 | 2025-01-02 | Not Resolved | N/A |",
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
