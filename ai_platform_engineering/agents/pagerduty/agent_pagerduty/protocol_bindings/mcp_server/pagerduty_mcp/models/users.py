# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0


from typing import Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field

class ContactMethod(BaseModel):
    """Contact method model."""
    id: str
    type: str
    summary: str
    self: str
    html_url: Optional[str] = None
    label: str
    address: str
    blacklisted: bool
    created_at: datetime
    updated_at: datetime
    send_short_email: bool
    send_html_email: bool

class NotificationRule(BaseModel):
    """Notification rule model."""
    id: str
    type: str
    summary: str
    self: str
    html_url: Optional[str] = None
    start_delay_in_minutes: int
    created_at: datetime
    updated_at: datetime
    contact_method: ContactMethod
    urgency: str

class User(BaseModel):
    """User model."""
    id: str
    type: str = "user"
    summary: str
    self: str
    html_url: str
    name: str
    email: str
    time_zone: str
    color: str
    role: str
    avatar_url: Optional[str] = None
    description: Optional[str] = None
    invitation_sent: bool
    job_title: Optional[str] = None
    teams: List[Dict] = Field(default_factory=list)
    contact_methods: List[ContactMethod] = Field(default_factory=list)
    notification_rules: List[NotificationRule] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    last_active: Optional[datetime] = None
    last_login: Optional[datetime] = None
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