# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Tools for /analyze-location operations"""

import logging
from typing import Dict, Any
from agent_backstage.protocol_bindings.mcp_server.mcp_backstage.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def analyze_location(
    body_location_type: str, body_location_target: str, body_catalog_file_name: str = None
) -> Dict[str, Any]:
    '''
    Validates a given location by analyzing the provided location type, target, and optional catalog file name.

    Args:
        body_location_type (str): The type of the location to validate (e.g., 'url', 'file', etc.).
        body_location_target (str): The target value of the location (e.g., a URL or file path).
        body_catalog_file_name (str, optional): The name of the catalog file associated with the location. Defaults to None.

    Returns:
        Dict[str, Any]: The JSON response from the API call containing the validation result or error details.

    Raises:
        Exception: If the API request fails or returns an error.

    OpenAPI Specification:
        post:
          summary: Validate a given location.
          operationId: analyzeLocation
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    location_type:
                      type: string
                      description: The type of the location to validate.
                    location_target:
                      type: string
                      description: The target value of the location.
                    catalog_file_name:
                      type: string
                      description: The name of the catalog file associated with the location.
                  required:
                    - location_type
                    - location_target
          responses:
            '200':
              description: Successful validation of the location.
              content:
                application/json:
                  schema:
                    type: object
            '400':
              description: Invalid input or validation error.
              content:
                application/json:
                  schema:
                    type: object
            '500':
              description: Internal server error.
              content:
                application/json:
                  schema:
                    type: object
    '''
    logger.debug("Making POST request to /analyze-location")

    params = {}
    data = {}

    if body_location_type:
        data["location_type"] = body_location_type
    if body_location_target:
        data["location_target"] = body_location_target
    if body_catalog_file_name:
        data["catalog_file_name"] = body_catalog_file_name

    success, response = await make_api_request("/api/catalog/analyze-location", method="POST", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response