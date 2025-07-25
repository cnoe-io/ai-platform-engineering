# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Tools for /pages operations"""

import logging
import os
from typing import Dict, Any, Optional, List
from agent_confluence.protocol_bindings.mcp_server.mcp_confluence.api.client import make_api_request

# Configure logging - use LOG_LEVEL from environment or default to INFO
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
numeric_level = getattr(logging, log_level, logging.INFO)
logging.basicConfig(level=numeric_level)
logger = logging.getLogger("mcp_tools")


async def get_pages(
  param_id: List[int] = None,
  param_space_id: List[int] = None,
  param_sort: str = None,
  param_status: List[str] = None,
  param_title: str = None,
  param_body_format: str = None,
  param_subtype: str = None,
  param_cursor: str = None,
  param_limit: int = None
) -> Dict[str, Any]:
    """
    Get pages

    OpenAPI Description:
        Returns all pages. The number of results is limited by the `limit` parameter and additional results (if available)
will be available through the `next` URL present in the `Link` response header.

**[Permissions](https://confluence.atlassian.com/x/_AozKw) required**:
Permission to access the Confluence site ('Can use' global permission).
Only pages that the user has permission to view will be returned.

    Args:

        param_id (List[int]): Filter the results based on page ids. Multiple page ids can be specified as a comma-separated list.

        param_space_id (List[int]): Filter the results based on space ids. Multiple space ids can be specified as a comma-separated list.

        param_sort (str): Used to sort the result by a particular field.

        param_status (List[str]): Filter the results to pages based on their status. By default, `current` and `archived` are used.

        param_title (str): Filter the results to pages based on their title.

        param_body_format (str): The content format types to be returned in the `body` field of the response. If available, the representation will be available under a response field of the same name under the `body` field.

        param_subtype (str): Filter the results to pages based on their subtype.

        param_cursor (str): Used for pagination, this opaque cursor will be returned in the `next` URL in the `Link` response header. Use the relative URL in the `Link` header to retrieve the `next` set of results.

        param_limit (int): Maximum number of pages per result to return. If more results exist, use the `Link` header to retrieve a relative URL that will return the next set of results.


    Returns:
        Dict[str, Any]: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    """
    logger.debug("Making GET request to /content")

    params = {}
    data = {}

    # Add type=page to filter for pages only
    params["type"] = "page"

    # Only add parameters if they have values
    if param_id is not None:
        params["id"] = param_id
    if param_space_id is not None:
        params["spaceId"] = param_space_id
    if param_sort is not None:
        params["sort"] = param_sort
    if param_status is not None:
        params["status"] = param_status
    if param_title is not None:
        params["title"] = param_title
    if param_body_format is not None:
        params["expand"] = param_body_format
    if param_subtype is not None:
        params["subtype"] = param_subtype
    if param_cursor is not None:
        params["cursor"] = param_cursor
    if param_limit is not None:
        params["limit"] = param_limit



    success, response = await make_api_request(
        "/content",
        method="GET",
        params=params,
        data=data
    )

    if not success:
        error_details = response.get('error', 'Request failed')
        error_message = f"Failed to get pages: {error_details}"
        logger.error(error_message)
        # Raise an exception instead of returning an error dict
        # This ensures the MCP framework properly signals the error to the agent
        raise Exception(error_message)
    return response

async def create_page(
    title: str,
    space_key: str,
    body_value: str = "",
    body_representation: str = "storage",
    status: str = "current",
    parent_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create page using Confluence Cloud REST API

    Args:
        title (str): The title of the page (required)
        space_key (str): The key of the space where the page will be created (required)
        body_value (str): The content of the page (optional, defaults to empty string)
        body_representation (str): The format of the body content (optional, defaults to "storage")
        status (str): The status of the page - "current" or "draft" (optional, defaults to "current")
        parent_id (Optional[str]): The ID of the parent page (optional)

    Returns:
        Dict[str, Any]: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    """
    logger.debug(f"Making POST request to /content with title: {title}, space_key: {space_key}")

    # Validate required parameters
    if not title or not title.strip():
        error_msg = "Title is required and cannot be empty"
        logger.error(error_msg)
        raise ValueError(error_msg)

    if not space_key or not space_key.strip():
        error_msg = "Space key is required and cannot be empty"
        logger.error(error_msg)
        raise ValueError(error_msg)

    # Create the page data using Confluence Cloud API format
    data = {
        "type": "page",
        "title": title.strip(),
        "space": {
            "key": space_key.strip()
        },
        "body": {
            body_representation: {
                "value": body_value,
                "representation": body_representation
            }
        }
    }

    # Add parent ID if provided
    if parent_id:
        data["ancestors"] = [{"id": parent_id}]

    logger.debug(f"Request data: {data}")

    success, response = await make_api_request(
        "/content",
        method="POST",
        data=data
    )

    if not success:
        error_details = response.get('error', 'Request failed')
        error_message = f"Failed to create page '{title}': {error_details}"

        # Check for specific error cases and provide better messages
        if 'already exists with the same TITLE' in str(response):
            error_message = f"Cannot create page '{title}': A page with this title already exists in the space. Please choose a different title."

        logger.error(error_message)
        # Raise an exception instead of returning an error dict
        # This ensures the MCP framework properly signals the error to the agent
        raise Exception(error_message)

    logger.info(f"Page created successfully: {response.get('title')} (ID: {response.get('id')})")
    return response
