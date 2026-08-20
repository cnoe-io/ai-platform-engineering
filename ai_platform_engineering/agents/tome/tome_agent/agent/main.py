"""ttt-agent FastAPI app — the entrypoint baked into Dockerfile.agent.

Endpoints:

- `POST /chat` — body `ChatRequest`, response `text/event-stream` of
  `ChatEventPayload`s. SDK chat loop, snapshot-driven.
- `POST /ingest` — body `IngestRequest`, response `text/event-stream` of
  `IngestEventPayload`s. SDK ingest loop, snapshot-driven.
- `POST /model-check` — body `ModelCheckRequest`, response `ModelCheckResponse`.
  Toolless one-shot smoke test for a candidate model id (admin UI Test button).
- `POST /presentation` — source-grounded, toolless structured deck generation.
- `POST /presentation/stream` — streamed deck generation followed by a validated deck.
- `POST /presentation/requirements` — source-grounded presentation brief AI Assist.
- `POST /presentation/requirements/stream` — streamed AI Assist output and validated brief.
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
from typing import Literal

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import StreamingResponse

from tome_agent.agent import http_client, workspace
from tome_agent.agent.chat import stream_chat
from tome_agent.agent.compact import stream_compaction
from tome_agent.agent.drift import build_drift_report
from tome_agent.agent.evaluator import evaluate_artifact, evaluator_prompt_contract
from tome_agent.agent.ingestor import expected_template_pages, stream_ingest
from tome_agent.agent.presentation import (
    generate_presentation,
    stream_presentation,
    stream_presentation_requirements,
    suggest_presentation_requirements,
)
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
    PresentationRequest,
    PresentationRequirementsRequest,
    PresentationRequirementsResponse,
    PresentationResponse,
    TemplateDriftRequest,
    TemplateDriftResponse,
)
from tome_agent.reports import schema as report_schema

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


@app.post("/template-drift", response_model=TemplateDriftResponse)
async def template_drift_endpoint(body: TemplateDriftRequest) -> TemplateDriftResponse:
    """Check for template drift (#508): classify every page against the
    live template config (#507). Synchronous, read-only — no persist hook,
    no wiki tools, never writes anything. Content-level checks only run for
    version-behind candidates (see `drift.check_content_drift`)."""
    if not _state.ready:
        raise HTTPException(503, "agent not ready")
    fetched = await asyncio.to_thread(http_client.fetch_page_templates)
    templates, versions = fetched if fetched is not None else (None, {})
    report_schema.set_template_overrides(templates, versions)
    expected = expected_template_pages(body.snapshot)
    report = await build_drift_report(body.pages, expected, model=body.model)
    return TemplateDriftResponse(
        pages=[
            {
                "path": p.path,
                "status": p.status,
                "title": p.title,
                "template_scope": p.template_scope,
                "template_path": p.template_path,
                "seeded_version": p.seeded_version,
                "live_version": p.live_version,
                "drifted": p.drifted,
                "reason": p.reason,
            }
            for p in report
        ]
    )


@app.post("/presentation", response_model=PresentationResponse)
async def presentation_endpoint(body: PresentationRequest) -> PresentationResponse:
    """Generate or revise a toolless, source-grounded presentation deck."""
    if not _state.ready:
        raise HTTPException(503, "agent not ready")
    _state.in_flight_runs += 1
    _state.last_activity_at = datetime.now(UTC)
    run_start = run_started()
    success = False
    try:
        result = await generate_presentation(body)
        success = True
        return result
    except (TypeError, ValueError) as exc:
        raise HTTPException(502, str(exc)) from exc
    finally:
        _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
        _state.last_activity_at = datetime.now(UTC)
        run_finished("presentation", run_start, success)


@app.post("/presentation/stream")
async def presentation_stream_endpoint(body: PresentationRequest) -> StreamingResponse:
    """Stream raw deck JSON for visibility, then the validated editable deck."""
    if not _state.ready:
        raise HTTPException(503, "agent not ready")

    async def gen() -> AsyncIterator[bytes]:
        _state.in_flight_runs += 1
        _state.last_activity_at = datetime.now(UTC)
        run_start = run_started()
        success = False
        event_iterator = stream_presentation(body).__aiter__()
        next_event: asyncio.Task[tuple[str, dict[str, object]]] | None = None
        try:
            action = "Revising" if body.existing_deck is not None else "Generating"
            yield _sse_message(
                "status",
                {"message": f"{action} a deck from {len(body.sources)} wiki source(s)…"},
            )
            heartbeat_count = 0
            next_event = asyncio.create_task(anext(event_iterator))
            while True:
                done, _ = await asyncio.wait({next_event}, timeout=10)
                if not done:
                    heartbeat_count += 1
                    verb = "revising" if body.existing_deck is not None else "building"
                    yield _sse_message(
                        "status",
                        {
                            "message": (
                                f"Still {verb} the deck… "
                                f"({heartbeat_count * 10}s elapsed)"
                            )
                        },
                    )
                    continue
                try:
                    event_type, data = next_event.result()
                except StopAsyncIteration:
                    break
                yield _sse_message(event_type, data)
                if event_type == "complete":
                    success = True
                next_event = asyncio.create_task(anext(event_iterator))
        except (TypeError, ValueError) as exc:
            yield _sse_message("error", {"message": str(exc)})
        finally:
            if next_event is not None and not next_event.done():
                next_event.cancel()
                try:
                    await next_event
                except asyncio.CancelledError:
                    pass
            await event_iterator.aclose()
            _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
            _state.last_activity_at = datetime.now(UTC)
            run_finished("presentation", run_start, success)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@app.post(
    "/presentation/requirements",
    response_model=PresentationRequirementsResponse,
)
async def presentation_requirements_endpoint(
    body: PresentationRequirementsRequest,
) -> PresentationRequirementsResponse:
    """Use the presentation model to fill an editable brief from wiki sources."""
    if not _state.ready:
        raise HTTPException(503, "agent not ready")
    _state.in_flight_runs += 1
    _state.last_activity_at = datetime.now(UTC)
    run_start = run_started()
    success = False
    try:
        result = await suggest_presentation_requirements(body)
        success = True
        return result
    except (TypeError, ValueError) as exc:
        raise HTTPException(502, str(exc)) from exc
    finally:
        _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
        _state.last_activity_at = datetime.now(UTC)
        run_finished("presentation_requirements", run_start, success)


@app.post("/presentation/requirements/stream")
async def presentation_requirements_stream_endpoint(
    body: PresentationRequirementsRequest,
) -> StreamingResponse:
    """Stream raw model text for visibility, then the validated editable brief."""
    if not _state.ready:
        raise HTTPException(503, "agent not ready")

    async def gen() -> AsyncIterator[bytes]:
        _state.in_flight_runs += 1
        _state.last_activity_at = datetime.now(UTC)
        run_start = run_started()
        success = False
        try:
            yield _sse_message(
                "status",
                {"message": f"Reviewing {len(body.sources)} selected wiki source(s)…"},
            )
            async for event_type, data in stream_presentation_requirements(body):
                yield _sse_message(event_type, data)
                if event_type == "complete":
                    success = True
        except (TypeError, ValueError) as exc:
            yield _sse_message("error", {"message": str(exc)})
        finally:
            _state.in_flight_runs = max(0, _state.in_flight_runs - 1)
            _state.last_activity_at = datetime.now(UTC)
            run_finished("presentation_requirements", run_start, success)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


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
async def evaluator_prompt_endpoint(
    mode: Literal["quick", "deep"] = "deep",
) -> EvaluatorPromptContract:
    """Expose the versioned evaluator prompt contract for immutable run snapshots."""
    if not _state.ready:
        raise HTTPException(503, "agent not ready")
    return evaluator_prompt_contract(mode)


# ---------- chat ----------


def _sse_format(event: ChatEventPayload | IngestEventPayload) -> bytes:
    """Render a typed event as SSE wire format. The `event:` line carries
    the payload type so the backend's proxy can dispatch without parsing
    the JSON body."""
    payload = json.dumps(event.data)
    return f"event: {event.type}\ndata: {payload}\n\n".encode()


def _sse_message(event_type: str, data: dict) -> bytes:
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n".encode()


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
                actor_email=body.actor_email,
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
                    actor_email=body.actor_email,
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
