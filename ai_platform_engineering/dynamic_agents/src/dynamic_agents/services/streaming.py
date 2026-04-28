"""Streaming mixin for AgentRuntime.

Provides ``stream()``, ``resume()``, ``has_pending_interrupt()``, and
the private helpers ``_build_stream_config()`` and ``_record_turn()``.

Separated from the core ``AgentRuntime`` to keep the main module focused
on initialisation and tool/subagent wiring.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from langgraph.types import Command

from dynamic_agents.metrics import metrics as prom_metrics
from dynamic_agents.models import AgentContext

if TYPE_CHECKING:
    from dynamic_agents.services.encoders import StreamEncoder

logger = logging.getLogger(__name__)


class StreamingMixin:
    """Mixin that adds streaming / resume / interrupt methods to AgentRuntime."""

    # ── These attributes are defined on AgentRuntime; listed here for type-checkers. ──
    config: Any
    _graph: Any
    _cancelled: bool
    _initialized: bool
    _skills_files: dict[str, Any]
    _failed_servers: list[str]
    _user: Any
    _client_context: Any
    tracing: Any
    _current_trace_id: str | None

    # forward declarations so the mixin can call them
    async def initialize(self) -> None: ...  # noqa: E704

    # ─────────────────────────── stream config ───────────────────────────

    def _build_stream_config(self, session_id: str, user_id: str, trace_id: str | None) -> dict[str, Any]:
        """Build config dict for stream/resume operations.

        Creates the LangGraph config with:
        - thread_id for conversation persistence (checkpointer)
        - AgentContext for tools that need user/session info
        - metadata for Langfuse tracing
        """
        config = self.tracing.create_config(session_id)

        if "configurable" not in config:
            config["configurable"] = {}
        config["configurable"]["thread_id"] = session_id

        config["context"] = AgentContext(
            user_id=user_id,
            agent_config_id=self.config.id,
            session_id=session_id,
        )

        if "metadata" not in config:
            config["metadata"] = {}
        config["metadata"]["user_id"] = user_id
        config["metadata"]["agent_config_id"] = self.config.id
        config["metadata"]["agent_name"] = self.config.name

        if trace_id:
            config["metadata"]["trace_id"] = trace_id
        else:
            current_trace_id = self.tracing.get_trace_id()
            if current_trace_id:
                config["metadata"]["trace_id"] = current_trace_id

        self._current_trace_id = config.get("metadata", {}).get("trace_id")

        return config

    # ─────────────────────────── stream ──────────────────────────────────

    async def stream(
        self,
        message: str,
        session_id: str,
        user_id: str,
        trace_id: str | None = None,
        encoder: "StreamEncoder | None" = None,
    ) -> AsyncGenerator[str, None]:
        """Stream agent response for a user message.

        Yields SSE frame strings produced by the encoder.
        """
        if not self._initialized:
            await self.initialize()

        assert encoder is not None, "encoder must be provided"

        self._cancelled = False

        config = self._build_stream_config(session_id, user_id, trace_id)
        run_id = f"run-{uuid4().hex[:12]}"
        turn_start = time.monotonic()
        turn_status = "success"

        logger.info(
            f"[stream] Starting stream for agent '{self.config.name}': "
            f"agent_id={self.config.id}, conv={session_id}, user={user_id}, "
            f"user_context={self._user}, client_context={self._client_context}"
        )

        # ── Core lifecycle: run start ──
        for frame in encoder.on_run_start(run_id, session_id):
            yield frame

        # ── Core lifecycle: warnings ──
        for server_name in self._failed_servers:
            for frame in encoder.on_warning(
                f"MCP server '{server_name}' is unavailable. Tools from this server will not work.",
            ):
                yield frame

        # ── Core lifecycle: chunks ──
        state_input: dict[str, Any] = {"messages": [{"role": "user", "content": message}]}
        # Inject skills files for SkillsMiddleware / StateBackend
        if getattr(self, "_skills_files", None):
            state_input["files"] = dict(self._skills_files)
        async for chunk in self._graph.astream(
            state_input,
            config=config,
            stream_mode=["messages", "updates", "tasks"],
            subgraphs=True,
        ):
            if self._cancelled:
                logger.info(
                    f"[stream] Stream cancelled by user for agent '{self.config.name}': "
                    f"conv={session_id}, user={user_id}"
                )
                turn_status = "cancelled"
                self._record_turn(turn_start, "stream", turn_status)
                return

            for frame in encoder.on_chunk(chunk):
                yield frame

        # ── Core lifecycle: stream end (flush) ──
        for frame in encoder.on_stream_end():
            yield frame

        # ── HITL interrupt check ──
        logger.debug("[stream] Stream loop completed, checking for pending interrupt...")
        interrupt_data = await self.has_pending_interrupt(session_id)
        logger.debug(f"[stream] has_pending_interrupt result: {interrupt_data}")
        if interrupt_data:
            logger.debug(f"[stream] Agent '{self.config.name}' has pending interrupt, emitting input_required event")
            for frame in encoder.on_input_required(
                interrupt_id=interrupt_data["interrupt_id"],
                prompt=interrupt_data["prompt"],
                fields=interrupt_data["fields"],
                agent=self.config.name,
            ):
                yield frame
            self._record_turn(turn_start, "stream", "interrupted")
            return

        # ── Core lifecycle: run finish ──
        logger.info(
            f"[stream] Completed stream for agent '{self.config.name}': "
            f"conv={session_id}, content_length={len(encoder.get_accumulated_content())}"
        )
        for frame in encoder.on_run_finish(run_id, session_id):
            yield frame
        self._record_turn(turn_start, "stream", turn_status)

    # ─────────────────────── has_pending_interrupt ───────────────────────

    async def has_pending_interrupt(self, session_id: str) -> dict[str, Any] | None:
        """Check if there's a pending interrupt for the given session.

        Uses the HumanInTheLoopMiddleware pattern from deepagents.
        """
        if not self._graph:
            logger.warning("[has_pending_interrupt] No graph available")
            return None

        config = {"configurable": {"thread_id": session_id}}

        try:
            state = await self._graph.aget_state(config)
            logger.debug(
                f"[has_pending_interrupt] Got state: has_interrupts={hasattr(state, 'interrupts')}, "
                f"interrupts_count={len(state.interrupts) if hasattr(state, 'interrupts') and state.interrupts else 0}"
            )

            if not state or not hasattr(state, "interrupts") or not state.interrupts:
                logger.debug("[has_pending_interrupt] No interrupts in state")
                return None

            for i, interrupt in enumerate(state.interrupts):
                interrupt_value = getattr(interrupt, "value", None)
                logger.debug(f"[has_pending_interrupt] Interrupt {i}: value_type={type(interrupt_value)}")

                if not isinstance(interrupt_value, dict):
                    continue

                action_requests = interrupt_value.get("action_requests", [])
                for action in action_requests:
                    if action.get("name") == "request_user_input":
                        args = action.get("args", {})
                        tool_call_id = action.get("id", str(id(interrupt)))
                        logger.info(
                            f"[has_pending_interrupt] Found request_user_input interrupt: tool_call_id={tool_call_id}"
                        )
                        return {
                            "interrupt_id": tool_call_id,
                            "prompt": args.get("prompt", ""),
                            "fields": args.get("fields", []),
                            "tool_call_id": tool_call_id,
                        }

            logger.debug("[has_pending_interrupt] No request_user_input interrupt found")
            return None
        except Exception as e:
            logger.warning(f"Error checking for pending interrupt: {e}")
            return None

    # ─────────────────────────── resume ──────────────────────────────────

    async def resume(
        self,
        session_id: str,
        user_id: str,
        form_data: str,
        trace_id: str | None = None,
        encoder: "StreamEncoder | None" = None,
    ) -> AsyncGenerator[str, None]:
        """Resume agent execution after user provides form input."""
        if not self._initialized:
            await self.initialize()

        assert encoder is not None, "encoder must be provided"

        self._cancelled = False

        config = self._build_stream_config(session_id, user_id, trace_id)
        run_id = f"run-{uuid4().hex[:12]}"
        turn_start = time.monotonic()
        turn_status = "success"

        logger.info(
            f"[resume] Resuming stream for agent '{self.config.name}': "
            f"agent_id={self.config.id}, conv={session_id}, user={user_id}, "
            f"user_context={self._user}, client_context={self._client_context}"
        )

        # ── Core lifecycle: run start ──
        for frame in encoder.on_run_start(run_id, session_id):
            yield frame

        # Build resume payload
        is_rejection = form_data.startswith("User dismissed")

        if is_rejection:
            resume_payload = {"decisions": [{"type": "reject", "message": form_data}]}
        else:
            try:
                user_values = json.loads(form_data)
            except json.JSONDecodeError:
                logger.warning(f"[resume] Invalid form_data JSON: {form_data[:100]}")
                user_values = {}

            interrupt_data = await self.has_pending_interrupt(session_id)
            if interrupt_data:
                original_fields = interrupt_data.get("fields", [])
                edited_fields = []
                for field in original_fields:
                    field_copy = dict(field)
                    field_name = field.get("field_name", "")
                    if field_name in user_values:
                        field_copy["value"] = user_values[field_name]
                    edited_fields.append(field_copy)

                edited_args = {
                    "prompt": interrupt_data.get("prompt", ""),
                    "fields": edited_fields,
                }

                resume_payload = {
                    "decisions": [
                        {
                            "type": "edit",
                            "edited_action": {
                                "name": "request_user_input",
                                "args": edited_args,
                            },
                        }
                    ]
                }
            else:
                logger.warning("[resume] No pending interrupt found, using simple approve")
                resume_payload = {"decisions": [{"type": "approve"}]}

        logger.debug(f"[resume] Resume payload: {resume_payload}")

        # ── Core lifecycle: chunks ──
        async for chunk in self._graph.astream(
            Command(resume=resume_payload),
            config=config,
            stream_mode=["messages", "updates", "tasks"],
            subgraphs=True,
        ):
            if self._cancelled:
                logger.info(
                    f"[resume] Resume stream cancelled by user for agent '{self.config.name}': conv={session_id}"
                )
                turn_status = "cancelled"
                self._record_turn(turn_start, "resume", turn_status)
                return

            for frame in encoder.on_chunk(chunk):
                yield frame

        # ── Core lifecycle: stream end (flush) ──
        for frame in encoder.on_stream_end():
            yield frame

        # ── HITL interrupt check ──
        interrupt_data = await self.has_pending_interrupt(session_id)
        if interrupt_data:
            logger.debug(f"[resume] Agent '{self.config.name}' has pending interrupt after resume")
            for frame in encoder.on_input_required(
                interrupt_id=interrupt_data["interrupt_id"],
                prompt=interrupt_data["prompt"],
                fields=interrupt_data["fields"],
                agent=self.config.name,
            ):
                yield frame
            self._record_turn(turn_start, "resume", "interrupted")
            return

        # ── Core lifecycle: run finish ──
        logger.info(
            f"[resume] Completed resume for agent '{self.config.name}': "
            f"conv={session_id}, content_length={len(encoder.get_accumulated_content())}"
        )
        for frame in encoder.on_run_finish(run_id, session_id):
            yield frame
        self._record_turn(turn_start, "resume", turn_status)

    # ─────────────────────────── metrics ─────────────────────────────────

    def _record_turn(self, start: float, turn_type: str, status: str) -> None:
        """Record turn duration to both Histogram and Summary."""
        duration = time.monotonic() - start
        labels = {
            "agent_name": self.config.name,
            "model_id": self.config.model.id,
            "turn_type": turn_type,
            "status": status,
        }
        prom_metrics.turns_total.labels(**labels).inc()
        prom_metrics.turn_duration_seconds.labels(**labels).observe(duration)
        prom_metrics.turn_duration_summary.labels(**labels).observe(duration)
        logger.info(
            "[%s] Turn completed for agent '%s': status=%s duration=%.2fs",
            turn_type,
            self.config.name,
            status,
            duration,
        )
