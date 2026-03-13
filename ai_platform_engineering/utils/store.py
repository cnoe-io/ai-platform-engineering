# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
LangGraph Store factory for cross-thread long-term memory.

Provides a pluggable store backend (InMemoryStore, Redis, Postgres, MongoDB) that
persists user memories and conversation summaries across threads.

Configuration via environment variables:
    LANGGRAPH_STORE_TYPE: memory (default) | redis | postgres | mongodb
    LANGGRAPH_STORE_REDIS_URL: Redis connection string (falls back to REDIS_URL)
    LANGGRAPH_STORE_POSTGRES_DSN: Postgres DSN (falls back to POSTGRES_DSN)
    LANGGRAPH_STORE_MONGODB_URI: MongoDB connection URI (falls back to MONGODB_URI)
    LANGGRAPH_STORE_TTL_MINUTES: TTL for stored items (default 10080 = 7 days)
    LANGGRAPH_STORE_KEY_PREFIX: Optional key/namespace prefix for shared Redis (BYO);
        when set, all store keys are namespaced so multiple deployments can share one Redis.

    Embeddings (shared with RAG stack; LANGGRAPH_STORE_* overrides take precedence):
    EMBEDDINGS_PROVIDER: Embedding provider (e.g. openai, azure-openai, litellm)
    EMBEDDINGS_MODEL: Embedding model name (e.g. text-embedding-3-small)
    LANGGRAPH_STORE_EMBEDDINGS_PROVIDER: Override embedding provider for store only
    LANGGRAPH_STORE_EMBEDDINGS_MODEL: Override embedding model for store only
    LANGGRAPH_STORE_EMBEDDINGS_DIMS: Override embedding dimensions (auto-detected for known models)

Usage:
    from ai_platform_engineering.utils.store import create_store, get_store

    store = create_store()  # Returns configured BaseStore instance
"""

import logging
import os
import re
import time
import uuid
from typing import Any, Iterable, Optional

from langgraph.store.base import BaseStore

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
STORE_TYPE_MONGODB = "mongodb"

DEFAULT_TTL_MINUTES = 10080  # 7 days

_KNOWN_EMBEDDING_DIMS: dict[str, int] = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
}


def _build_index_config() -> Optional[dict[str, Any]]:
    """Build store index config for semantic search from environment variables.

    Reuses EMBEDDINGS_PROVIDER / EMBEDDINGS_MODEL (shared with RAG stack).
    LANGGRAPH_STORE_EMBEDDINGS_* overrides take precedence.

    Returns:
        ``{"dims": <int>, "embed": "<provider>:<model>"}`` or ``None`` when
        no embedding provider/model is configured.
    """
    provider = (
        os.getenv("LANGGRAPH_STORE_EMBEDDINGS_PROVIDER")
        or os.getenv("EMBEDDINGS_PROVIDER")
        or ""
    ).strip()
    model = (
        os.getenv("LANGGRAPH_STORE_EMBEDDINGS_MODEL")
        or os.getenv("EMBEDDINGS_MODEL")
        or ""
    ).strip()

    if not provider or not model:
        return None

    normalized_provider = provider.replace("-", "_")
    embed_str = f"{normalized_provider}:{model}"

    dims_str = os.getenv("LANGGRAPH_STORE_EMBEDDINGS_DIMS", "").strip()
    if dims_str:
        dims = int(dims_str)
    else:
        dims = _KNOWN_EMBEDDING_DIMS.get(model, 1536)

    logger.info(
        f"Store embeddings configured: embed={embed_str}, dims={dims}"
    )
    return {"dims": dims, "embed": embed_str}


def get_store_config() -> dict[str, Any]:
    """Read store configuration from environment variables."""
    return {
        "type": os.getenv("LANGGRAPH_STORE_TYPE", STORE_TYPE_MEMORY).lower(),
        "redis_url": os.getenv("LANGGRAPH_STORE_REDIS_URL") or os.getenv("REDIS_URL", ""),
        "postgres_dsn": os.getenv("LANGGRAPH_STORE_POSTGRES_DSN") or os.getenv("POSTGRES_DSN", ""),
        "mongodb_uri": os.getenv("LANGGRAPH_STORE_MONGODB_URI") or os.getenv("MONGODB_URI", ""),
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
    index_config = _build_index_config()

    try:
        if store_type == STORE_TYPE_REDIS:
            redis_url = config["redis_url"]
            if not redis_url:
                logger.warning(
                    "LANGGRAPH_STORE_TYPE=redis but no Redis URL configured "
                    "(set LANGGRAPH_STORE_REDIS_URL or REDIS_URL). Falling back to InMemoryStore."
                )
                return _create_memory_store(index_config)
            return _create_redis_store(redis_url, index_config)

        elif store_type == STORE_TYPE_POSTGRES:
            postgres_dsn = config["postgres_dsn"]
            if not postgres_dsn:
                logger.warning(
                    "LANGGRAPH_STORE_TYPE=postgres but no Postgres DSN configured "
                    "(set LANGGRAPH_STORE_POSTGRES_DSN or POSTGRES_DSN). Falling back to InMemoryStore."
                )
                return _create_memory_store(index_config)
            return _create_postgres_store(postgres_dsn, index_config)

        elif store_type == STORE_TYPE_MONGODB:
            mongodb_uri = config["mongodb_uri"]
            if not mongodb_uri:
                logger.warning(
                    "LANGGRAPH_STORE_TYPE=mongodb but no MongoDB URI configured "
                    "(set LANGGRAPH_STORE_MONGODB_URI or MONGODB_URI). Falling back to InMemoryStore."
                )
                return _create_memory_store(index_config)
            return _create_mongodb_store(mongodb_uri)

        else:
            if store_type != STORE_TYPE_MEMORY:
                logger.warning(f"Unknown LANGGRAPH_STORE_TYPE='{store_type}', using InMemoryStore")
            return _create_memory_store(index_config)

    except Exception as e:
        logger.error(f"Failed to create store (type={store_type}): {e}")
        logger.info("Falling back to InMemoryStore")
        return _create_memory_store(index_config)


def _create_memory_store(index_config: Optional[dict] = None):
    """Create an InMemoryStore with optional embedding index for semantic search."""
    from langgraph.store.memory import InMemoryStore

    if index_config:
        store = InMemoryStore(index=index_config)
        logger.info(
            f"LangGraph Store: InMemoryStore created with semantic search "
            f"(embed={index_config['embed']}, dims={index_config['dims']})"
        )
    else:
        store = InMemoryStore()
        logger.info(
            "LangGraph Store: InMemoryStore created (no embeddings configured; "
            "set EMBEDDINGS_PROVIDER + EMBEDDINGS_MODEL to enable semantic memory search)"
        )
    return store


# ---------------------------------------------------------------------------
# Redis Store
# ---------------------------------------------------------------------------


def _create_redis_store(redis_url: str, index_config: Optional[dict] = None):
    """Create a Redis-backed store (lazy async initialization).

    Requires Redis 8.0+ or Redis Stack (RedisJSON + RediSearch modules).
    Uses langgraph-checkpoint-redis AsyncRedisStore under the hood.
    """
    try:
        import importlib.util
        if importlib.util.find_spec("langgraph.store.redis") is None:
            raise ImportError("langgraph-checkpoint-redis not installed")
        masked_url = redis_url[:15] + "..." if len(redis_url) > 15 else redis_url
        logger.info(f"LangGraph Store: Redis store configured (URL ending ...{masked_url})")
        return _LazyAsyncRedisStore(redis_url, index_config)
    except ImportError:
        logger.warning(
            "langgraph-checkpoint-redis not installed. "
            "Install with: pip install langgraph-checkpoint-redis. "
            "Falling back to InMemoryStore."
        )
        return _create_memory_store(index_config)


class _LazyAsyncRedisStore(BaseStore):
    """Lazy wrapper for AsyncRedisStore that initializes on first use.

    Inherits from ``BaseStore`` so that ``langmem`` and LangGraph internals
    recognise this as a proper store.  Only ``batch`` / ``abatch`` are
    abstract; all other methods (``aget``, ``aput``, ``asearch``, …) are
    provided by ``BaseStore`` and delegate to ``abatch``.
    """

    def __init__(self, redis_url: str, index_config: Optional[dict] = None):
        super().__init__()
        self._redis_url = redis_url
        self._index_config = index_config
        self._store_ctx: Optional[Any] = None
        self._store: Optional[Any] = None
        self._initialized = False

    async def _ensure_initialized(self) -> None:
        if not self._initialized:
            from langgraph.store.redis import AsyncRedisStore

            # redisvl (used internally) requires REDIS_URL in the environment.
            if not os.getenv("REDIS_URL"):
                os.environ["REDIS_URL"] = self._redis_url

            kwargs: dict[str, Any] = {}
            if self._index_config:
                kwargs["index"] = self._index_config
            # Keep a reference to the context manager so it isn't GC'd
            # (which would trigger __aexit__ and close the connection).
            self._store_ctx = AsyncRedisStore.from_conn_string(self._redis_url, **kwargs)
            self._store = await self._store_ctx.__aenter__()
            await self._store.setup()
            self._initialized = True
            embed_info = f" (embed={self._index_config['embed']})" if self._index_config else ""
            logger.info(f"LangGraph Redis Store initialized{embed_info}")

    async def abatch(self, ops: Iterable) -> list:
        await self._ensure_initialized()
        return await self._store.abatch(ops)

    def batch(self, ops: Iterable) -> list:
        raise NotImplementedError("Use async methods (abatch) for Redis store")


# ---------------------------------------------------------------------------
# Postgres Store
# ---------------------------------------------------------------------------


def _create_postgres_store(postgres_dsn: str, index_config: Optional[dict] = None):
    """Create a Postgres-backed store (lazy async initialization)."""
    try:
        import importlib.util
        if importlib.util.find_spec("langgraph.store.postgres") is None:
            raise ImportError("langgraph-checkpoint-postgres not installed")
        logger.info(f"LangGraph Store: Postgres store configured (DSN ending ...{postgres_dsn[-20:]})")
        return _LazyAsyncPostgresStore(postgres_dsn, index_config)
    except ImportError:
        logger.warning(
            "langgraph-checkpoint-postgres not installed. "
            "Install with: pip install langgraph-checkpoint-postgres"
        )
        return _create_memory_store(index_config)


class _LazyAsyncPostgresStore(BaseStore):
    """Lazy wrapper for AsyncPostgresStore that initializes on first use."""

    def __init__(self, dsn: str, index_config: Optional[dict] = None):
        super().__init__()
        self._dsn = dsn
        self._index_config = index_config
        self._store_ctx: Optional[Any] = None
        self._store: Optional[Any] = None
        self._initialized = False

    async def _ensure_initialized(self) -> None:
        if not self._initialized:
            from langgraph.store.postgres.aio import AsyncPostgresStore

            kwargs: dict[str, Any] = {}
            if self._index_config:
                kwargs["index"] = self._index_config
            self._store_ctx = AsyncPostgresStore.from_conn_string(self._dsn, **kwargs)
            self._store = await self._store_ctx.__aenter__()
            await self._store.setup()
            self._initialized = True
            embed_info = f" (embed={self._index_config['embed']})" if self._index_config else ""
            logger.info(f"LangGraph Postgres Store initialized{embed_info}")

    async def abatch(self, ops: Iterable) -> list:
        await self._ensure_initialized()
        return await self._store.abatch(ops)

    def batch(self, ops: Iterable) -> list:
        raise NotImplementedError("Use async methods (abatch) for Postgres store")


# ---------------------------------------------------------------------------
# MongoDB Store
# ---------------------------------------------------------------------------


def _create_mongodb_store(mongodb_uri: str):
    """Create a MongoDB-backed store (lazy async initialization).

    Uses motor (async MongoDB driver) with a custom BaseStore-compatible wrapper.
    Note: MongoDB store does not support semantic/vector search. Embedding config
    is ignored. Use Redis or Postgres store for full semantic memory search.

    Args:
        mongodb_uri: MongoDB connection URI (e.g. mongodb://host:27017)
    """
    try:
        import importlib.util

        if importlib.util.find_spec("motor") is None:
            raise ImportError("motor (async MongoDB driver) not installed")

        index_config = _build_index_config()
        if index_config:
            logger.warning(
                "MongoDB store does not support semantic/vector search. "
                "Embeddings config will be ignored. Use Redis or Postgres store "
                "for full semantic memory search with fact extraction."
            )

        masked_uri = mongodb_uri[:20] + "..." if len(mongodb_uri) > 20 else mongodb_uri
        logger.info(f"LangGraph Store: MongoDB store configured (URI={masked_uri})")
        return _LazyAsyncMongoDBStore(mongodb_uri)
    except ImportError:
        logger.warning(
            "motor (async MongoDB driver) not installed. "
            "Install with: pip install motor. "
            "Falling back to InMemoryStore."
        )
        return _create_memory_store(_build_index_config())


class _LazyAsyncMongoDBStore(BaseStore):
    """Lazy wrapper for a MongoDB-backed store that initializes on first use.

    Uses motor (async MongoDB driver) to implement the LangGraph BaseStore
    interface against a MongoDB collection.  Documents are keyed by
    ``(namespace, key)`` and the value is stored as a JSON-safe dict.

    Note: ``abatch`` is implemented as sequential individual operations since
    MongoDB does not have a single-call multi-op equivalent to LangGraph's
    ``Op`` protocol. All other ``BaseStore`` methods (``aget``, ``aput``, …)
    delegate to ``abatch`` automatically.
    """

    def __init__(self, mongodb_uri: str, db_name: str = "langgraph_store"):
        super().__init__()
        self._mongodb_uri = mongodb_uri
        self._db_name = db_name
        self._collection = None
        self._initialized = False

    async def _ensure_initialized(self) -> None:
        if not self._initialized:
            from motor.motor_asyncio import AsyncIOMotorClient

            client = AsyncIOMotorClient(self._mongodb_uri)
            db = client[self._db_name]
            self._collection = db["store"]
            await self._collection.create_index(
                [("namespace", 1), ("key", 1)], unique=True
            )
            self._initialized = True
            logger.info("LangGraph MongoDB Store initialized")

    async def abatch(self, ops: Iterable) -> list:
        """Execute LangGraph store Ops against MongoDB.

        Translates ``GetOp``, ``PutOp``, ``SearchOp``, ``ListNamespacesOp``
        into MongoDB calls.  This is a basic implementation; for production
        workloads consider Redis or Postgres stores instead.
        """
        await self._ensure_initialized()

        from langgraph.store.base import (
            GetOp,
            ListNamespacesOp,
            PutOp,
            SearchOp,
        )

        results: list = []
        for op in ops:
            if isinstance(op, GetOp):
                ns_str = ".".join(op.namespace)
                doc = await self._collection.find_one(
                    {"namespace": ns_str, "key": op.key}
                )
                if doc is None:
                    results.append(None)
                else:
                    from langgraph.store.base import Item

                    results.append(
                        Item(
                            value=doc.get("value", {}),
                            key=op.key,
                            namespace=op.namespace,
                            created_at=doc.get("created_at", time.time()),
                            updated_at=doc.get("updated_at", time.time()),
                        )
                    )
            elif isinstance(op, PutOp):
                ns_str = ".".join(op.namespace)
                now = time.time()
                if op.value is None:
                    await self._collection.delete_one(
                        {"namespace": ns_str, "key": op.key}
                    )
                else:
                    await self._collection.update_one(
                        {"namespace": ns_str, "key": op.key},
                        {
                            "$set": {
                                "namespace": ns_str,
                                "key": op.key,
                                "value": op.value,
                                "updated_at": now,
                            },
                            "$setOnInsert": {"created_at": now},
                        },
                        upsert=True,
                    )
                results.append(None)
            elif isinstance(op, SearchOp):
                ns_str = ".".join(op.namespace_prefix)
                limit = op.limit if hasattr(op, "limit") else 10
                cursor = self._collection.find(
                    {"namespace": {"$regex": f"^{re.escape(ns_str)}"}}
                ).limit(limit)
                items = []
                async for doc in cursor:
                    from langgraph.store.base import Item

                    ns_tuple = tuple(doc.get("namespace", "").split("."))
                    items.append(
                        Item(
                            value=doc.get("value", {}),
                            key=doc.get("key", ""),
                            namespace=ns_tuple,
                            created_at=doc.get("created_at", time.time()),
                            updated_at=doc.get("updated_at", time.time()),
                        )
                    )
                results.append(items)
            elif isinstance(op, ListNamespacesOp):
                namespaces = await self._collection.distinct("namespace")
                results.append(
                    [tuple(ns.split(".")) for ns in namespaces]
                )
            else:
                results.append(None)
        return results

    def batch(self, ops: Iterable) -> list:
        raise NotImplementedError("Use async methods (abatch) for MongoDB store")


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
    max_summaries: int = int(os.environ.get("LANGGRAPH_STORE_MAX_SUMMARIES", "10")),
    max_memories: int = int(os.environ.get("LANGGRAPH_STORE_MAX_MEMORIES", "50")),
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
