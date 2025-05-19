# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api/v1/gpgkeys operations"""

import logging
from typing import Dict, Any, Optional
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def GPGKeyService_List(keyID: Optional[str] = None) -> Dict[str, Any]:
    """
    List all available repository certificates

    Returns:
        API response data
    """
    logger.debug("Making GET request to /api/v1/gpgkeys")
    params = {}
    data = None
    # Add parameters to request
    if keyID is not None:
        params["keyID"] = keyID
    success, response = await make_api_request(
        "/api/v1/gpgkeys",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

async def GPGKeyService_Create(body: str, upsert: Optional[str] = None) -> Dict[str, Any]:
    """
    Create one or more GPG public keys in the server's configuration

    Returns:
        API response data
    """
    logger.debug("Making POST request to /api/v1/gpgkeys")
    params = {}
    data = None
    # Add parameters to request
    if body is not None:
        data = body
    if upsert is not None:
        params["upsert"] = upsert
    success, response = await make_api_request(
        "/api/v1/gpgkeys",
        method="POST",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

async def GPGKeyService_Delete(keyID: Optional[str] = None) -> Dict[str, Any]:
    """
    Delete specified GPG public key from the server's configuration

    Returns:
        API response data
    """
    logger.debug("Making DELETE request to /api/v1/gpgkeys")
    params = {}
    data = None
    # Add parameters to request
    if keyID is not None:
        params["keyID"] = keyID
    success, response = await make_api_request(
        "/api/v1/gpgkeys",
        method="DELETE",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response
