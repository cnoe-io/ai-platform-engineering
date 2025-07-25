# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Tools for /api/v1/notifications/templates operations"""

import logging
from typing import Dict, Any
from mcp_argocd.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def notification_service__list_templates() -> Dict[str, Any]:
    '''
    List all notification templates available in the service.

    This function makes an asynchronous GET request to the notification service API
    to retrieve a list of all available notification templates. The response is
    returned as a dictionary containing the JSON data from the API.

    Args:
        None

    Returns:
        Dict[str, Any]: A dictionary containing the JSON response from the API call,
        which includes the list of notification templates.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised
        with the error details.
    '''
    logger.debug("Making GET request to /api/v1/notifications/templates")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        "/api/v1/notifications/templates", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response