# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Tools for /api/v1/account/{name}/token operations"""

import logging
from typing import Dict, Any
from mcp_argocd.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def account_service__create_token(
    path_name: str, body_expiresIn: int = None, body_id: str = None, body_name: str = None
) -> Dict[str, Any]:
    '''
    CreateToken creates a token.

    Args:
        path_name (str): The name of the account for which the token is being created.
        body_expiresIn (int, optional): The duration in seconds for which the token is valid. Defaults to None.
        body_id (str, optional): The identifier for the token. Defaults to None.
        body_name (str, optional): The name associated with the token. Defaults to None.

    Returns:
        Dict[str, Any]: The JSON response from the API call, containing the details of the created token.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making POST request to /api/v1/account/{name}/token")

    params = {}
    data = {}

    flat_body = {}
    if body_expiresIn is not None:
        flat_body["expiresIn"] = body_expiresIn
    if body_id is not None:
        flat_body["id"] = body_id
    if body_name is not None:
        flat_body["name"] = body_name
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/api/v1/account/{path_name}/token", method="POST", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response