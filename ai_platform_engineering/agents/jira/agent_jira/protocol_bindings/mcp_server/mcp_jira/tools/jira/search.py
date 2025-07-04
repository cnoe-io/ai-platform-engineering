"""Search operations for Jira MCP"""

import logging
import json
from typing import List, Optional
from agent_jira.protocol_bindings.mcp_server.mcp_jira.api.client import make_api_request
from mcp.server.fastmcp import Context
from agent_jira.protocol_bindings.mcp_server.mcp_jira.models.jira.search import JiraSearchResult

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira")

DEFAULT_READ_JIRA_FIELDS = ["summary", "status", "assignee", "priority"]

# Example usage of JiraSearchResult model in search
async def search(
    ctx: Context,
    jql: str,
    fields: Optional[str] = ",".join(DEFAULT_READ_JIRA_FIELDS),
    limit: int = 10,
    start_at: int = 0,
    projects_filter: Optional[str] = "",
    expand: Optional[str] = "",
) -> list[JiraSearchResult]:
    """Search Jira issues using JQL (Jira Query Language).

    Args:
        ctx: The FastMCP context.
        jql: JQL query string.
        fields: Comma-separated fields to return.
        limit: Maximum number of results.
        start_at: Starting index for pagination.
        projects_filter: Comma-separated list of project keys to filter by.
        expand: Optional fields to expand.

    Returns:
        List of JiraSearchResult objects representing the search results.
    """
    fields_list: Optional[List[str]] = None
    if fields and fields != "*all":
        fields_list = [f.strip() for f in fields.split(",")]

    params = {
        "jql": jql,
        "fields": fields_list,
        "maxResults": limit,
        "startAt": start_at,
        "expand": expand,
        "projectsFilter": projects_filter,
    }

    success, response = await make_api_request(
        path="rest/api/2/search",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to search Jira issues: {response}")

    return response

async def search_fields(
    ctx: Context,
    keyword: Optional[str] = "",
    limit: int = 10,
    refresh: bool = False,
) -> str:
    """Search Jira fields by keyword with fuzzy match.

    Args:
        ctx: The FastMCP context.
        keyword: Keyword for fuzzy search.
        limit: Maximum number of results.
        refresh: Whether to force refresh the field list.

    Returns:
        JSON string representing a list of matching field definitions.
    """
    params = {
        "query": keyword,
        "maxResults": limit,
        "refresh": refresh,
    }

    success, response = await make_api_request(
        path="rest/api/2/field/search",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to search Jira fields: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)
