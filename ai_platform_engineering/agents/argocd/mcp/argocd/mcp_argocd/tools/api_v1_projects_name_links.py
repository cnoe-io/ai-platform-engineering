# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Tools for /api/v1/projects/{name}/links operations"""

import logging
from typing import Dict, Any
from mcp_argocd.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def project_service__list_links(path_name: str) -> Dict[str, Any]:
    '''
    ListLinks returns all deep links for the particular project.

    Args:
        path_name (str): The name of the project path for which deep links are to be retrieved.

    Returns:
        Dict[str, Any]: A dictionary containing the JSON response from the API call, which includes all deep links associated with the specified project.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making GET request to /api/v1/projects/{name}/links")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/api/v1/projects/{path_name}/links", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response