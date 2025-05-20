"""On-call management tools for PagerDuty MCP"""

from typing import Dict, Any, Optional, List
import logging
from datetime import datetime
from pydantic import BaseModel
from ..api.client import make_api_request

logger = logging.getLogger("pagerduty_mcp")

class OnCall(BaseModel):
    """Model for on-call assignment"""
    type: str = "oncall"
    user: Dict[str, str]
    schedule: Dict[str, str]
    escalation_level: int
    start: str
    end: Optional[str] = None

async def get_oncalls(
    schedule_ids: Optional[List[str]] = None,
    user_ids: Optional[List[str]] = None,
    team_ids: Optional[List[str]] = None,
    escalation_policy_ids: Optional[List[str]] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    earliest: bool = False,
    include: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Get on-call assignments from PagerDuty with filtering options

    Args:
        schedule_ids: Filter by schedule IDs
        user_ids: Filter by user IDs
        team_ids: Filter by team IDs
        escalation_policy_ids: Filter by escalation policy IDs
        since: Start time for the search (ISO 8601 format)
        until: End time for the search (ISO 8601 format)
        earliest: Whether to return only the earliest on-call assignments
        include: Additional fields to include in the response

    Returns:
        List of on-call assignments with pagination information
    """
    params = {}

    if schedule_ids:
        params["schedule_ids[]"] = schedule_ids

    if user_ids:
        params["user_ids[]"] = user_ids

    if team_ids:
        params["team_ids[]"] = team_ids

    if escalation_policy_ids:
        params["escalation_policy_ids[]"] = escalation_policy_ids

    if since:
        params["since"] = since

    if until:
        params["until"] = until

    if earliest:
        params["earliest"] = "true"

    if include:
        params["include[]"] = include

    success, data = await make_api_request("oncalls", params=params)

    if not success:
        return {"error": data.get("error", "Failed to retrieve on-call assignments")}

    return data

async def get_oncall(
    id: str,
    include: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Get details for a specific on-call assignment

    Args:
        id: The ID of the on-call assignment (required)
        include: Additional fields to include in the response

    Returns:
        The on-call assignment details
    """
    params = {}

    if include:
        params["include[]"] = include

    success, data = await make_api_request(f"oncalls/{id}", params=params)

    if not success:
        return {"error": data.get("error", "Failed to retrieve on-call assignment")}

    return data 