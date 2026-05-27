# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api-public/v2/team/{team}/oncall/schedule operations"""

import logging
from typing import Dict, Any, Optional
from ..api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_api_public_v2_team_oncall_schedule(team: str, org_slug: Optional[str] = None) -> Dict[str, Any]:
    """
        Get on-call schedule for a team

        OpenAPI Description:
            Get the on-call schedule for a team, including the current
            on-call user, escalation policies, rotation names, shift
            roll times, and upcoming on-call rolls.

    This API may be called a maximum of 2 times per second.


        Args:

            team (str): The team slug (e.g. 'team-FAQfg8VEQklS42Im').
                Use get_api_public_v1_team to find the slug for a team name.


        Returns:
            Dict[str, Any]: The JSON response from the API call.

        Raises:
            Exception: If the API request fails or returns an error.
    """
    logger.debug(f"Making GET request to /api-public/v2/team/{team}/oncall/schedule")

    params = {}
    data = {}

    success, response = await make_api_request(f"/api-public/v2/team/{team}/oncall/schedule", method="GET", org_slug=org_slug, params=params, data=data)

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response
