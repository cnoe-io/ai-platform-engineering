# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
LangGraph Store factory for cross-thread long-term memory.

Provides a pluggable store backend (InMemoryStore, Redis, Postgres) that
persists user memories and conversation summaries across threads.

Configuration via environment variables:
    LANGGRAPH_STORE_TYPE: memory (default) | redis | postgres
    LANGGRAPH_STORE_REDIS_URL: Redis connection string (falls back to REDIS_URL)
    LANGGRAPH_STORE_POSTGRES_DSN: Postgres DSN (falls back to POSTGRES_DSN)
    LANGGRAPH_STORE_TTL_MINUTES: TTL for stored items (default 10080 = 7 days)
    LANGGRAPH_STORE_KEY_PREFIX: Optional key/namespace prefix for shared Redis (BYO);
        when set, all store keys are namespaced so multiple deployments can share one Redis.

Usage:
    from ai_platform_engineering.utils.store import create_store, get_store

    store = create_store()  # Returns configured BaseStore instance
"""

import logging
import os
import re
import time
import uuid
from typing import Any, Optional

logger = logging.getLogger(__name__)


def sanitize_namespace_label(label: str) -> str:
    """Replace characters disallowed in LangGraph store namespace labels.

    LangGraph namespace labels cannot contain periods (``'.'``).  This helper
    replaces every period with an underscore so that email addresses (and
    similar identifiers) can be used safely as namespace components while
    remaining human-readable and reversible.
    """
    return re.sub(r"\.", "_", label) if label else label


def _store_namespace(key_prefix: str, category: str, user_id: str) -> tuple[str, ...]:
    """Build store namespace tuple, optionally prefixed for shared Redis (BYO)."""
    user_label = sanitize_namespace_label(user_id)
    if key_prefix:
        return (sanitize_namespace_label(key_prefix), category, user_label)
    return (category, user_label)


STORE_TYPE_MEMORY = "memory"
STORE_TYPE_REDIS = "redis"
STORE_TYPE_POSTGRES = "postgres"

DEFAULT_TTL_MINUTES = 10080  # 7 days


def get_store_config() -> dict[str, Any]:
    """Read store configuration from environment variables."""
    return {
        "type": os.getenv("LANGGRAPH_STORE_TYPE", STORE_TYPE_MEMORY).lower(),
        "redis_url": os.getenv("LANGGRAPH_STORE_REDIS_URL") or os.getenv("REDIS_URL", ""),
        "postgres_dsn": os.getenv("LANGGRAPH_STORE_POSTGRES_DSN") or os.getenv("POSTGRES_DSN", ""),
        "ttl_minutes": int(os.getenv("LANGGRAPH_STORE_TTL_MINUTES", str(DEFAULT_TTL_MINUTES))),
        "key_prefix": (os.getenv("LANGGRAPH_STORE_KEY_PREFIX") or "").strip(),
    }


def create_store():
    """
    Create a LangGraph Store based on environment configuration.

    Returns:
        A BaseStore instance (InMemoryStore, or a lazy wrapper for Redis/Postgres).
        Returns None if store creation fails.
    """
    config = get_store_config()
    store_type = config["type"]

    try:
        if store_type == STORE_TYPE_REDIS:
            redis_url = config["redis_url"]
            if not redis_url:
                logger.warning(
                    "LANGGRAPH_STORE_TYPE=redis but no Redis URL configured "
                    "(set LANGGRAPH_STORE_REDIS_URL or REDIS_URL). Falling back to InMemoryStore."
                )
                return _create_memory_store()
            return _create_redis_store(redis_url)

        elif store_type == STORE_TYPE_POSTGRES:
            postgres_dsn = config["postgres_dsn"]
            if not postgres_dsn:
                logger.warning(
                    "LANGGRAPH_STORE_TYPE=postgres but no Postgres DSN configured "
                    "(set LANGGRAPH_STORE_POSTGRES_DSN or POSTGRES_DSN). Falling back to InMemoryStore."
                )
                return _create_memory_store()
            return _create_postgres_store(postgres_dsn)

        else:
            if store_type != STORE_TYPE_MEMORY:
                logger.warning(f"Unknown LANGGRAPH_STORE_TYPE='{store_type}', using InMemoryStore")
            return _create_memory_store()

    except Exception as e:
        logger.error(f"Failed to create store (type={store_type}): {e}")
        logger.info("Falling back to InMemoryStore")
        return _create_memory_store()


def _create_memory_store():
    """Create an InMemoryStore."""
    from langgraph.store.memory import InMemoryStore
    store = InMemoryStore()
    logger.info("LangGraph Store: InMemoryStore created (cross-thread memory is in-process only)")
    return store


def _create_redis_store(redis_url: str):
    """Create a Redis-backed store (lazy async initialization)."""
    try:
        from langgraph.store.memory import InMemoryStore
        logger.warning(
            "Redis store for LangGraph is not yet available in langgraph-checkpoint-redis. "
            "Using InMemoryStore as fallback. Redis checkpointer is unaffected."
        )
        store = InMemoryStore()
        return store
    except Exception as e:
        logger.error(f"Failed to create Redis store: {e}")
        raise


def _create_postgres_store(postgres_dsn: str):
    """Create a Postgres-backed store (lazy async initialization)."""
    try:
        import importlib.util
        if importlib.util.find_spec("langgraph.store.postgres") is None:
            raise ImportError("langgraph-checkpoint-postgres not installed")
        logger.info(f"LangGraph Store: Postgres store configured (DSN ending ...{postgres_dsn[-20:]})")
        return _LazyAsyncPostgresStore(postgres_dsn)
    except ImportError:
        logger.warning(
            "langgraph-checkpoint-postgres not installed. "
            "Install with: pip install langgraph-checkpoint-postgres"
        )
        from langgraph.store.memory import InMemoryStore
        return InMemoryStore()


class _LazyAsyncPostgresStore:
    """
    Lazy wrapper for AsyncPostgresStore that initializes on first use.

    The Postgres store requires async setup which can't happen at import time
    in the synchronous _build_graph() method.
    """

    def __init__(self, dsn: str):
        self._dsn = dsn
        self._store = None
        self._initialized = False

    async def _ensure_initialized(self):
        if not self._initialized:
            from langgraph.store.postgres.aio import AsyncPostgresStore
            self._store = AsyncPostgresStore.from_conn_string(self._dsn)
            await self._store.__aenter__()
            await self._store.setup()
            self._initialized = True
            logger.info("LangGraph Postgres Store initialized")

    async def aput(self, namespace, key, value, index=None):
        await self._ensure_initialized()
        return await self._store.aput(namespace, key, value, index=index)

    async def aget(self, namespace, key):
        await self._ensure_initialized()
        return await self._store.aget(namespace, key)

    async def asearch(self, namespace, **kwargs):
        await self._ensure_initialized()
        return await self._store.asearch(namespace, **kwargs)

    async def adelete(self, namespace, key):
        await self._ensure_initialized()
        return await self._store.adelete(namespace, key)

    async def alist_namespaces(self, **kwargs):
        await self._ensure_initialized()
        return await self._store.alist_namespaces(**kwargs)

    def put(self, namespace, key, value, index=None):
        raise NotImplementedError("Use async methods (aput) for Postgres store")

    def get(self, namespace, key):
        raise NotImplementedError("Use async methods (aget) for Postgres store")

    def search(self, namespace, **kwargs):
        raise NotImplementedError("Use async methods (asearch) for Postgres store")

    def delete(self, namespace, key):
        raise NotImplementedError("Use async methods (adelete) for Postgres store")

    def list_namespaces(self, **kwargs):
        raise NotImplementedError("Use async methods (alist_namespaces) for Postgres store")

    def batch(self, ops):
        raise NotImplementedError("Use async methods (abatch) for Postgres store")

    async def abatch(self, ops):
        await self._ensure_initialized()
        return await self._store.abatch(ops)


# ============================================================================
# Store Helper Functions
# ============================================================================

_GLOBAL_STORE = None


def get_store():
    """Get or create the global store singleton."""
    global _GLOBAL_STORE
    if _GLOBAL_STORE is None:
        _GLOBAL_STORE = create_store()
    return _GLOBAL_STORE


def reset_store():
    """Reset the global store singleton (for testing)."""
    global _GLOBAL_STORE
    _GLOBAL_STORE = None


async def store_put_memory(
    store,
    user_id: str,
    data: str,
    source_thread: Optional[str] = None,
) -> str:
    """
    Store a user memory in the cross-thread store.

    Args:
        store: LangGraph BaseStore instance
        user_id: User identifier for namespace scoping
        data: The memory content to store
        source_thread: Optional thread_id where the memory originated

    Returns:
        The generated key for the stored memory
    """
    if not store or not user_id:
        return ""

    config = get_store_config()
    key_prefix = config.get("key_prefix") or ""
    namespace = _store_namespace(key_prefix, "memories", user_id)
    key = str(uuid.uuid4())
    value = {
        "data": data,
        "source_thread": source_thread or "",
        "timestamp": time.time(),
    }

    try:
        await store.aput(namespace, key, value)
        logger.debug(f"Stored memory for user={user_id}, key={key}")
        return key
    except Exception as e:
        logger.warning(f"Failed to store memory for user={user_id}: {e}")
        return ""


async def store_put_summary(
    store,
    user_id: str,
    summary: str,
    thread_id: Optional[str] = None,
) -> str:
    """
    Store a conversation summary in the cross-thread store.

    Args:
        store: LangGraph BaseStore instance
        user_id: User identifier for namespace scoping
        summary: The summary text
        thread_id: The thread_id the summary was generated from

    Returns:
        The generated key for the stored summary
    """
    if not store or not user_id:
        return ""

    config = get_store_config()
    key_prefix = config.get("key_prefix") or ""
    namespace = _store_namespace(key_prefix, "summaries", user_id)
    key = str(uuid.uuid4())
    value = {
        "summary": summary,
        "thread_id": thread_id or "",
        "timestamp": time.time(),
    }

    try:
        await store.aput(namespace, key, value)
        logger.info(f"Stored summary for user={user_id}, thread={thread_id}, key={key}")
        return key
    except Exception as e:
        logger.warning(f"Failed to store summary for user={user_id}: {e}")
        return ""


async def store_get_cross_thread_context(
    store,
    user_id: str,
    max_summaries: int = 3,
    max_memories: int = 5,
) -> Optional[str]:
    """
    Retrieve cross-thread context (summaries + memories) for a user.

    Args:
        store: LangGraph BaseStore instance
        user_id: User identifier for namespace scoping
        max_summaries: Maximum number of recent summaries to retrieve
        max_memories: Maximum number of memories to retrieve

    Returns:
        A formatted context string, or None if no context available
    """
    if not store or not user_id:
        return None

    config = get_store_config()
    key_prefix = config.get("key_prefix") or ""
    summaries_ns = _store_namespace(key_prefix, "summaries", user_id)
    memories_ns = _store_namespace(key_prefix, "memories", user_id)

    parts = []

    try:
        summaries = await store.asearch(summaries_ns, limit=max_summaries)
        if summaries:
            sorted_summaries = sorted(
                summaries,
                key=lambda s: s.value.get("timestamp", 0),
                reverse=True,
            )
            summary_texts = []
            for s in sorted_summaries[:max_summaries]:
                text = s.value.get("summary", "")
                if text:
                    summary_texts.append(text)
            if summary_texts:
                parts.append(
                    "[Previous Conversation Summaries]\n" + "\n---\n".join(summary_texts)
                )
    except Exception as e:
        logger.debug(f"Failed to retrieve summaries for user={user_id}: {e}")

    try:
        memories = await store.asearch(memories_ns, limit=max_memories)
        if memories:
            sorted_memories = sorted(
                memories,
                key=lambda m: m.value.get("timestamp", 0),
                reverse=True,
            )
            memory_texts = []
            for m in sorted_memories[:max_memories]:
                text = (
                    m.value.get("data")
                    or m.value.get("content")
                    or ""
                )
                if isinstance(text, dict):
                    text = str(text)
                if text:
                    memory_texts.append(f"- {text}")
            if memory_texts:
                parts.append(
                    "[User Memories]\n" + "\n".join(memory_texts)
                )
    except Exception as e:
        logger.debug(f"Failed to retrieve memories for user={user_id}: {e}")

    if not parts:
        return None

    return "\n\n".join(parts)
