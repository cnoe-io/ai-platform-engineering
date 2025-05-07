# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0


import logging
from typing import Dict, List, Optional

from pydantic import BaseModel
from langchain_core.tools import tool

from ..api.client import PagerDutyClient

logger = logging.getLogger(__name__)

@tool
async def get_users(
    team_ids: Optional[List[str]] = None,
    query: Optional[str] = None,
) -> str:
    """Get users from PagerDuty.
    
    Args:
        team_ids: Filter by team IDs
        query: Search query
    """
    client = PagerDutyClient()
    users = await client.get_users(
        team_ids=team_ids,
        query=query
    )
    return str(users)

@tool
async def get_user_contact_methods(
    user_id: str,
) -> str:
    """Get contact methods for a user.
    
    Args:
        user_id: User ID
    """
    client = PagerDutyClient()
    contact_methods = await client.get_user_contact_methods(
        user_id=user_id
    )
    return str(contact_methods)

@tool
async def get_user_notification_rules(
    user_id: str,
) -> str:
    """Get notification rules for a user.
    
    Args:
        user_id: User ID
    """
    client = PagerDutyClient()
    notification_rules = await client.get_user_notification_rules(
        user_id=user_id
    )
    return str(notification_rules) 