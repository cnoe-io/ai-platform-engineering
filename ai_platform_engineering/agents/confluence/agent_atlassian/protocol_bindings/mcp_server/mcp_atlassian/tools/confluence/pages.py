"""Page operations for Confluence MCP"""

import logging
from typing import Any, Annotated
from pydantic import BaseModel, Field
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.api.client import make_api_request
import json
from mcp.server.fastmcp import Context

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-confluence")

async def get_page(
    page_id: str = "",
    title: str = "",
    space_key: str = "",
    include_metadata: bool = True,
    convert_to_markdown: bool = True
) -> dict:
    """
    Get content of a specific Confluence page by ID, or by title and space key.

    Args:
        page_id: Confluence page ID (if provided, title and space_key are ignored)
        title: The exact title of the page (use with space_key)
        space_key: The key of the space (use with title)
        include_metadata: Whether to include page metadata
        convert_to_markdown: Convert content to markdown or keep raw HTML

    Returns:
        Response JSON from Confluence API or error dict
    """
    params = {
        "page_id": page_id,
        "title": title,
        "space_key": space_key,
        "include_metadata": include_metadata,
        "convert_to_markdown": convert_to_markdown
    }
    
    success, response = await make_api_request(
        endpoint="/wiki/rest/api/content/{page_id}",
        method="GET",
        params=params
    )

    if success:
        return response
    else:
        logger.error(f"Failed to get page: {response}")
        return response

async def get_page_children(
    parent_id: str,
    expand: str = "version",
    limit: int = 25,
    include_content: bool = False,
    convert_to_markdown: bool = True,
    start: int = 0
) -> dict:
    """
    Get child pages of a specific Confluence page.

    Args:
        parent_id: The ID of the parent page
        expand: Fields to expand in the response
        limit: Maximum number of child pages to return (1-50)
        include_content: Whether to include the page content
        convert_to_markdown: Convert content to markdown if include_content is true
        start: Starting index for pagination

    Returns:
        Response JSON from Confluence API or error dict
    """
    success, response = await make_api_request(
        endpoint=f"/rest/api/content/{parent_id}/child/page",
        method="GET",
        params={
            "expand": expand,
            "limit": limit,
            "start": start,
        }
    )
    
    if not success:
        logger.error(f"Failed to get child pages for {parent_id}: {response}")
        return response

    # Process content if needed
    if include_content and convert_to_markdown and success:
        for page in response.get("results", []):
            if "body" in page and "storage" in page["body"]:
                page["content"] = page["body"]["storage"].get("value", "")

    # Format result
    result = {
        "parent_id": parent_id,
        "count": len(response.get("results", [])),
        "limit": limit,
        "start": start,
        "results": response.get("results", [])
    }
    
    return result

async def create_page(
    space_key: str,
    title: str,
    content: str,
    parent_id: str = ""
) -> dict:
    """
    Create a new Confluence page.

    Args:
        space_key: The key of the space to create the page in (e.g., 'DEV', 'TEAM')
        title: The title of the page
        content: The content of the page in Markdown format
        parent_id: Optional parent page ID to create as a child page

    Returns:
        Response JSON from Confluence API or error dict.
    """
    payload = {
        "type": "page",
        "title": title,
        "space": {"key": space_key},
        "body": {
            "storage": {
                "value": content,
                "representation": "wiki",
            }
        }
    }
    
    # Add parent ID if provided
    if parent_id:
        payload["ancestors"] = [{"id": parent_id}]

    success, response = await make_api_request(
        endpoint="/rest/api/content",
        method="POST",
        json=payload
    )

    if success:
        return response
    else:
        logger.error(f"Failed to create Confluence page: {response}")
        return response

async def update_page(
    page_id: str,
    title: str,
    content: str,
    is_minor_edit: bool = False,
    version_comment: str = "",
    parent_id: str = ""
) -> dict:
    """
    Update an existing Confluence page.

    Args:
        page_id: The ID of the page to update
        title: The new title of the page
        content: The new content in Markdown format
        is_minor_edit: Whether this is a minor edit
        version_comment: Optional comment for this version
        parent_id: Optional new parent page ID

    Returns:
        Response JSON from Confluence API or error dict.
    """
    # Get current version number
    success, page_data = await make_api_request(
        endpoint=f"/rest/api/content/{page_id}",
        method="GET",
        params={"expand": "version"}
    )
    
    if not success:
        logger.error(f"Failed to fetch page {page_id} for update: {page_data}")
        return page_data
        
    try:
        current_version = page_data.get("version", {}).get("number", 1)
        next_version = current_version + 1
    except (AttributeError, KeyError):
        next_version = 1  # Default if we can't determine current version
    
    # Prepare payload for update
    payload = {
        "id": page_id,
        "type": "page",
        "title": title,
        "body": {
            "storage": {
                "value": content,
                "representation": "wiki",
            }
        },
        "version": {
            "number": next_version,
            "minorEdit": is_minor_edit,
        }
    }
    
    # Add version comment if provided
    if version_comment:
        payload["version"]["message"] = version_comment
        
    # Add parent ID if provided
    if parent_id:
        payload["ancestors"] = [{"id": parent_id}]

    success, response = await make_api_request(
        endpoint=f"/rest/api/content/{page_id}",
        method="PUT",
        json=payload
    )

    if success:
        return response
    else:
        logger.error(f"Failed to update Confluence page {page_id}: {response}")
        return response

async def delete_page(
    page_id: str
) -> dict:
    """
    Delete an existing Confluence page.

    Args:
        page_id: The ID of the page to delete

    Returns:
        Response JSON from Confluence API or error dict.
    """
    success, response = await make_api_request(
        endpoint=f"/rest/api/content/{page_id}",
        method="DELETE"
    )
    
    if success:
        return {"success": True, "message": f"Page {page_id} deleted successfully"}
    else:
        logger.error(f"Failed to delete Confluence page {page_id}: {response}")
        return {"success": False, "error": str(response)}