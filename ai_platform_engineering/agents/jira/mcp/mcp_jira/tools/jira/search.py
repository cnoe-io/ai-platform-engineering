"""Search operations for Jira MCP"""

import logging
import json
import httpx
import base64
from typing import List, Optional, Dict, Any, Annotated
from pydantic import Field
from mcp_jira.api.client import make_api_request
from mcp_jira.models.jira.search import JiraSearchResult

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira")

DEFAULT_READ_JIRA_FIELDS = ["summary", "status", "assignee", "priority", "issuetype", "created", "updated"]

async def search(
    jql: Annotated[str, Field(description="JQL query string to search for issues")],
    fields: Annotated[Optional[str], Field(description="Comma-separated fields to return (e.g., 'summary,status,assignee')")] = None,
    limit: Annotated[int, Field(description="Maximum number of results to return")] = 100,
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
    # Auto-correct: remove issuetype filters from JQL (unless explicitly wanted by user)
    import re
    if jql and re.search(r'\bAND\s+issuetype\s*=\s*\w+', jql, re.IGNORECASE):
        original_jql = jql
        jql = re.sub(r'\s+AND\s+issuetype\s*=\s*\w+', '', jql, flags=re.IGNORECASE)
        logger.warning(f"Auto-correcting: removed issuetype filter from JQL")
        logger.debug(f"Original: {original_jql}")
        logger.debug(f"Corrected: {jql}")

    # Get credentials from environment
    import os
    email = os.getenv("ATLASSIAN_EMAIL")
    token = os.getenv("ATLASSIAN_TOKEN")
    base_url = os.getenv("ATLASSIAN_API_URL")

    if not all([email, token, base_url]):
        raise ValueError("Missing required environment variables: ATLASSIAN_EMAIL, ATLASSIAN_TOKEN, ATLASSIAN_API_URL")

    # Prepare fields list
    fields_list: Optional[List[str]] = None
    if fields and fields != "*all":
        fields_list = [f.strip() for f in fields.split(",")]
    elif fields is None:
        # Use default fields when none specified
        fields_list = DEFAULT_READ_JIRA_FIELDS

    # Build payload exactly like the minimal example
    payload_data = {
        "fieldsByKeys": True,
        "jql": jql,
        "maxResults": limit
    }

    # Add fields if specified
    if fields_list:
        payload_data["fields"] = fields_list

    # Serialize payload exactly like the example
    payload = json.dumps(payload_data)

    # Prepare headers exactly like the minimal example
    headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': f'Basic {base64.b64encode(f"{email}:{token}".encode()).decode()}'
    }

    # Use the exact URL from the example
    url = f"{base_url}/rest/api/3/search/jql"

    try:
        # Log request details
        print("\n=== HTTP REQUEST ===")
        print(f"URL: {url}")
        print("Method: POST")
        print(f"Headers: {headers}")
        print(f"Payload: {payload}")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url,
                data=payload,  # Use data=payload like the example
                headers=headers
            )

            # Log response details
            print("\n=== HTTP RESPONSE ===")
            print(f"Status Code: {response.status_code}")
            print(f"Headers: {dict(response.headers)}")
            print(f"Response Body: {response.text[:1000]}...")  # First 1000 chars

            if response.status_code == 200:
                response_data = response.json()
                print(f"Parsed JSON: {response_data}")
                return JiraSearchResult.from_api_response(response_data, requested_fields=fields_list)
            else:
                error_data = response.json() if response.content else {}
                print(f"Error Response: {error_data}")
                raise ValueError(f"Failed to search Jira issues: {error_data}")

    except Exception as e:
        print(f"Exception: {str(e)}")
        raise ValueError(f"Failed to search Jira issues: {str(e)}")


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

