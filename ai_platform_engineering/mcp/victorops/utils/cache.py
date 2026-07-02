# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""In-process TTL cache for low-churn VictorOps endpoints.

Three named caches share one TTLCache class but live as module-level
singletons, mirroring the lifecycle of `_org_registry` in api/client.py
(built once at import, reset by importlib.reload during tests).

TTLs are configurable via environment variables read at import time:

    VICTOROPS_CACHE_TTL_TEAMS_SECONDS      (default 3600  -- 1 hour)
    VICTOROPS_CACHE_TTL_USERS_SECONDS      (default 1800  -- 30 minutes)
    VICTOROPS_CACHE_TTL_SCHEDULES_SECONDS  (default 300   -- 5 minutes)

Setting any value to 0 disables that cache (every get returns None,
every set is a no-op).
"""

import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("mcp_victorops")


class TTLCache:
    """Per-process TTL cache, keyed on (namespace, org_slug, filter_key).

    Bounded key space — three namespaces times a small number of orgs and
    teams — so no eviction policy is needed. Set ttl_seconds=0 to disable.
    """

    def __init__(self, ttl_seconds: int):
        self._enabled = ttl_seconds > 0
        self._ttl = timedelta(seconds=ttl_seconds) if self._enabled else timedelta(0)
        self._store: Dict[Tuple[str, str, str], Tuple[Any, datetime]] = {}

    def get(self, namespace: str, org_slug: str, filter_key: str = "") -> Optional[Any]:
        if not self._enabled:
            return None
        key = (namespace, org_slug or "_default_", filter_key)
        entry = self._store.get(key)
        if entry is None:
            return None
        value, ts = entry
        if datetime.now() - ts >= self._ttl:
            self._store.pop(key, None)
            logger.debug(f"Cache MISS (expired): {key}")
            return None
        logger.debug(f"Cache HIT: {key}")
        return value

    def set(self, namespace: str, org_slug: str, value: Any, filter_key: str = "") -> None:
        if not self._enabled:
            return
        key = (namespace, org_slug or "_default_", filter_key)
        self._store[key] = (value, datetime.now())
        logger.debug(f"Cache SET: {key}")

    def invalidate(self, namespace: str, org_slug: Optional[str] = None) -> None:
        """Drop all entries for a namespace, optionally scoped to one org."""
        keys = [
            k for k in self._store
            if k[0] == namespace and (org_slug is None or k[1] == (org_slug or "_default_"))
        ]
        for k in keys:
            self._store.pop(k, None)
        if keys:
            logger.debug(f"Cache INVALIDATE: {len(keys)} entries in '{namespace}'")


def _ttl_from_env(var_name: str, default_seconds: int) -> int:
    raw = os.getenv(var_name)
    if raw is None or raw == "":
        return default_seconds
    try:
        value = int(raw)
        if value < 0:
            raise ValueError("must be >= 0")
        return value
    except ValueError as e:
        raise ValueError(f"{var_name} must be a non-negative integer (seconds): {e}") from e


_team_cache = TTLCache(_ttl_from_env("VICTOROPS_CACHE_TTL_TEAMS_SECONDS", 3600))
_user_cache = TTLCache(_ttl_from_env("VICTOROPS_CACHE_TTL_USERS_SECONDS", 1800))
_schedule_cache = TTLCache(_ttl_from_env("VICTOROPS_CACHE_TTL_SCHEDULES_SECONDS", 300))


def team_cache() -> TTLCache:
    return _team_cache


def user_cache() -> TTLCache:
    return _user_cache


def schedule_cache() -> TTLCache:
    return _schedule_cache
