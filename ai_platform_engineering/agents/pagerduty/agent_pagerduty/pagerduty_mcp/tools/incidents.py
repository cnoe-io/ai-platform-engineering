"""Incident management tools for PagerDuty MCP"""

import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
from pydantic import BaseModel
from ..api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("pagerduty_mcp")

class IncidentBody(BaseModel):
    """Model for incident body"""
    type: str = "incident_body"
    details: str

async def get_incidents(
    status: Optional[str] = None,
    service_ids: Optional[List[str]] = None,
    user_ids: Optional[List[str]] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    limit: int = 100,
) -> Dict[str, Any]:
    """
    Get incidents from PagerDuty with filtering options

    Args:
        status: Filter incidents by status (triggered, acknowledged, resolved)
        service_ids: Filter incidents by service IDs
        user_ids: Filter incidents by user IDs
        since: Start time for incident search (ISO 8601 format)
        until: End time for incident search (ISO 8601 format)
        limit: Maximum number of incidents to return (default: 100)

    Returns:
        List of incidents with pagination information
    """
    logger.debug("Getting incidents with filters:")
    logger.debug(f"Status: {status}")
    logger.debug(f"Service IDs: {service_ids}")
    logger.debug(f"User IDs: {user_ids}")
    logger.debug(f"Since: {since}")
    logger.debug(f"Until: {until}")
    logger.debug(f"Limit: {limit}")

    params = {}

    if status:
        params["statuses[]"] = status

    if service_ids:
        params["service_ids[]"] = service_ids

    if user_ids:
        params["user_ids[]"] = user_ids

    if since:
        params["since"] = since

    if until:
        params["until"] = until

    params["limit"] = limit

    logger.debug(f"Making API request with params: {params}")
    success, data = await make_api_request("incidents", params=params)

    if not success:
        logger.error(f"Failed to retrieve incidents: {data.get('error')}")
        return {"error": data.get("error", "Failed to retrieve incidents")}

    logger.info(f"Successfully retrieved incidents")
    return data

async def create_incident(
    title: str,
    service_id: str,
    urgency: str = "high",
    body: Optional[str] = None,
    priority_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create a new incident in PagerDuty

    Args:
        title: The title of the incident (required)
        service_id: The ID of the service to create the incident for (required)
        urgency: The urgency of the incident (default: high)
        body: Additional details about the incident
        priority_id: The ID of the priority to set for the incident

    Returns:
        The created incident details
    """
    logger.debug(f"Creating new incident:")
    logger.debug(f"Title: {title}")
    logger.debug(f"Service ID: {service_id}")
    logger.debug(f"Urgency: {urgency}")
    logger.debug(f"Priority ID: {priority_id}")
    if body:
        logger.debug(f"Body length: {len(body)} characters")

    incident_data = {
        "incident": {
            "type": "incident",
            "title": title,
            "service": {"id": service_id, "type": "service_reference"},
            "urgency": urgency,
        }
    }

    if body:
        incident_data["incident"]["body"] = {
            "type": "incident_body",
            "details": body
        }

    if priority_id:
        incident_data["incident"]["priority"] = {
            "id": priority_id,
            "type": "priority_reference"
        }

    logger.debug(f"Making API request with incident data: {incident_data}")
    success, data = await make_api_request("incidents", method="POST", data=incident_data)

    if success:
        logger.info(f"Incident '{title}' created successfully")
        return data
    else:
        logger.error(f"Failed to create incident '{title}': {data.get('error')}")
        return {"error": data.get("error", "Failed to create incident")}

async def update_incident(
    id: str,
    title: Optional[str] = None,
    urgency: Optional[str] = None,
    body: Optional[str] = None,
    priority_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update an existing incident in PagerDuty

    Args:
        id: The ID of the incident to update (required)
        title: New title for the incident
        urgency: New urgency level for the incident
        body: New body text for the incident
        priority_id: New priority ID for the incident

    Returns:
        The updated incident details
    """
    logger.debug(f"Updating incident {id}:")
    logger.debug(f"New title: {title}")
    logger.debug(f"New urgency: {urgency}")
    logger.debug(f"New priority ID: {priority_id}")
    if body:
        logger.debug(f"New body length: {len(body)} characters")

    incident_data = {"incident": {}}

    if title:
        incident_data["incident"]["title"] = title

    if urgency:
        incident_data["incident"]["urgency"] = urgency

    if body:
        incident_data["incident"]["body"] = {
            "type": "incident_body",
            "details": body
        }

    if priority_id:
        incident_data["incident"]["priority"] = {
            "id": priority_id,
            "type": "priority_reference"
        }

    logger.debug(f"Making API request with update data: {incident_data}")
    success, data = await make_api_request(f"incidents/{id}", method="PUT", data=incident_data)

    if success:
        logger.info(f"Incident '{id}' updated successfully")
        return data
    else:
        logger.error(f"Failed to update incident '{id}': {data.get('error')}")
        return {"error": data.get("error", "Failed to update incident")}

async def resolve_incident(
    id: str,
    resolution: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Resolve an incident in PagerDuty

    Args:
        id: The ID of the incident to resolve (required)
        resolution: Optional resolution note

    Returns:
        The resolved incident details
    """
    logger.debug(f"Resolving incident {id}")
    if resolution:
        logger.debug(f"Resolution note length: {len(resolution)} characters")

    incident_data = {
        "incident": {
            "status": "resolved"
        }
    }

    if resolution:
        incident_data["incident"]["resolution"] = resolution

    logger.debug(f"Making API request with resolution data: {incident_data}")
    success, data = await make_api_request(f"incidents/{id}", method="PUT", data=incident_data)

    if success:
        logger.info(f"Incident '{id}' resolved successfully")
        return data
    else:
        logger.error(f"Failed to resolve incident '{id}': {data.get('error')}")
        return {"error": data.get("error", "Failed to resolve incident")}

async def acknowledge_incident(
    id: str,
) -> Dict[str, Any]:
    """
    Acknowledge an incident in PagerDuty

    Args:
        id: The ID of the incident to acknowledge (required)

    Returns:
        The acknowledged incident details
    """
    logger.debug(f"Acknowledging incident {id}")

    incident_data = {
        "incident": {
            "status": "acknowledged"
        }
    }

    logger.debug(f"Making API request with acknowledgment data: {incident_data}")
    success, data = await make_api_request(f"incidents/{id}", method="PUT", data=incident_data)

    if success:
        logger.info(f"Incident '{id}' acknowledged successfully")
        return data
    else:
        logger.error(f"Failed to acknowledge incident '{id}': {data.get('error')}")
        return {"error": data.get("error", "Failed to acknowledge incident")} 