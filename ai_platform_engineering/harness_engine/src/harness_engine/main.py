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

from harness_engine.adapters import AgentCoreAdapter
from harness_engine.config import Settings
from harness_engine.coordinator import AgentHarnessNotConfiguredError, RunCoordinator
from harness_engine.models import (
    TERMINAL_RUN_STATUSES,
    AgentHarnessConfig,
    CreateRunRequest,
    EventPage,
    PutAgentHarnessRequest,
    RunRecord,
)
from harness_engine.repository import (
    InMemoryRunRepository,
    MongoRunRepository,
    RevisionConflictError,
    RunRepository,
)


def _repository(settings: Settings) -> RunRepository:
    if settings.storage_backend == "mongodb":
        return MongoRunRepository(settings.mongodb_uri, settings.mongodb_database, settings.event_retention_seconds)
    return InMemoryRunRepository()


def create_app(
    *,
    settings: Settings | None = None,
    repository: RunRepository | None = None,
    adapter: AgentCoreAdapter | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings()
    resolved_repository = repository or _repository(resolved_settings)
    resolved_adapter = adapter or AgentCoreAdapter(resolved_settings)
    coordinator = RunCoordinator(
        resolved_repository,
        {"agentcore": resolved_adapter},
        resolved_settings.internal_token.encode(),
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await resolved_repository.initialize()
        yield
        await coordinator.shutdown()
        await resolved_repository.close()

    app = FastAPI(title="CAIPE Harness Engine", version="0.1.0", lifespan=lifespan)
    app.state.settings = resolved_settings
    app.state.repository = resolved_repository
    app.state.coordinator = coordinator

    async def caller_subject(
        authorization: Annotated[str | None, Header()] = None,
        x_harness_engine_subject: Annotated[str | None, Header()] = None,
    ) -> str:
        expected = f"Bearer {resolved_settings.internal_token}"
        if not authorization or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid internal service credential")
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
        aliases = resolved_adapter.configured_aliases
        return {
            "success": True,
            "data": {
                "contract_version": 1,
                "harnesses": [
                    {
                        "id": "agentcore",
                        "display_name": "Amazon Bedrock AgentCore",
                        "execution_mode": "provider_managed",
                        "availability": "available" if aliases else "misconfigured",
                        "certification": "experimental",
                        "runtime_aliases": aliases,
                        "capabilities": {
                            "streaming": "native",
                            "thread_persistence": "native",
                            "session_isolation": "native",
                            "reconnect_replay": "engine",
                        },
                    }
                ],
            },
        }

    @app.get("/api/v1/agents/{agent_id}/harness")
    async def get_agent_harness(
        agent_id: str, _: str = Depends(caller_subject)
    ) -> dict[str, object]:
        config = await resolved_repository.get_agent_config(agent_id)
        if not config:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Harness overlay not found")
        return {"success": True, "data": config}

    @app.put("/api/v1/agents/{agent_id}/harness")
    async def put_agent_harness(
        agent_id: str,
        body: PutAgentHarnessRequest,
        _: str = Depends(caller_subject),
    ) -> dict[str, object]:
        if body.runtime_alias not in resolved_adapter.configured_aliases:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Runtime alias is not configured")
        config = AgentHarnessConfig(
            agent_id=agent_id,
            harness_id=body.harness_id,
            runtime_alias=body.runtime_alias,
            enabled=body.enabled,
        )
        try:
            stored = await resolved_repository.put_agent_config(config, body.expected_revision)
        except RevisionConflictError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, "Harness overlay revision conflict") from exc
        return {"success": True, "data": stored}

    @app.delete("/api/v1/agents/{agent_id}/harness")
    async def delete_agent_harness(
        agent_id: str, _: str = Depends(caller_subject)
    ) -> dict[str, object]:
        return {
            "success": True,
            "data": {"agent_id": agent_id, "deleted": await resolved_repository.delete_agent_config(agent_id)},
        }

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
            and re.fullmatch(r"00-[0-9a-fA-F]{32}-[0-9a-fA-F]{16}-0[01]", incoming_traceparent)
            else None
        )
        try:
            run = await coordinator.start_run(body, subject, traceparent)
        except AgentHarnessNotConfiguredError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, "Agent has no runnable harness overlay") from exc
        return {"success": True, "data": run}

    @app.get("/api/v1/runs/{run_id}")
    async def get_run(
        run_id: str, subject: str = Depends(caller_subject)
    ) -> dict[str, object]:
        return {"success": True, "data": ensure_owner(await resolved_repository.get_run(run_id), subject)}

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
        page = EventPage(run=refreshed, events=events, next_cursor=events[-1].sequence if events else after)
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
                    yield f"id: {event.sequence}\nevent: {event.event_type}\ndata: {json.dumps(event.data)}\n\n"
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
