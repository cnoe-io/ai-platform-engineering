# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api/v1/session/userinfo operations"""

import logging
from typing import Dict, Any
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def SessionService_GetUserInfo() -> Dict[str, Any]:
    """
    Get the current user's info

    Returns:
        API response data
    """
    logger.debug("Making GET request to /api/v1/session/userinfo")
    params = {}
    data = None
    # Add parameters to request

    success, response = await make_api_request(
        "/api/v1/session/userinfo",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response
