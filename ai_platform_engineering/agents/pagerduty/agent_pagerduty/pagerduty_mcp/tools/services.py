# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0


import logging
from typing import Dict, List, Optional

from pydantic import BaseModel
from langchain_core.tools import tool

from ..api.client import PagerDutyClient

logger = logging.getLogger(__name__)

@tool
async def get_services(
    team_ids: Optional[List[str]] = None,
    query: Optional[str] = None,
) -> str:
    """Get services from PagerDuty.
    
    Args:
        team_ids: Filter by team IDs
        query: Search query
    """
    client = PagerDutyClient()
    services = await client.get_services(
        team_ids=team_ids,
        query=query
    )
    return str(services)

@tool
async def create_service(
    name: str,
    description: Optional[str] = None,
    escalation_policy_id: Optional[str] = None,
    team_ids: Optional[List[str]] = None,
) -> str:
    """Create a new service in PagerDuty.
    
    Args:
        name: Service name
        description: Service description
        escalation_policy_id: ID of escalation policy
        team_ids: List of team IDs
    """
    client = PagerDutyClient()
    service = await client.create_service(
        name=name,
        description=description,
        escalation_policy_id=escalation_policy_id,
        team_ids=team_ids
    )
    return str(service)

@tool
async def update_service(
    service_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    escalation_policy_id: Optional[str] = None,
    team_ids: Optional[List[str]] = None,
) -> str:
    """Update an existing service.
    
    Args:
        service_id: ID of service to update
        name: New name
        description: New description
        escalation_policy_id: New escalation policy ID
        team_ids: New team IDs
    """
    client = PagerDutyClient()
    service = await client.update_service(
        service_id=service_id,
        name=name,
        description=description,
        escalation_policy_id=escalation_policy_id,
        team_ids=team_ids
    )
    return str(service) 