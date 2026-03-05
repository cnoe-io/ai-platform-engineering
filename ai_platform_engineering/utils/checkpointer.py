# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
LangGraph Checkpointer factory for in-thread conversation state persistence.

Provides a pluggable checkpointer backend (InMemorySaver default, RedisSaver,
PostgresSaver, or MongoDBSaver) that persists conversation state within a
thread so that multi-turn conversations survive pod restarts.

Configuration via environment variables:
    LANGGRAPH_CHECKPOINT_TYPE: memory (default) | redis | postgres | mongodb
    LANGGRAPH_CHECKPOINT_REDIS_URL: Redis Stack connection string
    LANGGRAPH_CHECKPOINT_POSTGRES_DSN: Postgres DSN
    LANGGRAPH_CHECKPOINT_MONGODB_URI: MongoDB connection URI
    LANGGRAPH_CHECKPOINT_TTL_MINUTES: TTL for checkpoints (0 = no expiry)

Usage:
    from ai_platform_engineering.utils.checkpointer import create_checkpointer, get_checkpointer

    checkpointer = create_checkpointer()  # Returns configured checkpointer
"""

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

CHECKPOINT_TYPE_MEMORY = "memory"
CHECKPOINT_TYPE_REDIS = "redis"
CHECKPOINT_TYPE_POSTGRES = "postgres"
CHECKPOINT_TYPE_MONGODB = "mongodb"


def get_checkpointer_config() -> dict[str, Any]:
  """Read checkpointer configuration from environment variables."""
  return {
    "type": os.getenv("LANGGRAPH_CHECKPOINT_TYPE", CHECKPOINT_TYPE_MEMORY).lower(),
    "redis_url": os.getenv("LANGGRAPH_CHECKPOINT_REDIS_URL", ""),
    "postgres_dsn": os.getenv("LANGGRAPH_CHECKPOINT_POSTGRES_DSN") or os.getenv("POSTGRES_DSN", ""),
    "mongodb_uri": os.getenv("LANGGRAPH_CHECKPOINT_MONGODB_URI") or os.getenv("MONGODB_URI", ""),
    "ttl_minutes": int(os.getenv("LANGGRAPH_CHECKPOINT_TTL_MINUTES", "0")),
  }


def create_checkpointer():
  """Create a LangGraph checkpointer based on environment configuration.

  Returns:
      A checkpointer instance (InMemorySaver, RedisSaver, PostgresSaver, or MongoDBSaver).
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
          "(set LANGGRAPH_CHECKPOINT_POSTGRES_DSN or POSTGRES_DSN). Falling back to InMemorySaver."
        )
        return _create_memory_checkpointer()
      return _create_postgres_checkpointer(postgres_dsn)

    elif checkpoint_type == CHECKPOINT_TYPE_MONGODB:
      mongodb_uri = config["mongodb_uri"]
      if not mongodb_uri:
        logger.warning(
          "LANGGRAPH_CHECKPOINT_TYPE=mongodb but no MongoDB URI configured "
          "(set LANGGRAPH_CHECKPOINT_MONGODB_URI or MONGODB_URI). Falling back to InMemorySaver."
        )
        return _create_memory_checkpointer()
      return _create_mongodb_checkpointer(mongodb_uri)

    else:
      if checkpoint_type != CHECKPOINT_TYPE_MEMORY:
        logger.warning(f"Unknown LANGGRAPH_CHECKPOINT_TYPE='{checkpoint_type}', using InMemorySaver")
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


def _create_redis_checkpointer(redis_url: str, ttl_minutes: int = 0):
  """Create a Redis-backed checkpointer using langgraph-checkpoint-redis.

  Requires Redis 8.0+ or Redis Stack (RedisJSON + RediSearch modules).

  Args:
      redis_url: Redis connection string (e.g. redis://host:6379)
      ttl_minutes: TTL for checkpoints in minutes (0 = no expiry)
  """
  try:
    from langgraph.checkpoint.redis import RedisSaver

    ttl_config = None
    if ttl_minutes > 0:
      ttl_config = {
        "default_ttl": ttl_minutes,
        "refresh_on_read": True,
      }

    checkpointer = RedisSaver.from_conn_string(redis_url, ttl=ttl_config)
    checkpointer.setup()

    masked_url = redis_url[:15] + "..." if len(redis_url) > 15 else redis_url
    logger.info(
      f"LangGraph Checkpointer: RedisSaver created "
      f"(url={masked_url}, ttl={ttl_minutes}m)"
    )
    return checkpointer

  except ImportError:
    logger.warning(
      "langgraph-checkpoint-redis not installed. "
      "Install with: pip install langgraph-checkpoint-redis"
    )
    return _create_memory_checkpointer()
  except Exception as e:
    logger.error(f"Failed to create Redis checkpointer: {e}")
    raise


def _create_postgres_checkpointer(postgres_dsn: str):
  """Create a Postgres-backed checkpointer using langgraph-checkpoint-postgres.

  Args:
      postgres_dsn: Postgres DSN (e.g. postgresql://user:pass@host:5432/dbname)
  """
  try:
    from langgraph.checkpoint.postgres import PostgresSaver

    checkpointer = PostgresSaver.from_conn_string(postgres_dsn)
    checkpointer.setup()

    masked_dsn = postgres_dsn[:20] + "..." if len(postgres_dsn) > 20 else postgres_dsn
    logger.info(f"LangGraph Checkpointer: PostgresSaver created (dsn={masked_dsn})")
    return checkpointer

  except ImportError:
    logger.warning(
      "langgraph-checkpoint-postgres not installed. "
      "Install with: pip install langgraph-checkpoint-postgres"
    )
    return _create_memory_checkpointer()
  except Exception as e:
    logger.error(f"Failed to create Postgres checkpointer: {e}")
    raise


def _create_mongodb_checkpointer(mongodb_uri: str):
  """Create a MongoDB-backed checkpointer using langgraph-checkpoint-mongodb.

  Args:
      mongodb_uri: MongoDB connection URI (e.g. mongodb://host:27017)
  """
  try:
    from langgraph.checkpoint.mongodb import MongoDBSaver

    checkpointer = MongoDBSaver.from_conn_string(mongodb_uri)

    masked_uri = mongodb_uri[:20] + "..." if len(mongodb_uri) > 20 else mongodb_uri
    logger.info(f"LangGraph Checkpointer: MongoDBSaver created (uri={masked_uri})")
    return checkpointer

  except ImportError:
    logger.warning(
      "langgraph-checkpoint-mongodb not installed. "
      "Install with: pip install langgraph-checkpoint-mongodb"
    )
    return _create_memory_checkpointer()
  except Exception as e:
    logger.error(f"Failed to create MongoDB checkpointer: {e}")
    raise


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
