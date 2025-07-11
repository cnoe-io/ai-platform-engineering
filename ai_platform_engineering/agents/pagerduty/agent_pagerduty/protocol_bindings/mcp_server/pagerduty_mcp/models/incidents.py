# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0


from typing import Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field

class IncidentBody(BaseModel):
    """Incident body model."""
    type: str = "incident_body"
    details: str

class ServiceReference(BaseModel):
    """Service reference model."""
    id: str
    type: str = "service_reference"

class Incident(BaseModel):
    """Incident model."""
    id: str
    type: str = "incident"
    title: str
    description: Optional[str] = None
    urgency: str = "high"
    status: str
    service: ServiceReference
    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime] = None
    last_status_change_at: Optional[datetime] = None
    last_status_change_by: Optional[Dict] = None
    number: int
    incident_key: Optional[str] = None
    html_url: str
    body: Optional[IncidentBody] = None
    assignments: List[Dict] = Field(default_factory=list)
    acknowledgments: List[Dict] = Field(default_factory=list)
    last_status_change_on: Optional[datetime] = None
    priority: Optional[Dict] = None
    escalation_policy: Optional[Dict] = None
    teams: List[Dict] = Field(default_factory=list)
    alert_counts: Optional[Dict] = None
    pending_actions: List[Dict] = Field(default_factory=list)
    conference_bridge: Optional[Dict] = None
    resolve_reason: Optional[Dict] = None
    last_incident_timestamp: Optional[datetime] = None
    first_trigger_log_entry: Optional[Dict] = None
    incident_number: int
    incident_deeplinks: Optional[Dict] = None
    resolve_reason_notes: Optional[str] = None
    resolve_reason_notes_last_updated_at: Optional[datetime] = None
    resolve_reason_notes_last_updated_by: Optional[Dict] = None
    resolve_reason_notes_last_updated_on: Optional[datetime] = None
    resolve_reason_notes_last_updated_by_id: Optional[str] = None
    resolve_reason_notes_last_updated_by_type: Optional[str] = None
    resolve_reason_notes_last_updated_by_summary: Optional[str] = None
    resolve_reason_notes_last_updated_by_self: Optional[str] = None
    resolve_reason_notes_last_updated_by_html_url: Optional[str] = None
    resolve_reason_notes_last_updated_by_incident_number: Optional[int] = None
    resolve_reason_notes_last_updated_by_incident_key: Optional[str] = None
    resolve_reason_notes_last_updated_by_created_at: Optional[datetime] = None
    resolve_reason_notes_last_updated_by_updated_at: Optional[datetime] = None
    resolve_reason_notes_last_updated_by_resolved_at: Optional[datetime] = None
    resolve_reason_notes_last_updated_by_last_status_change_at: Optional[datetime] = None
    resolve_reason_notes_last_updated_by_last_status_change_by: Optional[Dict] = None
    resolve_reason_notes_last_updated_by_number: Optional[int] = None
    resolve_reason_notes_last_updated_by_incident_key: Optional[str] = None
    resolve_reason_notes_last_updated_by_html_url: Optional[str] = None
    resolve_reason_notes_last_updated_by_body: Optional[IncidentBody] = None
    resolve_reason_notes_last_updated_by_assignments: List[Dict] = Field(default_factory=list)
    resolve_reason_notes_last_updated_by_acknowledgments: List[Dict] = Field(default_factory=list)
    resolve_reason_notes_last_updated_by_last_status_change_on: Optional[datetime] = None
    resolve_reason_notes_last_updated_by_priority: Optional[Dict] = None
    resolve_reason_notes_last_updated_by_escalation_policy: Optional[Dict] = None
    resolve_reason_notes_last_updated_by_teams: List[Dict] = Field(default_factory=list)
    resolve_reason_notes_last_updated_by_alert_counts: Optional[Dict] = None
    resolve_reason_notes_last_updated_by_pending_actions: List[Dict] = Field(default_factory=list)
    resolve_reason_notes_last_updated_by_conference_bridge: Optional[Dict] = None
    resolve_reason_notes_last_updated_by_resolve_reason: Optional[Dict] = None
    resolve_reason_notes_last_updated_by_last_incident_timestamp: Optional[datetime] = None
    resolve_reason_notes_last_updated_by_first_trigger_log_entry: Optional[Dict] = None
    resolve_reason_notes_last_updated_by_incident_number: Optional[int] = None
    resolve_reason_notes_last_updated_by_incident_deeplinks: Optional[Dict] = None 