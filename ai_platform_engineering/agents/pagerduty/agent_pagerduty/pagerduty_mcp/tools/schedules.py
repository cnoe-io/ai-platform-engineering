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
async def get_schedules(
    team_ids: Optional[List[str]] = None,
    query: Optional[str] = None,
) -> str:
    """Get schedules from PagerDuty.
    
    Args:
        team_ids: Filter by team IDs
        query: Search query
    """
    client = PagerDutyClient()
    schedules = await client.get_schedules(
        team_ids=team_ids,
        query=query
    )
    return str(schedules)

@tool
async def get_schedule_users(
    schedule_id: str,
    since: Optional[str] = None,
    until: Optional[str] = None,
) -> str:
    """Get users on a schedule.
    
    Args:
        schedule_id: Schedule ID
        since: Start time (ISO format)
        until: End time (ISO format)
    """
    client = PagerDutyClient()
    users = await client.get_schedule_users(
        schedule_id=schedule_id,
        since=since,
        until=until
    )
    return str(users)

@tool
async def get_oncalls(
    schedule_ids: Optional[List[str]] = None,
    user_ids: Optional[List[str]] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
) -> str:
    """Get on-call assignments.
    
    Args:
        schedule_ids: Filter by schedule IDs
        user_ids: Filter by user IDs
        since: Start time (ISO format)
        until: End time (ISO format)
    """
    client = PagerDutyClient()
    oncalls = await client.get_oncalls(
        schedule_ids=schedule_ids,
        user_ids=user_ids,
        since=since,
        until=until
    )
    return str(oncalls) 