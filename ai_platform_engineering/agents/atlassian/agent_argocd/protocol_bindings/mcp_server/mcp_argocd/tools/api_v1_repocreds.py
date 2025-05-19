# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api/v1/repocreds operations"""

import logging
from typing import Dict, Any, Optional
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def RepoCredsService_ListRepositoryCredentials(url: Optional[str] = None) -> Dict[str, Any]:
    """
    ListRepositoryCredentials gets a list of all configured repository credential sets

    Returns:
        API response data
    """
    logger.debug("Making GET request to /api/v1/repocreds")
    params = {}
    data = None
    # Add parameters to request
    if url is not None:
        params["url"] = url
    success, response = await make_api_request(
        "/api/v1/repocreds",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

async def RepoCredsService_CreateRepositoryCredentials(body: str, upsert: Optional[str] = None) -> Dict[str, Any]:
    """
    CreateRepositoryCredentials creates a new repository credential set

    Returns:
        API response data
    """
    logger.debug("Making POST request to /api/v1/repocreds")
    params = {}
    data = None
    # Add parameters to request
    if body is not None:
        data = body
    if upsert is not None:
        params["upsert"] = upsert
    success, response = await make_api_request(
        "/api/v1/repocreds",
        method="POST",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response
