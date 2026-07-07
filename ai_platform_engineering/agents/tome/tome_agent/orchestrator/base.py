"""`AgentOrchestrator` ABC — the contract every driver must implement.

The backend talks to *one* `AgentOrchestrator` singleton. The driver knows
how to:

- spin up a per-project `ttt-agent` container (Docker locally, K8s in prod),
- mount that project's wiki dir into the agent,
- inject the project's secrets (Anthropic key + per-connector tokens) as env,
- generate a per-agent bearer token so the agent can POST back to
  `ttt-backend/internal/...` and prove who it is,
- expose a typed surface for backend code to drive lifecycle (ensure, status,
  stop, list, health, log tail).

Idle eviction is intentionally absent today — the host platform we eventually
integrate with will own that policy. Backend just calls `stop()` on project
deletion or app shutdown.

Drivers are picked at startup by the `TTT_ORCHESTRATOR` env var. The
backend never imports a driver directly; it always goes through this ABC.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class AgentSecrets(BaseModel):
    """Secrets injected into the agent container as env vars at start.

    The orchestrator is responsible for reading these from the backend's
    sqlite/OAuth services *before* spinning the container up — the agent
    never reaches back into sqlite for secrets, only to the
    `/internal/...` callback endpoints for page writes and logs.
    """

    anthropic_api_key: str = ""
    anthropic_auth_token: str = ""
    anthropic_base_url: str = ""

    github_token: str = ""
    confluence_token: str = ""
    confluence_cloud_id: str = ""
    confluence_base_url: str = ""
    confluence_user: str = ""
    webex_token: str = ""

    def as_env(self) -> dict[str, str]:
        """Render to an env-var dict suitable for docker `environment=` /
        k8s `env:`. Empty values are dropped so the container falls back to
        whatever the connector treats as 'no token'."""
        out: dict[str, str] = {}
        for k, v in self.model_dump().items():
            if v:
                out[k.upper()] = v
        return out


class AgentEndpoint(BaseModel):
    """Reachable address for a running agent + the bearer token it expects
    on the auth header for any callback to `ttt-backend/internal/...`."""

    project_id: UUID
    url: str
    """e.g. `http://ttt-agent-{project_id}:8766`. Driver-defined."""

    container_id: str
    """Opaque to backend; useful for logs/debugging. Docker container ID,
    K8s pod name, etc."""

    bearer_token: str
    """The orchestrator generated this when it started the container.
    Agent presents it on every callback; backend validates against the
    orchestrator's in-memory map."""

    started_at: datetime


class AgentStatus(BaseModel):
    """What the orchestrator knows about an agent. Used by `/admin/agents`,
    by the host platform's introspection tools, and by the SSE proxy to
    decide whether to wait for `/readyz` or fail fast."""

    project_id: UUID
    role: str = "editor"
    state: Literal["starting", "running", "unhealthy", "stopped"]
    started_at: datetime | None = None
    last_activity_at: datetime | None = None
    in_flight_runs: int = 0
    container_id: str | None = None
    extra: dict[str, str] = Field(default_factory=dict)
    """Driver-specific diagnostic fields (image tag, host, restart count)."""


class AgentOrchestrator(ABC):
    """The runtime layer the host platform consumes. Drivers implement
    every method; the backend depends only on this ABC."""

    @abstractmethod
    async def ensure_running(
        self,
        project_id: UUID,
        *,
        secrets: AgentSecrets,
        role: str = "editor",
    ) -> AgentEndpoint:
        """Idempotent. If an agent for this project+role is already running
        and healthy, return its existing endpoint (same `bearer_token`).
        Otherwise start a new container, wait for `/readyz` to return 200,
        and return the endpoint. Raises if start fails or readiness probe
        times out."""

    @abstractmethod
    async def status(self, project_id: UUID, role: str = "editor") -> AgentStatus:
        """Cheap check — driver-cached, doesn't hit the agent. Use
        `health()` for an active probe."""

    @abstractmethod
    async def stop(
        self, project_id: UUID, *, grace_seconds: int = 30, role: str = "editor"
    ) -> None:
        """Cleanly drain in-flight SSE, then stop the container. No-op if
        no agent is running."""

    @abstractmethod
    async def list_running(self) -> list[AgentStatus]:
        """All agents this orchestrator knows about. Used by the
        `/admin/agents` view and by shutdown handlers."""

    @abstractmethod
    async def health(self, project_id: UUID, role: str = "editor") -> bool:
        """Active probe — actually hits the agent's `/healthz`. Use this
        before opening a long-lived SSE stream so a dead container fails
        fast instead of hanging the request."""

    @abstractmethod
    def stream_logs(
        self, project_id: UUID, *, follow: bool = True, role: str = "editor"
    ) -> AsyncIterator[str]:
        """Tail the container's stdout/stderr. For the admin debug view
        and post-mortem diagnostics."""

    @abstractmethod
    def get_bearer_token(self, project_id: UUID) -> str | None:
        """Return the bearer token issued for this project's running agent,
        or None if no agent is running. Used by the backend's auth
        dependency on `/internal/...` to validate callback requests."""


__all__ = [
    "AgentEndpoint",
    "AgentOrchestrator",
    "AgentSecrets",
    "AgentStatus",
]
