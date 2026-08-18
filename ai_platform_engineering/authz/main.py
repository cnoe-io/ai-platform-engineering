"""Standalone CAIPE authorization service process."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from typing import AsyncIterator
from uuid import uuid4

import grpc
import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from ai_platform_engineering.authz.api.ext_authz import ExtAuthzService, add_to_server
from ai_platform_engineering.authz.api.http import create_decision_router
from ai_platform_engineering.authz.api.inspection import create_inspection_router
from ai_platform_engineering.authz.api.policy import create_policy_router
from ai_platform_engineering.authz.audit.events import revision_event
from ai_platform_engineering.authz.audit.outbox import AuditOutbox
from ai_platform_engineering.authz.audit.publisher import AuditPublisher
from ai_platform_engineering.authz.config import Settings
from ai_platform_engineering.authz.core.decision import DecisionEngine
from ai_platform_engineering.authz.metrics import OUTBOX_BACKLOG, ROLLOUT_REVISION
from ai_platform_engineering.authz.policy.repository import (
    MongoPolicyRepository,
    PolicyRepository,
)
from ai_platform_engineering.authz.providers.openfga import OpenFgaProvider

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    *,
    provider: OpenFgaProvider | None = None,
    repository: PolicyRepository | None = None,
    outbox: AuditOutbox | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.validate()
    provider = provider or OpenFgaProvider(
        base_url=settings.openfga_url,
        store_name=settings.openfga_store_name,
        store_id=settings.openfga_store_id,
        authorization_model_id=settings.openfga_model_id,
        expected_model_sha256=settings.openfga_model_sha256,
        timeout_seconds=settings.provider_timeout_seconds,
        max_concurrency=settings.decision_concurrency,
    )
    repository = repository or MongoPolicyRepository(settings.mongo_url, settings.mongo_database)
    outbox = outbox or AuditOutbox(
        settings.audit_outbox_path,
        capacity=settings.audit_outbox_capacity,
    )
    rollout = settings.rollout()
    engine = DecisionEngine(
        provider,
        timeout_seconds=settings.provider_timeout_seconds,
        max_concurrency=settings.decision_concurrency,
        outbox=outbox,
        strict_audit_allows=settings.audit_strict_allows,
        subject_salt=settings.audit_subject_salt,
        rollout_revision=rollout.revision,
    )
    publisher = AuditPublisher(outbox, audit_service_url=settings.audit_service_url)
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        grpc_server = grpc.aio.server()
        add_to_server(grpc_server, ExtAuthzService(engine, settings))
        grpc_server.add_insecure_port(settings.grpc_bind)
        await outbox.initialize()
        await outbox.append(
            revision_event(
                correlation_id=str(uuid4()),
                revision=rollout.revision,
                default_mode=rollout.default_mode.value,
                scopes=[
                    {
                        "surface": scope.surface,
                        "resource_type": scope.resource_type,
                        "action": scope.action,
                        "exact_resources": list(scope.exact_resources),
                        "subject_types": list(scope.subject_types),
                        "mode": scope.mode.value,
                        "canary_percent": scope.canary_percent,
                        "expression_mode": scope.expression_mode,
                        "owner_present": bool(scope.owner),
                    }
                    for scope in rollout.scopes
                ],
            )
        )
        if isinstance(repository, MongoPolicyRepository):
            await repository.initialize()
        await grpc_server.start()
        publisher_task = asyncio.create_task(publisher.run(), name="authz-audit-publisher")
        app.state.grpc_ready = True
        try:
            yield
        finally:
            app.state.grpc_ready = False
            await publisher.stop()
            publisher_task.cancel()
            with suppress(asyncio.CancelledError):
                await publisher_task
            await grpc_server.stop(grace=5)
            await provider.close()

    app = FastAPI(
        title="CAIPE Authorization Service",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.provider = provider
    app.state.repository = repository
    app.state.outbox = outbox
    app.state.engine = engine
    app.state.grpc_ready = False

    @app.middleware("http")
    async def correlation(request: Request, call_next):
        request.state.correlation_id = request.headers.get("x-correlation-id") or str(uuid4())
        response = await call_next(request)
        response.headers["x-correlation-id"] = request.state.correlation_id
        return response

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz(request: Request) -> dict[str, object]:
        provider_ready = await provider.ready()
        outbox_size = await outbox.size()
        OUTBOX_BACKLOG.set(outbox_size)
        ROLLOUT_REVISION.labels(revision=rollout.revision).set(1)
        if not provider_ready or not request.app.state.grpc_ready:
            raise HTTPException(status_code=503, detail="authorization service is not ready")
        return {
            "status": "ready",
            "http": True,
            "grpc": request.app.state.grpc_ready,
            "provider": provider_ready,
            "rollout_revision": rollout.revision,
            "default_mode": rollout.default_mode.value,
            "audit_outbox": outbox_size,
        }

    @app.get("/metrics")
    async def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    app.include_router(create_decision_router(engine, settings))
    app.include_router(create_policy_router(provider, repository, outbox, settings))
    app.include_router(create_inspection_router(provider, engine, repository, settings))
    return app


def run() -> None:
    settings = Settings.from_env()
    uvicorn.run(
        create_app(settings),
        host=settings.http_bind,
        port=settings.http_port,
        log_level="info",
    )


if __name__ == "__main__":
    run()
