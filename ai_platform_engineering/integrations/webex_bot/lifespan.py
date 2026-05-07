# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""FastAPI lifespan + AppState container for the Webex inbound bridge.

Split out of ``app.py`` so route definitions stay focused on HTTP
concerns and so this module is the single place that imports motor
(the production-only Mongo driver). Tests for the dispatcher and
webhook registration helpers don't import this module and therefore
never need motor on PYTHONPATH.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient

from .config import Settings, get_settings
from .thread_store import WebexThreadStore
from .webex_client import WebexClient
from .webhook_setup import ensure_webhook_registered


logger = logging.getLogger(__name__)


class AppState:
    """Resources held for the lifetime of the FastAPI app.

    Stashed on ``app.state`` rather than in module-level globals so a
    single test process can spin up multiple isolated apps.
    """

    settings: Settings
    webex: WebexClient
    thread_store: WebexThreadStore
    http: httpx.AsyncClient
    bot_person_id: str
    # ``motor.motor_asyncio.AsyncIOMotorClient`` in production, but
    # we keep the type loose so unit tests can substitute a fake
    # without paying motor's import cost.
    mongo_client: object | None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Wire up dependencies and register the Webex webhook."""
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper())

    webex = WebexClient(
        token=settings.webex_bot_token,
        base_url=str(settings.webex_api_base),
        timeout=settings.http_timeout_seconds,
    )

    me = await webex.get_me()
    bot_person_id = me.get("id")
    if not bot_person_id:
        # Without our own personId we cannot enforce the loop guard,
        # so fail closed rather than risk an infinite trigger loop.
        await webex.aclose()
        raise RuntimeError(
            "Webex /people/me did not return an id; check WEBEX_BOT_TOKEN"
        )
    logger.info("Webex bot identified as personId=%s", bot_person_id)

    # Mongo (read-only)
    mongo_client = AsyncIOMotorClient(settings.mongodb_uri)
    collection = (
        mongo_client[settings.mongodb_database][
            settings.mongodb_webex_thread_map_collection
        ]
    )
    thread_store = WebexThreadStore(collection)

    http = httpx.AsyncClient(timeout=settings.http_timeout_seconds)

    target_url = f"{str(settings.webex_bot_public_url).rstrip('/')}/webex/events"
    try:
        await ensure_webhook_registered(
            webex,
            target_url=target_url,
            secret=settings.webex_webhook_secret,
        )
    except httpx.HTTPError as exc:
        # Don't crash the bridge if registration fails -- operators
        # may want to register webhooks manually, or the Webex API
        # may be flaky during startup. We log loudly and continue;
        # the /webex/events route still works as long as something
        # else has registered the webhook for us.
        logger.error(
            "Webex webhook registration failed (%s); continuing without "
            "auto-registration. Existing webhooks (if any) will keep "
            "delivering events.",
            exc,
        )

    state = AppState()
    state.settings = settings
    state.webex = webex
    state.thread_store = thread_store
    state.http = http
    state.bot_person_id = bot_person_id
    state.mongo_client = mongo_client
    app.state.bridge = state

    try:
        yield
    finally:
        await webex.aclose()
        await http.aclose()
        mongo_client.close()
