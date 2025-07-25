# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Tools for /api/v1/gpgkeys/{keyID} operations"""

import logging
from typing import Dict, Any
from mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def gpg_key_service__get(path_keyID: str) -> Dict[str, Any]:
    '''
    Get information about a specified GPG public key from the server.

    Args:
        path_keyID (str): The unique identifier of the GPG public key to retrieve.

    Returns:
        Dict[str, Any]: A dictionary containing the JSON response from the API call, which includes details about the specified GPG public key.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making GET request to /api/v1/gpgkeys/{keyID}")

    params = {}
    data = {}

    success, response = await make_api_request(f"/api/v1/gpgkeys/{path_keyID}", method="GET", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response