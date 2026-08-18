"""Standalone Harness Engine FastAPI application."""

from __future__ import annotations

import hmac
import json
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from harness_engine.adapters import AgentCoreAdapter, ClaudeSDKAdapter
from harness_engine.adapters.base import HarnessAdapter
from harness_engine.brokers import DefaultPromptCompiler
from harness_engine.config import Settings
from harness_engine.coordinator import AgentNotRunnableError, RunCoordinator
from harness_engine.models import (
    TERMINAL_RUN_STATUSES,
    ClearAgentSessionRequest,
    CreateRunRequest,
    EventPage,
    RunRecord,
    SaveAgentRequest,
    ValidateAgentDraftRequest,
)
from harness_engine.registry import HarnessNotFoundError, HarnessRegistry
from harness_engine.repository import (
    InMemoryRunRepository,
    MongoRunRepository,
    RevisionConflictError,
    RunRepository,
)
from harness_engine.sessions import CAIPEAgentSessionManager


def _repository(settings: Settings) -> RunRepository:
    if settings.storage_backend == "mongodb":
        return MongoRunRepository(
            settings.mongodb_uri, settings.mongodb_database, settings.event_retention_seconds
        )
    return InMemoryRunRepository()


def create_app(
    *,
    settings: Settings | None = None,
    repository: RunRepository | None = None,
    adapters: list[HarnessAdapter] | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings()
    resolved_repository = repository or _repository(resolved_settings)
    resolved_adapters = adapters or [
        AgentCoreAdapter(resolved_settings),
        ClaudeSDKAdapter(resolved_settings),
    ]
    registry = HarnessRegistry(resolved_adapters)
    session_manager = CAIPEAgentSessionManager(
        resolved_repository,
        registry,
        resolved_settings.internal_token.encode(),
    )
    coordinator = RunCoordinator(
        resolved_repository,
        registry,
        session_manager,
        DefaultPromptCompiler(),
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await resolved_repository.initialize()
        yield
        await coordinator.shutdown()
        await resolved_repository.close()

    app = FastAPI(title="CAIPE Harness Engine", version="0.2.0", lifespan=lifespan)
    app.state.settings = resolved_settings
    app.state.repository = resolved_repository
    app.state.registry = registry
    app.state.session_manager = session_manager
    app.state.coordinator = coordinator

    async def caller_subject(
        authorization: Annotated[str | None, Header()] = None,
        x_harness_engine_subject: Annotated[str | None, Header()] = None,
    ) -> str:
        expected = f"Bearer {resolved_settings.internal_token}"
        if not authorization or not hmac.compare_digest(authorization, expected):
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "Invalid internal service credential"
            )
        if not x_harness_engine_subject:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing caller subject")
        return x_harness_engine_subject

    def ensure_owner(run: RunRecord | None, subject: str) -> RunRecord:
        if run is None or run.owner_subject != subject:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
        return run

    @app.get("/healthz")
    async def health() -> dict[str, object]:
        return {"status": "ok", "service": "harness-engine"}

    @app.get("/api/v1/harnesses")
    async def catalog(_: str = Depends(caller_subject)) -> dict[str, object]:
        return {
            "success": True,
            "data": {
                "contract_version": 1,
                "catalog_revision": registry.catalog_revision,
                "harnesses": registry.catalog(),
            },
        }

    @app.post("/api/v1/agent-drafts/validate")
    async def validate_agent_draft(
        body: ValidateAgentDraftRequest,
        _: str = Depends(caller_subject),
    ) -> dict[str, object]:
        try:
            validation = registry.validate(body.blueprint, body.catalog_revision)
        except HarnessNotFoundError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown harness") from exc
        return {"success": True, "data": validation}

    @app.get("/api/v1/agents/{agent_id}")
    async def get_agent(agent_id: str, _: str = Depends(caller_subject)) -> dict[str, object]:
        record = await resolved_repository.get_agent(agent_id)
        version = await resolved_repository.get_agent_version(agent_id)
        if record is None or version is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Harness agent not found")
        return {"success": True, "data": {"record": record, "version": version}}

    @app.put("/api/v1/agents/{agent_id}")
    async def put_agent(
        agent_id: str,
        body: SaveAgentRequest,
        _: str = Depends(caller_subject),
    ) -> dict[str, object]:
        if body.blueprint.id != agent_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Agent path and blueprint IDs differ"
            )
        try:
            validation = registry.validate(body.blueprint, body.catalog_revision)
        except HarnessNotFoundError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown harness") from exc
        if not validation.valid:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                {"message": "Agent blueprint is invalid", "issues": validation.issues},
            )
        if body.config_fingerprint and body.config_fingerprint != validation.config_fingerprint:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Agent draft changed after server validation"
            )
        try:
            record, version = await resolved_repository.save_agent(
                validation.normalized_blueprint,
                validation.config_fingerprint,
                validation.catalog_revision,
                body.expected_revision,
            )
        except RevisionConflictError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, "Harness agent revision conflict") from exc
        return {"success": True, "data": {"record": record, "version": version}}

    @app.post("/api/v1/runs", status_code=status.HTTP_202_ACCEPTED)
    async def start_run(
        request: Request,
        body: CreateRunRequest,
        subject: str = Depends(caller_subject),
    ) -> dict[str, object]:
        incoming_traceparent = request.headers.get("traceparent")
        traceparent = (
            incoming_traceparent.lower()
            if incoming_traceparent
            and re.fullmatch(
                r"00-[0-9a-fA-F]{32}-[0-9a-fA-F]{16}-0[01]", incoming_traceparent
            )
            else None
        )
        try:
            run = await coordinator.start_run(body, subject, traceparent)
        except AgentNotRunnableError as exc:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Agent has no runnable harness version"
            ) from exc
        return {"success": True, "data": run}

    @app.post("/api/v1/sessions/clear")
    async def clear_session(
        body: ClearAgentSessionRequest,
        subject: str = Depends(caller_subject),
    ) -> dict[str, object]:
        result = await coordinator.clear_session(
            subject, body.agent_id, body.conversation_id
        )
        return {"success": True, "data": result}

    @app.get("/api/v1/runs/{run_id}")
    async def get_run(run_id: str, subject: str = Depends(caller_subject)) -> dict[str, object]:
        return {
            "success": True,
            "data": ensure_owner(await resolved_repository.get_run(run_id), subject),
        }

    @app.get("/api/v1/runs/{run_id}/events")
    async def get_events(
        run_id: str,
        subject: str = Depends(caller_subject),
        after: int = Query(0, ge=0),
        wait: float = Query(0.0, ge=0.0, le=30.0),
    ) -> dict[str, object]:
        ensure_owner(await resolved_repository.get_run(run_id), subject)
        events = await (
            resolved_repository.wait_for_events(run_id, after, wait)
            if wait > 0
            else resolved_repository.list_events(run_id, after)
        )
        refreshed = ensure_owner(await resolved_repository.get_run(run_id), subject)
        page = EventPage(
            run=refreshed,
            events=events,
            next_cursor=events[-1].sequence if events else after,
        )
        return {"success": True, "data": page}

    @app.get("/api/v1/runs/{run_id}/events/stream")
    async def stream_events(
        request: Request,
        run_id: str,
        subject: str = Depends(caller_subject),
        after: int = Query(0, ge=0),
    ) -> StreamingResponse:
        ensure_owner(await resolved_repository.get_run(run_id), subject)

        async def generate() -> AsyncIterator[str]:
            cursor = after
            while True:
                if await request.is_disconnected():
                    return
                events = await resolved_repository.wait_for_events(
                    run_id, cursor, resolved_settings.long_poll_seconds
                )
                for event in events:
                    cursor = event.sequence
                    yield (
                        f"id: {event.sequence}\nevent: {event.event_type}\n"
                        f"data: {json.dumps(event.data)}\n\n"
                    )
                run = await resolved_repository.get_run(run_id)
                if run and run.status in TERMINAL_RUN_STATUSES and cursor >= run.last_sequence:
                    return
                if not events:
                    yield ": keepalive\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )

    @app.delete("/api/v1/runs/{run_id}")
    async def cancel_run(
        run_id: str, subject: str = Depends(caller_subject)
    ) -> dict[str, object]:
        ensure_owner(await resolved_repository.get_run(run_id), subject)
        return {"success": True, "data": await coordinator.cancel(run_id)}

    return app


app = create_app()


if __name__ == "__main__":
    settings = Settings()
    uvicorn.run("harness_engine.main:app", host=settings.host, port=settings.port, reload=False)
