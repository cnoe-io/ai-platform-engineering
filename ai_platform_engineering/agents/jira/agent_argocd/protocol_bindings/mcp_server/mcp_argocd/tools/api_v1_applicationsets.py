# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api/v1/applicationsets operations"""

import logging
from typing import Dict, Any, Optional
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def ApplicationSetService_List(
        projects: Optional[str] = None,
        selector: Optional[str] = None,
        appsetNamespace: Optional[str] = None) -> Dict[str, Any]:
    """
    List returns list of applicationset

    Returns:
        API response data
    """
    logger.debug("Making GET request to /api/v1/applicationsets")
    params = {}
    data = None
    # Add parameters to request
    if projects is not None:
        params["projects"] = projects
    if selector is not None:
        params["selector"] = selector
    if appsetNamespace is not None:
        params["appsetNamespace"] = appsetNamespace
    success, response = await make_api_request(
        "/api/v1/applicationsets",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

async def ApplicationSetService_Create(body: str, upsert: Optional[str] = None, dryRun: Optional[str] = None) -> Dict[str, Any]:
    """
    Create creates an applicationset

    Returns:
        API response data
    """
    logger.debug("Making POST request to /api/v1/applicationsets")
    params = {}
    data = None
    # Add parameters to request
    if body is not None:
        data = body
    if upsert is not None:
        params["upsert"] = upsert
    if dryRun is not None:
        params["dryRun"] = dryRun
    success, response = await make_api_request(
        "/api/v1/applicationsets",
        method="POST",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response
