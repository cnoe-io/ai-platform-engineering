# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api/v1/projects operations"""

import logging
from typing import Dict, Any, Optional
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def ProjectService_List(name: Optional[str] = None) -> Dict[str, Any]:
    """
    List returns list of projects

    Returns:
        API response data
    """
    logger.debug("Making GET request to /api/v1/projects")
    params = {}
    data = None
    # Add parameters to request
    if name is not None:
        params["name"] = name
    success, response = await make_api_request(
        "/api/v1/projects",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

async def ProjectService_Create(body: str) -> Dict[str, Any]:
    """
    Create a new project

    Returns:
        API response data
    """
    logger.debug("Making POST request to /api/v1/projects")
    params = {}
    data = None
    # Add parameters to request
    if body is not None:
        data = body
    success, response = await make_api_request(
        "/api/v1/projects",
        method="POST",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response
