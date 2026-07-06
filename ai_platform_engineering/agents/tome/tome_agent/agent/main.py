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

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import PlainTextResponse, StreamingResponse

from tome_agent.agent import http_client, workspace
from tome_agent.agent.chat import stream_chat
from tome_agent.agent.compact import stream_compaction
from tome_agent.agent.ingestor import stream_ingest
from tome_agent.agent.synthesize import stream_synthesis
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
    if not os.environ.get("TTT_BACKEND_URL"):
        log.warning("agent missing TTT_BACKEND_URL — requests will fail at callback time")

    # Persistent workspace: materialize every project's wiki to disk before
    # serving, then keep them fresh on a timer. Best-effort — a backend hiccup
    # at startup shouldn't stop the agent from coming up; the periodic sync and
    # the per-ingest refresh will catch anything missed here.
    try:
        await workspace.sync_all_projects()
    except Exception:
        log.warning("initial workspace load failed; continuing", exc_info=True)
    _state.ready = True

    sync_task = asyncio.create_task(
        workspace.sync_loop(settings.tome_sync_interval_seconds)
    )
    try:
        yield
    finally:
        sync_task.cancel()
        try:
            await sync_task
        except asyncio.CancelledError:
            pass
        except Exception:
            log.warning("sync task shutdown error", exc_info=True)


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
        http_client.set_active_actor_email(body.actor_email)
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
        pid = body.snapshot.project_id
        http_client.set_active_project_id(pid)
        http_client.set_active_credentials(body.credentials)
        _state.in_flight_runs += 1
        _state.last_activity_at = datetime.now(timezone.utc)
        try:
            # Hold the per-project lock for the whole run (serializing it
            # against other ingests and the periodic sync), and refresh the
            # on-disk copy from the source of truth first so the ingest edits
            # the latest committed state.
            async with workspace.project_lock(pid):
                await workspace.refresh_project(pid)
                async for event in stream_ingest(
                    run_id=body.run_id,
                    seed=body.seed,
                    connector_data=body.connector_data,
                    snapshot=body.snapshot,
                    is_greenfield=body.is_greenfield,
                    seed_stable_pages=body.seed_stable_pages,
                    report_id=body.report_id,
                ):
                    yield _sse_format(event)
        finally:
            _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
            _state.last_activity_at = datetime.now(timezone.utc)

    return StreamingResponse(gen(), media_type="text/event-stream")


# ---------- compaction (in-place wiki editing pass) ----------


@app.post("/compact")
async def compact_endpoint(body: IngestRequest):
    """Compaction: tighten the prose of a project's dynamic wiki pages and fix
    stale `tome://` links. An in-place editing pass — it pulls no sources and
    removes no pages. Holds the project lock and refreshes the on-disk wiki first,
    like `/ingest`."""
    if not _state.ready:
        raise HTTPException(503, "agent not ready")

    async def gen() -> AsyncIterator[bytes]:
        pid = body.snapshot.project_id
        http_client.set_active_project_id(pid)
        http_client.set_active_credentials(body.credentials)
        _state.in_flight_runs += 1
        _state.last_activity_at = datetime.now(timezone.utc)
        try:
            async with workspace.project_lock(pid):
                await workspace.refresh_project(pid)
                async for event in stream_compaction(
                    run_id=body.run_id,
                    seed=body.seed,
                    snapshot=body.snapshot,
                    report_id=body.report_id,
                ):
                    yield _sse_format(event)
        finally:
            _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
            _state.last_activity_at = datetime.now(timezone.utc)

    return StreamingResponse(gen(), media_type="text/event-stream")


# ---------- BHAG synthesis (cross-project synthesis) ----------


@app.post("/synthesize")
async def synthesize_endpoint(body: IngestRequest):
    """BHAG synthesis: synthesize a strategic goal's wiki from its tagged child
    projects' wikis. Distinct from `/ingest` (which pulls a single project's
    sources) — the first of a suite of cross-project subagents. Reuses the
    IngestRequest contract; `snapshot.child_projects` carries the children."""
    if not _state.ready:
        raise HTTPException(503, "agent not ready")

    async def gen() -> AsyncIterator[bytes]:
        pid = body.snapshot.project_id
        http_client.set_active_project_id(pid)
        http_client.set_active_credentials(body.credentials)
        _state.in_flight_runs += 1
        _state.last_activity_at = datetime.now(timezone.utc)
        try:
            async with workspace.project_lock(pid):
                await workspace.refresh_project(pid)
                # Refresh each child's on-disk wiki from the source of truth so
                # the synthesis reads the latest committed state. Each under its
                # own lock.
                for child in body.snapshot.child_projects:
                    async with workspace.project_lock(child.project_id):
                        await workspace.refresh_project(child.project_id)
                async for event in stream_synthesis(
                    run_id=body.run_id,
                    seed=body.seed,
                    snapshot=body.snapshot,
                    is_greenfield=body.is_greenfield,
                    seed_stable_pages=body.seed_stable_pages,
                    report_id=body.report_id,
                ):
                    yield _sse_format(event)
        finally:
            _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
            _state.last_activity_at = datetime.now(timezone.utc)

    return StreamingResponse(gen(), media_type="text/event-stream")
