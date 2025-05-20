"""Comment operations for Confluence MCP"""

import logging
from typing import Any, Annotated
from pydantic import BaseModel, Field
import json
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.api.client import make_api_request
from mcp.server.fastmcp import Context


# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-confluence")

async def get_comments(
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
    """Get comments for a specific Confluence page.

    Args:
        ctx: The FastMCP context.
        page_id: Confluence page ID.

    Returns:
        JSON string representing a list of comment objects.
    """
    response = await make_api_request(
        endpoint=f"/rest/api/content/{page_id}/child/comment",
        method="GET",
    )
    return json.dumps(response, indent=2, ensure_ascii=False)

async def add_comment(
    ctx: Context,
    page_id: Annotated[
        str, Field(description="The ID of the page to add a comment to")
    ],
    content: Annotated[
        str, Field(description="The comment content in Markdown format")
    ],
) -> str:
    """Add a comment to a Confluence page.

    Args:
        ctx: The FastMCP context.
        page_id: The ID of the page to add a comment to.
        content: The comment content in Markdown format.

    Returns:
        JSON string representing the created comment.

    Raises:
        ValueError: If in read-only mode or Confluence client is unavailable.
    """
    if ctx.request_context.lifespan_context.get("app_lifespan_context", {}).get("read_only", False):
        logger.warning("Attempted to call add_comment in read-only mode.")
        raise ValueError("Cannot add comment in read-only mode.")

    try:
        response = await make_api_request(
            endpoint=f"/rest/api/content/{page_id}/child/comment",
            method="POST",
            json={
                "type": "comment",
                "body": {
                    "storage": {
                        "value": content,
                        "representation": "wiki",
                    }
                },
            },
        )
        return json.dumps(
            {
                "success": True,
                "message": "Comment added successfully",
                "comment": response,
            },
            indent=2,
            ensure_ascii=False,
        )
    except Exception as e:
        logger.error(f"Error adding comment to Confluence page {page_id}: {str(e)}")
        return json.dumps(
            {
                "success": False,
                "message": f"Error adding comment to page {page_id}",
                "error": str(e),
            },
            indent=2,
            ensure_ascii=False,
        )