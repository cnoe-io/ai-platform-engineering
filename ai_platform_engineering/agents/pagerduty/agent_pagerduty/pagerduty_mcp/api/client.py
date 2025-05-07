# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0


import logging
import os
from typing import Dict, List, Optional
from datetime import datetime

import aiohttp
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class PagerDutyClient:
    """PagerDuty API client."""
    
    def __init__(self):
        self.token = os.getenv("PAGERDUTY_TOKEN")
        if not self.token:
            raise ValueError("PAGERDUTY_TOKEN must be set as an environment variable.")
        
        self.base_url = "https://api.pagerduty.com"
        self.headers = {
            "Authorization": f"Token token={self.token}",
            "Accept": "application/vnd.pagerduty+json;version=2",
            "Content-Type": "application/json",
        }
    
    async def _make_request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict] = None,
        data: Optional[Dict] = None,
    ) -> Dict:
        """Make a request to the PagerDuty API."""
        url = f"{self.base_url}{endpoint}"
        
        async with aiohttp.ClientSession() as session:
            async with session.request(
                method=method,
                url=url,
                headers=self.headers,
                params=params,
                json=data,
            ) as response:
                response.raise_for_status()
                return await response.json()
    
    # Incident methods
    async def get_incidents(
        self,
        status: Optional[str] = None,
        service_ids: Optional[List[str]] = None,
        user_ids: Optional[List[str]] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
    ) -> Dict:
        """Get incidents."""
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
            
        return await self._make_request("GET", "/incidents", params=params)
    
    async def create_incident(
        self,
        title: str,
        service_id: str,
        urgency: str = "high",
        body: Optional[str] = None,
    ) -> Dict:
        """Create an incident."""
        data = {
            "incident": {
                "type": "incident",
                "title": title,
                "urgency": urgency,
                "service": {"id": service_id, "type": "service_reference"},
            }
        }
        if body:
            data["incident"]["body"] = {"type": "incident_body", "details": body}
            
        return await self._make_request("POST", "/incidents", data=data)
    
    async def update_incident(
        self,
        incident_id: str,
        title: Optional[str] = None,
        urgency: Optional[str] = None,
        body: Optional[str] = None,
    ) -> Dict:
        """Update an incident."""
        data = {"incident": {}}
        if title:
            data["incident"]["title"] = title
        if urgency:
            data["incident"]["urgency"] = urgency
        if body:
            data["incident"]["body"] = {"type": "incident_body", "details": body}
            
        return await self._make_request("PUT", f"/incidents/{incident_id}", data=data)
    
    async def resolve_incident(
        self,
        incident_id: str,
        resolution: Optional[str] = None,
    ) -> Dict:
        """Resolve an incident."""
        data = {
            "incident": {
                "type": "incident",
                "status": "resolved",
            }
        }
        if resolution:
            data["incident"]["resolution"] = resolution
            
        return await self._make_request("PUT", f"/incidents/{incident_id}", data=data)
    
    async def acknowledge_incident(
        self,
        incident_id: str,
        note: Optional[str] = None,
    ) -> Dict:
        """Acknowledge an incident."""
        data = {
            "incident": {
                "type": "incident",
                "status": "acknowledged",
            }
        }
        if note:
            data["incident"]["note"] = note
            
        return await self._make_request("PUT", f"/incidents/{incident_id}", data=data)
    
    # Service methods
    async def get_services(
        self,
        team_ids: Optional[List[str]] = None,
        query: Optional[str] = None,
    ) -> Dict:
        """Get services."""
        params = {}
        if team_ids:
            params["team_ids[]"] = team_ids
        if query:
            params["query"] = query
            
        return await self._make_request("GET", "/services", params=params)
    
    async def create_service(
        self,
        name: str,
        description: Optional[str] = None,
        escalation_policy_id: Optional[str] = None,
        team_ids: Optional[List[str]] = None,
    ) -> Dict:
        """Create a service."""
        data = {
            "service": {
                "type": "service",
                "name": name,
            }
        }
        if description:
            data["service"]["description"] = description
        if escalation_policy_id:
            data["service"]["escalation_policy"] = {
                "id": escalation_policy_id,
                "type": "escalation_policy_reference",
            }
        if team_ids:
            data["service"]["teams"] = [
                {"id": team_id, "type": "team_reference"} for team_id in team_ids
            ]
            
        return await self._make_request("POST", "/services", data=data)
    
    async def update_service(
        self,
        service_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        escalation_policy_id: Optional[str] = None,
        team_ids: Optional[List[str]] = None,
    ) -> Dict:
        """Update a service."""
        data = {"service": {}}
        if name:
            data["service"]["name"] = name
        if description:
            data["service"]["description"] = description
        if escalation_policy_id:
            data["service"]["escalation_policy"] = {
                "id": escalation_policy_id,
                "type": "escalation_policy_reference",
            }
        if team_ids:
            data["service"]["teams"] = [
                {"id": team_id, "type": "team_reference"} for team_id in team_ids
            ]
            
        return await self._make_request("PUT", f"/services/{service_id}", data=data)
    
    # User methods
    async def get_users(
        self,
        team_ids: Optional[List[str]] = None,
        query: Optional[str] = None,
    ) -> Dict:
        """Get users."""
        params = {}
        if team_ids:
            params["team_ids[]"] = team_ids
        if query:
            params["query"] = query
            
        return await self._make_request("GET", "/users", params=params)
    
    async def get_user_contact_methods(
        self,
        user_id: str,
    ) -> Dict:
        """Get user contact methods."""
        return await self._make_request("GET", f"/users/{user_id}/contact_methods")
    
    async def get_user_notification_rules(
        self,
        user_id: str,
    ) -> Dict:
        """Get user notification rules."""
        return await self._make_request("GET", f"/users/{user_id}/notification_rules")
    
    # Schedule methods
    async def get_schedules(
        self,
        team_ids: Optional[List[str]] = None,
        query: Optional[str] = None,
    ) -> Dict:
        """Get schedules."""
        params = {}
        if team_ids:
            params["team_ids[]"] = team_ids
        if query:
            params["query"] = query
            
        return await self._make_request("GET", "/schedules", params=params)
    
    async def get_schedule_users(
        self,
        schedule_id: str,
        since: Optional[str] = None,
        until: Optional[str] = None,
    ) -> Dict:
        """Get schedule users."""
        params = {}
        if since:
            params["since"] = since
        if until:
            params["until"] = until
            
        return await self._make_request(
            "GET", f"/schedules/{schedule_id}/users", params=params
        )
    
    async def get_oncalls(
        self,
        schedule_ids: Optional[List[str]] = None,
        user_ids: Optional[List[str]] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
    ) -> Dict:
        """Get on-call assignments."""
        params = {}
        if schedule_ids:
            params["schedule_ids[]"] = schedule_ids
        if user_ids:
            params["user_ids[]"] = user_ids
        if since:
            params["since"] = since
        if until:
            params["until"] = until
            
        return await self._make_request("GET", "/oncalls", params=params) 