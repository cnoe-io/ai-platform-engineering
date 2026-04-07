# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
TurnPersistence Service

Persists every streaming turn and its individual events into MongoDB so that
UI and Slack-bot interfaces can become stateless consumers instead of direct
MongoDB writers.

Collections
-----------
- ``turns``        One document per user↔assistant exchange.
- ``stream_events``  Individual SSE/streaming events within a turn.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Literal

from pymongo.errors import PyMongoError

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

TurnStatus = Literal["streaming", "completed", "interrupted", "waiting_for_input", "failed"]
EventType = Literal[
    "tool_start",
    "tool_end",
    "content",
    "todo_update",
    "subagent_start",
    "subagent_end",
    "input_required",
    "warning",
    "error",
    "plan_update",
]
Source = Literal["web", "slack"]


# ---------------------------------------------------------------------------
# Event normalisation helper
# ---------------------------------------------------------------------------

def normalize_a2a_event(event: dict) -> dict:
    """Map a raw A2A streaming event dict to a normalised persistence payload.

    The returned dict contains at minimum:
      - ``type``      (EventType string)
      - ``data``      (type-specific payload dict)
      - ``namespace`` (list[str], agent hierarchy for subagent correlation)

    Parameters
    ----------
    event:
        Raw dict yielded by the A2A agent stream.

    Returns
    -------
    dict
        Normalised event with ``type``, ``data``, and ``namespace`` keys.
    """
    artifact_payload = event.get("artifact") or {}
    artifact_name: str = artifact_payload.get("name", "")

    # Resolve namespace from source_agent or metadata
    namespace: list[str] = []
    source_agent = event.get("source_agent")
    if source_agent:
        namespace = [source_agent]

    # -- Tool notifications --------------------------------------------------
    if artifact_name == "tool_notification_start" or event.get("tool_call"):
        tool_call = event.get("tool_call") or {}
        return {
            "type": "tool_start",
            "data": {
                "tool_name": tool_call.get("name", artifact_payload.get("description", "")),
                "tool_call_id": tool_call.get("id"),
                "arguments": tool_call.get("arguments"),
                "content": artifact_payload.get("text", event.get("content", "")),
            },
            "namespace": namespace,
        }

    if artifact_name == "tool_notification_end" or event.get("tool_result"):
        tool_result = event.get("tool_result") or {}
        return {
            "type": "tool_end",
            "data": {
                "tool_name": tool_result.get("name", artifact_payload.get("description", "")),
                "tool_call_id": tool_result.get("id"),
                "output": tool_result.get("output"),
                "content": artifact_payload.get("text", event.get("content", "")),
            },
            "namespace": namespace,
        }

    # -- Execution plan updates -----------------------------------------------
    if artifact_name in ("execution_plan_update", "execution_plan_status_update"):
        return {
            "type": "plan_update",
            "data": {
                "plan_text": artifact_payload.get("text", ""),
                "artifact_name": artifact_name,
            },
            "namespace": namespace,
        }

    # -- Streaming / final content -------------------------------------------
    if artifact_name in ("streaming_result", "partial_result"):
        return {
            "type": "content",
            "data": {
                "content": artifact_payload.get("text", event.get("content", "")),
                "artifact_name": artifact_name,
                "is_final": False,
            },
            "namespace": namespace,
        }

    if artifact_name in ("final_result", "complete_result"):
        return {
            "type": "content",
            "data": {
                "content": artifact_payload.get("text", event.get("content", "")),
                "artifact_name": artifact_name,
                "is_final": True,
            },
            "namespace": namespace,
        }

    # -- Input required -------------------------------------------------------
    if event.get("require_user_input"):
        return {
            "type": "input_required",
            "data": {
                "content": event.get("content", ""),
                "metadata": event.get("metadata"),
            },
            "namespace": namespace,
        }

    # -- Sub-agent lifecycle -------------------------------------------------
    if event.get("type") == "artifact-update":
        sub_artifact = (event.get("result") or {}).get("artifact", {})
        sub_name = sub_artifact.get("name", "")
        if sub_name in ("complete_result", "final_result", "partial_result"):
            return {
                "type": "subagent_end",
                "data": {
                    "source_agent": source_agent,
                    "artifact_name": sub_name,
                    "content": " ".join(
                        p.get("text", "") for p in sub_artifact.get("parts", []) if isinstance(p, dict)
                    ),
                },
                "namespace": namespace,
            }
        return {
            "type": "subagent_start",
            "data": {
                "source_agent": source_agent,
                "artifact_name": sub_name,
            },
            "namespace": namespace,
        }

    # Raw content chunk (no artifact wrapper)
    if event.get("content") and not artifact_name:
        return {
            "type": "content",
            "data": {
                "content": event.get("content", ""),
                "is_final": bool(event.get("is_task_complete")),
            },
            "namespace": namespace,
        }

    # -- Generic / unknown ---------------------------------------------------
    return {
        "type": "content",
        "data": {"raw": event},
        "namespace": namespace,
    }


# ---------------------------------------------------------------------------
# TurnPersistence service
# ---------------------------------------------------------------------------

class TurnPersistence:
    """Persist streaming turns and events to MongoDB.

    Each public method is a no-op when MongoDB is unavailable, so the A2A
    executor can inject persistence without a hard dependency on the database.

    Parameters
    ----------
    database:
        MongoDB database name override.  Defaults to the ``MONGODB_DATABASE``
        env var (fallback ``"caipe"``).
    content_buffer_size:
        Number of content chunks to accumulate in memory before flushing
        ``append_content`` to MongoDB.  Default ``10``.
    content_flush_interval_s:
        Maximum seconds between content flushes regardless of buffer size.
        Default ``2``.
    """

    def __init__(
        self,
        *,
        database: str | None = None,
        content_buffer_size: int = 10,
        content_flush_interval_s: float = 2.0,
    ) -> None:
        from ai_platform_engineering.utils.mongodb_client import get_mongodb_client

        self._client = get_mongodb_client()
        self._db_name: str = database or os.getenv("MONGODB_DATABASE", "caipe")
        self._content_buffer_size = content_buffer_size
        self._content_flush_interval_s = content_flush_interval_s

        # Per-turn content buffer: turn_id -> (accumulated_chunks, last_flush_ts, sequence)
        self._content_buffers: dict[str, tuple[list[str], float, int]] = {}
        # Per-turn event sequence counter
        self._event_sequences: dict[str, int] = {}

        if self._client is not None:
            try:
                db = self._client[self._db_name]
                turns_coll = db["turns"]
                events_coll = db["stream_events"]

                turns_coll.create_index([("conversation_id", 1), ("sequence", 1)])
                turns_coll.create_index([("conversation_id", 1), ("created_at", 1)])
                turns_coll.create_index(
                    [("metadata.slack_thread_ts", 1)],
                    sparse=True,
                )
                events_coll.create_index([("turn_id", 1), ("sequence", 1)])
                events_coll.create_index([("conversation_id", 1), ("sequence", 1)])
                events_coll.create_index([("conversation_id", 1), ("type", 1)])
                logger.debug("TurnPersistence: MongoDB indexes ensured")
            except PyMongoError as exc:
                logger.warning(f"TurnPersistence: failed to create indexes: {exc}")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _db(self):
        """Return the MongoDB database handle or None."""
        if self._client is None:
            return None
        try:
            return self._client[self._db_name]
        except Exception:
            return None

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    def _next_event_seq(self, turn_id: str) -> int:
        seq = self._event_sequences.get(turn_id, 0)
        self._event_sequences[turn_id] = seq + 1
        return seq

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def create_turn(
        self,
        conversation_id: str,
        user_message: dict,
        metadata: dict | None = None,
    ) -> str:
        """Create a new turn document with status ``"streaming"``.

        Parameters
        ----------
        conversation_id:
            ID of the parent conversation.
        user_message:
            Dict with keys ``message_id``, ``content``, ``sender_email``
            (optional), and ``created_at`` (optional; defaults to now).
        metadata:
            Optional dict with keys ``source``, ``agent_id``, ``trace_id``,
            ``model``, ``tokens_used``, ``latency_ms``.

        Returns
        -------
        str
            The new ``turn_id`` (UUID).
        """
        turn_id = str(uuid.uuid4())
        now = self._now()

        # Ensure required user_message sub-fields
        user_msg = {
            "message_id": user_message.get("message_id", str(uuid.uuid4())),
            "content": user_message.get("content", ""),
            "sender_email": user_message.get("sender_email"),
            "created_at": user_message.get("created_at", now),
        }

        # Count existing turns to derive sequence number
        sequence = 0
        db = self._db()
        if db is not None:
            try:
                sequence = db["turns"].count_documents({"conversation_id": conversation_id})
            except PyMongoError as exc:
                logger.warning("TurnPersistence: count_documents failed for conv %s: %s", conversation_id, exc)

        doc = {
            "_id": turn_id,
            "conversation_id": conversation_id,
            "sequence": sequence,
            "user_message": user_msg,
            "assistant_message": {
                "message_id": str(uuid.uuid4()),
                "content": "",
                "created_at": now,
                "completed_at": None,
                "status": "streaming",
            },
            "metadata": {
                **(metadata or {}),
                "source": (metadata or {}).get("source", "web"),
            },
            "created_at": now,
            "updated_at": now,
        }

        if db is not None:
            try:
                db["turns"].insert_one(doc)
                logger.debug(f"TurnPersistence: created turn {turn_id} for conv {conversation_id}")
            except PyMongoError as exc:
                logger.warning(f"TurnPersistence: failed to create turn: {exc}")

        # Initialise per-turn state
        self._content_buffers[turn_id] = ([], time.monotonic(), 0)
        self._event_sequences[turn_id] = 0

        return turn_id

    def append_event(
        self,
        turn_id: str,
        event_type: EventType,
        data: dict,
        namespace: list[str] | None = None,
        conversation_id: str | None = None,
    ) -> None:
        """Insert a single event into the ``stream_events`` collection.

        Parameters
        ----------
        turn_id:
            The parent turn ID returned by :meth:`create_turn`.
        event_type:
            One of the ``EventType`` literals.
        data:
            Type-specific payload dict.
        namespace:
            Agent hierarchy list, e.g. ``["PlatformEngineer", "JiraAgent"]``.
        conversation_id:
            Denormalised conversation ID for direct queries.  When omitted,
            this method looks it up from the turns collection; if still
            unavailable, the field is stored as ``None``.
        """
        db = self._db()
        if db is None:
            return

        # Resolve conversation_id if not provided
        conv_id = conversation_id
        if conv_id is None:
            try:
                turn_doc = db["turns"].find_one({"_id": turn_id}, {"conversation_id": 1})
                if turn_doc:
                    conv_id = turn_doc.get("conversation_id")
            except PyMongoError as exc:
                logger.debug("TurnPersistence: conv_id lookup failed for turn %s: %s", turn_id, exc)

        seq = self._next_event_seq(turn_id)
        now = self._now()
        event_doc = {
            "_id": str(uuid.uuid4()),
            "turn_id": turn_id,
            "conversation_id": conv_id,
            "sequence": seq,
            "type": event_type,
            "timestamp": now,
            "namespace": namespace or [],
            "data": data,
            "created_at": now,
        }

        try:
            db["stream_events"].insert_one(event_doc)
        except PyMongoError as exc:
            logger.warning(f"TurnPersistence: failed to append event: {exc}")

    def append_content(self, turn_id: str, content: str) -> None:
        """Buffer a content chunk and flush to MongoDB when the buffer is full
        or the flush interval has elapsed.

        Uses ``$set`` on ``assistant_message.content`` with the accumulated
        content so far (not an append), which keeps the document correct even
        on partial reads.

        Parameters
        ----------
        turn_id:
            The parent turn ID.
        content:
            New content chunk to accumulate.
        """
        if turn_id not in self._content_buffers:
            self._content_buffers[turn_id] = ([content], time.monotonic(), 0)
        else:
            chunks, last_flush, flush_count = self._content_buffers[turn_id]
            chunks.append(content)
            self._content_buffers[turn_id] = (chunks, last_flush, flush_count)

        chunks, last_flush, flush_count = self._content_buffers[turn_id]
        elapsed = time.monotonic() - last_flush
        should_flush = (
            len(chunks) >= self._content_buffer_size
            or elapsed >= self._content_flush_interval_s
        )

        if should_flush:
            self._flush_content_buffer(turn_id)

    def _flush_content_buffer(self, turn_id: str) -> None:
        """Write the accumulated content buffer to MongoDB."""
        if turn_id not in self._content_buffers:
            return

        chunks, _, flush_count = self._content_buffers[turn_id]
        if not chunks:
            return

        accumulated = "".join(chunks)
        db = self._db()
        if db is not None:
            try:
                db["turns"].update_one(
                    {"_id": turn_id},
                    {
                        "$set": {
                            "assistant_message.content": accumulated,
                            "updated_at": self._now(),
                        }
                    },
                )
            except PyMongoError as exc:
                logger.warning(f"TurnPersistence: failed to flush content buffer: {exc}")

        self._content_buffers[turn_id] = (chunks, time.monotonic(), flush_count + 1)

    def complete_turn(
        self,
        turn_id: str,
        final_content: str,
        status: TurnStatus = "completed",
    ) -> None:
        """Finalise a turn with its complete content and terminal status.

        Also flushes any remaining buffered content and persists a
        ``"completed"``-type event to ``stream_events``.

        Parameters
        ----------
        turn_id:
            The turn to complete.
        final_content:
            The full assistant response text.
        status:
            Final turn status (default ``"completed"``).
        """
        # Clear buffer to avoid double-write; we'll set content explicitly below
        self._content_buffers.pop(turn_id, None)

        now = self._now()
        db = self._db()
        if db is None:
            return

        try:
            db["turns"].update_one(
                {"_id": turn_id},
                {
                    "$set": {
                        "assistant_message.content": final_content,
                        "assistant_message.status": status,
                        "assistant_message.completed_at": now,
                        "updated_at": now,
                    }
                },
            )
            logger.debug(f"TurnPersistence: completed turn {turn_id} with status={status}")
        except PyMongoError as exc:
            logger.warning(f"TurnPersistence: failed to complete turn: {exc}")

        # Persist a terminal event for downstream consumers
        self.append_event(
            turn_id=turn_id,
            event_type="content",
            data={"content": final_content, "is_final": True, "status": status},
        )

        # Clean up per-turn state
        self._event_sequences.pop(turn_id, None)

    # ------------------------------------------------------------------
    # Read helpers
    # ------------------------------------------------------------------

    def get_turns(self, conversation_id: str) -> list[dict]:
        """Return all turns for a conversation ordered by sequence.

        Parameters
        ----------
        conversation_id:
            The conversation to query.

        Returns
        -------
        list[dict]
            List of turn documents (with ``_id`` as ``turn_id``), or ``[]``
            when MongoDB is unavailable.
        """
        db = self._db()
        if db is None:
            return []
        try:
            return list(
                db["turns"]
                .find({"conversation_id": conversation_id})
                .sort("sequence", 1)
            )
        except PyMongoError as exc:
            logger.warning(f"TurnPersistence: get_turns failed: {exc}")
            return []

    def get_turn_events(self, turn_id: str) -> list[dict]:
        """Return all events for a turn ordered by sequence.

        Parameters
        ----------
        turn_id:
            The turn whose events to retrieve.

        Returns
        -------
        list[dict]
            List of stream_event documents, or ``[]`` when unavailable.
        """
        db = self._db()
        if db is None:
            return []
        try:
            return list(
                db["stream_events"]
                .find({"turn_id": turn_id})
                .sort("sequence", 1)
            )
        except PyMongoError as exc:
            logger.warning(f"TurnPersistence: get_turn_events failed: {exc}")
            return []

    def find_conversation_by_slack_thread(self, thread_ts: str) -> dict | None:
        """Look up a conversation by its Slack thread timestamp.

        Queries the ``turns`` collection for the earliest turn whose
        ``metadata.slack_thread_ts`` matches *thread_ts*.

        Returns
        -------
        dict | None
            ``{"conversation_id": ..., "metadata": ...}`` or ``None``.
        """
        db = self._db()
        if db is None:
            return None
        try:
            doc = db["turns"].find_one(
                {"metadata.slack_thread_ts": thread_ts},
                {"conversation_id": 1, "metadata": 1},
                sort=[("created_at", 1)],
            )
            if doc:
                return {
                    "conversation_id": doc["conversation_id"],
                    "metadata": doc.get("metadata", {}),
                }
            return None
        except PyMongoError as exc:
            logger.warning("TurnPersistence: find_conversation_by_slack_thread failed: %s", exc)
            return None

    def update_turn_metadata(
        self,
        thread_ts: str,
        updates: dict,
    ) -> bool:
        """Update metadata fields on the latest turn for a Slack thread.

        Parameters
        ----------
        thread_ts:
            Slack thread timestamp identifying the conversation.
        updates:
            Key-value pairs to ``$set`` under ``metadata.``.

        Returns
        -------
        bool
            ``True`` when at least one document was matched.
        """
        db = self._db()
        if db is None:
            return False
        try:
            set_fields = {f"metadata.{k}": v for k, v in updates.items()}
            set_fields["updated_at"] = self._now()
            result = db["turns"].update_one(
                {"metadata.slack_thread_ts": thread_ts},
                {"$set": set_fields},
                sort=[("created_at", -1)],  # type: ignore[call-arg]
            )
            # update_one on some drivers doesn't support sort; fall back
            return result.matched_count > 0
        except TypeError:
            # PyMongo's update_one doesn't support sort — use find + update
            try:
                doc = db["turns"].find_one(
                    {"metadata.slack_thread_ts": thread_ts},
                    {"_id": 1},
                    sort=[("created_at", -1)],
                )
                if not doc:
                    return False
                db["turns"].update_one(
                    {"_id": doc["_id"]},
                    {"$set": set_fields},
                )
                return True
            except PyMongoError as exc:
                logger.warning("TurnPersistence: update_turn_metadata fallback failed: %s", exc)
                return False
        except PyMongoError as exc:
            logger.warning("TurnPersistence: update_turn_metadata failed: %s", exc)
            return False

    def get_conversation_events(self, conversation_id: str) -> list[dict]:
        """Return all stream events for a conversation ordered by sequence.

        Parameters
        ----------
        conversation_id:
            The conversation to query.

        Returns
        -------
        list[dict]
            List of stream_event documents, or ``[]`` when unavailable.
        """
        db = self._db()
        if db is None:
            return []
        try:
            return list(
                db["stream_events"]
                .find({"conversation_id": conversation_id})
                .sort("sequence", 1)
            )
        except PyMongoError as exc:
            logger.warning(f"TurnPersistence: get_conversation_events failed: {exc}")
            return []
