"""ttt-agent FastAPI app — the entrypoint baked into Dockerfile.agent.

Endpoints:

- `POST /chat` — body `ChatRequest`, response `text/event-stream` of
  `ChatEventPayload`s. SDK chat loop, snapshot-driven.
- `POST /ingest` — body `IngestRequest`, response `text/event-stream` of
  `IngestEventPayload`s. SDK ingest loop, snapshot-driven.
- `POST /model-check` — body `ModelCheckRequest`, response `ModelCheckResponse`.
  Toolless one-shot smoke test for a candidate model id (admin UI Test button).
- `GET /healthz` — process is alive. Always 200 once the app has started.
- `GET /readyz` — agent is ready to serve. 200 if the ttt config import
  succeeded and the snapshot endpoint is reachable; 503 otherwise.
- `GET /metrics` — Prometheus exposition (see `tome_agent.metrics`), served by
  `PrometheusHTTPMiddleware` rather than a route handler.

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
from datetime import UTC, datetime

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import StreamingResponse

from tome_agent.agent import http_client, workspace
from tome_agent.agent.chat import stream_chat
from tome_agent.agent.compact import stream_compaction
from tome_agent.agent.evaluator import evaluate_artifact, evaluator_prompt_contract
from tome_agent.agent.ingestor import stream_ingest
from tome_agent.agent.synthesize import stream_synthesis
from tome_agent.config import settings
from tome_agent.metrics import (
    PrometheusHTTPMiddleware,
    metrics,
    run_finished,
    run_started,
)
from tome_agent.orchestrator.contract import (
    ArtifactEvaluationRequest,
    ArtifactEvaluationResponse,
    ChatEventPayload,
    ChatRequest,
    EvaluatorPromptContract,
    HealthResponse,
    IngestEventPayload,
    IngestRequest,
    ModelCheckRequest,
    ModelCheckResponse,
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


_state = _AgentState(started_at=datetime.now(UTC))
metrics.uptime_seconds.set_function(
    lambda: (datetime.now(UTC) - _state.started_at).total_seconds()
)


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
app.add_middleware(PrometheusHTTPMiddleware)


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


# `/metrics` itself is served by PrometheusHTTPMiddleware (registered above),
# not a route handler — see tome_agent.metrics.PrometheusHTTPMiddleware.


# ---------- model-check ----------


@app.post("/model-check", response_model=ModelCheckResponse)
async def model_check_endpoint(body: ModelCheckRequest) -> ModelCheckResponse:
    """Smoke-test a candidate model id: the admin UI's model-config Test
    button calls this (via the backend proxy) before an id is saved. No
    project scope, no tools, no persist hook — a single toolless turn that
    proves the id resolves through the container's ANTHROPIC_BASE_URL/auth,
    the same path a real ingest/chat run would use."""
    if not _state.ready:
        raise HTTPException(503, "agent not ready")
    options = ClaudeAgentOptions(
        model=body.model,
        max_turns=1,
        allowed_tools=[],
        system_prompt="Reply with the single word: ok",
    )
    try:
        async for message in query(prompt="ping", options=options):
            if isinstance(message, ResultMessage):
                if getattr(message, "is_error", False):
                    # The provider's actual rejection reason (e.g. "Invalid
                    # model name") lands in `result`, not `errors` — the SDK
                    # only populates the latter for a narrower error class.
                    detail = getattr(message, "result", None) or message.subtype
                    return ModelCheckResponse(ok=False, error=str(detail))
                return ModelCheckResponse(ok=True)
    except Exception as e:  # noqa: BLE001 — surfaced to the admin UI verbatim
        return ModelCheckResponse(ok=False, error=f"{type(e).__name__}: {e}")
    return ModelCheckResponse(ok=False, error="No result from model")


@app.post("/evaluate", response_model=ArtifactEvaluationResponse)
async def evaluate_endpoint(
    body: ArtifactEvaluationRequest,
) -> ArtifactEvaluationResponse:
    """Evaluate one blinded candidate only against its frozen evidence."""
    if not _state.ready:
        raise HTTPException(503, "agent not ready")
    try:
        return await evaluate_artifact(body)
    except ValueError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.get("/evaluate/prompt", response_model=EvaluatorPromptContract)
async def evaluator_prompt_endpoint() -> EvaluatorPromptContract:
    """Expose the versioned evaluator prompt contract for immutable run snapshots."""
    if not _state.ready:
        raise HTTPException(503, "agent not ready")
    return evaluator_prompt_contract()


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
        http_client.set_active_actor_sub(body.actor_sub)
        _state.in_flight_runs += 1
        _state.last_activity_at = datetime.now(UTC)
        run_start = run_started()
        success = False
        try:
            async for event in stream_chat(
                user_message=body.message,
                sdk_session_id=body.sdk_session_id,
                snapshot=body.snapshot,
                stable_pages=body.stable_pages,
                is_compact=body.is_compact,
            ):
                yield _sse_format(event)
            success = True
        finally:
            _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
            _state.last_activity_at = datetime.now(UTC)
            run_finished("chat", run_start, success)

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
        http_client.set_active_experiment(
            body.experiment.experiment_id if body.experiment else None,
            body.experiment.artifact_id if body.experiment else None,
        )
        _state.in_flight_runs += 1
        _state.last_activity_at = datetime.now(UTC)
        run_start = run_started()
        success = False
        try:
            # Hold the per-project lock for the whole run (serializing it
            # against other ingests and the periodic sync), and refresh the
            # on-disk copy from the source of truth first so the ingest edits
            # the latest committed state.
            async with workspace.project_lock(pid):
                if body.experiment:
                    await workspace.materialize_project_pages(
                        pid, body.experiment.frozen_pages
                    )
                else:
                    await workspace.refresh_project(pid)
                async for event in stream_ingest(
                    run_id=body.run_id,
                    seed=body.seed,
                    connector_data=body.connector_data,
                    snapshot=body.snapshot,
                    is_greenfield=body.is_greenfield,
                    seed_stable_pages=body.seed_stable_pages,
                    report_id=body.report_id,
                    quick=body.mode == "quick" and not body.is_greenfield,
                    experiment=body.experiment,
                ):
                    yield _sse_format(event)
            success = True
        finally:
            http_client.set_active_experiment(None, None)
            _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
            _state.last_activity_at = datetime.now(UTC)
            run_finished("ingest", run_start, success)

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
        http_client.set_active_experiment(
            body.experiment.experiment_id if body.experiment else None,
            body.experiment.artifact_id if body.experiment else None,
        )
        _state.in_flight_runs += 1
        _state.last_activity_at = datetime.now(UTC)
        run_start = run_started()
        success = False
        try:
            async with workspace.project_lock(pid):
                if body.experiment:
                    await workspace.materialize_project_pages(
                        pid, body.experiment.frozen_pages
                    )
                else:
                    await workspace.refresh_project(pid)
                async for event in stream_compaction(
                    run_id=body.run_id,
                    seed=body.seed,
                    snapshot=body.snapshot,
                    report_id=body.report_id,
                    experiment=body.experiment,
                ):
                    yield _sse_format(event)
            success = True
        finally:
            http_client.set_active_experiment(None, None)
            _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
            _state.last_activity_at = datetime.now(UTC)
            run_finished("compact", run_start, success)

    return StreamingResponse(gen(), media_type="text/event-stream")


# ---------- BHAG synthesis (cross-project synthesis) ----------


@app.post("/synthesize")
async def synthesize_endpoint(body: IngestRequest):
    """BHAG/Area synthesis from tagged child wikis and direct sources."""
    if not _state.ready:
        raise HTTPException(503, "agent not ready")

    async def gen() -> AsyncIterator[bytes]:
        pid = body.snapshot.project_id
        http_client.set_active_project_id(pid)
        http_client.set_active_credentials(body.credentials)
        http_client.set_active_experiment(
            body.experiment.experiment_id if body.experiment else None,
            body.experiment.artifact_id if body.experiment else None,
        )
        _state.in_flight_runs += 1
        _state.last_activity_at = datetime.now(UTC)
        run_start = run_started()
        success = False
        try:
            async with workspace.project_lock(pid):
                if body.experiment:
                    await workspace.materialize_project_pages(
                        pid, body.experiment.frozen_pages
                    )
                else:
                    await workspace.refresh_project(pid)
                # Refresh each child's on-disk wiki from the source of truth so
                # the synthesis reads the latest committed state. Each under its
                # own lock.
                for child in body.snapshot.child_projects:
                    async with workspace.project_lock(child.project_id):
                        if body.experiment:
                            await workspace.materialize_project_pages(
                                child.project_id,
                                body.experiment.frozen_child_pages.get(
                                    child.project_id, {}
                                ),
                            )
                        else:
                            await workspace.refresh_project(child.project_id)
                async for event in stream_synthesis(
                    run_id=body.run_id,
                    seed=body.seed,
                    connector_data=body.connector_data,
                    snapshot=body.snapshot,
                    is_greenfield=body.is_greenfield,
                    seed_stable_pages=body.seed_stable_pages,
                    report_id=body.report_id,
                    experiment=body.experiment,
                ):
                    yield _sse_format(event)
            success = True
        finally:
            http_client.set_active_experiment(None, None)
            _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
            _state.last_activity_at = datetime.now(UTC)
            run_finished("synthesize", run_start, success)

    return StreamingResponse(gen(), media_type="text/event-stream")
