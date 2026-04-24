"""Deepagents middleware for Prometheus metrics collection.

``MetricsAgentMiddleware`` — append to the END of the middleware stack.
It wraps model and tool calls to record total duration and counts.

``TimedMiddlewareWrapper`` — wraps any ``AgentMiddleware`` instance and
records how long that middleware's own logic takes (total hook time minus
inner handler time) in ``da_middleware_duration_seconds``.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse, ToolCallRequest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.types import Command

from dynamic_agents.metrics.agent_metrics import metrics

logger = logging.getLogger(__name__)


class MetricsAgentMiddleware(AgentMiddleware):
    """Records LLM call and tool call duration via deepagents hooks.

    Place this at the END of the middleware stack so it measures the
    full duration including all other middleware layers.
    """

    def __init__(self, agent_name: str, model_id: str = "unknown") -> None:
        self._agent_name = agent_name
        self._model_id = model_id

    @property
    def name(self) -> str:
        return "MetricsAgentMiddleware"

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse | AIMessage:
        """Time the full model call (including all inner middleware)."""
        start = time.monotonic()
        status = "success"
        try:
            result = await handler(request)
            return result
        except Exception:
            status = "error"
            raise
        finally:
            duration = time.monotonic() - start
            metrics.llm_calls_total.labels(
                agent_name=self._agent_name,
                model_id=self._model_id,
                status=status,
            ).inc()
            metrics.llm_call_duration_seconds.labels(
                agent_name=self._agent_name,
                model_id=self._model_id,
                status=status,
            ).observe(duration)
            metrics.llm_call_duration_summary.labels(
                agent_name=self._agent_name,
                model_id=self._model_id,
                status=status,
            ).observe(duration)
            logger.debug(
                "LLM call: agent=%s model=%s status=%s duration=%.2fs",
                self._agent_name,
                self._model_id,
                status,
                duration,
            )

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        """Time the full tool call (including all inner middleware)."""
        tool_name = request.tool_call.get("name", "unknown") if isinstance(request.tool_call, dict) else "unknown"
        start = time.monotonic()
        status = "success"
        try:
            result = await handler(request)
            # Check for error status in ToolMessage
            if isinstance(result, ToolMessage) and getattr(result, "status", None) == "error":
                status = "error"
            return result
        except Exception:
            status = "error"
            raise
        finally:
            duration = time.monotonic() - start
            metrics.tool_calls_total.labels(
                tool_name=tool_name,
                agent_name=self._agent_name,
                status=status,
            ).inc()
            metrics.tool_call_duration_seconds.labels(
                tool_name=tool_name,
                agent_name=self._agent_name,
                status=status,
            ).observe(duration)
            metrics.tool_call_duration_summary.labels(
                tool_name=tool_name,
                agent_name=self._agent_name,
                status=status,
            ).observe(duration)
            logger.debug(
                "Tool call: tool=%s agent=%s status=%s duration=%.2fs",
                tool_name,
                self._agent_name,
                status,
                duration,
            )


class TimedMiddlewareWrapper(AgentMiddleware):
    """Wraps an ``AgentMiddleware`` and records per-hook duration.

    The recorded duration is the middleware's **own overhead** — total time
    in the hook minus the time spent calling the inner ``handler``.

    For simple hooks (``before_agent``, ``after_agent``, etc.) there is no
    inner handler, so total time == overhead.
    """

    def __init__(self, inner: AgentMiddleware, agent_name: str) -> None:
        self._inner = inner
        self._agent_name = agent_name
        self._mw_name = type(inner).__name__
        # Pre-compute which hooks the inner middleware actually implements
        # so we only delegate (and time) hooks that exist on the concrete class.
        inner_cls = type(inner)
        self._has_awrap_model = "awrap_model_call" in inner_cls.__dict__
        self._has_awrap_tool = "awrap_tool_call" in inner_cls.__dict__
        self._has_wrap_model = "wrap_model_call" in inner_cls.__dict__
        self._has_wrap_tool = "wrap_tool_call" in inner_cls.__dict__

    @property
    def name(self) -> str:
        return self._inner.name

    # Expose inner middleware attributes so deepagents sees tools, state_schema, etc.
    @property
    def state_schema(self):  # type: ignore[override]
        return self._inner.state_schema

    @property
    def tools(self):  # type: ignore[override]
        return self._inner.tools

    # -- Simple hooks (no handler chain) ----------------------------------

    def before_agent(self, state, runtime):
        start = time.monotonic()
        try:
            return self._inner.before_agent(state, runtime)
        finally:
            self._record("before_agent", time.monotonic() - start)

    async def abefore_agent(self, state, runtime):
        start = time.monotonic()
        try:
            return await self._inner.abefore_agent(state, runtime)
        finally:
            self._record("before_agent", time.monotonic() - start)

    def before_model(self, state, runtime):
        start = time.monotonic()
        try:
            return self._inner.before_model(state, runtime)
        finally:
            self._record("before_model", time.monotonic() - start)

    async def abefore_model(self, state, runtime):
        start = time.monotonic()
        try:
            return await self._inner.abefore_model(state, runtime)
        finally:
            self._record("before_model", time.monotonic() - start)

    def after_model(self, state, runtime):
        start = time.monotonic()
        try:
            return self._inner.after_model(state, runtime)
        finally:
            self._record("after_model", time.monotonic() - start)

    async def aafter_model(self, state, runtime):
        start = time.monotonic()
        try:
            return await self._inner.aafter_model(state, runtime)
        finally:
            self._record("after_model", time.monotonic() - start)

    def after_agent(self, state, runtime):
        start = time.monotonic()
        try:
            return self._inner.after_agent(state, runtime)
        finally:
            self._record("after_agent", time.monotonic() - start)

    async def aafter_agent(self, state, runtime):
        start = time.monotonic()
        try:
            return await self._inner.aafter_agent(state, runtime)
        finally:
            self._record("after_agent", time.monotonic() - start)

    # -- Wrapping hooks (handler chain — measure overhead only) -----------

    async def awrap_model_call(self, request, handler):
        if not self._has_awrap_model:
            # Inner doesn't implement this hook — pass through directly
            return await handler(request)
        total_start = time.monotonic()
        handler_time = 0.0

        async def timed_handler(req):
            nonlocal handler_time
            h_start = time.monotonic()
            try:
                return await handler(req)
            finally:
                handler_time = time.monotonic() - h_start

        try:
            return await self._inner.awrap_model_call(request, timed_handler)
        finally:
            overhead = (time.monotonic() - total_start) - handler_time
            self._record("wrap_model_call", overhead)

    async def awrap_tool_call(self, request, handler):
        if not self._has_awrap_tool:
            return await handler(request)
        total_start = time.monotonic()
        handler_time = 0.0

        async def timed_handler(req):
            nonlocal handler_time
            h_start = time.monotonic()
            try:
                return await handler(req)
            finally:
                handler_time = time.monotonic() - h_start

        try:
            return await self._inner.awrap_tool_call(request, timed_handler)
        finally:
            overhead = (time.monotonic() - total_start) - handler_time
            self._record("wrap_tool_call", overhead)

    # -- Sync wrappers (fallback if agent runs synchronously) -------------

    def wrap_model_call(self, request, handler):
        if not self._has_wrap_model:
            return handler(request)
        total_start = time.monotonic()
        handler_time = 0.0

        def timed_handler(req):
            nonlocal handler_time
            h_start = time.monotonic()
            try:
                return handler(req)
            finally:
                handler_time = time.monotonic() - h_start

        try:
            return self._inner.wrap_model_call(request, timed_handler)
        finally:
            overhead = (time.monotonic() - total_start) - handler_time
            self._record("wrap_model_call", overhead)

    def wrap_tool_call(self, request, handler):
        if not self._has_wrap_tool:
            return handler(request)
        total_start = time.monotonic()
        handler_time = 0.0

        def timed_handler(req):
            nonlocal handler_time
            h_start = time.monotonic()
            try:
                return handler(req)
            finally:
                handler_time = time.monotonic() - h_start

        try:
            return self._inner.wrap_tool_call(request, timed_handler)
        finally:
            overhead = (time.monotonic() - total_start) - handler_time
            self._record("wrap_tool_call", overhead)

    # -- Internal ---------------------------------------------------------

    def _record(self, hook: str, duration: float) -> None:
        labels = {
            "middleware_name": self._mw_name,
            "agent_name": self._agent_name,
            "hook": hook,
        }
        metrics.middleware_duration_seconds.labels(**labels).observe(duration)
        metrics.middleware_duration_summary.labels(**labels).observe(duration)
