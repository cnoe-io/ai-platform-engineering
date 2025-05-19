# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api/v1/session operations"""

import logging
from typing import Dict, Any
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def SessionService_Create(body: str) -> Dict[str, Any]:
    """
    Create a new JWT for authentication and set a cookie if using HTTP

    Returns:
        API response data
    """
    logger.debug("Making POST request to /api/v1/session")
    params = {}
    data = None
    # Add parameters to request
    if body is not None:
        data = body
    success, response = await make_api_request(
        "/api/v1/session",
        method="POST",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

async def SessionService_Delete() -> Dict[str, Any]:
    """
    Delete an existing JWT cookie if using HTTP

    Returns:
        API response data
    """
    logger.debug("Making DELETE request to /api/v1/session")
    params = {}
    data = None
    # Add parameters to request

    success, response = await make_api_request(
        "/api/v1/session",
        method="DELETE",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response
