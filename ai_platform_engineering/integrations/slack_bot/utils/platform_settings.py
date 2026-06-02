# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Runtime reader for platform-wide settings stored in MongoDB.

The admin UI persists a small set of platform-wide settings in the
``platform_config`` singleton document (``_id: "platform_settings"``):

* ``default_agent_id`` — the platform default agent. Governs the Web UI
  *and* Slack (channel fallback + DMs). Set in Admin → Settings →
  Default Agent.
* ``slack_victorops_escalation_agent_id`` — the agent the Slack bot
  queries for on-call lookups when VictorOps escalation fires. Set in
  Admin → Integrations → Slack → Advanced.

Historically the Slack bot only read these from environment variables at
startup (``SLACK_INTEGRATION_DEFAULT_AGENT_ID`` etc.). This reader lets the
bot honor the values an admin saves in the UI at runtime, while keeping the
env/YAML values as a fallback so locked-down or UI-less deployments keep
working. Resolution is always **DB setting → env/YAML fallback**.

The reader is TTL-cached (default 60s) so hot paths (every DM, every
escalation) don't hit Mongo on each message. It degrades gracefully: if
Mongo is unconfigured or unreachable, lookups return ``None`` and callers
fall back to their env/YAML defaults.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import PyMongoError

logger = logging.getLogger("caipe.slack_bot.platform_settings")

PLATFORM_CONFIG_ID = "platform_settings"
DEFAULT_AGENT_FIELD = "default_agent_id"
VICTOROPS_AGENT_FIELD = "slack_victorops_escalation_agent_id"


class PlatformSettingsReader:
    """Read platform-wide settings from the ``platform_config`` collection.

    Values are cached for ``ttl_seconds`` to keep per-message lookups cheap.
    A missing Mongo configuration or a transient read error is treated as
    "no override" so callers transparently fall back to env/YAML defaults.
    """

    def __init__(
        self,
        *,
        ttl_seconds: Optional[int] = None,
        collection_factory: Any = None,
    ) -> None:
        self._ttl = ttl_seconds if ttl_seconds is not None else _ttl_from_env()
        self._collection_factory = collection_factory
        self._client: Optional[MongoClient] = None
        self._db_name = os.environ.get("MONGODB_DATABASE", "caipe")
        self._cache: Optional[dict[str, Any]] = None
        self._cache_ts: float = 0.0

    def _get_client(self) -> Optional[MongoClient]:
        uri = os.environ.get("MONGODB_URI", "").strip()
        if not uri:
            return None
        if self._client is None:
            try:
                self._client = MongoClient(uri, serverSelectionTimeoutMS=5000, retryWrites=False)
            except PyMongoError as exc:
                logger.warning("PlatformSettingsReader: MongoDB client init failed: %s", exc)
                return None
        return self._client

    def _get_collection(self) -> Optional[Collection[Any]]:
        if self._collection_factory is not None:
            return self._collection_factory()
        client = self._get_client()
        if client is None:
            return None
        return client[self._db_name]["platform_config"]

    def _document(self) -> dict[str, Any]:
        now = time.monotonic()
        if self._cache is not None and now - self._cache_ts < self._ttl:
            return self._cache

        collection = self._get_collection()
        document: dict[str, Any] = {}
        if collection is not None:
            try:
                found = collection.find_one({"_id": PLATFORM_CONFIG_ID})
                if isinstance(found, dict):
                    document = found
            except PyMongoError as exc:
                logger.warning("PlatformSettingsReader: platform_config read failed: %s", exc)
                document = {}

        self._cache = document
        self._cache_ts = now
        return document

    def _string_field(self, field: str) -> Optional[str]:
        value = self._document().get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None

    def default_agent_id(self) -> Optional[str]:
        """Platform default agent id from the UI, or ``None`` if unset."""
        return self._string_field(DEFAULT_AGENT_FIELD)

    def victorops_escalation_agent_id(self) -> Optional[str]:
        """Slack VictorOps escalation agent id from the UI, or ``None``."""
        return self._string_field(VICTOROPS_AGENT_FIELD)

    def invalidate(self) -> None:
        """Drop the cached document (used by tests and after writes)."""
        self._cache = None
        self._cache_ts = 0.0


def _ttl_from_env() -> int:
    try:
        return max(0, int(os.environ.get("SLACK_PLATFORM_SETTINGS_TTL_SECONDS", "60")))
    except ValueError:
        return 60


_default_reader: Optional[PlatformSettingsReader] = None


def get_platform_settings_reader() -> PlatformSettingsReader:
    """Return the process-wide platform settings reader."""
    global _default_reader
    if _default_reader is None:
        _default_reader = PlatformSettingsReader()
    return _default_reader


def resolve_default_agent_id(env_fallback: Optional[str]) -> Optional[str]:
    """Return the UI platform default agent, falling back to env/YAML."""
    from_db = get_platform_settings_reader().default_agent_id()
    if from_db:
        return from_db
    if isinstance(env_fallback, str) and env_fallback.strip():
        return env_fallback.strip()
    return None


def resolve_victorops_agent_id(env_fallback: Optional[str]) -> Optional[str]:
    """Return the UI VictorOps escalation agent, falling back to env/YAML."""
    from_db = get_platform_settings_reader().victorops_escalation_agent_id()
    if from_db:
        return from_db
    if isinstance(env_fallback, str) and env_fallback.strip():
        return env_fallback.strip()
    return None
