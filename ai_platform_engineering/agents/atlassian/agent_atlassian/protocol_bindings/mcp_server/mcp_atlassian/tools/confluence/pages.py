"""Page operations for Confluence MCP"""

import logging
from typing import Any, Annotated
from pydantic import BaseModel, Field
from fastapi import Depends
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.api.client import make_api_request
import json
from mcp.server.fastmcp import Context

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-confluence")

async def get_page(
    ctx: Context,
    page_id: Annotated[
        str,
        Field(
            description=(
                "Confluence page ID (numeric ID, can be found in the page URL). "
                "For example, in the URL 'https://example.atlassian.net/wiki/spaces/TEAM/pages/123456789/Page+Title', "
                "the page ID is '123456789'. "
                "Provide this OR both 'title' and 'space_key'. If page_id is provided, title and space_key will be ignored."
            ),
            default="",
        ),
    ] = "",
    title: Annotated[
        str,
        Field(
            description=(
                "The exact title of the Confluence page. Use this with 'space_key' if 'page_id' is not known."
            ),
            default="",
        ),
    ] = "",
    space_key: Annotated[
        str,
        Field(
            description=(
                "The key of the Confluence space where the page resides (e.g., 'DEV', 'TEAM'). Required if using 'title'."
            ),
            default="",
        ),
    ] = "",
    include_metadata: Annotated[
        bool,
        Field(
            description="Whether to include page metadata such as creation date, last update, version, and labels.",
            default=True,
        ),
    ] = True,
    convert_to_markdown: Annotated[
        bool,
        Field(
            description=(
                "Whether to convert page to markdown (true) or keep it in raw HTML format (false). "
                "Raw HTML can reveal macros (like dates) not visible in markdown, but CAUTION: "
                "using HTML significantly increases token usage in AI responses."
            ),
            default=True,
        ),
    ] = True,
) -> str:
    """Get content of a specific Confluence page by its ID, or by its title and space key.

    Args:
        ctx: The FastMCP context.
        page_id: Confluence page ID. If provided, 'title' and 'space_key' are ignored.
        title: The exact title of the page. Must be used with 'space_key'.
        space_key: The key of the space. Must be used with 'title'.
        include_metadata: Whether to include page metadata.
        convert_to_markdown: Convert content to markdown (true) or keep raw HTML (false).

    Returns:
        JSON string representing the page content and/or metadata, or an error if not found or parameters are invalid.
    """
    response = await make_api_request(
        endpoint="/rest/api/content",
        method="GET",
        params={
            "page_id": page_id,
            "title": title,
            "space_key": space_key,
            "include_metadata": include_metadata,
            "convert_to_markdown": convert_to_markdown,
        },
    )
    return json.dumps(response, indent=2, ensure_ascii=False)

async def get_page_children(
    ctx: Context,
    parent_id: Annotated[
        str,
        Field(
            description="The ID of the parent page whose children you want to retrieve"
        ),
    ],
    expand: Annotated[
        str,
        Field(
            description="Fields to expand in the response (e.g., 'version', 'body.storage')",
            default="version",
        ),
    ] = "version",
    limit: Annotated[
        int,
        Field(
            description="Maximum number of child pages to return (1-50)",
            default=25,
            ge=1,
            le=50,
        ),
    ] = 25,
    include_content: Annotated[
        bool,
        Field(
            description="Whether to include the page content in the response",
            default=False,
        ),
    ] = False,
    convert_to_markdown: Annotated[
        bool,
        Field(
            description="Whether to convert page content to markdown (true) or keep it in raw HTML format (false). Only relevant if include_content is true.",
            default=True,
        ),
    ] = True,
    start: Annotated[
        int,
        Field(description="Starting index for pagination (0-based)", default=0, ge=0),
    ] = 0,
) -> str:
    """Get child pages of a specific Confluence page.

    Args:
        ctx: The FastMCP context.
        parent_id: The ID of the parent page.
        expand: Fields to expand.
        limit: Maximum number of child pages.
        include_content: Whether to include page content.
        convert_to_markdown: Convert content to markdown if include_content is true.
        start: Starting index for pagination.

    Returns:
        JSON string representing a list of child page objects.
    """
    response = await make_api_request(
        endpoint=f"/rest/api/content/{parent_id}/child/page",
        method="GET",
        params={
            "expand": expand,
            "limit": limit,
            "start": start,
        },
    )

    if include_content and convert_to_markdown:
        for page in response.get("results", []):
            if "body" in page and "storage" in page["body"]:
                page["content"] = page["body"]["storage"].get("value", "")

    result = {
        "parent_id": parent_id,
        "count": len(response.get("results", [])),
        "limit_requested": limit,
        "start_requested": start,
        "results": response.get("results", []),
    }

    return json.dumps(result, indent=2, ensure_ascii=False)

async def create_page(
    ctx: Context,
    space_key: Annotated[
        str,
        Field(
            description="The key of the space to create the page in (usually a short uppercase code like 'DEV', 'TEAM', or 'DOC')"
        ),
    ],
    title: Annotated[str, Field(description="The title of the page")],
    content: Annotated[
        str,
        Field(
            description="The content of the page in Markdown format. Supports headings, lists, tables, code blocks, and other Markdown syntax"
        ),
    ],
    parent_id: Annotated[
        str,
        Field(
            description="(Optional) parent page ID. If provided, this page will be created as a child of the specified page",
            default="",
        ),
    ] = "",
) -> str:
    """Create a new Confluence page.

    Args:
        ctx: The FastMCP context.
        space_key: The key of the space.
        title: The title of the page.
        content: The content in Markdown format.
        parent_id: Optional parent page ID.

    Returns:
        JSON string representing the created page object.

    Raises:
        ValueError: If in read-only mode or Confluence client is unavailable.
    """
    if ctx.request_context.lifespan_context.get("app_lifespan_context", {}).get("read_only", False):
        logger.warning("Attempted to call create_page in read-only mode.")
        raise ValueError("Cannot create page in read-only mode.")

    response = await make_api_request(
        endpoint="/rest/api/content",
        method="POST",
        json={
            "type": "page",
            "title": title,
            "space": {"key": space_key},
            "body": {
                "storage": {
                    "value": content,
                    "representation": "wiki",
                }
            },
            **({"ancestors": [{"id": parent_id}]} if parent_id else {}),
        },
    )

    return json.dumps(
        {"message": "Page created successfully", "page": response},
        indent=2,
        ensure_ascii=False,
    )

async def update_page(
    ctx: Context,
    page_id: Annotated[str, Field(description="The ID of the page to update")],
    title: Annotated[str, Field(description="The new title of the page")],
    content: Annotated[
        str, Field(description="The new content of the page in Markdown format")
    ],
    is_minor_edit: Annotated[
        bool, Field(description="Whether this is a minor edit", default=False)
    ] = False,
    version_comment: Annotated[
        str, Field(description="Optional comment for this version", default="")
    ] = "",
    parent_id: Annotated[
        str,  # TODO: Revert type hint to once Cursor IDE handles optional parameters with Union types correctly.
        Field(description="Optional the new parent page ID", default=""),
    ] = "",
) -> str:
    """Update an existing Confluence page.

    Args:
        ctx: The FastMCP context.
        page_id: The ID of the page to update.
        title: The new title of the page.
        content: The new content in Markdown format.
        is_minor_edit: Whether this is a minor edit.
        version_comment: Optional comment for this version.
        parent_id: Optional new parent page ID.

    Returns:
        JSON string representing the updated page object.

    Raises:
        ValueError: If Confluence client is not configured or available.
    """
    if ctx.request_context.lifespan_context.get("app_lifespan_context", {}).get("read_only", False):
        logger.warning("Attempted to call update_page in read-only mode.")
        raise ValueError("Cannot update page in read-only mode.")

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
            "number": 2,  # Increment version number appropriately
            "minorEdit": is_minor_edit,
            "message": version_comment,
        },
    }

    if parent_id:
        payload["ancestors"] = [{"id": parent_id}]

    response = await make_api_request(
        endpoint=f"/rest/api/content/{page_id}",
        method="PUT",
        json=payload,
    )

    return json.dumps(
        {"message": "Page updated successfully", "page": response},
        indent=2,
        ensure_ascii=False,
    )


async def delete_page(
    ctx: Context,
    page_id: Annotated[str, Field(description="The ID of the page to delete")],
) -> str:
    """Delete an existing Confluence page.

    Args:
        ctx: The FastMCP context.
        page_id: The ID of the page to delete.

    Returns:
        JSON string indicating success or failure.

    Raises:
        ValueError: If Confluence client is not configured or available.
    """
    if ctx.request_context.lifespan_context.get("app_lifespan_context", {}).get("read_only", False):
        logger.warning("Attempted to call delete_page in read-only mode.")
        raise ValueError("Cannot delete page in read-only mode.")

    try:
        await make_api_request(
            endpoint=f"/rest/api/content/{page_id}",
            method="DELETE",
        )
        response = {
            "success": True,
            "message": f"Page {page_id} deleted successfully",
        }
    except Exception as e:
        logger.error(f"Error deleting Confluence page {page_id}: {str(e)}")
        response = {
            "success": False,
            "message": f"Error deleting page {page_id}",
            "error": str(e),
        }

    return json.dumps(response, indent=2, ensure_ascii=False)