# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api/v1/clusters operations"""

import logging
from typing import Dict, Any, Optional
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def ClusterService_List(
        server: Optional[str] = None,
        name: Optional[str] = None,
        id_type: Optional[str] = None,
        id_value: Optional[str] = None) -> Dict[str, Any]:
    """
    List returns list of clusters

    Returns:
        API response data
    """
    logger.debug("Making GET request to /api/v1/clusters")
    params = {}
    data = None
    # Add parameters to request
    if server is not None:
        params["server"] = server
    if name is not None:
        params["name"] = name
    if id_type is not None:
        params["id.type"] = id_type
    if id_value is not None:
        params["id.value"] = id_value
    success, response = await make_api_request(
        "/api/v1/clusters",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

async def ClusterService_Create(body: str, upsert: Optional[str] = None) -> Dict[str, Any]:
    """
    Create creates a cluster

    Returns:
        API response data
    """
    logger.debug("Making POST request to /api/v1/clusters")
    params = {}
    data = None
    # Add parameters to request
    if body is not None:
        data = body
    if upsert is not None:
        params["upsert"] = upsert
    success, response = await make_api_request(
        "/api/v1/clusters",
        method="POST",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response
