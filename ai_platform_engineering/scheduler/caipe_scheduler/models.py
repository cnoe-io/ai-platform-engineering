"""Pydantic models for the schedules API + Mongo docs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


RunStatus = Literal["ok", "error"]


class LastRun(BaseModel):
    ts: datetime
    status: RunStatus
    error: str | None = None
    http_status: int | None = None


class ScheduleVersion(BaseModel):
    """Previous schedule settings captured before a successful PATCH."""

    model_config = ConfigDict(extra="ignore")

    version: int = 1
    superseded_at: datetime
    changed_fields: list[str] = Field(default_factory=list)
    title: str | None = None
    agent_id: str
    message_template: str
    pod_id: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    cron: str
    tz: str
    enabled: bool = True
    cronjob_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ScheduleCreate(BaseModel):
    """Body of POST /v1/schedules."""

    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(
        ...,
        description="Dynamic agent _id (e.g. 'agent-sunny-webex-meeting-test'). Must exist in dynamic_agents collection.",
    )
    title: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Human-readable job title shown in schedule UIs.",
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
    attributes: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Optional JSON object with small display attributes for UIs "
            "(for example {'pod_id': 'important-team-2'})."
        ),
    )

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("title must be a non-empty string")
        return value


class SchedulePatch(BaseModel):
    """Body of PATCH /v1/schedules/{id}. All fields optional."""

    model_config = ConfigDict(extra="forbid")

    agent_id: str | None = None
    enabled: bool | None = None
    cron: str | None = None
    tz: str | None = None
    message_template: str | None = None
    title: str | None = None
    attributes: dict[str, Any] | None = None

    @field_validator("title")
    @classmethod
    def patch_title_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("title must be a non-empty string")
        return value


class Schedule(BaseModel):
    """Full schedule doc as stored in Mongo + returned by API."""

    model_config = ConfigDict(extra="ignore")

    schedule_id: str
    owner_user_id: str
    agent_id: str
    title: str | None = None
    message_template: str
    pod_id: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    cron: str
    tz: str
    enabled: bool = True
    cronjob_name: str | None = None
    created_at: datetime
    updated_at: datetime
    last_run: LastRun | None = None
    version: int = 1
    versions: list[ScheduleVersion] = Field(default_factory=list)


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
