"""Prometheus metric definitions for Dynamic Agents.

All collectors are created once on the singleton ``AgentMetrics`` instance.
Import ``metrics`` for direct access.
"""

import logging

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, Summary, generate_latest

logger = logging.getLogger(__name__)


class AgentMetrics:
    """Centralised Prometheus metrics for the Dynamic Agents service."""

    _instance: "AgentMetrics | None" = None

    def __new__(cls) -> "AgentMetrics":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return

        # -----------------------------------------------------------------
        # HTTP request metrics
        # -----------------------------------------------------------------
        self.request_duration_seconds = Histogram(
            "da_request_duration_seconds",
            "HTTP request duration in seconds",
            labelnames=["method", "path", "status", "agent_name"],
            buckets=(0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 30, 60, 120, 300, float("inf")),
        )
        self.active_requests = Gauge(
            "da_active_requests",
            "Number of in-flight requests",
        )

        # -----------------------------------------------------------------
        # LLM call metrics (recorded by MetricsAgentMiddleware)
        # -----------------------------------------------------------------
        self.llm_call_duration_seconds = Histogram(
            "da_llm_call_duration_seconds",
            "LLM model call duration in seconds (histogram)",
            labelnames=["agent_name", "model_id", "status"],
            buckets=(0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 30, 60, 120, float("inf")),
        )
        self.llm_call_duration_summary = Summary(
            "da_llm_call_duration_summary_seconds",
            "LLM model call duration in seconds (exact quantiles)",
            labelnames=["agent_name", "model_id", "status"],
        )
        self.llm_calls_total = Counter(
            "da_llm_calls_total",
            "Total LLM model calls",
            labelnames=["agent_name", "model_id", "status"],
        )

        # -----------------------------------------------------------------
        # Tool call metrics (recorded by MetricsAgentMiddleware)
        # -----------------------------------------------------------------
        self.tool_call_duration_seconds = Histogram(
            "da_tool_call_duration_seconds",
            "Tool call duration in seconds (histogram)",
            labelnames=["tool_name", "agent_name", "status"],
            buckets=(0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 30, 60, float("inf")),
        )
        self.tool_call_duration_summary = Summary(
            "da_tool_call_duration_summary_seconds",
            "Tool call duration in seconds (exact quantiles)",
            labelnames=["tool_name", "agent_name", "status"],
        )
        self.tool_calls_total = Counter(
            "da_tool_calls_total",
            "Total tool calls",
            labelnames=["tool_name", "agent_name", "status"],
        )

        # -----------------------------------------------------------------
        # Per-middleware timing (recorded by TimedMiddlewareWrapper)
        # -----------------------------------------------------------------
        self.middleware_duration_seconds = Histogram(
            "da_middleware_duration_seconds",
            "Time spent in a middleware hook (histogram, excludes inner handler)",
            labelnames=["middleware_name", "agent_name", "hook"],
            buckets=(0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5, float("inf")),
        )
        self.middleware_duration_summary = Summary(
            "da_middleware_duration_summary_seconds",
            "Time spent in a middleware hook (exact quantiles, excludes inner handler)",
            labelnames=["middleware_name", "agent_name", "hook"],
        )

        # -----------------------------------------------------------------
        # Runtime init metrics
        # -----------------------------------------------------------------
        self.runtime_init_duration_seconds = Histogram(
            "da_runtime_init_duration_seconds",
            "Agent runtime initialisation duration in seconds (histogram)",
            labelnames=["agent_name"],
            buckets=(0.25, 0.5, 1, 2, 3, 5, 10, 20, 30, 60, float("inf")),
        )
        self.runtime_init_duration_summary = Summary(
            "da_runtime_init_duration_summary_seconds",
            "Agent runtime initialisation duration in seconds (exact quantiles)",
            labelnames=["agent_name"],
        )

        # -----------------------------------------------------------------
        # Turn metrics (full end-to-end stream/resume duration)
        # -----------------------------------------------------------------
        self.turn_duration_seconds = Histogram(
            "da_turn_duration_seconds",
            "Full end-to-end turn duration in seconds (histogram)",
            labelnames=["agent_name", "model_id", "turn_type", "status"],
            buckets=(0.5, 1, 2, 3, 5, 7.5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, float("inf")),
        )
        self.turn_duration_summary = Summary(
            "da_turn_duration_summary_seconds",
            "Full end-to-end turn duration in seconds (exact quantiles)",
            labelnames=["agent_name", "model_id", "turn_type", "status"],
        )
        self.turns_total = Counter(
            "da_turns_total",
            "Total turns (stream or resume)",
            labelnames=["agent_name", "model_id", "turn_type", "status"],
        )

        self._initialized = True
        logger.info("AgentMetrics initialised")

    # Convenience helpers ------------------------------------------------

    def generate(self) -> bytes:
        """Generate Prometheus text exposition."""
        return generate_latest()

    @staticmethod
    def content_type() -> str:
        """Content-Type header for the metrics response."""
        return CONTENT_TYPE_LATEST


# Singleton
metrics = AgentMetrics()
