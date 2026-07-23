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
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse, ToolCallRequest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.types import Command

from dynamic_agents.metrics.agent_metrics import metrics

logger = logging.getLogger(__name__)


def _as_nonnegative_int(value: Any) -> int:
    """Normalize provider token counts without letting malformed metadata break a call."""
    if isinstance(value, bool):
        return 0
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return max(parsed, 0)


def _message_token_usage(message: AIMessage) -> tuple[int, int]:
    """Read normalized LangChain usage metadata, with provider fallbacks."""
    usage = getattr(message, "usage_metadata", None)
    if not isinstance(usage, Mapping):
        response_metadata = getattr(message, "response_metadata", None)
        if isinstance(response_metadata, Mapping):
            candidate = response_metadata.get("token_usage") or response_metadata.get("usage")
            usage = candidate if isinstance(candidate, Mapping) else None

    if not isinstance(usage, Mapping):
        return 0, 0

    input_tokens = _as_nonnegative_int(
        usage.get("input_tokens", usage.get("prompt_tokens")),
    )
    output_tokens = _as_nonnegative_int(
        usage.get("output_tokens", usage.get("completion_tokens")),
    )
    return input_tokens, output_tokens


def _extract_token_usage(result: ModelResponse | AIMessage) -> tuple[int, int]:
    """Sum token usage across AI messages in a model middleware response."""
    messages = result.result if isinstance(result, ModelResponse) else [result]
    input_tokens = 0
    output_tokens = 0
    for message in messages:
        if not isinstance(message, AIMessage):
            continue
        message_input, message_output = _message_token_usage(message)
        input_tokens += message_input
        output_tokens += message_output
    return input_tokens, output_tokens


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
            input_tokens, output_tokens = _extract_token_usage(result)
            if input_tokens > 0:
                metrics.llm_input_tokens_total.labels(
                    agent_name=self._agent_name,
                    model_id=self._model_id,
                ).inc(input_tokens)
            if output_tokens > 0:
                metrics.llm_output_tokens_total.labels(
                    agent_name=self._agent_name,
                    model_id=self._model_id,
                ).inc(output_tokens)
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
