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
