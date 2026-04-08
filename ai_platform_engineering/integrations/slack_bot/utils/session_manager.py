# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Stateless Session Manager

Provides a thin caching layer over the supervisor's turn-lookup API.
All authoritative state lives server-side; the Slack bot only keeps a
short-lived in-memory TTL cache for performance.
"""

import time
from typing import Optional, Dict, Tuple

import requests as _requests
from loguru import logger


# ---------------------------------------------------------------------------
# TTL cache
# ---------------------------------------------------------------------------

class TTLCache:
    """Simple in-memory cache with per-entry TTL."""

    def __init__(self, ttl_seconds: int = 3600):
        self._store: Dict[str, Tuple[object, float]] = {}
        self._ttl = ttl_seconds

    def get(self, key: str):
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.monotonic() > expires_at:
            del self._store[key]
            return None
        return value

    def set(self, key: str, value):
        self._store[key] = (value, time.monotonic() + self._ttl)

    def delete(self, key: str):
        self._store.pop(key, None)

    def __len__(self):
        return len(self._store)


# ---------------------------------------------------------------------------
# Session Manager
# ---------------------------------------------------------------------------

class SessionManager:
    """Stateless session manager backed by the supervisor's lookup API.

    On construction, requires the supervisor base URL.  All state is
    stored server-side in the ``turns`` collection; this class keeps only
    a short-lived in-memory TTL cache.

    Parameters
    ----------
    supervisor_url:
        Base URL of the supervisor (e.g. ``http://localhost:8000``).
    auth_client:
        Optional OAuth2 client for authenticated supervisor requests.
    """

    def __init__(self, supervisor_url: str, auth_client=None):
        self._supervisor_url = supervisor_url.rstrip("/")
        self._auth_client = auth_client

        # Fast-path caches (authoritative source is always the API)
        self._context_cache = TTLCache(ttl_seconds=3600)
        self._trace_cache = TTLCache(ttl_seconds=3600)
        self._user_info_cache = TTLCache(ttl_seconds=600)
        self._skipped_cache = TTLCache(ttl_seconds=300)

        # Escalation dedup — purely ephemeral, acceptable to lose on restart
        self._escalated_threads: set[str] = set()

    def _get_headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self._auth_client:
            try:
                token = self._auth_client.get_access_token()
                headers["Authorization"] = f"Bearer {token}"
            except Exception as e:
                logger.warning(f"SessionManager: failed to get auth token: {e}")
        return headers

    # ------------------------------------------------------------------
    # Context ID (conversation_id / LangGraph thread_id)
    # ------------------------------------------------------------------

    def get_context_id(self, thread_ts: str) -> Optional[str]:
        """Get the conversation ID for a Slack thread.

        Fast path: local cache.
        Slow path: ``GET /api/v1/conversations/lookup?source=slack&thread_ts=...``
        """
        cached = self._context_cache.get(thread_ts)
        if cached is not None:
            return cached

        try:
            resp = _requests.get(
                f"{self._supervisor_url}/api/v1/conversations/lookup",
                params={"source": "slack", "thread_ts": thread_ts},
                headers=self._get_headers(),
                timeout=5,
            )
            if resp.status_code == 200:
                data = resp.json()
                conv_id = data.get("conversation_id")
                if conv_id:
                    self._context_cache.set(thread_ts, conv_id)
                    # Also cache trace_id if present
                    trace_id = (data.get("metadata") or {}).get("trace_id")
                    if trace_id:
                        self._trace_cache.set(thread_ts, trace_id)
                    return conv_id
            # 404 is expected for new threads — not an error
            elif resp.status_code != 404:
                logger.warning(f"SessionManager: lookup returned {resp.status_code}")
        except Exception as e:
            logger.warning(f"SessionManager: lookup API failed for {thread_ts}: {e}")

        return None

    def set_context_id(self, thread_ts: str, context_id: str) -> None:
        """Cache the conversation ID locally (written by RUN_FINISHED handler)."""
        self._context_cache.set(thread_ts, context_id)

    # ------------------------------------------------------------------
    # Trace ID (Langfuse run_id)
    # ------------------------------------------------------------------

    def get_trace_id(self, thread_ts: str) -> Optional[str]:
        """Get the Langfuse trace/run ID for a Slack thread."""
        cached = self._trace_cache.get(thread_ts)
        if cached is not None:
            return cached

        # Trigger a lookup which also caches trace_id
        self.get_context_id(thread_ts)
        return self._trace_cache.get(thread_ts)

    def set_trace_id(self, thread_ts: str, trace_id: str) -> None:
        """Cache the trace_id locally (written by RUN_FINISHED handler)."""
        self._trace_cache.set(thread_ts, trace_id)

    # ------------------------------------------------------------------
    # Skipped (overthink mode)
    # ------------------------------------------------------------------

    def set_skipped(self, thread_ts: str, skipped: bool = True) -> None:
        """Mark a thread as skipped in overthink mode."""
        self._skipped_cache.set(thread_ts, skipped)
        # Best-effort server-side update
        try:
            _requests.patch(
                f"{self._supervisor_url}/api/v1/conversations/lookup/metadata",
                params={"source": "slack", "thread_ts": thread_ts},
                json={"is_skipped": skipped},
                headers=self._get_headers(),
                timeout=3,
            )
        except Exception as e:
            logger.debug(f"SessionManager: failed to persist is_skipped for {thread_ts}: {e}")

    def is_skipped(self, thread_ts: str) -> bool:
        """Check if a thread was skipped in overthink mode."""
        cached = self._skipped_cache.get(thread_ts)
        if cached is not None:
            return cached
        return False

    def clear_skipped(self, thread_ts: str) -> None:
        """Clear the skipped flag."""
        self._skipped_cache.delete(thread_ts)
        try:
            _requests.patch(
                f"{self._supervisor_url}/api/v1/conversations/lookup/metadata",
                params={"source": "slack", "thread_ts": thread_ts},
                json={"is_skipped": False},
                headers=self._get_headers(),
                timeout=3,
            )
        except Exception as e:
            logger.debug(f"SessionManager: failed to clear is_skipped for {thread_ts}: {e}")

    # ------------------------------------------------------------------
    # Escalation dedup
    # ------------------------------------------------------------------

    def is_escalated(self, thread_ts: str) -> bool:
        """Check if this thread has already been escalated."""
        return thread_ts in self._escalated_threads

    def set_escalated(self, thread_ts: str) -> None:
        """Mark a thread as escalated (idempotent)."""
        self._escalated_threads.add(thread_ts)
        # Best-effort server-side update
        try:
            _requests.patch(
                f"{self._supervisor_url}/api/v1/conversations/lookup/metadata",
                params={"source": "slack", "thread_ts": thread_ts},
                json={"escalated": True},
                headers=self._get_headers(),
                timeout=3,
            )
        except Exception as e:
            logger.debug(f"SessionManager: failed to persist escalated for {thread_ts}: {e}")

    # ------------------------------------------------------------------
    # User info cache (pure local — avoids Slack API rate limits)
    # ------------------------------------------------------------------

    def get_user_info(self, user_id: str) -> Optional[dict]:
        """Get cached Slack user info."""
        return self._user_info_cache.get(user_id)

    def set_user_info(self, user_id: str, user_info: dict) -> None:
        """Cache Slack user info to avoid rate limits."""
        self._user_info_cache.set(user_id, user_info)

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def get_store_type(self) -> str:
        return "api"

    def get_stats(self) -> dict:
        return {
            "type": "api",
            "supervisor_url": self._supervisor_url,
            "context_cache_size": len(self._context_cache),
            "trace_cache_size": len(self._trace_cache),
            "user_cache_size": len(self._user_info_cache),
            "escalated_threads": len(self._escalated_threads),
        }
