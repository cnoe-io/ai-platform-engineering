# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Slack Interaction Tracker

Records Slack thread metadata directly on the ``conversations`` collection
(via an embedded ``slack_meta`` sub-document) and upserts ``users``.
Also writes lightweight ``messages`` docs (no content, just metadata)
for per-response tracking (message counts, daily/hourly activity).
"""

import datetime
import uuid
from typing import Optional
from loguru import logger

from .session_manager import SessionManager


class InteractionTracker:
    """
    Records Slack interactions to MongoDB for platform statistics.

    Each Slack thread maps to a ``conversations`` doc with ``source: "slack"``
    and an embedded ``slack_meta`` field holding Slack-specific metadata
    (escalation, interaction type, channel info, etc.).

    On every bot response it also:
    - Upserts a ``users`` doc keyed by the user's email
    - Writes a lightweight ``messages`` doc (no content, just metadata)
      for per-response message counts and activity tracking
    """

    def __init__(self, session_manager: SessionManager):
        self._db = session_manager.get_db()

    def record_interaction(
        self,
        thread_ts: str,
        channel_id: str,
        channel_name: Optional[str],
        user_id: str,
        user_email: Optional[str],
        interaction_type: str,  # "mention" | "qanda" | "dm" | "alert"
        trace_id: Optional[str] = None,
        context_id: Optional[str] = None,
        response_time_ms: Optional[int] = None,
        user_name: Optional[str] = None,
        event_timestamp: Optional[datetime.datetime] = None,
    ) -> None:
        """Record or update an interaction for a Slack thread.

        Upserts ``conversations`` (with embedded ``slack_meta``) and ``users``.
        """
        if self._db is None:
            return

        now = datetime.datetime.utcnow()
        ts = event_timestamp or now
        conversation_id = f"slack-{thread_ts}"

        # ── conversations (source: "slack", with embedded slack_meta) ──
        try:
            title = f"{channel_name} thread" if channel_name else "Slack thread"
            self._db["conversations"].update_one(
                {"_id": conversation_id},
                {
                    "$setOnInsert": {
                        "title": title,
                        "owner_id": user_email or user_id,
                        "source": "slack",
                        "created_at": ts,
                        "sharing": {"shared_with": [], "is_shared": False},
                        "tags": [],
                        "is_archived": False,
                    },
                    "$inc": {"message_count": 2},  # +1 user question, +1 bot reply
                    "$set": {
                        "updated_at": now,
                        "slack_meta": {
                            "thread_ts": thread_ts,
                            "channel_id": channel_id,
                            "channel_name": channel_name,
                            "user_id": user_id,
                            "user_email": user_email,
                            "interaction_type": interaction_type,
                            "escalated": False,
                            "trace_id": trace_id,
                            "context_id": context_id,
                            "response_time_ms": response_time_ms,
                        },
                    },
                },
                upsert=True,
            )
        except Exception as e:
            logger.warning(f"Failed to upsert conversation for {thread_ts}: {e}")

        # ── users (keyed by email) ───────────────────────────────────
        if user_email:
            try:
                self._db["users"].update_one(
                    {"email": user_email},
                    {
                        "$setOnInsert": {
                            "email": user_email,
                            "name": user_name or user_email.split("@")[0],
                            "role": "user",
                            "source": "slack",
                            "slack_user_id": user_id,
                            "created_at": now,
                        },
                        "$set": {"last_login": now},
                    },
                    upsert=True,
                )
            except Exception as e:
                logger.warning(f"Failed to upsert user {user_email}: {e}")

        # ── messages (lightweight, no content — for message counts) ──
        try:
            message_id = f"slack-{thread_ts}-{uuid.uuid4().hex[:8]}"
            self._db["messages"].insert_one({
                "message_id": message_id,
                "conversation_id": conversation_id,
                "owner_id": user_email or user_id,
                "role": "assistant",
                "content": None,
                "metadata": {
                    "source": "slack",
                },
                "created_at": now,
                "updated_at": now,
            })
        except Exception as e:
            logger.warning(f"Failed to write message for {thread_ts}: {e}")

    def mark_escalated(self, thread_ts: str, channel_id: str) -> None:
        """Mark a thread as escalated (a non-bot, non-asker human replied)."""
        if self._db is None:
            return

        conversation_id = f"slack-{thread_ts}"
        try:
            self._db["conversations"].update_one(
                {"_id": conversation_id, "source": "slack"},
                {
                    "$set": {
                        "slack_meta.escalated": True,
                        "updated_at": datetime.datetime.utcnow(),
                    },
                },
            )
        except Exception as e:
            logger.warning(f"Failed to mark escalation for {thread_ts}: {e}")
