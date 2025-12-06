"""Board operations for Jira MCP

This module provides tools for managing Jira Software boards using the Jira Agile REST API.
Reference: https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/
"""

import json
import logging
from typing import Annotated, Optional, Dict, Any

from pydantic import Field
from mcp_jira.api.client import make_api_request
from mcp_jira.tools.jira.constants import check_read_only, check_boards_delete_protection

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira-boards")


async def get_all_boards(
    start_at: Annotated[
        int,
        Field(description="Starting index for pagination", default=0, ge=0)
    ] = 0,
    max_results: Annotated[
        int,
        Field(description="Maximum number of boards to return", default=50, ge=1, le=100)
    ] = 50,
    board_type: Annotated[
        Optional[str],
        Field(
            description=(
                "(Optional) Filter boards by type: 'scrum', 'kanban', or 'simple'. "
                "If not provided, returns all board types."
            )
        ),
    ] = None,
    name: Annotated[
        Optional[str],
        Field(description="(Optional) Filter boards by name (case-insensitive partial match)")
    ] = None,
    project_key_or_id: Annotated[
        Optional[str],
        Field(description="(Optional) Filter boards by project key or ID")
    ] = None,
) -> str:
    """Get all boards.

    Returns all boards that the user has permission to view.

    Args:
        start_at: Starting index for pagination.
        max_results: Maximum number of boards to return.
        board_type: Optional board type filter ('scrum', 'kanban', 'simple').
        name: Optional board name filter.
        project_key_or_id: Optional project filter.

    Returns:
        JSON string containing the list of boards.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-get
    """
    logger.debug(
        f"get_all_boards called with start_at={start_at}, max_results={max_results}, "
        f"type={board_type}, name={name}, project={project_key_or_id}"
    )

    params: Dict[str, Any] = {
        "startAt": start_at,
        "maxResults": max_results,
    }

    if board_type:
        if board_type not in ["scrum", "kanban", "simple"]:
            raise ValueError(f"Invalid board type '{board_type}'. Must be: scrum, kanban, or simple")
        params["type"] = board_type

    if name:
        params["name"] = name

    if project_key_or_id:
        params["projectKeyOrId"] = project_key_or_id

    success, response = await make_api_request(
        path="rest/agile/1.0/board",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch boards: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def create_board(
    name: Annotated[
        str,
        Field(description="Board name (must be less than 255 characters)")
    ],
    board_type: Annotated[
        str,
        Field(description="Board type: 'scrum' or 'kanban'")
    ],
    filter_id: Annotated[
        int,
        Field(description="ID of a filter that the user has permissions to view")
    ],
    location_type: Annotated[
        str,
        Field(description="Location type: 'project' or 'user'")
    ],
    project_key_or_id: Annotated[
        Optional[str],
        Field(
            description=(
                "(Optional) Project key or ID. Required if location_type is 'project'. "
                "Not used if location_type is 'user'."
            )
        ),
    ] = None,
) -> str:
    """Create a new board.

    Creates a new board with the specified configuration.

    Important notes:
    - Board name must be less than 255 characters
    - Board type must be 'scrum' or 'kanban'
    - User must have permission to view the filter
    - If user lacks 'Create shared objects' permission, a private board is created
    - Filter must ORDER BY Rank field to enable issue reordering on the board

    Args:
        name: Board name (< 255 characters).
        board_type: Board type ('scrum' or 'kanban').
        filter_id: ID of the filter to use.
        location_type: Location type ('project' or 'user').
        project_key_or_id: Project key/ID (required if location_type is 'project').

    Returns:
        JSON string representing the created board.

    Raises:
        ValueError: If in read-only mode, invalid input, or API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-post
    """
    check_read_only()

    if len(name) >= 255:
        raise ValueError(f"Board name must be less than 255 characters. Current length: {len(name)}")

    if board_type not in ["scrum", "kanban"]:
        raise ValueError(f"Invalid board type '{board_type}'. Must be 'scrum' or 'kanban'")

    if location_type not in ["project", "user"]:
        raise ValueError(f"Invalid location type '{location_type}'. Must be 'project' or 'user'")

    if location_type == "project" and not project_key_or_id:
        raise ValueError("project_key_or_id is required when location_type is 'project'")

    logger.debug(f"create_board called with name={name}, type={board_type}, filter_id={filter_id}")

    board_data: Dict[str, Any] = {
        "name": name,
        "type": board_type,
        "filterId": filter_id,
        "location": {
            "type": location_type,
        }
    }

    if location_type == "project":
        board_data["location"]["projectKeyOrId"] = project_key_or_id

    logger.debug(f"Board data to send: {json.dumps(board_data, indent=2)}")

    success, response = await make_api_request(
        path="rest/agile/1.0/board",
        method="POST",
        data=board_data,
    )

    if not success:
        raise ValueError(f"Failed to create board: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def get_board(
    board_id: Annotated[
        int,
        Field(description="ID of the board to retrieve")
    ],
) -> str:
    """Get board by ID.

    Returns the board for the given board ID.

    Args:
        board_id: Board ID.

    Returns:
        JSON string representing the board details.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-get
    """
    logger.debug(f"get_board called with board_id={board_id}")

    success, response = await make_api_request(
        path=f"rest/agile/1.0/board/{board_id}",
        method="GET",
    )

    if not success:
        raise ValueError(f"Failed to fetch board {board_id}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def delete_board(
    board_id: Annotated[
        int,
        Field(description="ID of the board to delete")
    ],
) -> str:
    """Delete a board.

    Deletes the board. Admin without the view permission can still remove the board.

    Args:
        board_id: Board ID to delete.

    Returns:
        JSON string confirming deletion.

    Raises:
        ValueError: If in read-only mode, delete protection is enabled, or API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-delete
    """
    check_read_only()
    check_boards_delete_protection()

    logger.debug(f"delete_board called with board_id={board_id}")

    success, response = await make_api_request(
        path=f"rest/agile/1.0/board/{board_id}",
        method="DELETE",
    )

    if not success:
        raise ValueError(f"Failed to delete board {board_id}: {response}")

    return json.dumps(
        {
            "success": True,
            "message": f"Board {board_id} successfully deleted",
        },
        indent=2,
        ensure_ascii=False,
    )


async def get_board_configuration(
    board_id: Annotated[
        int,
        Field(description="ID of the board")
    ],
) -> str:
    """Get board configuration.

    Returns the configuration of the board.

    Args:
        board_id: Board ID.

    Returns:
        JSON string containing the board configuration.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-configuration-get
    """
    logger.debug(f"get_board_configuration called with board_id={board_id}")

    success, response = await make_api_request(
        path=f"rest/agile/1.0/board/{board_id}/configuration",
        method="GET",
    )

    if not success:
        raise ValueError(f"Failed to fetch configuration for board {board_id}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def get_board_issues(
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
    expand: Annotated[
        Optional[str],
        Field(description="(Optional) Fields to expand (e.g., 'changelog')")
    ] = None,
) -> str:
    """Get issues for board.

    Returns all issues from the board, for the given board ID. This only includes issues that the user
    has permission to view. By default, the issues are ordered by rank.

    Args:
        board_id: Board ID.
        start_at: Starting index for pagination.
        max_results: Maximum number of issues to return.
        jql: Optional JQL query to filter issues.
        validate_query: Whether to validate the JQL query.
        fields: Optional comma-separated list of fields.
        expand: Optional fields to expand.

    Returns:
        JSON string containing the board issues.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-issue-get
    """
    logger.debug(f"get_board_issues called with board_id={board_id}")

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
        path=f"rest/agile/1.0/board/{board_id}/issue",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch issues for board {board_id}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def get_board_sprints(
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
        Field(description="Maximum number of sprints to return", default=50, ge=1, le=100)
    ] = 50,
    state: Annotated[
        Optional[str],
        Field(
            description=(
                "(Optional) Filter sprints by state: 'future', 'active', or 'closed'. "
                "If not provided, returns all sprints."
            )
        ),
    ] = None,
) -> str:
    """Get all sprints for board.

    Returns all sprints from a board, for a given board ID. This only includes sprints that the user
    has permission to view.

    Args:
        board_id: Board ID.
        start_at: Starting index for pagination.
        max_results: Maximum number of sprints to return.
        state: Optional sprint state filter ('future', 'active', 'closed').

    Returns:
        JSON string containing the board sprints.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-sprint-get
    """
    logger.debug(f"get_board_sprints called with board_id={board_id}")

    params: Dict[str, Any] = {
        "startAt": start_at,
        "maxResults": max_results,
    }

    if state:
        if state not in ["future", "active", "closed"]:
            raise ValueError(f"Invalid state '{state}'. Must be: future, active, or closed")
        params["state"] = state

    success, response = await make_api_request(
        path=f"rest/agile/1.0/board/{board_id}/sprint",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch sprints for board {board_id}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def get_board_epics(
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
        Field(description="Maximum number of epics to return", default=50, ge=1, le=100)
    ] = 50,
    done: Annotated[
        Optional[bool],
        Field(description="(Optional) Filter epics by done status (true/false)")
    ] = None,
) -> str:
    """Get epics for board.

    Returns all epics from the board, for the given board ID. This only includes epics that the user
    has permission to view. Note, if the user does not have permission to view the board, no epics
    will be returned at all.

    Args:
        board_id: Board ID.
        start_at: Starting index for pagination.
        max_results: Maximum number of epics to return.
        done: Optional filter for done epics.

    Returns:
        JSON string containing the board epics.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-epic-get
    """
    logger.debug(f"get_board_epics called with board_id={board_id}")

    params: Dict[str, Any] = {
        "startAt": start_at,
        "maxResults": max_results,
    }

    if done is not None:
        params["done"] = str(done).lower()

    success, response = await make_api_request(
        path=f"rest/agile/1.0/board/{board_id}/epic",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch epics for board {board_id}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def get_board_versions(
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
        Field(description="Maximum number of versions to return", default=50, ge=1, le=100)
    ] = 50,
    released: Annotated[
        Optional[str],
        Field(description="(Optional) Filter versions by release status: 'released' or 'unreleased'")
    ] = None,
) -> str:
    """Get all versions for board.

    Returns all versions from a board, for a given board ID. This only includes versions that the user
    has permission to view. Returned versions are ordered by the name of the project from which they
    belong and then by sequence defined by user.

    Args:
        board_id: Board ID.
        start_at: Starting index for pagination.
        max_results: Maximum number of versions to return.
        released: Optional release status filter ('released' or 'unreleased').

    Returns:
        JSON string containing the board versions.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-version-get
    """
    logger.debug(f"get_board_versions called with board_id={board_id}")

    params: Dict[str, Any] = {
        "startAt": start_at,
        "maxResults": max_results,
    }

    if released:
        if released not in ["released", "unreleased"]:
            raise ValueError(f"Invalid released value '{released}'. Must be: released or unreleased")
        params["released"] = released

    success, response = await make_api_request(
        path=f"rest/agile/1.0/board/{board_id}/version",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch versions for board {board_id}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)


async def get_board_projects(
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
        Field(description="Maximum number of projects to return", default=50, ge=1, le=100)
    ] = 50,
) -> str:
    """Get projects for board.

    Returns all projects that are associated with the board, for the given board ID.

    Args:
        board_id: Board ID.
        start_at: Starting index for pagination.
        max_results: Maximum number of projects to return.

    Returns:
        JSON string containing the board projects.

    Raises:
        ValueError: If the API request fails.

    Reference:
        https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-project-get
    """
    logger.debug(f"get_board_projects called with board_id={board_id}")

    params: Dict[str, Any] = {
        "startAt": start_at,
        "maxResults": max_results,
    }

    success, response = await make_api_request(
        path=f"rest/agile/1.0/board/{board_id}/project",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch projects for board {board_id}: {response}")

    return json.dumps(response, indent=2, ensure_ascii=False)

