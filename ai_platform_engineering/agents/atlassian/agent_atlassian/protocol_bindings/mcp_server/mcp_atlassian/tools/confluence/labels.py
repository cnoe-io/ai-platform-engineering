"""Label operations for Confluence MCP"""

import logging
from typing import Any, Annotated
from pydantic import BaseModel, Field
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.api.client import make_api_request
import json
from mcp.server.fastmcp import Context


# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-confluence")

async def get_labels(
    ctx: Context,
    page_id: Annotated[
        str,
        Field(
            description=(
                "Confluence page ID (numeric ID, can be parsed from URL, "
                "e.g. from 'https://example.atlassian.net/wiki/spaces/TEAM/pages/123456789/Page+Title' "
                "-> '123456789')"
            )
        ),
    ],
) -> str:
    """Get labels for a specific Confluence page.

    Args:
        ctx: The FastMCP context.
        page_id: Confluence page ID.

    Returns:
        JSON string representing a list of label objects.
    """
    response = await make_api_request(
        endpoint=f"/rest/api/content/{page_id}/label",
        method="GET",
    )
    return json.dumps(response, indent=2, ensure_ascii=False)

async def add_label(
    ctx: Context,
    page_id: Annotated[str, Field(description="The ID of the page to update")],
    name: Annotated[str, Field(description="The name of the label")],
) -> str:
    """Add label to an existing Confluence page.

    Args:
        ctx: The FastMCP context.
        page_id: The ID of the page to update.
        name: The name of the label.

    Returns:
        JSON string representing the updated list of label objects for the page.

    Raises:
        ValueError: If in read-only mode or Confluence client is unavailable.
    """
    response = await make_api_request(
        endpoint=f"/rest/api/content/{page_id}/label",
        method="POST",
        json={"name": name},
    )
    return json.dumps(response, indent=2, ensure_ascii=False)