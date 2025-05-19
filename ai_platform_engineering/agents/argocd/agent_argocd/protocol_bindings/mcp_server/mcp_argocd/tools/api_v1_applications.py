# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api/v1/applications operations"""

import logging
from typing import Dict, Any, Optional
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def ApplicationService_List(
        name: Optional[str] = None,
        refresh: Optional[str] = None,
        projects: Optional[str] = None,
        resourceVersion: Optional[str] = None,
        selector: Optional[str] = None,
        repo: Optional[str] = None,
        appNamespace: Optional[str] = None,
        project: Optional[str] = None) -> Dict[str, Any]:
    """
    List returns list of applications

    Returns:
        API response data
    """
    logger.debug("Making GET request to /api/v1/applications")
    params = {}
    data = None
    # Add parameters to request
    if name is not None:
        params["name"] = name
    if refresh is not None:
        params["refresh"] = refresh
    if projects is not None:
        params["projects"] = projects
    if resourceVersion is not None:
        params["resourceVersion"] = resourceVersion
    if selector is not None:
        params["selector"] = selector
    if repo is not None:
        params["repo"] = repo
    if appNamespace is not None:
        params["appNamespace"] = appNamespace
    if project is not None:
        params["project"] = project
    success, response = await make_api_request(
        "/api/v1/applications",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

async def ApplicationService_Create(body: str, upsert: Optional[str] = None, validate: Optional[str] = None) -> Dict[str, Any]:
    """
    Create creates an application

    Returns:
        API response data
    """
    logger.debug("Making POST request to /api/v1/applications")
    params = {}
    data = None
    # Add parameters to request
    if body is not None:
        data = body
    if upsert is not None:
        params["upsert"] = upsert
    if validate is not None:
        params["validate"] = validate
    success, response = await make_api_request(
        "/api/v1/applications",
        method="POST",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response
