# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api/v1/applications/manifestsWithFiles operations"""

import logging
from typing import Dict, Any
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def ApplicationService_GetManifestsWithFiles(body: str) -> Dict[str, Any]:
    """
    GetManifestsWithFiles returns application manifests using provided files to generate them

    Returns:
        API response data
    """
    logger.debug("Making POST request to /api/v1/applications/manifestsWithFiles")
    params = {}
    data = None
    # Add parameters to request
    if body is not None:
        data = body
    success, response = await make_api_request(
        "/api/v1/applications/manifestsWithFiles",
        method="POST",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response
