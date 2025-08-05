"""Sprint operations for Jira MCP"""

import logging
import json
from pydantic import Field
from typing_extensions import Annotated
from mcp_jira.api.client import make_api_request
from mcp.server.fastmcp import Context

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira")

async def get_sprints_from_board(
    board_id: Annotated[str, Field(description="The id of board (e.g., '1000')")],
    state: Annotated[
        str,
        Field(description="Sprint state (e.g., 'active', 'future', 'closed')"),
    ] = "",
    start_at: Annotated[
        int,
        Field(description="Starting index for pagination (0-based)", default=0, ge=0),
    ] = 0,
    limit: Annotated[
        int,
        Field(description="Maximum number of results (1-50)", default=10, ge=1, le=50),
    ] = 10,
) -> str:
    """Get jira sprints from board by state.

    Args:
        ctx: The FastMCP context.
        board_id: The ID of the board.
        state: Sprint state ('active', 'future', 'closed'). If None, returns all sprints.
        start_at: Starting index.
        limit: Maximum results.

    Returns:
        JSON string representing a list of sprint objects.
    """
    params = {
        "state": state,
        "startAt": start_at,
        "maxResults": limit,
    }
    response = await make_api_request(ctx, f"/rest/agile/1.0/board/{board_id}/sprint", params=params, method='GET')
    if not response or response.status_code != 200:
        raise ValueError(f"Failed to fetch sprints for board {board_id}. Response: {response}")
    return json.dumps(response.json(), indent=2, ensure_ascii=False)

async def create_sprint(
    board_id: Annotated[str, Field(description="The id of board (e.g., '1000')")],
    sprint_name: Annotated[
        str, Field(description="Name of the sprint (e.g., 'Sprint 1')")
    ],
    start_date: Annotated[
        str, Field(description="Start time for sprint (ISO 8601 format)")
    ],
    end_date: Annotated[
        str, Field(description="End time for sprint (ISO 8601 format)")
    ],
    goal: Annotated[str, Field(description="(Optional) Goal of the sprint")] = "",
) -> str:
    """Create Jira sprint for a board.

    Args:
        ctx: The FastMCP context.
        board_id: Board ID.
        sprint_name: Sprint name.
        start_date: Start date (ISO format).
        end_date: End date (ISO format).
        goal: Optional sprint goal.

    Returns:
        JSON string representing the created sprint object.

    Raises:
        ValueError: If in read-only mode or Jira client unavailable.
    """
    payload = {
        "name": sprint_name,
        "startDate": start_date,
        "endDate": end_date,
        "goal": goal,
    }
    response = await make_api_request(ctx, f"/rest/agile/1.0/board/{board_id}/sprint", method="POST", json=payload)
    if not response or response.status_code != 201:
        raise ValueError(f"Failed to create sprint for board {board_id}. Response: {response}")
    return json.dumps(response.json(), indent=2, ensure_ascii=False)

async def update_sprint(
    sprint_id: Annotated[str, Field(description="The id of sprint (e.g., '10001')")],
    sprint_name: Annotated[
        str, Field(description="(Optional) New name for the sprint")
    ] = "",
    state: Annotated[
        str,
        Field(description="(Optional) New state for the sprint (future|active|closed)"),
    ] = "",
    start_date: Annotated[
        str, Field(description="(Optional) New start date for the sprint")
    ] = "",
    end_date: Annotated[
        str, Field(description="(Optional) New end date for the sprint")
    ] = "",
    goal: Annotated[str, Field(description="(Optional) New goal for the sprint")] = "",
) -> str:
    """Update jira sprint.

    Args:
        ctx: The FastMCP context.
        sprint_id: The ID of the sprint.
        sprint_name: Optional new name.
        state: Optional new state (future|active|closed).
        start_date: Optional new start date.
        end_date: Optional new end date.
        goal: Optional new goal.

    Returns:
        JSON string representing the updated sprint object or an error message.

    Raises:
        ValueError: If in read-only mode or Jira client unavailable.
    """
    payload = {
        "name": sprint_name,
        "state": state,
        "startDate": start_date,
        "endDate": end_date,
        "goal": goal,
    }
    response = await make_api_request(ctx, f"/rest/agile/1.0/sprint/{sprint_id}", method="PUT", json=payload)
    if not response or response.status_code != 200:
        error_payload = {
            "error": f"Failed to update sprint {sprint_id}. Response: {response}"
        }
        return json.dumps(error_payload, indent=2, ensure_ascii=False)
    return json.dumps(response.json(), indent=2, ensure_ascii=False)