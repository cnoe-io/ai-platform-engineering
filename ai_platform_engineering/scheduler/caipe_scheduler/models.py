"""Pydantic models for the schedules API + Mongo docs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


RunStatus = Literal["ok", "error"]


class LastRun(BaseModel):
    ts: datetime
    status: RunStatus
    error: str | None = None
    http_status: int | None = None


class ScheduleCreate(BaseModel):
    """Body of POST /v1/schedules."""

    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(
        ...,
        description="Dynamic agent _id (e.g. 'agent-sunny-webex-meeting-test'). Must exist in dynamic_agents collection.",
    )
    message_template: str = Field(
        ...,
        description="The chat message body posted on each fire. Plain text, no template engine.",
    )
    cron: str = Field(
        ..., description="Standard 5-field cron string (e.g. '0 9 * * MON')."
    )
    tz: str = Field(
        ..., description="IANA timezone name (e.g. 'America/Los_Angeles')."
    )
    owner_user_id: str = Field(
        ...,
        description="CAIPE user email (or any stable identifier the chat API recognises). The fire is attributed to this user.",
    )
    pod_id: str | None = Field(
        default=None,
        description="Optional pod context (Pam-specific). Stored for listing/UI; not used by scheduler.",
    )


class SchedulePatch(BaseModel):
    """Body of PATCH /v1/schedules/{id}. All fields optional."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    cron: str | None = None
    tz: str | None = None
    message_template: str | None = None


class Schedule(BaseModel):
    """Full schedule doc as stored in Mongo + returned by API."""

    model_config = ConfigDict(extra="ignore")

    schedule_id: str
    owner_user_id: str
    agent_id: str
    message_template: str
    pod_id: str | None = None
    cron: str
    tz: str
    enabled: bool = True
    cronjob_name: str | None = None
    created_at: datetime
    updated_at: datetime
    last_run: LastRun | None = None


class ScheduleCreateResponse(BaseModel):
    schedule_id: str
    cronjob_name: str


class ScheduleList(BaseModel):
    items: list[Schedule]


class LastRunReport(BaseModel):
    """Body of POST /v1/schedules/{id}/runs (cron-runner reports back)."""

    model_config = ConfigDict(extra="forbid")

    status: RunStatus
    error: str | None = None
    http_status: int | None = None
