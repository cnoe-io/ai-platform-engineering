# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
"""
Persisted stream wrapper for Platform Engineer supervisor.

Wraps the supervisor's event stream and adds turn/event persistence.
Used by both SSE and A2A protocol bindings so that persistence logic
lives in one place rather than being duplicated per protocol.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from typing import Any

from ai_platform_engineering.utils.persistence.turn_persistence import (
    TurnPersistence,
    normalize_a2a_event,
)

logger = logging.getLogger(__name__)


class PersistedStreamHandler:
    """Wraps supervisor streaming with turn persistence.

    Parameters
    ----------
    persistence:
        Optional pre-built :class:`TurnPersistence` instance.  When omitted a
        new instance is created (no-op when MongoDB is unavailable).
    """

    def __init__(self, persistence: TurnPersistence | None = None) -> None:
        self.persistence = persistence or TurnPersistence()

    async def stream_with_persistence(
        self,
        source: AsyncGenerator[Any, None],
        conversation_id: str,
        user_message: dict,
        metadata: dict,
    ) -> AsyncGenerator[Any, None]:
        """Wrap an existing async event stream with turn persistence.

        Yields exactly the same events as *source* while:

        1. Creating a turn document before the first event is yielded.
        2. Persisting tool/plan/content events to ``stream_events`` during
           streaming.
        3. Completing the turn (with final content and status) when streaming
           ends, whether normally or via an exception.

        Parameters
        ----------
        source:
            The raw async iterable of events produced by the supervisor (e.g.
            the generator returned by ``AIPlatformEngineerA2ABinding.stream``).
        conversation_id:
            ID of the parent conversation (A2A ``context_id`` or SSE session
            ID).
        user_message:
            Dict with at minimum a ``content`` key.  May also include
            ``sender_email`` and ``message_id``.
        metadata:
            Dict passed verbatim to :meth:`TurnPersistence.create_turn`.
            Typically contains ``source``, ``trace_id``, and ``agent_id``.

        Yields
        ------
        Any
            Each event from *source*, unmodified.
        """
        turn_id = self.persistence.create_turn(
            conversation_id=conversation_id,
            user_message=user_message,
            metadata=metadata,
        )

        content_chunks: list[str] = []
        final_status = "completed"

        try:
            async for event in source:
                # Only dict events carry persistence-relevant data.
                if isinstance(event, dict):
                    try:
                        normalized = normalize_a2a_event(event)
                        evt_type = normalized["type"]

                        # Persist structured events immediately.
                        if evt_type in (
                            "tool_start",
                            "tool_end",
                            "plan_update",
                            "subagent_start",
                            "subagent_end",
                            "input_required",
                        ):
                            self.persistence.append_event(
                                turn_id=turn_id,
                                event_type=evt_type,
                                data=normalized["data"],
                                namespace=normalized.get("namespace"),
                                conversation_id=conversation_id,
                            )
                        elif evt_type == "content":
                            raw_content = normalized["data"].get("content", "")
                            if raw_content:
                                content_chunks.append(raw_content)
                                self.persistence.append_content(turn_id, raw_content)
                    except Exception as persist_err:
                        logger.debug(
                            f"PersistedStreamHandler: event persist error (non-fatal): {persist_err}"
                        )

                    # Detect terminal events to choose the right final status.
                    if event.get("require_user_input"):
                        final_status = "waiting_for_input"
                    elif event.get("is_task_complete"):
                        final_status = "completed"

                yield event

        except Exception:
            final_status = "failed"
            raise
        finally:
            final_content = "".join(content_chunks)
            self.persistence.complete_turn(turn_id, final_content, final_status)

    # ------------------------------------------------------------------
    # Convenience properties / accessors
    # ------------------------------------------------------------------

    def get_turn_id_for(self, conversation_id: str) -> str | None:
        """Look up the most-recent turn_id for a conversation.

        Useful for callers that need to attach extra events after streaming
        ends (e.g. token-count updates).  Returns ``None`` when MongoDB is
        unavailable or the conversation has no turns yet.
        """
        turns = self.persistence.get_turns(conversation_id)
        if turns:
            return turns[-1].get("_id")
        return None
