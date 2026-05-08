"""Shared preflight acknowledgement model for autonomous task targets."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field


class Acknowledgement(BaseModel):
    """Structured pre-flight result for an autonomous task target.

    Both supervisor-backed tasks and dynamic-agent-backed tasks persist
    this shape on ``TaskDefinition.last_ack`` so the UI can render the
    same badge regardless of which backend will execute the task.
    """

    ack_status: Literal["ok", "warn", "failed", "pending"] = Field(
        ...,
        description=(
            "ok = target confirmed the routing path is viable. "
            "warn = target reachable but flagged a soft issue. "
            "failed = target reachable and flagged a hard issue. "
            "pending = target unreachable; will retry."
        ),
    )
    ack_detail: str = Field(
        default="",
        description="Human-readable detail line shown in the UI badge tooltip.",
    )
    routed_to: Optional[str] = Field(
        default=None,
        description="Sub-agent or dynamic agent the task would route to.",
    )
    tools: list[str] = Field(
        default_factory=list,
        description="Tool names the target has loaded.",
    )
    available_agents: list[str] = Field(
        default_factory=list,
        description="All agents currently visible to the target service.",
    )
    credentials_status: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "Map of credential-name -> status (e.g. 'github_pat': 'ok'). "
            "Empty in the light preflight; populated by future heavy-probe."
        ),
    )
    dry_run_summary: str = Field(
        default="",
        description="Plain-English summary of what the task will do at run time.",
    )
    ack_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="When this ack was produced (server time).",
    )

    @classmethod
    def transport_failure(cls, detail: str) -> "Acknowledgement":
        """Build an ack representing 'target never answered'."""
        return cls(
            ack_status="pending",
            ack_detail=detail,
            routed_to=None,
            tools=[],
            available_agents=[],
            credentials_status={},
            dry_run_summary="Target service unreachable; will retry on next task touch.",
        )

    @classmethod
    def application_failure(cls, detail: str) -> "Acknowledgement":
        """Build an ack representing 'target answered with an application error'."""
        return cls(
            ack_status="failed",
            ack_detail=detail,
            routed_to=None,
            tools=[],
            available_agents=[],
            credentials_status={},
            dry_run_summary="Target service refused the preflight; see ack_detail.",
        )
