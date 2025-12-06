"""Backlog operations for Jira MCP

This module provides tools for managing Jira Software backlogs using the Jira Agile REST API.
Reference: https://developer.atlassian.com/cloud/jira/software/rest/api-group-backlog/
"""

import json
import logging
from typing import Annotated, Optional, List, Dict, Any

from pydantic import Field
from mcp_jira.api.client import make_api_request
from mcp_jira.tools.jira.constants import check_read_only

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira-backlogs")


async def get_backlog_issues(
    board_id: Annotated[
        int,
        Field(description="ID of the board")
    ],
    start_at: Annotated[
        int,
        Field(description="Starting index for pagination", default=0, ge=0)
    ] = 0,
    max_results: Annotated[
        int,
        Field(description="Maximum number of issues to return", default=50, ge=1, le=100)
    ] = 50,
    jql: Annotated[
        Optional[str],
        Field(description="(Optional) JQL query to filter backlog issues")
    ] = None,
    validate_query: Annotated[
        bool,
        Field(description="Whether to validate the JQL query", default=True)
    ] = True,
    fields: Annotated[
        Optional[str],
        Field(description="(Optional) Comma-separated list of fields to return")
    ] = None,
    expand: Annotated[
        Optional[str],
        Field(description="(Optional) Fields to expand (e.g., 'changelog')")
    ] = None,
) -> str:
    """Get issues for backlog.

    Returns all issues from the board's backlog, for the given board ID. This only includes issues
    that the user has permission to view. The backlog contains incomplete issues that are not assigned
    to any future or active sprint. Note, if the user does not have permission to view the board, no
    issues will be returned at all. Issues returned from this resource include Agile fields, like
    sprint, closedSprints, flagged, and epic.

    Args:
        board_id: Board ID.
        start_at: Starting index for pagination.
        max_results: Maximum number of issues to return.
        jql: Optional JQL query to filter issues.
        validate_query: Whether to validate the JQL query.
        fields: Optional comma-separated list of fields.
        expand: Optional fields to expand.

    Returns:
        JSON string containing the backlog issues.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-backlog-get
    """
    logger.debug(f"get_backlog_issues called with board_id={board_id}")

    params: Dict[str, Any] = {
        "startAt": start_at,
        "maxResults": max_results,
        "validateQuery": validate_query,
    }

    if jql:
        params["jql"] = jql
    if fields:
        params["fields"] = fields
    if expand:
        params["expand"] = expand

    success, response = await make_api_request(
        path=f"rest/agile/1.0/board/{board_id}/backlog",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch backlog issues for board {board_id}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def move_issues_to_backlog(
    issues: Annotated[
        List[str],
        Field(
            description=(
                "List of issue keys or IDs to move to the backlog "
                "(e.g., ['PROJ-123', 'PROJ-124'] or ['10001', '10002'])"
            )
        ),
    ],
) -> str:
    """Move issues to backlog.

    Moves issues to the backlog. This operation is equivalent to remove future and active sprints
    from a given set of issues. At most 50 issues may be moved at once.

    Args:
        issues: List of issue keys or IDs to move to backlog (max 50).

    Returns:
        JSON string confirming the operation.

    Raises:
        ValueError: If in read-only mode, too many issues, or API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-backlog/#api-rest-agile-1-0-backlog-issue-post
    """
    check_read_only()

    if len(issues) > 50:
        raise ValueError(f"Cannot move more than 50 issues at once. Provided: {len(issues)}")

    logger.debug(f"move_issues_to_backlog called with {len(issues)} issues")

    move_data = {
        "issues": issues,
    }

    logger.debug(f"Move data to send: {json.dumps(move_data, indent=2)}")

    success, response = await make_api_request(
        path="rest/agile/1.0/backlog/issue",
        method="POST",
        data=move_data,
    )

    if not success:
        raise ValueError(f"Failed to move issues to backlog: {response}")

    return json.dumps(
        {
            "success": True,
            "message": f"Successfully moved {len(issues)} issue(s) to backlog",
            "issues_moved": len(issues),
        },
        indent=2,
        ensure_ascii=False,
    )


async def move_issues_to_backlog_for_board(
    board_id: Annotated[
        int,
        Field(description="ID of the board")
    ],
    issues: Annotated[
        List[str],
        Field(
            description=(
                "List of issue keys or IDs to move to the board's backlog "
                "(e.g., ['PROJ-123', 'PROJ-124'] or ['10001', '10002'])"
            )
        ),
    ],
    rank_before_issue: Annotated[
        Optional[str],
        Field(
            description=(
                "(Optional) Issue key or ID to rank the moved issues before. "
                "If not provided, issues are ranked to the end of the backlog."
            )
        ),
    ] = None,
    rank_custom_field_id: Annotated[
        Optional[int],
        Field(
            description=(
                "(Optional) ID of the rank custom field. "
                "If not provided, the default rank field is used."
            )
        ),
    ] = None,
) -> str:
    """Move issues to backlog for board.

    Moves issues to the backlog of a specific board. This operation is equivalent to moving issues
    to the backlog and then ranking them on a specific board. At most 50 issues may be moved at once.

    Args:
        board_id: Board ID.
        issues: List of issue keys or IDs to move to backlog (max 50).
        rank_before_issue: Optional issue to rank before.
        rank_custom_field_id: Optional custom field ID for ranking.

    Returns:
        JSON string confirming the operation.

    Raises:
        ValueError: If in read-only mode, too many issues, or API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-backlog/#api-rest-agile-1-0-backlog-board-boardid-issue-post
    """
    check_read_only()

    if len(issues) > 50:
        raise ValueError(f"Cannot move more than 50 issues at once. Provided: {len(issues)}")

    logger.debug(f"move_issues_to_backlog_for_board called with board_id={board_id}, {len(issues)} issues")

    move_data: Dict[str, Any] = {
        "issues": issues,
    }

    if rank_before_issue:
        move_data["rankBeforeIssue"] = rank_before_issue
    if rank_custom_field_id:
        move_data["rankCustomFieldId"] = rank_custom_field_id

    logger.debug(f"Move data to send: {json.dumps(move_data, indent=2)}")

    success, response = await make_api_request(
        path=f"rest/agile/1.0/backlog/{board_id}/issue",
        method="POST",
        data=move_data,
    )

    if not success:
        raise ValueError(f"Failed to move issues to backlog for board {board_id}: {response}")

    return json.dumps(
        {
            "success": True,
            "message": f"Successfully moved {len(issues)} issue(s) to backlog for board {board_id}",
            "board_id": board_id,
            "issues_moved": len(issues),
        },
        indent=2,
        ensure_ascii=False,
    )


async def get_issues_without_epic(
    board_id: Annotated[
        int,
        Field(description="ID of the board")
    ],
    start_at: Annotated[
        int,
        Field(description="Starting index for pagination", default=0, ge=0)
    ] = 0,
    max_results: Annotated[
        int,
        Field(description="Maximum number of issues to return", default=50, ge=1, le=100)
    ] = 50,
    jql: Annotated[
        Optional[str],
        Field(description="(Optional) JQL query to filter issues")
    ] = None,
    validate_query: Annotated[
        bool,
        Field(description="Whether to validate the JQL query", default=True)
    ] = True,
    fields: Annotated[
        Optional[str],
        Field(description="(Optional) Comma-separated list of fields to return")
    ] = None,
) -> str:
    """Get issues without epic for board.

    Returns all issues from the board that are not associated with any epic. This only includes issues
    that the user has permission to view. Issues returned from this resource include Agile fields, like
    sprint, closedSprints, and flagged.

    Args:
        board_id: Board ID.
        start_at: Starting index for pagination.
        max_results: Maximum number of issues to return.
        jql: Optional JQL query to filter issues.
        validate_query: Whether to validate the JQL query.
        fields: Optional comma-separated list of fields.

    Returns:
        JSON string containing issues without epic.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-epic-none-issue-get
    """
    logger.debug(f"get_issues_without_epic called with board_id={board_id}")

    params: Dict[str, Any] = {
        "startAt": start_at,
        "maxResults": max_results,
        "validateQuery": validate_query,
    }

    if jql:
        params["jql"] = jql
    if fields:
        params["fields"] = fields

    success, response = await make_api_request(
        path=f"rest/agile/1.0/board/{board_id}/epic/none/issue",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch issues without epic for board {board_id}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def get_board_issues_for_epic(
    board_id: Annotated[
        int,
        Field(description="ID of the board")
    ],
    epic_id: Annotated[
        int,
        Field(description="ID of the epic")
    ],
    start_at: Annotated[
        int,
        Field(description="Starting index for pagination", default=0, ge=0)
    ] = 0,
    max_results: Annotated[
        int,
        Field(description="Maximum number of issues to return", default=50, ge=1, le=100)
    ] = 50,
    jql: Annotated[
        Optional[str],
        Field(description="(Optional) JQL query to filter issues")
    ] = None,
    validate_query: Annotated[
        bool,
        Field(description="Whether to validate the JQL query", default=True)
    ] = True,
    fields: Annotated[
        Optional[str],
        Field(description="(Optional) Comma-separated list of fields to return")
    ] = None,
) -> str:
    """Get board issues for epic.

    Returns all issues that belong to an epic on the board, for the given epic ID and board ID.
    This only includes issues that the user has permission to view. Issues returned from this resource
    include Agile fields, like sprint, closedSprints, and flagged.

    Args:
        board_id: Board ID.
        epic_id: Epic ID.
        start_at: Starting index for pagination.
        max_results: Maximum number of issues to return.
        jql: Optional JQL query to filter issues.
        validate_query: Whether to validate the JQL query.
        fields: Optional comma-separated list of fields.

    Returns:
        JSON string containing the epic's issues on the board.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-epic-epicid-issue-get
    """
    logger.debug(f"get_board_issues_for_epic called with board_id={board_id}, epic_id={epic_id}")

    params: Dict[str, Any] = {
        "startAt": start_at,
        "maxResults": max_results,
        "validateQuery": validate_query,
    }

    if jql:
        params["jql"] = jql
    if fields:
        params["fields"] = fields

    success, response = await make_api_request(
        path=f"rest/agile/1.0/board/{board_id}/epic/{epic_id}/issue",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch issues for epic {epic_id} on board {board_id}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)

