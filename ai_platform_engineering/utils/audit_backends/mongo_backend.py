# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6
"""MongoDB audit log backend (default).

Preserves the original fire-and-forget insert behaviour from
``audit_logger._persist_to_mongo``: writes to the ``audit_events`` collection
and ensures indexes on first write.
"""

import logging
import os
import threading
from typing import Any, Dict

from pymongo.errors import PyMongoError

from ai_platform_engineering.utils.mongodb_client import get_mongodb_client

try:
    from loguru import logger
except ImportError:
    logger = logging.getLogger(__name__)

AUDIT_COLLECTION = "audit_events"

_indexes_lock = threading.Lock()
_indexes_ensured: Dict[str, bool] = {"done": False}


def _ensure_indexes() -> None:
    """Create indexes once per process (idempotent, thread-safe)."""
    if _indexes_ensured["done"]:
        return
    with _indexes_lock:
        if _indexes_ensured["done"]:
            return
        client = get_mongodb_client()
        if client is None:
            return
        database = os.getenv("MONGODB_DATABASE", "caipe")
        try:
            coll = client[database][AUDIT_COLLECTION]
            coll.create_index([("ts", -1)])
            coll.create_index([("type", 1), ("ts", -1)])
            coll.create_index([("subject_hash", 1), ("ts", -1)])
            coll.create_index([("agent_name", 1), ("ts", -1)])
            coll.create_index([("correlation_id", 1)])
            _indexes_ensured["done"] = True
            logger.info("audit_events indexes ensured")
        except PyMongoError as exc:
            logger.warning(f"[audit/mongo] Failed to create indexes: {exc}")


class MongoBackend:
    """Inserts audit events into the MongoDB ``audit_events`` collection."""

    def write(self, event: Dict[str, Any]) -> None:
        """Fire-and-forget insert. Never raises."""
        client = get_mongodb_client()
        if client is None:
            return
        _ensure_indexes()
        database = os.getenv("MONGODB_DATABASE", "caipe")
        try:
            coll = client[database][AUDIT_COLLECTION]
            coll.insert_one(event)
        except PyMongoError as exc:
            logger.warning(f"[audit/mongo] Failed to persist audit event: {exc}")
