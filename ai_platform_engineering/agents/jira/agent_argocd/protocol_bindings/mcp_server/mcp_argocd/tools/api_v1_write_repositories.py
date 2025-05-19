# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api/v1/write-repositories operations"""

import logging
from typing import Dict, Any, Optional
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def RepositoryService_ListWriteRepositories(
        repo: Optional[str] = None,
        forceRefresh: Optional[str] = None,
        appProject: Optional[str] = None) -> Dict[str, Any]:
    """
    ListWriteRepositories gets a list of all configured write repositories

    Returns:
        API response data
    """
    logger.debug("Making GET request to /api/v1/write-repositories")
    params = {}
    data = None
    # Add parameters to request
    if repo is not None:
        params["repo"] = repo
    if forceRefresh is not None:
        params["forceRefresh"] = forceRefresh
    if appProject is not None:
        params["appProject"] = appProject
    success, response = await make_api_request(
        "/api/v1/write-repositories",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

async def RepositoryService_CreateWriteRepository(
        body: str,
        upsert: Optional[str] = None,
        credsOnly: Optional[str] = None) -> Dict[str, Any]:
    """
    CreateWriteRepository creates a new write repository configuration

    Returns:
        API response data
    """
    logger.debug("Making POST request to /api/v1/write-repositories")
    params = {}
    data = None
    # Add parameters to request
    if body is not None:
        data = body
    if upsert is not None:
        params["upsert"] = upsert
    if credsOnly is not None:
        params["credsOnly"] = credsOnly
    success, response = await make_api_request(
        "/api/v1/write-repositories",
        method="POST",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response
