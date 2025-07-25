# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Tools for /api/v1/projects/{name}/detailed operations"""

import logging
from typing import Dict, Any
from mcp_argocd.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def project_service__get_detailed_project(path_name: str) -> Dict[str, Any]:
    '''
    GetDetailedProject returns a project that includes project, global project, and scoped resources by name.

    Args:
        path_name (str): The name of the project to retrieve detailed information for.

    Returns:
        Dict[str, Any]: A dictionary containing the JSON response from the API call, which includes detailed information about the project.

    Raises:
        Exception: If the API request fails or returns an error, an exception is raised with the error details.
    '''
    logger.debug("Making GET request to /api/v1/projects/{name}/detailed")

    params = {}
    data = {}

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/api/v1/projects/{path_name}/detailed", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response