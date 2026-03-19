# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
LangGraph Checkpointer factory for in-thread conversation state persistence.

Provides a pluggable checkpointer backend (InMemorySaver default, RedisSaver,
PostgresSaver, or MongoDBSaver) that persists conversation state within a
thread so that multi-turn conversations survive pod restarts.

All external backends use async savers with lazy initialization so that the
synchronous ``create_checkpointer()`` can be called from ``_build_graph()``
while the actual connection is deferred until the first async graph operation.

Configuration via environment variables:
    LANGGRAPH_CHECKPOINT_TYPE: memory (default) | redis | postgres | mongodb
    LANGGRAPH_CHECKPOINT_REDIS_URL: Redis Stack connection string
    LANGGRAPH_CHECKPOINT_POSTGRES_DSN: Postgres DSN
    LANGGRAPH_CHECKPOINT_MONGODB_URI: MongoDB connection URI
    LANGGRAPH_CHECKPOINT_MONGODB_DB_NAME: MongoDB database name (default: checkpointing_db)
    LANGGRAPH_CHECKPOINT_MONGODB_COLLECTION: Checkpoint collection name (default: checkpoints)
    LANGGRAPH_CHECKPOINT_MONGODB_WRITES_COLLECTION: Writes collection name (default: checkpoint_writes)
    LANGGRAPH_CHECKPOINT_TTL_MINUTES: TTL for checkpoints (0 = no expiry)

Usage:
    from ai_platform_engineering.utils.checkpointer import create_checkpointer, get_checkpointer

    checkpointer = create_checkpointer()  # Returns configured checkpointer
"""

import logging
import os
from typing import Any, AsyncIterator, Iterator, Optional, Sequence, Tuple

from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
)

logger = logging.getLogger(__name__)

CHECKPOINT_TYPE_MEMORY = "memory"
CHECKPOINT_TYPE_REDIS = "redis"
CHECKPOINT_TYPE_POSTGRES = "postgres"
CHECKPOINT_TYPE_MONGODB = "mongodb"

# Default collection suffixes (prefixed with auto-detected agent name)
_DEFAULT_CHECKPOINT_COLLECTION = "checkpoints"
_DEFAULT_WRITES_COLLECTION = "checkpoint_writes"


def _detect_collection_prefix() -> str:
    """Auto-detect a collection name prefix from the running module.

    Returns a short agent identifier used to namespace MongoDB checkpoint
    collections so that each agent writes to its own collection.

    Detection heuristic (checked in order):
      1. ``__main__.__spec__.name`` — the ``-m`` module name
         * ``agent_jira``                       → ``"jira"``
         * ``ai_platform_engineering.multi_agents`` → ``"supervisor"``
      2. Falls back to ``""`` (no prefix).
    """
    import sys

    spec = getattr(sys.modules.get("__main__"), "__spec__", None)
    if spec and spec.name:
        module_name = spec.name
        # Supervisor module
        if "multi_agents" in module_name or "platform_engineer" in module_name:
            return "caipe_supervisor"
        # Agent module: agent_jira -> jira, agent_github -> github
        if "agent_" in module_name:
            # Handle dotted names: agent_jira.__main__ -> agent_jira
            base = module_name.split(".")[0] if "." in module_name else module_name
            parts = base.split("agent_", 1)
            if len(parts) > 1 and parts[1]:
                return parts[1]
    return ""


def get_checkpointer_config() -> dict[str, Any]:
    """Read checkpointer configuration from environment variables."""
    return {
        "type": os.getenv("LANGGRAPH_CHECKPOINT_TYPE", CHECKPOINT_TYPE_MEMORY).lower(),
        "redis_url": os.getenv("LANGGRAPH_CHECKPOINT_REDIS_URL", ""),
        "postgres_dsn": (
            os.getenv("LANGGRAPH_CHECKPOINT_POSTGRES_DSN") or os.getenv("POSTGRES_DSN", "")
        ),
        "mongodb_uri": (
            os.getenv("LANGGRAPH_CHECKPOINT_MONGODB_URI") or os.getenv("MONGODB_URI", "")
        ),
        "mongodb_db_name": os.getenv("LANGGRAPH_CHECKPOINT_MONGODB_DB_NAME", ""),
        "mongodb_collection": os.getenv("LANGGRAPH_CHECKPOINT_MONGODB_COLLECTION", ""),
        "mongodb_writes_collection": os.getenv("LANGGRAPH_CHECKPOINT_MONGODB_WRITES_COLLECTION", ""),
        "ttl_minutes": int(os.getenv("LANGGRAPH_CHECKPOINT_TTL_MINUTES", "0")),
    }


def create_checkpointer():
    """Create a LangGraph checkpointer based on environment configuration.

    Returns:
        A BaseCheckpointSaver instance (InMemorySaver, or a lazy async wrapper
        for Redis/Postgres/MongoDB).
    """
    config = get_checkpointer_config()
    checkpoint_type = config["type"]

    try:
        if checkpoint_type == CHECKPOINT_TYPE_REDIS:
            redis_url = config["redis_url"]
            if not redis_url:
                logger.warning(
                    "LANGGRAPH_CHECKPOINT_TYPE=redis but no Redis URL configured "
                    "(set LANGGRAPH_CHECKPOINT_REDIS_URL). Falling back to InMemorySaver."
                )
                return _create_memory_checkpointer()
            return _create_redis_checkpointer(redis_url, config["ttl_minutes"])

        elif checkpoint_type == CHECKPOINT_TYPE_POSTGRES:
            postgres_dsn = config["postgres_dsn"]
            if not postgres_dsn:
                logger.warning(
                    "LANGGRAPH_CHECKPOINT_TYPE=postgres but no Postgres DSN configured "
                    "(set LANGGRAPH_CHECKPOINT_POSTGRES_DSN or POSTGRES_DSN). "
                    "Falling back to InMemorySaver."
                )
                return _create_memory_checkpointer()
            return _create_postgres_checkpointer(postgres_dsn)

        elif checkpoint_type == CHECKPOINT_TYPE_MONGODB:
            mongodb_uri = config["mongodb_uri"]
            if not mongodb_uri:
                logger.warning(
                    "LANGGRAPH_CHECKPOINT_TYPE=mongodb but no MongoDB URI configured "
                    "(set LANGGRAPH_CHECKPOINT_MONGODB_URI or MONGODB_URI). "
                    "Falling back to InMemorySaver."
                )
                return _create_memory_checkpointer()

            # Auto-prefix collection names with agent name when not explicitly set
            cp_coll = config["mongodb_collection"]
            wr_coll = config["mongodb_writes_collection"]
            if not cp_coll and not wr_coll:
                prefix = _detect_collection_prefix()
                if prefix:
                    cp_coll = f"{_DEFAULT_CHECKPOINT_COLLECTION}_{prefix}"
                    wr_coll = f"{_DEFAULT_WRITES_COLLECTION}_{prefix}"
                    logger.info(
                        f"LangGraph Checkpointer: auto-prefixed collections "
                        f"with '{prefix}' → {cp_coll}, {wr_coll}"
                    )

            return _create_mongodb_checkpointer(
                mongodb_uri,
                db_name=config["mongodb_db_name"],
                checkpoint_collection_name=cp_coll,
                writes_collection_name=wr_coll,
            )

        else:
            if checkpoint_type != CHECKPOINT_TYPE_MEMORY:
                logger.warning(
                    f"Unknown LANGGRAPH_CHECKPOINT_TYPE='{checkpoint_type}', using InMemorySaver"
                )
            return _create_memory_checkpointer()

    except Exception as e:
        logger.error(f"Failed to create checkpointer (type={checkpoint_type}): {e}")
        logger.info("Falling back to InMemorySaver")
        return _create_memory_checkpointer()


def _create_memory_checkpointer():
    """Create an InMemorySaver checkpointer."""
    from langgraph.checkpoint.memory import InMemorySaver

    checkpointer = InMemorySaver()
    logger.info("LangGraph Checkpointer: InMemorySaver created (state lost on restart)")
    return checkpointer


# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------


def _create_redis_checkpointer(redis_url: str, ttl_minutes: int = 0):
    """Create a Redis-backed checkpointer (lazy async initialization).

    Uses AsyncRedisSaver from langgraph-checkpoint-redis. The async context
    manager is entered lazily on the first async operation so that
    ``create_checkpointer()`` can remain synchronous.

    Requires Redis 8.0+ or Redis Stack (RedisJSON + RediSearch modules).
    """
    try:
        import importlib.util

        if importlib.util.find_spec("langgraph.checkpoint.redis") is None:
            raise ImportError("langgraph-checkpoint-redis not installed")

        masked_url = redis_url[:15] + "..." if len(redis_url) > 15 else redis_url
        logger.info(
            f"LangGraph Checkpointer: AsyncRedisSaver configured "
            f"(url={masked_url}, ttl={ttl_minutes}m)"
        )
        return _LazyAsyncRedisSaver(redis_url, ttl_minutes)

    except ImportError:
        logger.warning(
            "langgraph-checkpoint-redis not installed. "
            "Install with: pip install langgraph-checkpoint-redis"
        )
        return _create_memory_checkpointer()


class _LazyAsyncRedisSaver(BaseCheckpointSaver):
    """Lazy wrapper for AsyncRedisSaver that initializes on first async use.

    Inherits from ``BaseCheckpointSaver`` so LangGraph sees a proper
    checkpointer with ``get_next_version``, ``config_specs``, ``serde``, etc.

    ``AsyncRedisSaver.from_conn_string()`` returns an async context manager.
    We cannot ``await __aenter__()`` inside the synchronous
    ``create_checkpointer()`` / ``_build_graph()`` call chain, so we defer
    initialization until the first async checkpoint operation.
    """

    def __init__(self, redis_url: str, ttl_minutes: int = 0):
        super().__init__()
        self._redis_url = redis_url
        self._ttl_minutes = ttl_minutes
        self._saver_ctx: Optional[Any] = None
        self._saver: Optional[Any] = None
        self._initialized = False

    async def _ensure_initialized(self) -> None:
        if not self._initialized:
            from langgraph.checkpoint.redis.aio import AsyncRedisSaver

            # redisvl (used internally by langgraph-checkpoint-redis) requires
            # REDIS_URL in the environment for its index client connections.
            if not os.getenv("REDIS_URL"):
                os.environ["REDIS_URL"] = self._redis_url

            ttl_config = None
            if self._ttl_minutes > 0:
                ttl_config = {
                    "default_ttl": self._ttl_minutes,
                    "refresh_on_read": True,
                }

            # Keep a reference to the context manager so it isn't GC'd
            # (which would trigger __aexit__ and close the connection).
            self._saver_ctx = AsyncRedisSaver.from_conn_string(
                self._redis_url, ttl=ttl_config
            )
            self._saver = await self._saver_ctx.__aenter__()
            await self._saver.setup()
            self._initialized = True
            logger.info("LangGraph AsyncRedisSaver initialized and connected")

    async def aget_tuple(self, config: dict) -> Optional[CheckpointTuple]:
        await self._ensure_initialized()
        return await self._saver.aget_tuple(config)

    async def aput(
        self,
        config: dict,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> dict:
        await self._ensure_initialized()
        return await self._saver.aput(config, checkpoint, metadata, new_versions)

    async def aput_writes(
        self, config: dict, writes: Sequence[Tuple[str, Any]], task_id: str
    ) -> None:
        await self._ensure_initialized()
        return await self._saver.aput_writes(config, writes, task_id)

    async def alist(
        self,
        config: Optional[dict],
        *,
        filter: Optional[dict[str, Any]] = None,
        before: Optional[dict] = None,
        limit: Optional[int] = None,
    ) -> AsyncIterator[CheckpointTuple]:
        await self._ensure_initialized()
        async for item in self._saver.alist(
            config, filter=filter, before=before, limit=limit
        ):
            yield item

    def get_tuple(self, config: dict) -> Optional[CheckpointTuple]:
        raise NotImplementedError("Use async methods (aget_tuple) for Redis checkpointer")

    def put(
        self, config: dict, checkpoint: Checkpoint,
        metadata: CheckpointMetadata, new_versions: ChannelVersions,
    ) -> dict:
        raise NotImplementedError("Use async methods (aput) for Redis checkpointer")

    def put_writes(
        self, config: dict, writes: Sequence[Tuple[str, Any]], task_id: str
    ) -> None:
        raise NotImplementedError("Use async methods (aput_writes) for Redis checkpointer")

    def list(
        self, config: Optional[dict], **kwargs: Any
    ) -> Iterator[CheckpointTuple]:
        raise NotImplementedError("Use async methods (alist) for Redis checkpointer")


# ---------------------------------------------------------------------------
# Postgres
# ---------------------------------------------------------------------------


def _create_postgres_checkpointer(postgres_dsn: str):
    """Create a Postgres-backed checkpointer (lazy async initialization).

    Uses AsyncPostgresSaver from langgraph-checkpoint-postgres.
    """
    try:
        import importlib.util

        if importlib.util.find_spec("langgraph.checkpoint.postgres") is None:
            raise ImportError("langgraph-checkpoint-postgres not installed")

        masked_dsn = postgres_dsn[:20] + "..." if len(postgres_dsn) > 20 else postgres_dsn
        logger.info(f"LangGraph Checkpointer: AsyncPostgresSaver configured (dsn={masked_dsn})")
        return _LazyAsyncPostgresSaver(postgres_dsn)

    except ImportError:
        logger.warning(
            "langgraph-checkpoint-postgres not installed. "
            "Install with: pip install langgraph-checkpoint-postgres"
        )
        return _create_memory_checkpointer()


class _LazyAsyncPostgresSaver(BaseCheckpointSaver):
    """Lazy wrapper for AsyncPostgresSaver that initializes on first async use."""

    def __init__(self, dsn: str):
        super().__init__()
        self._dsn = dsn
        self._saver_ctx: Optional[Any] = None
        self._saver: Optional[Any] = None
        self._initialized = False

    async def _ensure_initialized(self) -> None:
        if not self._initialized:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

            self._saver_ctx = AsyncPostgresSaver.from_conn_string(self._dsn)
            self._saver = await self._saver_ctx.__aenter__()
            await self._saver.setup()
            self._initialized = True
            logger.info("LangGraph AsyncPostgresSaver initialized and connected")

    async def aget_tuple(self, config: dict) -> Optional[CheckpointTuple]:
        await self._ensure_initialized()
        return await self._saver.aget_tuple(config)

    async def aput(
        self,
        config: dict,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> dict:
        await self._ensure_initialized()
        return await self._saver.aput(config, checkpoint, metadata, new_versions)

    async def aput_writes(
        self, config: dict, writes: Sequence[Tuple[str, Any]], task_id: str
    ) -> None:
        await self._ensure_initialized()
        return await self._saver.aput_writes(config, writes, task_id)

    async def alist(
        self,
        config: Optional[dict],
        *,
        filter: Optional[dict[str, Any]] = None,
        before: Optional[dict] = None,
        limit: Optional[int] = None,
    ) -> AsyncIterator[CheckpointTuple]:
        await self._ensure_initialized()
        async for item in self._saver.alist(
            config, filter=filter, before=before, limit=limit
        ):
            yield item

    def get_tuple(self, config: dict) -> Optional[CheckpointTuple]:
        raise NotImplementedError("Use async methods (aget_tuple) for Postgres checkpointer")

    def put(
        self, config: dict, checkpoint: Checkpoint,
        metadata: CheckpointMetadata, new_versions: ChannelVersions,
    ) -> dict:
        raise NotImplementedError("Use async methods (aput) for Postgres checkpointer")

    def put_writes(
        self, config: dict, writes: Sequence[Tuple[str, Any]], task_id: str
    ) -> None:
        raise NotImplementedError("Use async methods (aput_writes) for Postgres checkpointer")

    def list(
        self, config: Optional[dict], **kwargs: Any
    ) -> Iterator[CheckpointTuple]:
        raise NotImplementedError("Use async methods (alist) for Postgres checkpointer")


# ---------------------------------------------------------------------------
# MongoDB
# ---------------------------------------------------------------------------


def _create_mongodb_checkpointer(
    mongodb_uri: str,
    db_name: str = "",
    checkpoint_collection_name: str = "",
    writes_collection_name: str = "",
):
    """Create a MongoDB-backed checkpointer (lazy async initialization).

    Uses MongoDBSaver from langgraph-checkpoint-mongodb.

    Args:
        mongodb_uri: MongoDB connection URI.
        db_name: Database name (default: MongoDBSaver default "checkpointing_db").
        checkpoint_collection_name: Collection for checkpoints (default: "checkpoints").
        writes_collection_name: Collection for writes (default: "checkpoint_writes").
    """
    try:
        import importlib.util

        if importlib.util.find_spec("langgraph.checkpoint.mongodb") is None:
            raise ImportError("langgraph-checkpoint-mongodb not installed")

        masked_uri = mongodb_uri[:20] + "..." if len(mongodb_uri) > 20 else mongodb_uri
        logger.info(
            f"LangGraph Checkpointer: MongoDBSaver configured "
            f"(uri={masked_uri}, db={db_name or 'default'}, "
            f"checkpoints={checkpoint_collection_name or 'default'}, "
            f"writes={writes_collection_name or 'default'})"
        )
        return _LazyAsyncMongoDBSaver(
            mongodb_uri,
            db_name=db_name,
            checkpoint_collection_name=checkpoint_collection_name,
            writes_collection_name=writes_collection_name,
        )

    except ImportError:
        logger.warning(
            "langgraph-checkpoint-mongodb not installed. "
            "Install with: pip install langgraph-checkpoint-mongodb"
        )
        return _create_memory_checkpointer()


class _LazyAsyncMongoDBSaver(BaseCheckpointSaver):
    """Lazy wrapper for MongoDBSaver that initializes on first async use."""

    def __init__(
        self,
        mongodb_uri: str,
        db_name: str = "",
        checkpoint_collection_name: str = "",
        writes_collection_name: str = "",
    ):
        super().__init__()
        self._mongodb_uri = mongodb_uri
        self._db_name = db_name
        self._checkpoint_collection_name = checkpoint_collection_name
        self._writes_collection_name = writes_collection_name
        self._saver: Optional[Any] = None
        self._initialized = False

    async def _ensure_initialized(self) -> None:
        if not self._initialized:
            from pymongo import MongoClient
            from langgraph.checkpoint.mongodb.saver import MongoDBSaver

            client = MongoClient(self._mongodb_uri)
            kwargs: dict[str, Any] = {}
            if self._db_name:
                kwargs["db_name"] = self._db_name
            if self._checkpoint_collection_name:
                kwargs["checkpoint_collection_name"] = self._checkpoint_collection_name
            if self._writes_collection_name:
                kwargs["writes_collection_name"] = self._writes_collection_name
            self._saver = MongoDBSaver(client, **kwargs)
            self._initialized = True
            logger.info(
                f"LangGraph MongoDBSaver initialized "
                f"(db={self._saver.db.name}, "
                f"checkpoints={self._saver.checkpoint_collection.name}, "
                f"writes={self._saver.writes_collection.name})"
            )

    async def aget_tuple(self, config: dict) -> Optional[CheckpointTuple]:
        await self._ensure_initialized()
        return await self._saver.aget_tuple(config)

    async def aput(
        self,
        config: dict,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> dict:
        await self._ensure_initialized()
        return await self._saver.aput(config, checkpoint, metadata, new_versions)

    async def aput_writes(
        self, config: dict, writes: Sequence[Tuple[str, Any]], task_id: str
    ) -> None:
        await self._ensure_initialized()
        return await self._saver.aput_writes(config, writes, task_id)

    async def alist(
        self,
        config: Optional[dict],
        *,
        filter: Optional[dict[str, Any]] = None,
        before: Optional[dict] = None,
        limit: Optional[int] = None,
    ) -> AsyncIterator[CheckpointTuple]:
        await self._ensure_initialized()
        async for item in self._saver.alist(
            config, filter=filter, before=before, limit=limit
        ):
            yield item

    def get_tuple(self, config: dict) -> Optional[CheckpointTuple]:
        raise NotImplementedError("Use async methods (aget_tuple) for MongoDB checkpointer")

    def put(
        self, config: dict, checkpoint: Checkpoint,
        metadata: CheckpointMetadata, new_versions: ChannelVersions,
    ) -> dict:
        raise NotImplementedError("Use async methods (aput) for MongoDB checkpointer")

    def put_writes(
        self, config: dict, writes: Sequence[Tuple[str, Any]], task_id: str
    ) -> None:
        raise NotImplementedError("Use async methods (aput_writes) for MongoDB checkpointer")

    def list(
        self, config: Optional[dict], **kwargs: Any
    ) -> Iterator[CheckpointTuple]:
        raise NotImplementedError("Use async methods (alist) for MongoDB checkpointer")


# ============================================================================
# Checkpointer Singleton
# ============================================================================

_GLOBAL_CHECKPOINTER = None


def get_checkpointer():
    """Get or create the global checkpointer singleton."""
    global _GLOBAL_CHECKPOINTER
    if _GLOBAL_CHECKPOINTER is None:
        _GLOBAL_CHECKPOINTER = create_checkpointer()
    return _GLOBAL_CHECKPOINTER


def reset_checkpointer():
    """Reset the global checkpointer singleton (for testing)."""
    global _GLOBAL_CHECKPOINTER
    _GLOBAL_CHECKPOINTER = None
