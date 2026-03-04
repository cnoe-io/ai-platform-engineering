# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Shared MongoDB Client

Provides a singleton pymongo client for the Python backend services.
Used by the supervisor agent to read task configs from MongoDB.

Reuses the same MONGODB_URI / MONGODB_DATABASE env vars as the UI and Slack bot.
"""

import os
import time
from typing import Optional

from loguru import logger
from pymongo import MongoClient
from pymongo.errors import PyMongoError

_client: Optional[MongoClient] = None
_task_config_cache: Optional[dict] = None
_task_config_cache_time: float = 0.0

TASK_CONFIG_CACHE_TTL = int(os.getenv("TASK_CONFIG_CACHE_TTL", "60"))


def get_mongodb_client() -> Optional[MongoClient]:
    """Get or create the shared MongoDB client singleton.

    Returns None if MONGODB_URI is not configured.
    """
    global _client

    uri = os.getenv("MONGODB_URI")
    if not uri:
        return None

    if _client is not None:
        return _client

    database = os.getenv("MONGODB_DATABASE", "caipe")
    try:
        _client = MongoClient(
            uri,
            serverSelectionTimeoutMS=5000,
            retryWrites=False,
        )
        # Verify connectivity
        _client.admin.command("ping")
        logger.info(f"MongoDB client connected (database: {database})")
        return _client
    except PyMongoError as e:
        logger.warning(f"Failed to connect to MongoDB: {e}")
        _client = None
        return None


def get_task_configs_from_mongodb() -> Optional[dict]:
    """Fetch all task configs from MongoDB and return in task_config.yaml dict format.

    Returns a dict keyed by workflow name with ``{tasks: [...]}`` values,
    matching the structure that ``invoke_self_service_task`` expects.

    Uses an in-memory cache with configurable TTL to avoid per-request queries.

    Returns None if MongoDB is not available or the collection is empty.
    """
    global _task_config_cache, _task_config_cache_time

    now = time.time()
    if _task_config_cache is not None and (now - _task_config_cache_time) < TASK_CONFIG_CACHE_TTL:
        return _task_config_cache

    client = get_mongodb_client()
    if client is None:
        return None

    database = os.getenv("MONGODB_DATABASE", "caipe")
    try:
        db = client[database]
        collection = db["task_configs"]

        docs = list(collection.find({}, {"_id": 0, "name": 1, "tasks": 1}))
        if not docs:
            return None

        result: dict = {}
        for doc in docs:
            name = doc.get("name")
            tasks = doc.get("tasks", [])
            if name and tasks:
                result[name] = {
                    "tasks": [
                        {
                            "display_text": t.get("display_text", ""),
                            "llm_prompt": t.get("llm_prompt", ""),
                            "subagent": t.get("subagent", "caipe"),
                        }
                        for t in tasks
                    ]
                }

        if result:
            _task_config_cache = result
            _task_config_cache_time = now
            logger.info(f"Loaded {len(result)} task configs from MongoDB")
            return result

        return None
    except PyMongoError as e:
        logger.warning(f"Failed to read task configs from MongoDB: {e}")
        return None


def invalidate_task_config_cache() -> None:
    """Clear the in-memory task config cache, forcing a fresh read on next access."""
    global _task_config_cache, _task_config_cache_time
    _task_config_cache = None
    _task_config_cache_time = 0.0
