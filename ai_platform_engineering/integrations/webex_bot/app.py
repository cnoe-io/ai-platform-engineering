# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Webex inbound bridge -- FastAPI service.

End-to-end flow on receipt of a Webex ``messages.created`` event:

    1. ``POST /webex/events`` is called by Webex.
    2. We verify ``X-Spark-Signature`` (HMAC-SHA1 of body) when a
       webhook secret is configured.
    3. We fetch the message body via Webex API (events carry only
       the message id by design).
    4. ``dispatch_message_event`` decides: drop or forward.
    5. If FORWARD, we POST a follow-up to the autonomous-agents
       service which re-fires the original task with the operator's
       reply as additional context.

Webhook registration is idempotent and runs on application startup
so a fresh deploy doesn't require any manual ``curl /webhooks``
ceremony. The registration helper itself lives in
:mod:`webex_bot.webhook_setup`; the lifespan that wires up Mongo,
httpx, and the Webex client lives in :mod:`webex_bot.lifespan`.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException, Request

from .config import get_settings
from .dispatcher import (
    Verdict,
    dispatch_message_event,
    forward_followup,
    verify_webex_signature,
)
from .lifespan import AppState, lifespan


logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """Build the FastAPI app. Factory pattern for testability."""

    app = FastAPI(
        title="CAIPE Webex Inbound Bridge",
        version="0.1.0",
        lifespan=lifespan,
    )

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        # Intentionally cheap: doesn't touch Webex or Mongo so it
        # can be used as a k8s liveness probe without rate-limiting
        # external services.
        return {"status": "ok"}

    @app.post("/webex/events")
    async def webex_events(
        request: Request,
        x_spark_signature: str | None = Header(None, alias="X-Spark-Signature"),
    ) -> dict[str, Any]:
        """Receive a Webex webhook delivery."""
        bridge: AppState = request.app.state.bridge
        body = await request.body()

        if not verify_webex_signature(
            secret=bridge.settings.webex_webhook_secret,
            body=body,
            signature_header=x_spark_signature,
        ):
            # Don't echo expected vs got; just refuse.
            logger.warning(
                "Rejecting Webex event with bad/missing X-Spark-Signature"
            )
            raise HTTPException(status_code=401, detail="invalid signature")

        try:
            event = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="invalid JSON body")

        # Webex sometimes sends a confirmation/test ping with no
        # ``data`` -- treat that as a no-op rather than an error so
        # operators see green health checks during setup.
        if not isinstance(event, dict) or "data" not in event:
            return {"status": "ignored", "reason": "no event data"}

        try:
            result = await dispatch_message_event(
                event,
                bot_person_id=bridge.bot_person_id,
                fetch_message=bridge.webex.get_message,
                lookup_thread=bridge.thread_store.lookup,
            )
        except httpx.HTTPError as exc:
            # Failed to fetch the message body. Webex retries on 5xx,
            # so we return 502 and let them try again.
            logger.warning("Webex API error fetching message: %s", exc)
            raise HTTPException(status_code=502, detail="webex api error")

        if result.verdict is not Verdict.FORWARD:
            logger.info(
                "Dropping Webex event: verdict=%s reason=%s",
                result.verdict.value,
                result.reason,
            )
            return {"status": "ignored", "verdict": result.verdict.value}

        assert result.payload is not None  # narrow for the type checker
        try:
            response = await forward_followup(
                result.payload,
                autonomous_agents_url=str(bridge.settings.autonomous_agents_url),
                http_client=bridge.http,
                webhook_secret=bridge.settings.webhook_secret,
            )
        except httpx.HTTPError as exc:
            logger.error(
                "Failed to forward follow-up for task %s: %s",
                result.payload.task_id,
                exc,
            )
            raise HTTPException(
                status_code=502, detail="autonomous-agents unreachable"
            )

        if response.status_code >= 400:
            logger.warning(
                "Follow-up forward returned %s for task=%s parent_run=%s body=%s",
                response.status_code,
                result.payload.task_id,
                result.payload.parent_run_id,
                response.text[:300],
            )
            # Bubble the receiver's status so Webex's delivery dashboard
            # matches what really happened. We deliberately don't 200
            # here -- failed forwards should be retried.
            raise HTTPException(
                status_code=response.status_code,
                detail="follow-up forward failed",
            )

        logger.info(
            "Forwarded follow-up: task=%s parent_run=%s -> %s",
            result.payload.task_id,
            result.payload.parent_run_id,
            response.status_code,
        )
        return {
            "status": "forwarded",
            "task_id": result.payload.task_id,
            "parent_run_id": result.payload.parent_run_id,
        }

    return app


app = create_app()


def main() -> None:
    """Entry point for ``python -m webex_bot``.

    The package is exposed as the flat ``webex_bot`` name in the
    Docker image (``build/Dockerfile.webex-bot`` puts the source
    under ``/app/webex_bot/`` and ``PYTHONPATH=/app``). Tests on a
    monorepo checkout use the same flat name via ``conftest.py``,
    so the import string here is environment-agnostic.
    """
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "webex_bot.app:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()
