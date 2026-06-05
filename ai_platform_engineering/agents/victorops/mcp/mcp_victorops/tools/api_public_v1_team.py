# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api-public/v1/team operations"""

import json
import logging
from typing import Any, Dict, Optional

from ..api.client import make_api_request
from ..utils.cache import team_cache

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_api_public_v1_team(
    org_slug: Optional[str] = None,
    force_refresh: bool = False,
) -> str:
    """List all teams.

    OpenAPI Description:
        Get a list of teams for your organization.

    This API may be called a maximum of 2 times per second.

    Results are cached in-process. TTL is set by
    VICTOROPS_CACHE_TTL_TEAMS_SECONDS (default 3600). Set to 0 to disable.

    Output is the upstream payload, pretty-printed, with the top-level
    list wrapped under "teams".

    Args:
        org_slug: VictorOps organization slug. Required when multiple
            orgs are configured.
        force_refresh: Bypass the cache and re-fetch from the API.
    """
    logger.debug("Making GET request to /api-public/v1/team")

    cache = team_cache()
    cache_key_org = org_slug or "_default_"

    raw: Optional[Dict[str, Any]] = (
        cache.get("team", cache_key_org) if not force_refresh else None
    )
    if raw is None:
        success, response = await make_api_request(
            "/api-public/v1/team", method="GET",
            org_slug=org_slug, params={}, data={},
        )
        if not success:
            logger.error(f"Request failed: {response.get('error')}")
            return json.dumps({"error": response.get("error", "Request failed")}, indent=2)
        raw = {"teams": response} if isinstance(response, list) else response
        cache.set("team", cache_key_org, raw)

    return json.dumps(raw, indent=2, default=str)
