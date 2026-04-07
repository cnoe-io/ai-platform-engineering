# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
PersistedLangGraphAgent — LangGraphAgent subclass with MongoDB turn persistence.

Intercepts AG-UI events yielded by the standard LangGraphAgent.run() and
persists them via TurnPersistence.  Keeps the standard
``add_langgraph_fastapi_endpoint`` pipeline intact — the only change is that
every event is recorded in MongoDB so the UI can reconstruct timelines on
page refresh.
"""

from __future__ import annotations

import logging
import uuid
from typing import AsyncGenerator

from ag_ui.core import EventType as AGUIEventType, RunAgentInput
from ag_ui_langgraph import LangGraphAgent

from ai_platform_engineering.utils.persistence.turn_persistence import TurnPersistence

logger = logging.getLogger(__name__)


class PersistedLangGraphAgent(LangGraphAgent):
    """LangGraphAgent that persists every streaming turn to MongoDB."""

    def __init__(self, *, persistence: TurnPersistence | None = None, **kwargs):
        super().__init__(**kwargs)
        self.persistence = persistence or TurnPersistence()

    def clone(self) -> "PersistedLangGraphAgent":
        return PersistedLangGraphAgent(
            name=self.name,
            graph=self.graph,
            description=self.description,
            config=self.config,
            persistence=self.persistence,
        )

    async def run(self, input: RunAgentInput) -> AsyncGenerator:
        conversation_id = input.thread_id or str(uuid.uuid4())

        # Extract user message content from the last user message
        user_content = ""
        if input.messages:
            for msg in reversed(input.messages):
                if hasattr(msg, "role") and msg.role == "user":
                    user_content = (
                        msg.content
                        if isinstance(msg.content, str)
                        else str(msg.content)
                    )
                    break

        # Extract metadata from forwardedProps (set by both UI and Slack bot)
        fwd = {}
        if hasattr(input, "forwarded_props") and isinstance(input.forwarded_props, dict):
            fwd = input.forwarded_props
        source = fwd.get("source", "web")
        turn_metadata: dict = {"source": source, "agent_id": self.name}
        if fwd.get("user_email"):
            turn_metadata["user_email"] = fwd["user_email"]
        if fwd.get("slack_channel_id"):
            turn_metadata["slack_channel_id"] = fwd["slack_channel_id"]
        if fwd.get("slack_thread_ts"):
            turn_metadata["slack_thread_ts"] = fwd["slack_thread_ts"]

        turn_id = None
        try:
            turn_id = self.persistence.create_turn(
                conversation_id=conversation_id,
                user_message={"content": user_content},
                metadata=turn_metadata,
            )
        except Exception as exc:
            logger.warning("PersistedLangGraphAgent: create_turn failed: %s", exc)

        accumulated_content: list[str] = []
        run_finished = False
        run_error = False

        try:
            async for event in super().run(input):
                if turn_id is not None:
                    try:
                        self._persist_event(
                            turn_id, conversation_id, event, accumulated_content
                        )
                    except Exception as exc:
                        logger.warning(
                            "PersistedLangGraphAgent: event persist failed: %s", exc
                        )

                if hasattr(event, "type"):
                    if event.type == AGUIEventType.RUN_FINISHED:
                        run_finished = True
                    elif event.type == AGUIEventType.RUN_ERROR:
                        run_error = True

                yield event
        except GeneratorExit:
            # Client disconnected (e.g. page refresh) — generator cancelled.
            # Do NOT re-raise; just let finally handle cleanup.
            pass
        except Exception:
            run_error = True
            raise
        finally:
            if turn_id is not None:
                if run_error:
                    final_status = "failed"
                elif run_finished:
                    final_status = "completed"
                else:
                    # Stream ended without RUN_FINISHED — client disconnected
                    final_status = "interrupted"
                    logger.info(
                        "PersistedLangGraphAgent: turn %s interrupted (no RUN_FINISHED received)",
                        turn_id,
                    )
                try:
                    self.persistence.complete_turn(
                        turn_id, "".join(accumulated_content), final_status
                    )
                except Exception as exc:
                    logger.warning(
                        "PersistedLangGraphAgent: complete_turn failed: %s", exc
                    )

    # ------------------------------------------------------------------
    # Event → persistence mapping
    # ------------------------------------------------------------------

    def _persist_event(
        self,
        turn_id: str,
        conversation_id: str,
        event,
        accumulated_content: list[str],
    ) -> None:
        if not hasattr(event, "type"):
            return

        et = event.type

        if et == AGUIEventType.TEXT_MESSAGE_CONTENT:
            delta = getattr(event, "delta", "")
            if delta:
                accumulated_content.append(delta)
                self.persistence.append_content(turn_id, delta)
                self.persistence.append_event(
                    turn_id,
                    "content",
                    {
                        "content": delta,
                        "is_final": False,
                        "agui_type": "TEXT_MESSAGE_CONTENT",
                    },
                    conversation_id=conversation_id,
                )

        elif et == AGUIEventType.TOOL_CALL_START:
            self.persistence.append_event(
                turn_id,
                "tool_start",
                {
                    "tool_name": getattr(event, "tool_call_name", ""),
                    "tool_call_id": getattr(event, "tool_call_id", ""),
                    "agui_type": "TOOL_CALL_START",
                },
                conversation_id=conversation_id,
            )

        elif et == AGUIEventType.TOOL_CALL_END:
            self.persistence.append_event(
                turn_id,
                "tool_end",
                {
                    "tool_call_id": getattr(event, "tool_call_id", ""),
                    "agui_type": "TOOL_CALL_END",
                },
                conversation_id=conversation_id,
            )

        elif et == AGUIEventType.STATE_DELTA:
            delta = getattr(event, "delta", [])
            if isinstance(delta, list) and any(
                isinstance(op, dict) and "/steps" in op.get("path", "")
                for op in delta
            ):
                self.persistence.append_event(
                    turn_id,
                    "plan_update",
                    {
                        "delta": [
                            dict(op) if hasattr(op, "__dict__") else op
                            for op in delta
                        ],
                        "agui_type": "STATE_DELTA",
                    },
                    conversation_id=conversation_id,
                )

        elif et == AGUIEventType.STATE_SNAPSHOT:
            snapshot = getattr(event, "snapshot", None)
            if isinstance(snapshot, dict) and isinstance(snapshot.get("todos"), list):
                self.persistence.append_event(
                    turn_id,
                    "plan_update",
                    {
                        "todos": snapshot["todos"],
                        "agui_type": "STATE_SNAPSHOT",
                    },
                    conversation_id=conversation_id,
                )

        elif et == AGUIEventType.CUSTOM:
            if getattr(event, "name", "") == "INPUT_REQUIRED":
                self.persistence.append_event(
                    turn_id,
                    "input_required",
                    {
                        "fields": getattr(event, "value", {}),
                        "agui_type": "CUSTOM",
                        "custom_name": "INPUT_REQUIRED",
                    },
                    conversation_id=conversation_id,
                )
