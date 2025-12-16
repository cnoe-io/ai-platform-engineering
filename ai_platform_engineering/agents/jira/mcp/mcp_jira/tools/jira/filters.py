"""Filter operations for Jira MCP

This module provides tools for managing Jira filters using the Jira REST API.
Reference: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-filters/
"""

import json
import logging
from typing import Annotated, Optional, List, Dict, Any

from pydantic import Field
from mcp_jira.api.client import make_api_request
from mcp_jira.tools.jira.constants import check_read_only

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira-filters")


async def create_filter(
    name: Annotated[
        str,
        Field(description="Name of the filter")
    ],
    jql: Annotated[
        str,
        Field(
            description=(
                "JQL query for the filter. For board filters, MUST include "
                "'ORDER BY Rank' for drag-and-drop functionality. "
                "Example: 'project = SRI ORDER BY Rank'"
            )
        )
    ],
    description: Annotated[
        Optional[str],
        Field(description="(Optional) Description of the filter")
    ] = None,
    favorite: Annotated[
        bool,
        Field(description="Whether to mark filter as favorite (default: false)")
    ] = False,
    share_permissions: Annotated[
        Optional[List[Dict[str, str]]],
        Field(
            description=(
                "(Optional) Share permissions. Examples: "
                "[{'type': 'project', 'projectId': '10000'}] for project sharing, "
                "[{'type': 'group', 'groupname': 'jira-users'}] for group sharing"
            )
        )
    ] = None,
) -> str:
    """Create a Jira filter.

    Creates a new filter with the specified JQL query and permissions.

    Important notes:
    - For board filters, JQL MUST include 'ORDER BY Rank' clause
    - Filters can be shared with projects, groups, or kept private
    - Filter name must be unique for the user

    Args:
        name: Filter name (required).
        jql: JQL query string (required, must include ORDER BY Rank for boards).
        description: Optional filter description.
        favorite: Whether to mark as favorite.
        share_permissions: Optional list of permission objects.

    Returns:
        JSON string representing the created filter including the filter ID.

    Raises:
        ValueError: If required fields missing, in read-only mode, or API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-filters/#api-rest-api-3-filter-post
    """
    check_read_only()

    logger.debug(f"create_filter called with name={name}, jql={jql}")

    filter_data: Dict[str, Any] = {
        "name": name,
        "jql": jql,
    }

    if description:
        filter_data["description"] = description

    if favorite:
        filter_data["favourite"] = True

    if share_permissions:
        filter_data["sharePermissions"] = share_permissions

    logger.debug(f"Filter data to send: {json.dumps(filter_data, indent=2)}")

    success, response = await make_api_request(
        path="rest/api/3/filter",
        method="POST",
        data=filter_data,
    )

    if not success:
        error_msg = response.get("errorMessages", ["Unknown error"])
        raise ValueError(f"Failed to create filter: {error_msg}")

    # Format response with helpful info
    filter_id = response.get("id", "unknown")
    filter_url = response.get("viewUrl", "")

    result = {
        "success": True,
        "filter_id": filter_id,
        "name": name,
        "jql": jql,
        "viewUrl": filter_url,
        "message": f"Filter '{name}' created successfully with ID {filter_id}"
    }

    return json.dumps(result, indent=2, ensure_ascii=False)


async def get_filter(
    filter_id: Annotated[
        int,
        Field(description="ID of the filter to retrieve")
    ],
) -> str:
    """Get filter details by ID.

    Returns the filter details for a given filter ID.

    Args:
        filter_id: Filter ID.

    Returns:
        JSON string representing the filter details.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-filters/#api-rest-api-3-filter-id-get
    """
    logger.debug(f"get_filter called with filter_id={filter_id}")

    success, response = await make_api_request(
        path=f"rest/api/3/filter/{filter_id}",
        method="GET",
    )

    if not success:
        error_msg = response.get("errorMessages", ["Filter not found or no permission"])
        raise ValueError(f"Failed to fetch filter {filter_id}: {error_msg}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def search_filters(
    filter_name: Annotated[
        Optional[str],
        Field(description="(Optional) Filter by filter name")
    ] = None,
    account_id: Annotated[
        Optional[str],
        Field(description="(Optional) Filter by owner account ID")
    ] = None,
    order_by: Annotated[
        str,
        Field(description="Sort order: 'name', '-name', 'favourite_count', etc.")
    ] = "name",
    start_at: Annotated[
        int,
        Field(description="Starting index for pagination (default: 0)")
    ] = 0,
    max_results: Annotated[
        int,
        Field(description="Maximum number of filters to return (default: 50, max: 100)")
    ] = 50,
) -> str:
    """Search for filters.

    Returns filters that the user has permission to view.

    Args:
        filter_name: Optional filter name to search for.
        account_id: Optional owner account ID.
        order_by: Sort order.
        start_at: Starting index for pagination.
        max_results: Maximum number of filters to return.

    Returns:
        JSON string containing the list of filters.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-filters/#api-rest-api-3-filter-search-get
    """
    logger.debug(f"search_filters called with filter_name={filter_name}")

    params: Dict[str, Any] = {
        "orderBy": order_by,
        "startAt": start_at,
        "maxResults": max_results,
    }

    if filter_name:
        params["filterName"] = filter_name
    if account_id:
        params["accountId"] = account_id

    success, response = await make_api_request(
        path="rest/api/3/filter/search",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to search filters: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def update_filter(
    filter_id: Annotated[
        int,
        Field(description="ID of the filter to update")
    ],
    name: Annotated[
        Optional[str],
        Field(description="(Optional) Updated filter name")
    ] = None,
    jql: Annotated[
        Optional[str],
        Field(description="(Optional) Updated JQL query")
    ] = None,
    description: Annotated[
        Optional[str],
        Field(description="(Optional) Updated description")
    ] = None,
    favorite: Annotated[
        Optional[bool],
        Field(description="(Optional) Update favorite status")
    ] = None,
) -> str:
    """Update an existing filter.

    Updates a filter with new details. Only provided fields will be updated.

    Args:
        filter_id: Filter ID to update.
        name: Optional updated filter name.
        jql: Optional updated JQL query.
        description: Optional updated description.
        favorite: Optional updated favorite status.

    Returns:
        JSON string representing the updated filter.

    Raises:
        ValueError: If in read-only mode or API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-filters/#api-rest-api-3-filter-id-put
    """
    check_read_only()

    logger.debug(f"update_filter called with filter_id={filter_id}")

    filter_data: Dict[str, Any] = {}

    if name:
        filter_data["name"] = name
    if jql:
        filter_data["jql"] = jql
    if description is not None:
        filter_data["description"] = description
    if favorite is not None:
        filter_data["favourite"] = favorite

    if not filter_data:
        return json.dumps({
            "error": "No fields provided to update",
            "filter_id": filter_id
        }, indent=2)

    success, response = await make_api_request(
        path=f"rest/api/3/filter/{filter_id}",
        method="PUT",
        data=filter_data,
    )

    if not success:
        error_msg = response.get("errorMessages", ["Unknown error"])
        raise ValueError(f"Failed to update filter {filter_id}: {error_msg}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def delete_filter(
    filter_id: Annotated[
        int,
        Field(description="ID of the filter to delete")
    ],
) -> str:
    """Delete a filter.

    Deletes a filter. The user must own the filter or have admin permissions.

    Args:
        filter_id: Filter ID to delete.

    Returns:
        JSON string confirming deletion.

    Raises:
        ValueError: If in read-only mode or API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-filters/#api-rest-api-3-filter-id-delete
    """
    check_read_only()

    logger.debug(f"delete_filter called with filter_id={filter_id}")

    success, response = await make_api_request(
        path=f"rest/api/3/filter/{filter_id}",
        method="DELETE",
    )

    if not success:
        error_msg = response.get("errorMessages", ["Unknown error"])
        raise ValueError(f"Failed to delete filter {filter_id}: {error_msg}")

    return json.dumps({
        "success": True,
        "message": f"Filter {filter_id} deleted successfully"
    }, indent=2, ensure_ascii=False)



