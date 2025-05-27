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
    page_id: str,
    limit: int = 25,
    start: int = 0,
    expand: str = "body.view,version"
) -> dict:
    """
    Get comments for a specific Confluence page.

    Args:
        page_id: Confluence page ID
        limit: Maximum number of comments to return (default: 25)
        start: Starting index for pagination (default: 0)
        expand: Fields to expand in the response (default: "body.view,version")

    Returns:
        Response JSON from Confluence API or error dict.
    """
    params = {
        "limit": limit,
        "start": start,
        "expand": expand
    }
    
    success, response = await make_api_request(
        endpoint=f"/rest/api/content/{page_id}/child/comment",
        method="GET",
        params=params
    )

    if success:
        return response
    else:
        logger.error(f"Failed to get comments for page {page_id}: {response}")
        return response

async def add_comment(
    page_id: str,
    content: str
) -> dict:
    """
    Add a comment to a Confluence page.

    Args:
        page_id: The ID of the page to add a comment to
        content: The comment content in Markdown format

    Returns:
        Response JSON from Confluence API or error dict.
    """
    payload = {
        "type": "comment",
        "body": {
            "storage": {
                "value": content,
                "representation": "wiki",
            }
        }
    }
    
    success, response = await make_api_request(
        endpoint=f"/rest/api/content/{page_id}/child/comment",
        method="POST",
        json=payload
    )

    if success:
        return response
    else:
        logger.error(f"Failed to add comment to page {page_id}: {response}")
        return response