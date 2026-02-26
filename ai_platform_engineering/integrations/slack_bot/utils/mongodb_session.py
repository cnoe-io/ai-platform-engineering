# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
MongoDB Session Store

Replaces Redis for persistent session storage. Uses the platform's existing
MongoDB instance (caipe-ui-mongodb).

Collections:
  - slack_sessions: thread_ts -> context_id, trace_id, etc.
  - slack_users: cached Slack user info to avoid API rate limits

Data is stored permanently (no TTL) to match the UI's conversation lifecycle.
"""

import datetime
from typing import Optional
from loguru import logger

from pymongo import MongoClient
from pymongo.errors import PyMongoError


class MongoDBSessionStore:
    """
    MongoDB-backed session store for Slack bot conversations.

    Provides the same interface as InMemorySessionStore but persists
    data across restarts via MongoDB.
    """

    def __init__(self, uri: str, database: str = "caipe"):
        self._client = MongoClient(
            uri,
            serverSelectionTimeoutMS=5000,
            retryWrites=True,
        )
        self._db = self._client[database]
        self._sessions = self._db["slack_sessions"]
        self._users = self._db["slack_users"]
        self._ensure_indexes()
        logger.info(f"MongoDB session store initialized (database: {database})")

    def _ensure_indexes(self):
        """Create unique indexes for fast lookups."""
        try:
            self._sessions.create_index("thread_ts", unique=True)
            self._users.create_index("slack_user_id", unique=True)
            logger.info("MongoDB indexes ensured for slack_sessions and slack_users")
        except PyMongoError as e:
            logger.error(f"Failed to create MongoDB indexes: {e}")

    @classmethod
    def from_env(cls) -> Optional["MongoDBSessionStore"]:
        """Create a MongoDBSessionStore from environment variables."""
        import os

        uri = os.environ.get("MONGODB_URI")
        database = os.environ.get("MONGODB_DATABASE", "caipe")

        if not uri:
            return None

        try:
            return cls(uri=uri, database=database)
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            return None

    def is_available(self) -> bool:
        """Check if MongoDB is reachable."""
        try:
            self._client.admin.command("ping")
            return True
        except PyMongoError:
            return False

    # ---- Context ID (A2A session) ----

    def get_context_id(self, thread_ts: str) -> Optional[str]:
        """Get the A2A context ID for a Slack thread."""
        try:
            doc = self._sessions.find_one({"thread_ts": thread_ts}, {"context_id": 1})
            if doc and doc.get("context_id"):
                return doc["context_id"]
            return None
        except PyMongoError as e:
            logger.warning(f"Failed to get context_id for {thread_ts}: {e}")
            return None

    def set_context_id(self, thread_ts: str, context_id: str) -> None:
        """Store the A2A context ID for a Slack thread."""
        now = datetime.datetime.utcnow()
        try:
            self._sessions.update_one(
                {"thread_ts": thread_ts},
                {
                    "$set": {
                        "context_id": context_id,
                        "updated_at": now,
                    },
                    "$setOnInsert": {"created_at": now},
                },
                upsert=True,
            )
        except PyMongoError as e:
            logger.warning(f"Failed to set context_id for {thread_ts}: {e}")

    def delete_context_id(self, thread_ts: str) -> None:
        """Delete the entire session document for a thread."""
        try:
            self._sessions.delete_one({"thread_ts": thread_ts})
        except PyMongoError as e:
            logger.warning(f"Failed to delete session for {thread_ts}: {e}")

    # ---- Trace ID (Langfuse) ----

    def get_trace_id(self, thread_ts: str) -> Optional[str]:
        """Get the Langfuse trace ID for a Slack thread."""
        try:
            doc = self._sessions.find_one({"thread_ts": thread_ts}, {"trace_id": 1})
            if doc and doc.get("trace_id"):
                return doc["trace_id"]
            return None
        except PyMongoError as e:
            logger.warning(f"Failed to get trace_id for {thread_ts}: {e}")
            return None

    def set_trace_id(self, thread_ts: str, trace_id: str) -> None:
        """Store the Langfuse trace ID for a Slack thread."""
        now = datetime.datetime.utcnow()
        try:
            self._sessions.update_one(
                {"thread_ts": thread_ts},
                {
                    "$set": {
                        "trace_id": trace_id,
                        "updated_at": now,
                    },
                    "$setOnInsert": {"created_at": now},
                },
                upsert=True,
            )
        except PyMongoError as e:
            logger.warning(f"Failed to set trace_id for {thread_ts}: {e}")

    # ---- Channel ID ----

    def set_channel_id(self, thread_ts: str, channel_id: str) -> None:
        """Store the channel ID for a thread."""
        try:
            self._sessions.update_one(
                {"thread_ts": thread_ts},
                {"$set": {"channel_id": channel_id}},
                upsert=True,
            )
        except PyMongoError as e:
            logger.warning(f"Failed to set channel_id for {thread_ts}: {e}")

    # ---- Skipped (overthink mode) ----

    def set_skipped(self, thread_ts: str, skipped: bool = True) -> None:
        """Mark a thread as having a skipped response (persists with session)."""
        try:
            self._sessions.update_one(
                {"thread_ts": thread_ts},
                {"$set": {"is_skipped": skipped, "updated_at": datetime.datetime.utcnow()}},
                upsert=True,
            )
        except PyMongoError as e:
            logger.warning(f"Failed to set skipped for {thread_ts}: {e}")

    def is_skipped(self, thread_ts: str) -> bool:
        """Check if a thread has a skipped response."""
        try:
            doc = self._sessions.find_one({"thread_ts": thread_ts}, {"is_skipped": 1})
            return doc.get("is_skipped", False) if doc else False
        except PyMongoError as e:
            logger.warning(f"Failed to check skipped for {thread_ts}: {e}")
            return False

    def clear_skipped(self, thread_ts: str) -> None:
        """Clear the skipped flag for a thread."""
        try:
            self._sessions.update_one(
                {"thread_ts": thread_ts},
                {"$set": {"is_skipped": False}},
            )
        except PyMongoError as e:
            logger.warning(f"Failed to clear skipped for {thread_ts}: {e}")

    # ---- User info cache ----

    def get_user_info(self, user_id: str) -> Optional[dict]:
        """Get cached Slack user info."""
        try:
            doc = self._users.find_one({"slack_user_id": user_id})
            if doc and doc.get("user_info"):
                return doc["user_info"]
            return None
        except PyMongoError as e:
            logger.warning(f"Failed to get user_info for {user_id}: {e}")
            return None

    def set_user_info(self, user_id: str, user_info: dict) -> None:
        """Cache Slack user info to avoid rate limits."""
        now = datetime.datetime.utcnow()
        try:
            self._users.update_one(
                {"slack_user_id": user_id},
                {
                    "$set": {
                        "user_info": user_info,
                        "updated_at": now,
                    },
                    "$setOnInsert": {"created_at": now},
                },
                upsert=True,
            )
        except PyMongoError as e:
            logger.warning(f"Failed to set user_info for {user_id}: {e}")

    # ---- Stats ----

    def get_stats(self) -> dict:
        """Get statistics about the session store."""
        try:
            return {
                "type": "mongodb",
                "session_count": self._sessions.estimated_document_count(),
                "user_cache_count": self._users.estimated_document_count(),
            }
        except PyMongoError as e:
            logger.warning(f"Failed to get stats: {e}")
            return {"type": "mongodb", "error": str(e)}
