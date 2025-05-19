# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api/v1/account/password operations"""

import logging
from typing import Dict, Any
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def AccountService_UpdatePassword(body: str) -> Dict[str, Any]:
    """
    UpdatePassword updates an account's password to a new value

    Returns:
        API response data
    """
    logger.debug("Making PUT request to /api/v1/account/password")
    params = {}
    data = None
    # Add parameters to request
    if body is not None:
        data = body
    success, response = await make_api_request(
        "/api/v1/account/password",
        method="PUT",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response
