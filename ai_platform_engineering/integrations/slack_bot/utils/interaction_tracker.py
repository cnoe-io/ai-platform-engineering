# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Slack Interaction Tracker

Records one document per Slack thread where the bot participated,
stored in the `slack_interactions` MongoDB collection. Also upserts
into `conversations` (source: "slack") and `users` collections so
that Slack activity is visible alongside web data in the admin dashboard.
"""

import datetime
from typing import Optional
from loguru import logger

from .session_manager import SessionManager


class InteractionTracker:
    """
    Records Slack thread interactions to MongoDB for platform statistics.

    Each thread gets a single document in `slack_interactions`, upserted
    on (thread_ts, channel_id). Escalation is tracked separately when a
    non-bot, non-asker human replies in the thread.

    On every response the bot sends it also:
    - Upserts a `conversations` doc keyed by ``slack-{thread_ts}``
    - Upserts a `users` doc keyed by the user's email
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

        Also upserts the ``conversations`` and ``users`` collections so
        that Slack data appears alongside web data in admin stats.
        """
        if self._db is None:
            return

        now = datetime.datetime.utcnow()
        ts = event_timestamp or now
        conversation_id = f"slack-{thread_ts}"

        # ── slack_interactions ───────────────────────────────────────
        try:
            self._db["slack_interactions"].update_one(
                {"thread_ts": thread_ts, "channel_id": channel_id},
                {
                    "$set": {
                        "channel_name": channel_name,
                        "user_email": user_email,
                        "interaction_type": interaction_type,
                        "trace_id": trace_id,
                        "context_id": context_id,
                        "response_time_ms": response_time_ms,
                        "conversation_id": conversation_id,
                        "updated_at": now,
                    },
                    "$setOnInsert": {
                        "user_id": user_id,
                        "timestamp": ts,
                        "escalated": False,
                    },
                },
                upsert=True,
            )
        except Exception as e:
            logger.warning(f"Failed to record interaction for {thread_ts}: {e}")

        # ── conversations (source: "slack") ──────────────────────────
        try:
            title = f"#{channel_name} thread" if channel_name else f"Slack thread"
            self._db["conversations"].update_one(
                {"_id": conversation_id},
                {
                    "$setOnInsert": {
                        "title": title,
                        "owner_id": user_email or user_id,
                        "source": "slack",
                        "channel_id": channel_id,
                        "channel_name": channel_name,
                        "created_at": ts,
                        "sharing": {"shared_with": [], "is_shared": False},
                        "tags": [],
                        "is_archived": False,
                    },
                    "$inc": {"message_count": 2},  # +1 user question, +1 bot reply
                    "$set": {"updated_at": now},
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

    def mark_escalated(self, thread_ts: str, channel_id: str) -> None:
        """Mark a thread as escalated (a non-bot, non-asker human replied)."""
        if self._db is None:
            return

        try:
            self._db["slack_interactions"].update_one(
                {"thread_ts": thread_ts, "channel_id": channel_id},
                {
                    "$set": {
                        "escalated": True,
                        "updated_at": datetime.datetime.utcnow(),
                    },
                },
            )
        except Exception as e:
            logger.warning(f"Failed to mark escalation for {thread_ts}: {e}")
