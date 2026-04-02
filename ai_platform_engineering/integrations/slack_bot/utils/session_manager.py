# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Session Manager for A2A Conversations

Provides a pluggable interface for session storage with support for:
- MongoDBSessionStore: Persistent storage across restarts (production)
- InMemorySessionStore: Default in-memory storage (dev/test)

The SessionManager class automatically selects the appropriate backend
based on environment configuration (MONGODB_URI).
"""

import os
from abc import ABC, abstractmethod
from typing import Optional, Dict
from loguru import logger


class SessionStore(ABC):
    """Abstract interface for session storage backends."""

    @abstractmethod
    def get_context_id(self, thread_ts: str) -> Optional[str]:
        pass

    @abstractmethod
    def set_context_id(self, thread_ts: str, context_id: str) -> None:
        pass

    @abstractmethod
    def get_trace_id(self, thread_ts: str) -> Optional[str]:
        pass

    @abstractmethod
    def set_trace_id(self, thread_ts: str, trace_id: str) -> None:
        pass

    @abstractmethod
    def get_user_info(self, user_id: str) -> Optional[dict]:
        pass

    @abstractmethod
    def set_user_info(self, user_id: str, user_info: dict) -> None:
        pass


class InMemorySessionStore(SessionStore):
    """In-memory session storage for development and testing."""

    def __init__(self):
        self._sessions: Dict[str, str] = {}
        self._trace_ids: Dict[str, str] = {}
        self._skipped: Dict[str, bool] = {}
        self._user_info: Dict[str, dict] = {}

    def get_context_id(self, thread_ts: str) -> Optional[str]:
        return self._sessions.get(thread_ts)

    def set_context_id(self, thread_ts: str, context_id: str) -> None:
        self._sessions[thread_ts] = context_id

    def get_trace_id(self, thread_ts: str) -> Optional[str]:
        return self._trace_ids.get(thread_ts)

    def set_trace_id(self, thread_ts: str, trace_id: str) -> None:
        self._trace_ids[thread_ts] = trace_id

    def delete_context_id(self, thread_ts: str) -> None:
        self._sessions.pop(thread_ts, None)

    def set_skipped(self, thread_ts: str, skipped: bool = True) -> None:
        self._skipped[thread_ts] = skipped

    def is_skipped(self, thread_ts: str) -> bool:
        return self._skipped.get(thread_ts, False)

    def clear_skipped(self, thread_ts: str) -> None:
        self._skipped.pop(thread_ts, None)

    def get_user_info(self, user_id: str) -> Optional[dict]:
        return self._user_info.get(user_id)

    def set_user_info(self, user_id: str, user_info: dict) -> None:
        self._user_info[user_id] = user_info

    def get_stats(self) -> dict:
        return {
            "type": "in_memory",
            "session_count": len(self._sessions),
            "skipped_count": len(self._skipped),
        }


class SessionManager:
    """
    High-level session manager that auto-selects the appropriate backend.

    On initialization:
    1. If MONGODB_URI is set, attempts to connect to MongoDB
    2. Falls back to in-memory storage if MongoDB unavailable
    """

    def __init__(self, store: Optional[SessionStore] = None):
        if store:
            self._store = store
        else:
            self._store = self._create_store()

    def _create_store(self) -> SessionStore:
        """Create the appropriate session store based on environment."""
        mongodb_uri = os.environ.get("MONGODB_URI")

        if mongodb_uri:
            try:
                from .mongodb_session import MongoDBSessionStore

                mongo_store = MongoDBSessionStore.from_env()
                if mongo_store and mongo_store.is_available():
                    logger.info("Using MongoDB session store for persistent sessions")
                    return mongo_store
            except Exception as e:
                logger.warning(f"Failed to initialize MongoDB session store: {e}")

        logger.warning(
            "Using in-memory session store - sessions will be lost on restart. "
            "Set MONGODB_URI environment variable for persistent sessions."
        )
        return InMemorySessionStore()

    def get_context_id(self, thread_ts: str) -> Optional[str]:
        return self._store.get_context_id(thread_ts)

    def set_context_id(self, thread_ts: str, context_id: str) -> None:
        self._store.set_context_id(thread_ts, context_id)

    def get_trace_id(self, thread_ts: str) -> Optional[str]:
        return self._store.get_trace_id(thread_ts)

    def set_trace_id(self, thread_ts: str, trace_id: str) -> None:
        self._store.set_trace_id(thread_ts, trace_id)

    def set_skipped(self, thread_ts: str, skipped: bool = True) -> None:
        if hasattr(self._store, "set_skipped"):
            self._store.set_skipped(thread_ts, skipped)

    def is_skipped(self, thread_ts: str) -> bool:
        if hasattr(self._store, "is_skipped"):
            return self._store.is_skipped(thread_ts)
        return False

    def clear_skipped(self, thread_ts: str) -> None:
        if hasattr(self._store, "clear_skipped"):
            self._store.clear_skipped(thread_ts)

    def get_user_info(self, user_id: str) -> Optional[dict]:
        return self._store.get_user_info(user_id)

    def set_user_info(self, user_id: str, user_info: dict) -> None:
        self._store.set_user_info(user_id, user_info)

    def get_db(self):
        """Return the MongoDB database handle if using MongoDB backend, else None."""
        if hasattr(self._store, '_db'):
            return self._store._db
        return None

    def get_store_type(self) -> str:
        if isinstance(self._store, InMemorySessionStore):
            return "in_memory"
        return "mongodb"

    def get_stats(self) -> dict:
        if hasattr(self._store, "get_stats"):
            return self._store.get_stats()
        return {"type": "unknown"}
