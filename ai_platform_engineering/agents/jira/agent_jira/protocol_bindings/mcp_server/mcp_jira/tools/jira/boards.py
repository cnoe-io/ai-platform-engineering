"""Board operations for Jira MCP"""

import logging
from typing import Annotated
from pydantic import Field
from mcp.server.fastmcp import Context
from agent_jira.protocol_bindings.mcp_server.mcp_jira.api.client import make_api_request
from agent_jira.protocol_bindings.mcp_server.mcp_jira.models.jira.agile import JiraBoard

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira")

async def get_agile_boards(
    ctx: Context,
    board_name: Annotated[
        str, Field(description="(Optional) The name of board, support fuzzy search")
    ] = "",
    project_key: Annotated[
        str, Field(description="(Optional) Jira project key (e.g., 'PROJ-123')")
    ] = "",
    board_type: Annotated[
        str,
        Field(
            description="(Optional) The type of jira board (e.g., 'scrum', 'kanban')"
        ),
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
    """Get jira agile boards by name, project key, or type.

    Args:
        ctx: The FastMCP context.
        board_name: Name of the board (fuzzy search).
        project_key: Project key.
        board_type: Board type ('scrum' or 'kanban').
        start_at: Starting index.
        limit: Maximum results.

    Returns:
        JSON string representing a list of board objects.

    Raises:
        ValueError: If Jira client is unavailable.
    """
    params = {
        "name": board_name,
        "projectKeyOrId": project_key,
        "type": board_type,
        "startAt": start_at,
        "maxResults": limit,
    }

    success, response = await make_api_request(
        path="rest/agile/1.0/board",
        method="GET",
        params=params,
    )

    if not success:
        raise ValueError(f"Failed to fetch agile boards: {response}")

    boards_data = response.json().get("values", [])
    return [JiraBoard(**board) for board in boards_data]