# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api-public/v2/team/{team}/oncall/schedule operations"""

import json
import logging
from typing import Optional

from ..api.client import make_api_request
from ..utils.cache import schedule_cache

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def get_api_public_v2_team_oncall_schedule(
    team: str,
    org_slug: Optional[str] = None,
    force_refresh: bool = False,
) -> str:
    """Get on-call schedule for a team.

    OpenAPI Description:
        Get the on-call schedule for a team, including the current
        on-call user, escalation policies, rotation names, shift roll
        times, and upcoming on-call rolls.

    This API may be called a maximum of 2 times per second.

    Results are cached per (team, org_slug). TTL is set by
    VICTOROPS_CACHE_TTL_SCHEDULES_SECONDS (default 300). Set to 0 to
    disable. The TTL is intentionally short because rotations roll daily
    and on-call freshness matters during a page.

    Output is the upstream schedule payload, pretty-printed. The schema
    nests on-call user info under varying keys (onCallUser, onCallNow,
    inside rolls[]) depending on the org config, so we return the full
    payload rather than projecting and risking dropping the field.

    Args:
        team: The team slug (e.g. 'team-FAQfg8VEQklS42Im'). Use
            get_api_public_v1_team to find the slug for a team name.
        org_slug: VictorOps organization slug. Required when multiple
            orgs are configured.
        force_refresh: Bypass the cache and re-fetch from the API.
    """
    logger.debug(f"Making GET request to /api-public/v2/team/{team}/oncall/schedule")

    cache = schedule_cache()
    cache_key_org = org_slug or "_default_"

    raw = cache.get("schedule", cache_key_org, filter_key=team) if not force_refresh else None
    if raw is None:
        success, response = await make_api_request(
            f"/api-public/v2/team/{team}/oncall/schedule", method="GET",
            org_slug=org_slug, params={}, data={},
        )
        if not success:
            logger.error(f"Request failed: {response.get('error')}")
            return json.dumps({"error": response.get("error", "Request failed")}, indent=2)
        raw = {"schedules": response} if isinstance(response, list) else response
        cache.set("schedule", cache_key_org, raw, filter_key=team)

    return json.dumps(raw, indent=2, default=str)
