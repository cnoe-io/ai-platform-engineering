"""Portable Harness Engine configuration, run, and event models."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AgentHarnessConfig(BaseModel):
    """Harness overlay stored independently from Dynamic Agents documents."""

    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(..., min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.-]+$")
    harness_id: Literal["agentcore"] = "agentcore"
    runtime_alias: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    enabled: bool = True
    revision: int = Field(1, ge=1)
    updated_at: datetime = Field(default_factory=utc_now)


class PutAgentHarnessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    harness_id: Literal["agentcore"] = "agentcore"
    runtime_alias: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    enabled: bool = True
    expected_revision: int | None = Field(None, ge=1)


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_RUN_STATUSES = {RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED}


class CreateRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(..., min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.-]+$")
    conversation_id: str = Field(..., min_length=1, max_length=256)
    message: str = Field(..., min_length=1, max_length=1_000_000)
    client_request_id: str | None = Field(None, min_length=1, max_length=128)


class RunRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    owner_subject: str
    agent_id: str
    conversation_id: str
    harness_id: Literal["agentcore"]
    runtime_alias: str
    provider_session_id: str
    status: RunStatus = RunStatus.QUEUED
    last_sequence: int = 0
    client_request_id: str | None = None
    error_code: str | None = None
    traceparent: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class RunEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    sequence: int = Field(..., ge=1)
    event_type: Literal["run.started", "content.delta", "run.completed", "run.failed", "run.cancelled"]
    data: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


class EventPage(BaseModel):
    run: RunRecord
    events: list[RunEvent]
    next_cursor: int
