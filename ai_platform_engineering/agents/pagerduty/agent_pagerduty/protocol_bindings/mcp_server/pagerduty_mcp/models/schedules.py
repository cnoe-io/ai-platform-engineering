# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0


from typing import Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field

class TeamReference(BaseModel):
    """Team reference model."""
    id: str
    type: str = "team_reference"

class ScheduleLayer(BaseModel):
    """Schedule layer model."""
    id: str
    type: str = "schedule_layer"
    start: datetime
    end: Optional[datetime] = None
    rotation_virtual_start: datetime
    rotation_turn_length_seconds: int
    users: List[Dict] = Field(default_factory=list)
    restrictions: List[Dict] = Field(default_factory=list)

class Schedule(BaseModel):
    """Schedule model."""
    id: str
    type: str = "schedule"
    summary: str
    self: str
    html_url: str
    name: str
    time_zone: str
    description: Optional[str] = None
    teams: List[TeamReference] = Field(default_factory=list)
    schedule_layers: List[ScheduleLayer] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    final_schedule: Optional[Dict] = None
    override_schedule: Optional[Dict] = None
    last_incident_timestamp: Optional[datetime] = None
    first_incident_timestamp: Optional[datetime] = None
    first_incident_number: Optional[int] = None
    first_incident_key: Optional[str] = None
    first_incident_html_url: Optional[str] = None
    first_incident_body: Optional[Dict] = None
    first_incident_assignments: List[Dict] = Field(default_factory=list)
    first_incident_acknowledgments: List[Dict] = Field(default_factory=list)
    first_incident_last_status_change_at: Optional[datetime] = None
    first_incident_last_status_change_by: Optional[Dict] = None
    first_incident_number: Optional[int] = None
    first_incident_incident_key: Optional[str] = None
    first_incident_html_url: Optional[str] = None
    first_incident_body: Optional[Dict] = None
    first_incident_assignments: List[Dict] = Field(default_factory=list)
    first_incident_acknowledgments: List[Dict] = Field(default_factory=list)
    first_incident_last_status_change_at: Optional[datetime] = None
    first_incident_last_status_change_by: Optional[Dict] = None
    first_incident_priority: Optional[Dict] = None
    first_incident_escalation_policy: Optional[Dict] = None
    first_incident_teams: List[Dict] = Field(default_factory=list)
    first_incident_alert_counts: Optional[Dict] = None
    first_incident_pending_actions: List[Dict] = Field(default_factory=list)
    first_incident_conference_bridge: Optional[Dict] = None
    first_incident_resolve_reason: Optional[Dict] = None
    first_incident_last_incident_timestamp: Optional[datetime] = None
    first_incident_first_trigger_log_entry: Optional[Dict] = None
    first_incident_incident_number: Optional[int] = None
    first_incident_incident_deeplinks: Optional[Dict] = None 