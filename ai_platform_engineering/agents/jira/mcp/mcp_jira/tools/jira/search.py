"""Search operations for Jira MCP"""

import logging
import asyncio
from typing import List, Optional, Dict, Any, Annotated
from pydantic import Field
from mcp_jira.api.client import make_api_request, validate_prerequisites
from mcp_jira.models.jira.search import JiraSearchResult

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp-jira")

DEFAULT_READ_JIRA_FIELDS = ["summary", "status", "assignee", "priority", "issuetype", "created", "updated"]

async def search(
    jql: Annotated[str, Field(description="JQL query string to search for issues")],
    fields: Annotated[Optional[str], Field(description="Comma-separated fields to return (e.g., 'summary,status,assignee')")] = None,
    limit: Annotated[int, Field(description="Maximum number of results to return (default 25, max 100 to prevent context overflow)")] = 25,
    start_at: Annotated[int, Field(description="Starting index for pagination")] = 0,
    projects_filter: Annotated[str, Field(description="Comma-separated list of project keys to filter by")] = "",
    expand: Annotated[str, Field(description="Optional fields to expand")] = "",
    next_page_token: Annotated[Optional[str], Field(description="Token for pagination (new in v3)")] = None,
    reconcile_issues: Annotated[Optional[List[int]], Field(description="List of issue IDs to reconcile")] = None,
    properties: Annotated[Optional[List[str]], Field(description="List of properties to include")] = None,
    fields_by_keys: Annotated[bool, Field(description="Whether to use field keys instead of field IDs")] = False,
) -> JiraSearchResult:
    """Search Jira issues using JQL (Jira Query Language) with enhanced search API.

    Args:
        jql: JQL query string.
        fields: Comma-separated fields to return.
        limit: Maximum number of results.
        start_at: Starting index for pagination.
        projects_filter: Comma-separated list of project keys to filter by.
        expand: Optional fields to expand.
        next_page_token: Token for pagination (new in v3).
        reconcile_issues: List of issue IDs to reconcile.
        properties: List of properties to include.
        fields_by_keys: Whether to use field keys instead of field IDs.

    Returns:
        JiraSearchResult object representing the search results.
    """
    # Note: issuetype filters are now allowed in JQL queries
    # When user asks for specific issue types (epics, bugs, etc.), the filter is preserved

    # Prepare fields list
    fields_list: Optional[List[str]] = None
    if fields and fields != "*all":
        fields_list = [f.strip() for f in fields.split(",")]
    elif fields is None:
        # Use default fields when none specified
        fields_list = DEFAULT_READ_JIRA_FIELDS

    # Build the enhanced-search payload (POST rest/api/3/search/jql).
    payload_data: Dict[str, Any] = {
        "fieldsByKeys": True,
        "jql": jql,
        "maxResults": limit,
    }
    if fields_list:
        payload_data["fields"] = fields_list
    if start_at:
        payload_data["startAt"] = start_at
    if next_page_token:
        payload_data["nextPageToken"] = next_page_token
    if expand:
        payload_data["expand"] = expand
    if reconcile_issues:
        payload_data["reconcileIssues"] = reconcile_issues
    if properties:
        payload_data["properties"] = properties

    # Route through the shared client so this honors the per-user provider token
    # (X-CAIPE-Provider-Token -> Bearer + Atlassian cloud-id gateway rewrite) and
    # falls back to the static API token (Basic auth) when impersonation is off.
    # Credential/URL validation lives in make_api_request -> validate_prerequisites.
    success, response = await make_api_request(
        path="rest/api/3/search/jql",
        method="POST",
        data=payload_data,
    )
    if not success:
        error_text = response.get("error") if isinstance(response, dict) else str(response)
        raise ValueError(f"Failed to search Jira issues: {error_text}")

    return JiraSearchResult.from_api_response(response, requested_fields=fields_list)


def search_jira_issues(
    jql: str,
    fields: Optional[str] = None,
    limit: int = 25,
    start_at: int = 0,
) -> JiraSearchResult | str:
    """Backward-compatible sync wrapper used by older tests and tooling."""
    ok, result = validate_prerequisites()
    if not ok:
        return f"Error: {result.get('error', 'Missing Jira configuration')}"

    async def _run_search() -> JiraSearchResult:
        payload: Dict[str, Any] = {
            "fieldsByKeys": True,
            "jql": jql,
            "maxResults": limit,
            "startAt": start_at,
        }

        requested_fields: Optional[List[str]] = None
        if fields and fields != "*all":
            requested_fields = [field.strip() for field in fields.split(",")]
            payload["fields"] = requested_fields
        elif fields is None:
            requested_fields = DEFAULT_READ_JIRA_FIELDS
            payload["fields"] = requested_fields

        success, response = await make_api_request(
            path="rest/api/3/search/jql",
            method="POST",
            data=payload,
        )
        if not success:
            error_text = response.get("error") if isinstance(response, dict) else str(response)
            raise ValueError(error_text)

        return JiraSearchResult.from_api_response(response, requested_fields=requested_fields)

    try:
        return asyncio.run(_run_search())
    except Exception as exc:
        return f"Error: {exc}"


async def check_jql_match(
    issue_ids: Annotated[List[int], Field(description="List of issue IDs to check")],
    jqls: Annotated[List[str], Field(description="List of JQL queries to check against")],
) -> Dict[str, Any]:
    """Check whether issues would be returned by JQL queries.

    Args:
        issue_ids: List of issue IDs to check.
        jqls: List of JQL queries to check against.

    Returns:
        Dictionary containing match results for each JQL query.
    """
    data = {
        "issueIds": issue_ids,
        "jqls": jqls,
    }

    success, response = await make_api_request(
        path="rest/api/3/jql/match",
        method="POST",
        data=data,
    )

    if not success:
        raise ValueError(f"Failed to check JQL match: {response}")

    return response

async def get_approximate_count(
    jql: Annotated[str, Field(description="JQL query string to get approximate count for")],
) -> Dict[str, Any]:
    """Get approximate count of issues matching a JQL query.

    Args:
        jql: JQL query string.

    Returns:
        Dictionary containing the approximate count.
    """
    data = {
        "jql": jql,
    }

    success, response = await make_api_request(
        path="rest/api/3/search/approximate-count",
        method="POST",
        data=data,
    )

    if not success:
        raise ValueError(f"Failed to get approximate count: {response}")

    return response

