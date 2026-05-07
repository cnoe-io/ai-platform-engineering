# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Configuration for the Webex inbound bridge.

All knobs live as environment variables so the bot is straightforward
to deploy under docker-compose / Helm with no code changes between
environments. Pydantic-settings parses them at startup; missing
required fields surface as a clear error rather than mysterious 500s
later.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, AnyHttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Webex bot configuration.

    Required:
        WEBEX_BOT_TOKEN: bot access token (starts with ``ZGVm...``).
            Source: developer.webex.com -> My Webex Apps -> bot.
        WEBEX_BOT_PUBLIC_URL: externally reachable base URL of THIS
            service (e.g. ``https://abcd.ngrok-free.app``). Webex
            POSTs message-created events to ``<public_url>/webex/events``
            so the URL must terminate at this FastAPI app. Localhost
            does NOT work -- Webex's webhook delivery happens from
            their cloud.
        AUTONOMOUS_AGENTS_URL: URL of the autonomous-agents service
            (e.g. ``http://autonomous-agents:8002``). The bot calls
            ``<base>/api/v1/hooks/<task_id>/follow-up`` and queries
            the thread map collection in MongoDB it shares.
        MONGODB_URI: same Mongo the autonomous-agents service writes
            the thread map into. We read-only query it to resolve a
            Webex parentId to (task_id, run_id).

    Defaulted (override only when the autonomous-agents service was
    customised away from the same defaults):
        MONGODB_DATABASE: database name (default ``caipe``).

    Optional:
        WEBEX_WEBHOOK_SECRET: HMAC secret used to sign incoming Webex
            webhook events. When configured, ``X-Spark-Signature``
            must validate or the request is rejected. Strongly
            recommended in production.
        WEBHOOK_SECRET: shared HMAC secret with autonomous-agents so
            the bot can sign its outbound POST to /follow-up the same
            way the original webhook would. Optional -- when unset the
            follow-up route is also unsigned and we send unsigned.
        MONGODB_WEBEX_THREAD_MAP_COLLECTION: collection name override.
            Must match the autonomous-agents Settings of the same name.
    """

    webex_bot_token: str = Field(...)
    webex_bot_public_url: AnyHttpUrl = Field(...)
    autonomous_agents_url: AnyHttpUrl = Field(...)

    # Mongo (read-only access to the shared thread map collection).
    # Defaults match the autonomous-agents service so a stock dev
    # stack just works; override either to point at a different DB.
    mongodb_uri: str = Field(...)
    mongodb_database: str = "caipe"
    mongodb_webex_thread_map_collection: str = "webex_thread_map"

    # Optional security
    webex_webhook_secret: str | None = None
    webhook_secret: str | None = None

    # Service knobs
    host: str = "0.0.0.0"  # nosec B104 - intentional for container deployment
    port: int = 8003
    log_level: str = "INFO"

    # Webex API base. Overridable for testing / future tenant migrations.
    webex_api_base: AnyHttpUrl = "https://webexapis.com/v1"  # type: ignore[assignment]

    # HTTP client knobs -- generous defaults so a slow Webex round-trip
    # doesn't drop a legitimate event.
    http_timeout_seconds: float = 15.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings singleton.

    ``lru_cache`` makes this O(1) on every call after the first parse;
    tests that need to override config reset it via
    ``get_settings.cache_clear()``.
    """
    return Settings()  # type: ignore[call-arg]
