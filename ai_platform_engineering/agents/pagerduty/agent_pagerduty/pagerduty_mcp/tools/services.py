# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

"""Service management tools for PagerDuty MCP"""

import logging
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
from ..api.client import make_api_request

logger = logging.getLogger("pagerduty_mcp")

class ServiceBody(BaseModel):
    """Model for service body"""
    type: str = "service"
    name: str
    description: Optional[str] = None
    alert_creation: str = "create_alerts_and_incidents"
    alert_grouping: str = "time"
    alert_grouping_timeout: int = 300

async def get_services(
    team_ids: Optional[List[str]] = None,
    time_zone: Optional[str] = None,
    sort_by: Optional[str] = None,
    include: Optional[List[str]] = None,
    limit: int = 100,
) -> Dict[str, Any]:
    """
    Get services from PagerDuty with filtering options

    Args:
        team_ids: Filter services by team IDs
        time_zone: Time zone for the response
        sort_by: Field to sort by (name, created_at, etc.)
        include: Additional fields to include in the response
        limit: Maximum number of services to return (default: 100)

    Returns:
        List of services with pagination information
    """
    params = {}

    if team_ids:
        params["team_ids[]"] = team_ids

    if time_zone:
        params["time_zone"] = time_zone

    if sort_by:
        params["sort_by"] = sort_by

    if include:
        params["include[]"] = include

    params["limit"] = limit

    success, data = await make_api_request("services", params=params)

    if not success:
        return {"error": data.get("error", "Failed to retrieve services")}

    return data

async def create_service(
    name: str,
    description: Optional[str] = None,
    escalation_policy_id: Optional[str] = None,
    alert_creation: str = "create_alerts_and_incidents",
    alert_grouping: str = "time",
    alert_grouping_timeout: int = 300,
) -> Dict[str, Any]:
    """
    Create a new service in PagerDuty

    Args:
        name: The name of the service (required)
        description: Description of the service
        escalation_policy_id: ID of the escalation policy to use
        alert_creation: How alerts are created (create_alerts_and_incidents, create_incidents)
        alert_grouping: How alerts are grouped (time, intelligent, rules)
        alert_grouping_timeout: Time in seconds before alerts are grouped (default: 300)

    Returns:
        The created service details
    """
    service_data = {
        "service": {
            "type": "service",
            "name": name,
            "alert_creation": alert_creation,
            "alert_grouping": alert_grouping,
            "alert_grouping_timeout": alert_grouping_timeout,
        }
    }

    if description:
        service_data["service"]["description"] = description

    if escalation_policy_id:
        service_data["service"]["escalation_policy"] = {
            "id": escalation_policy_id,
            "type": "escalation_policy_reference"
        }

    success, data = await make_api_request("services", method="POST", data=service_data)

    if success:
        logger.info(f"Service '{name}' created successfully")
        return data
    else:
        logger.error(f"Failed to create service '{name}': {data.get('error')}")
        return {"error": data.get("error", "Failed to create service")}

async def update_service(
    id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    escalation_policy_id: Optional[str] = None,
    alert_creation: Optional[str] = None,
    alert_grouping: Optional[str] = None,
    alert_grouping_timeout: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Update an existing service in PagerDuty

    Args:
        id: The ID of the service to update (required)
        name: New name for the service
        description: New description for the service
        escalation_policy_id: New escalation policy ID
        alert_creation: New alert creation setting
        alert_grouping: New alert grouping setting
        alert_grouping_timeout: New alert grouping timeout

    Returns:
        The updated service details
    """
    service_data = {"service": {}}

    if name:
        service_data["service"]["name"] = name

    if description:
        service_data["service"]["description"] = description

    if escalation_policy_id:
        service_data["service"]["escalation_policy"] = {
            "id": escalation_policy_id,
            "type": "escalation_policy_reference"
        }

    if alert_creation:
        service_data["service"]["alert_creation"] = alert_creation

    if alert_grouping:
        service_data["service"]["alert_grouping"] = alert_grouping

    if alert_grouping_timeout:
        service_data["service"]["alert_grouping_timeout"] = alert_grouping_timeout

    success, data = await make_api_request(f"services/{id}", method="PUT", data=service_data)

    if success:
        logger.info(f"Service '{id}' updated successfully")
        return data
    else:
        logger.error(f"Failed to update service '{id}': {data.get('error')}")
        return {"error": data.get("error", "Failed to update service")} 