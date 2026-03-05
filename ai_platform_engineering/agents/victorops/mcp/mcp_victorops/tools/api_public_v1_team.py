# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api-public/v1/team operations"""

import logging
from typing import Dict, Any
from ..api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_api_public_v1_team() -> Dict[str, Any]:
    """
        List all teams

        OpenAPI Description:
            Get a list of teams for your organization.
            Returns team name, slug, and memberCount for each team.
            Use the team slug to query on-call schedules.

    This API may be called a maximum of 2 times per second.


        Returns:
            Dict[str, Any]: The JSON response from the API call.

        Raises:
            Exception: If the API request fails or returns an error.
    """
    logger.debug("Making GET request to /api-public/v1/team")

    params = {}
    data = {}

    success, response = await make_api_request("/api-public/v1/team", method="GET", params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response
