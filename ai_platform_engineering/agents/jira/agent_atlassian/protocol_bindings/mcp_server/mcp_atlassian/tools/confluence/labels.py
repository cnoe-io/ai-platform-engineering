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
    page_id: str
) -> dict:
    """
    Get labels for a specific Confluence page.

    Args:
        page_id: Confluence page ID

    Returns:
        Response JSON from Confluence API or error dict.
    """
    success, response = await make_api_request(
        endpoint=f"/rest/api/content/{page_id}/label",
        method="GET"
    )

    if success:
        return response
    else:
        logger.error(f"Failed to get labels for page {page_id}: {response}")
        return response

async def add_label(
    page_id: str,
    name: str
) -> dict:
    """
    Add label to an existing Confluence page.

    Args:
        page_id: The ID of the page to update
        name: The name of the label to add

    Returns:
        Response JSON from Confluence API or error dict.
    """
    success, response = await make_api_request(
        endpoint=f"/rest/api/content/{page_id}/label",
        method="POST",
        json={"name": name}
    )

    if success:
        return response
    else:
        logger.error(f"Failed to add label '{name}' to page {page_id}: {response}")
        return response