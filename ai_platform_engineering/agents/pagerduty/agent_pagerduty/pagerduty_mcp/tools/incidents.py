# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0


import logging
from typing import Dict, List, Optional
from datetime import datetime

from pydantic import BaseModel
from langchain_core.tools import tool

from ..api.client import PagerDutyClient

logger = logging.getLogger(__name__)

@tool
async def get_incidents(
    status: Optional[str] = None,
    service_ids: Optional[List[str]] = None,
    user_ids: Optional[List[str]] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
) -> str:
    """Get incidents from PagerDuty.
    
    Args:
        status: Filter by status (triggered, acknowledged, resolved)
        service_ids: Filter by service IDs
        user_ids: Filter by user IDs
        since: Start time (ISO format)
        until: End time (ISO format)
    """
    client = PagerDutyClient()
    incidents = await client.get_incidents(
        status=status,
        service_ids=service_ids,
        user_ids=user_ids,
        since=since,
        until=until
    )
    return str(incidents)

@tool
async def create_incident(
    title: str,
    service_id: str,
    urgency: str = "high",
    body: Optional[str] = None,
) -> str:
    """Create a new incident in PagerDuty.
    
    Args:
        title: Incident title
        service_id: Service ID to create incident for
        urgency: Incident urgency (high/low)
        body: Incident description
    """
    client = PagerDutyClient()
    incident = await client.create_incident(
        title=title,
        service_id=service_id,
        urgency=urgency,
        body=body
    )
    return str(incident)

@tool
async def update_incident(
    incident_id: str,
    title: Optional[str] = None,
    urgency: Optional[str] = None,
    body: Optional[str] = None,
) -> str:
    """Update an existing incident.
    
    Args:
        incident_id: ID of incident to update
        title: New title
        urgency: New urgency
        body: New description
    """
    client = PagerDutyClient()
    incident = await client.update_incident(
        incident_id=incident_id,
        title=title,
        urgency=urgency,
        body=body
    )
    return str(incident)

@tool
async def resolve_incident(
    incident_id: str,
    resolution: Optional[str] = None,
) -> str:
    """Resolve an incident.
    
    Args:
        incident_id: ID of incident to resolve
        resolution: Resolution note
    """
    client = PagerDutyClient()
    incident = await client.resolve_incident(
        incident_id=incident_id,
        resolution=resolution
    )
    return str(incident)

@tool
async def acknowledge_incident(
    incident_id: str,
    note: Optional[str] = None,
) -> str:
    """Acknowledge an incident.
    
    Args:
        incident_id: ID of incident to acknowledge
        note: Acknowledgment note
    """
    client = PagerDutyClient()
    incident = await client.acknowledge_incident(
        incident_id=incident_id,
        note=note
    )
    return str(incident) 