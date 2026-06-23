"""ttt-agent FastAPI app — the entrypoint baked into Dockerfile.agent.

Endpoints:

- `POST /chat` — body `ChatRequest`, response `text/event-stream` of
  `ChatEventPayload`s. SDK chat loop, snapshot-driven.
- `POST /ingest` — body `IngestRequest`, response `text/event-stream` of
  `IngestEventPayload`s. SDK ingest loop, snapshot-driven.
- `GET /healthz` — process is alive. Always 200 once the app has started.
- `GET /readyz` — agent is ready to serve. 200 if the ttt config import
  succeeded and the snapshot endpoint is reachable; 503 otherwise.
- `GET /metrics` — minimal Prometheus-style counters.

Auth boundary: the **backend** authenticates requests to these endpoints
by virtue of routing — only the backend can reach the agent on the
internal docker network. Outbound callbacks from agent → backend
include the per-agent bearer (`TTT_AGENT_TOKEN` env), validated by the
backend's `/internal/...` auth dependency.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import PlainTextResponse, StreamingResponse

from tome_agent.agent import http_client
from tome_agent.agent.chat import stream_chat
from tome_agent.agent.ingestor import stream_ingest
from tome_agent.agent.loop import project_root
from tome_agent.config import settings
from tome_agent.orchestrator.contract import (
    ChatEventPayload,
    ChatRequest,
    HealthResponse,
    IngestEventPayload,
    IngestRequest,
)

log = logging.getLogger("tome_agent.agent.main")
logging.basicConfig(level=settings.log_level)
logging.getLogger("ttt").setLevel(settings.log_level)


@dataclass
class _AgentState:
    started_at: datetime
    in_flight_runs: int = 0
    last_activity_at: datetime | None = None
    ready: bool = False


_state = _AgentState(started_at=datetime.now(timezone.utc))


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        raise RuntimeError(
            "At least one of ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set"
        )
    # The agent is multi-project: it has no single project to probe at startup.
    # Each request fetches a fresh snapshot for its own project_id; the per-request
    # path is the real readiness signal. Mark ready once basic env is present.
    if not os.environ.get("TTT_BACKEND_URL"):
        log.warning("agent missing TTT_BACKEND_URL — requests will fail at callback time")
    _state.ready = True
    yield


app = FastAPI(title="tome-agent", lifespan=lifespan)


# ---------- health / readiness / metrics ----------


@app.get("/healthz", response_model=HealthResponse)
def healthz() -> HealthResponse:
    return HealthResponse(
        status="ok",
        started_at=_state.started_at,
        in_flight_runs=_state.in_flight_runs,
        last_activity_at=_state.last_activity_at,
    )


@app.get("/readyz")
def readyz() -> Response:
    if _state.ready:
        return Response(status_code=200, content="ok")
    return Response(status_code=503, content="not ready")


@app.get("/metrics", response_class=PlainTextResponse)
def metrics() -> str:
    """Minimal Prometheus exposition. We only track what the host's
    autoscaler/observability cares about — in-flight runs and uptime."""
    uptime_s = (datetime.now(timezone.utc) - _state.started_at).total_seconds()
    return (
        "# HELP ttt_agent_in_flight_runs Number of chat/ingest runs in flight.\n"
        "# TYPE ttt_agent_in_flight_runs gauge\n"
        f"ttt_agent_in_flight_runs {_state.in_flight_runs}\n"
        "# HELP ttt_agent_uptime_seconds Process uptime.\n"
        "# TYPE ttt_agent_uptime_seconds counter\n"
        f"ttt_agent_uptime_seconds {uptime_s:.3f}\n"
    )


# ---------- chat ----------


def _yank_working_copy(project_id: str) -> None:
    """Remove this project's scratch working copy after a run. It's rehydrated
    from the backend (source of truth) at the next run, so nothing is lost —
    this just keeps one project's files from lingering in the shared container."""
    try:
        shutil.rmtree(project_root(project_id), ignore_errors=True)
    except Exception:
        log.warning("failed to remove working copy for %s", project_id, exc_info=True)


def _sse_format(event: ChatEventPayload | IngestEventPayload) -> bytes:
    """Render a typed event as SSE wire format. The `event:` line carries
    the payload type so the backend's proxy can dispatch without parsing
    the JSON body."""
    payload = json.dumps(event.data)
    return f"event: {event.type}\ndata: {payload}\n\n".encode()


@app.post("/chat")
async def chat_endpoint(body: ChatRequest):
    if not _state.ready:
        raise HTTPException(503, "agent not ready")

    async def gen() -> AsyncIterator[bytes]:
        # Scope every backend callback in this run to the request's project
        # AND scope per-connector OAuth credentials to the requesting user
        # (set inside the generator so awaited stream_* calls inherit both
        # ContextVars).
        http_client.set_active_project_id(body.snapshot.project_id)
        http_client.set_active_credentials(body.credentials)
        _state.in_flight_runs += 1
        _state.last_activity_at = datetime.now(timezone.utc)
        try:
            async for event in stream_chat(
                user_message=body.message,
                sdk_session_id=body.sdk_session_id,
                snapshot=body.snapshot,
                stable_pages=body.stable_pages,
            ):
                yield _sse_format(event)
        finally:
            _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
            _state.last_activity_at = datetime.now(timezone.utc)
            _yank_working_copy(body.snapshot.project_id)

    return StreamingResponse(gen(), media_type="text/event-stream")


# ---------- ingest ----------


@app.post("/ingest")
async def ingest_endpoint(body: IngestRequest):
    if not _state.ready:
        raise HTTPException(503, "agent not ready")

    async def gen() -> AsyncIterator[bytes]:
        # Scope every backend callback in this run to the request's project
        # AND scope per-connector OAuth credentials to the requesting user
        # (set inside the generator so awaited stream_* calls inherit both
        # ContextVars).
        http_client.set_active_project_id(body.snapshot.project_id)
        http_client.set_active_credentials(body.credentials)
        _state.in_flight_runs += 1
        _state.last_activity_at = datetime.now(timezone.utc)
        try:
            async for event in stream_ingest(
                run_id=body.run_id,
                seed=body.seed,
                connector_data=body.connector_data,
                snapshot=body.snapshot,
                is_greenfield=body.is_greenfield,
                report_id=body.report_id,
            ):
                yield _sse_format(event)
        finally:
            _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
            _state.last_activity_at = datetime.now(timezone.utc)
            _yank_working_copy(body.snapshot.project_id)

    return StreamingResponse(gen(), media_type="text/event-stream")
