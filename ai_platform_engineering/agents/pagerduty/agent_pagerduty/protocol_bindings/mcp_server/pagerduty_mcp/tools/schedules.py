# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

"""Schedule management tools for PagerDuty MCP"""

from typing import Dict, Any, Optional, List
import logging
from pydantic import BaseModel
from ..api.client import make_api_request

logger = logging.getLogger("pagerduty_mcp")

class Layer(BaseModel):
    """Model for schedule layer"""
    start: str
    rotation_virtual_start: str
    rotation_turn_length_seconds: int
    users: List[Dict[str, str]]
    restrictions: Optional[List[Dict[str, Any]]] = None

class Schedule(BaseModel):
    """Model for schedule"""
    type: str = "schedule"
    name: str
    description: Optional[str] = None
    time_zone: str = "UTC"
    layers: Optional[List[Layer]] = None

async def get_schedules(
    team_ids: Optional[List[str]] = None,
    query: Optional[str] = None,
    include: Optional[List[str]] = None,
    limit: int = 100,
) -> Dict[str, Any]:
    """
    Get schedules from PagerDuty with filtering options

    Args:
        team_ids: Filter schedules by team IDs
        query: Search query for schedules
        include: Additional fields to include in the response
        limit: Maximum number of schedules to return (default: 100)

    Returns:
        List of schedules with pagination information
    """
    params = {}

    if team_ids:
        params["team_ids[]"] = team_ids

    if query:
        params["query"] = query

    if include:
        params["include[]"] = include

    params["limit"] = limit

    success, data = await make_api_request("schedules", params=params)

    if not success:
        return {"error": data.get("error", "Failed to retrieve schedules")}

    return data

async def create_schedule(
    name: str,
    description: Optional[str] = None,
    time_zone: str = "UTC",
    layers: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Create a new schedule in PagerDuty

    Args:
        name: The name of the schedule (required)
        description: Description of the schedule
        time_zone: The time zone of the schedule (default: UTC)
        layers: List of schedule layers with rotation information

    Returns:
        The created schedule details
    """
    schedule_data = {
        "schedule": {
            "type": "schedule",
            "name": name,
            "time_zone": time_zone,
        }
    }

    if description:
        schedule_data["schedule"]["description"] = description

    if layers:
        schedule_data["schedule"]["layers"] = layers

    success, data = await make_api_request("schedules", method="POST", data=schedule_data)

    if success:
        logger.info(f"Schedule '{name}' created successfully")
        return data
    else:
        logger.error(f"Failed to create schedule '{name}': {data.get('error')}")
        return {"error": data.get("error", "Failed to create schedule")}

async def update_schedule(
    id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    time_zone: Optional[str] = None,
    layers: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Update an existing schedule in PagerDuty

    Args:
        id: The ID of the schedule to update (required)
        name: New name for the schedule
        description: New description for the schedule
        time_zone: New time zone for the schedule
        layers: New list of schedule layers

    Returns:
        The updated schedule details
    """
    schedule_data = {"schedule": {}}

    if name:
        schedule_data["schedule"]["name"] = name

    if description:
        schedule_data["schedule"]["description"] = description

    if time_zone:
        schedule_data["schedule"]["time_zone"] = time_zone

    if layers:
        schedule_data["schedule"]["layers"] = layers

    success, data = await make_api_request(f"schedules/{id}", method="PUT", data=schedule_data)

    if success:
        logger.info(f"Schedule '{id}' updated successfully")
        return data
    else:
        logger.error(f"Failed to update schedule '{id}': {data.get('error')}")
        return {"error": data.get("error", "Failed to update schedule")}

async def get_schedule_users(
    id: str,
    since: Optional[str] = None,
    until: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Get users on a schedule for a given time period

    Args:
        id: The ID of the schedule (required)
        since: Start time for the search (ISO 8601 format)
        until: End time for the search (ISO 8601 format)

    Returns:
        List of users on the schedule for the specified time period
    """
    params = {}

    if since:
        params["since"] = since

    if until:
        params["until"] = until

    success, data = await make_api_request(f"schedules/{id}/users", params=params)

    if not success:
        return {"error": data.get("error", "Failed to retrieve schedule users")}

    return data

async def get_oncalls(
    schedule_ids: Optional[List[str]] = None,
    user_ids: Optional[List[str]] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
) -> Dict[str, Any]:
    """Get on-call assignments.
    
    Args:
        schedule_ids: Filter by schedule IDs
        user_ids: Filter by user IDs
        since: Start time (ISO format)
        until: End time (ISO format)
    """
    params = {}

    if schedule_ids:
        params["schedule_ids[]"] = schedule_ids

    if user_ids:
        params["user_ids[]"] = user_ids

    if since:
        params["since"] = since

    if until:
        params["until"] = until

    success, data = await make_api_request("oncalls", params=params)

    if not success:
        return {"error": data.get("error", "Failed to retrieve on-call assignments")}

    return data 