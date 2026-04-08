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

import json
import logging
import uuid
from typing import AsyncGenerator

from ag_ui.core import (
    EventType as AGUIEventType,
    RunAgentInput,
    RunFinishedEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui_langgraph import LangGraphAgent
from langchain_core.messages import AIMessage, RemoveMessage, ToolMessage
from langgraph.errors import GraphRecursionError

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

        # Track write_todos tool calls so we can emit a STATE_SNAPSHOT
        # with the todos immediately when the tool completes.
        # ag_ui_langgraph suppresses the STATE_SNAPSHOT when multiple
        # tool calls are made in one model turn, so we fill the gap.
        write_todos_args: dict[str, str] = {}  # toolCallId → accumulated args JSON

        try:
            async for event in self._stream_with_intercepts(
                input, turn_id, conversation_id, accumulated_content,
                write_todos_args,
            ):
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
    # Core streaming with intercepts (write_todos snapshot + persistence)
    # ------------------------------------------------------------------

    async def _stream_with_intercepts(
        self,
        input: RunAgentInput,
        turn_id: str | None,
        conversation_id: str,
        accumulated_content: list[str],
        write_todos_args: dict[str, str],
    ) -> AsyncGenerator:
        """Consume super().run(), persist events, and inject synthetic snapshots.

        On error, attempts recovery:
        - Repair orphaned tool calls in graph state
        - For non-recursion errors: retry the stream once
        - For recursion limit: emit a wrap-up message via the LLM
        """
        try:
            async for event in self._iter_and_intercept(
                super().run(input), turn_id, conversation_id,
                accumulated_content, write_todos_args,
            ):
                yield event
        except GeneratorExit:
            raise
        except Exception as exc:
            error_str = str(exc)
            is_recursion = isinstance(exc, GraphRecursionError) or "recursion limit" in error_str.lower()
            logger.warning(
                "PersistedLangGraphAgent: stream error (recursion=%s): %s",
                is_recursion, error_str[:200],
            )

            # Phase 1: repair orphaned tool calls
            thread_id = input.thread_id
            config = {**(self.config or {})}
            config.setdefault("configurable", {})["thread_id"] = thread_id
            await self._repair_orphaned_tool_calls(config)

            # Phase 2: retry once for non-recursion errors
            if not is_recursion:
                logger.info("PersistedLangGraphAgent: retrying stream after state repair")
                try:
                    async for event in self._iter_and_intercept(
                        super().run(input), turn_id, conversation_id,
                        accumulated_content, write_todos_args,
                    ):
                        yield event
                    return  # retry succeeded
                except Exception as retry_exc:
                    logger.warning(
                        "PersistedLangGraphAgent: retry also failed: %s",
                        str(retry_exc)[:200],
                    )
                    # Fall through to wrap-up

            # Phase 3: graceful wrap-up — ask the LLM to summarize progress
            logger.info("PersistedLangGraphAgent: emitting wrap-up response")
            async for event in self._emit_wrapup(config, error_str, turn_id, conversation_id, accumulated_content):
                yield event

    async def _iter_and_intercept(
        self,
        stream: AsyncGenerator,
        turn_id: str | None,
        conversation_id: str,
        accumulated_content: list[str],
        write_todos_args: dict[str, str],
    ) -> AsyncGenerator:
        """Iterate an AG-UI event stream, persisting events and injecting
        synthetic STATE_SNAPSHOT after write_todos completes."""
        async for event in stream:
            if turn_id is not None:
                try:
                    self._persist_event(
                        turn_id, conversation_id, event, accumulated_content
                    )
                except Exception as exc:
                    logger.warning(
                        "PersistedLangGraphAgent: event persist failed: %s", exc
                    )

            if not hasattr(event, "type"):
                yield event
                continue

            # --- write_todos → synthetic STATE_SNAPSHOT ---
            if event.type == AGUIEventType.TOOL_CALL_START:
                name = getattr(event, "tool_call_name", "")
                if name == "write_todos":
                    write_todos_args[getattr(event, "tool_call_id", "")] = ""

            elif event.type == AGUIEventType.TOOL_CALL_ARGS:
                tcid = getattr(event, "tool_call_id", "")
                if tcid in write_todos_args:
                    write_todos_args[tcid] += getattr(event, "delta", "")

            elif event.type == AGUIEventType.TOOL_CALL_END:
                tcid = getattr(event, "tool_call_id", "")
                if tcid in write_todos_args:
                    yield event  # yield the TOOL_CALL_END first
                    snapshot_event = self._make_todos_snapshot(
                        write_todos_args.pop(tcid)
                    )
                    if snapshot_event is not None:
                        if turn_id is not None:
                            try:
                                self._persist_event(
                                    turn_id, conversation_id,
                                    snapshot_event, accumulated_content,
                                )
                            except Exception as exc:
                                logger.warning(
                                    "PersistedLangGraphAgent: "
                                    "write_todos snapshot persist failed: %s", exc,
                                )
                        yield snapshot_event
                    continue  # already yielded the TOOL_CALL_END above

            yield event

    # ------------------------------------------------------------------
    # Error recovery helpers
    # ------------------------------------------------------------------

    async def _repair_orphaned_tool_calls(self, config: dict) -> None:
        """Remove AIMessages with tool_calls that have no matching ToolMessage.

        Bedrock/Anthropic requires every tool_use to be followed by a
        tool_result.  If an error interrupted execution mid-stream, orphaned
        tool calls would cause validation errors on retry.
        """
        try:
            state = await self.graph.aget_state(config)
            if not state or not state.values:
                return

            messages = state.values.get("messages", [])
            if not messages:
                return

            # Map tool_call_id → AIMessage.id
            tc_to_ai: dict[str, str | None] = {}
            resolved: set[str] = set()

            for msg in messages:
                if isinstance(msg, AIMessage):
                    for tc in getattr(msg, "tool_calls", None) or []:
                        tc_id = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", None)
                        if tc_id:
                            tc_to_ai[tc_id] = getattr(msg, "id", None)
                elif isinstance(msg, ToolMessage):
                    tc_id = getattr(msg, "tool_call_id", None)
                    if tc_id:
                        resolved.add(tc_id)

            orphaned_ai_ids = {
                ai_id for tc_id, ai_id in tc_to_ai.items()
                if tc_id not in resolved and ai_id
            }
            if not orphaned_ai_ids:
                return

            logger.warning(
                "PersistedLangGraphAgent: removing %d AIMessage(s) with orphaned tool calls",
                len(orphaned_ai_ids),
            )
            remove_msgs = [RemoveMessage(id=mid) for mid in orphaned_ai_ids]
            await self.graph.aupdate_state(config, {"messages": remove_msgs})

        except Exception as exc:
            logger.error("PersistedLangGraphAgent: _repair_orphaned_tool_calls failed: %s", exc)

    async def _emit_wrapup(
        self,
        config: dict,
        error_str: str,
        turn_id: str | None,
        conversation_id: str,
        accumulated_content: list[str],
    ) -> AsyncGenerator:
        """Inject a summary AIMessage into the graph and invoke the LLM once
        to produce a graceful wrap-up response.  Falls back to a hardcoded
        message if anything goes wrong."""
        wrapup_text = (
            "I ran into a processing limit while working on your request. "
            "Here's what I was able to accomplish so far. "
            "You can ask me to continue if needed."
        )
        try:
            # Inject a summary so the graph can route to a final response
            summary = (
                f"I encountered an error and need to wrap up: {error_str[:500]}\n\n"
                "Summarize what was accomplished and provide a helpful response."
            )
            await self.graph.aupdate_state(
                config,
                {"messages": [AIMessage(content=summary)]},
                as_node="agent",
            )
            # Re-invoke the graph — it should route to generate_structured_response
            # or produce a final message since the last AIMessage has no tool_calls
            async for event in super().run(
                RunAgentInput(
                    thread_id=config["configurable"]["thread_id"],
                    run_id=str(uuid.uuid4()),
                    messages=[],
                    state={},
                    tools=[],
                    context=[],
                    forwarded_props={"command": {"resume": None}},
                )
            ):
                if hasattr(event, "type") and event.type == AGUIEventType.TEXT_MESSAGE_CONTENT:
                    delta = getattr(event, "delta", "")
                    if delta:
                        accumulated_content.append(delta)
                yield event
            return
        except Exception as wrapup_exc:
            logger.warning("PersistedLangGraphAgent: wrap-up failed: %s", wrapup_exc)

        # Hardcoded fallback
        msg_id = str(uuid.uuid4())
        yield TextMessageStartEvent(type=AGUIEventType.TEXT_MESSAGE_START, role="assistant", message_id=msg_id)
        yield TextMessageContentEvent(type=AGUIEventType.TEXT_MESSAGE_CONTENT, message_id=msg_id, delta=wrapup_text)
        accumulated_content.append(wrapup_text)
        yield TextMessageEndEvent(type=AGUIEventType.TEXT_MESSAGE_END, message_id=msg_id)
        yield RunFinishedEvent(
            type=AGUIEventType.RUN_FINISHED,
            thread_id=config["configurable"].get("thread_id", ""),
            run_id=str(uuid.uuid4()),
        )

    # ------------------------------------------------------------------
    # write_todos → synthetic STATE_SNAPSHOT
    # ------------------------------------------------------------------

    @staticmethod
    def _make_todos_snapshot(raw_args: str) -> StateSnapshotEvent | None:
        """Parse accumulated TOOL_CALL_ARGS for write_todos and build a
        STATE_SNAPSHOT containing the todos list."""
        try:
            parsed = json.loads(raw_args)
            todos = parsed if isinstance(parsed, list) else parsed.get("todos")
            if isinstance(todos, list) and todos:
                return StateSnapshotEvent(
                    type=AGUIEventType.STATE_SNAPSHOT,
                    snapshot={"todos": todos},
                )
        except (json.JSONDecodeError, TypeError, AttributeError) as exc:
            logger.debug("PersistedLangGraphAgent: could not parse write_todos args: %s", exc)
        return None

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
