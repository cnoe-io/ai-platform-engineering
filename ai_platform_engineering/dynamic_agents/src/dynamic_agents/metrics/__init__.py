"""Prometheus metrics for the Dynamic Agents service.

Provides:
- ``metrics`` — singleton ``AgentMetrics`` with all Prometheus collectors.
- ``MetricsAgentMiddleware`` — deepagents middleware that times LLM and tool calls.
- ``TimedMiddlewareWrapper`` — wrapper that records per-middleware duration.
- ``PrometheusHTTPMiddleware`` — Starlette middleware serving ``/metrics``.
"""

from dynamic_agents.metrics.agent_metrics import AgentMetrics, metrics
from dynamic_agents.metrics.agent_middleware import MetricsAgentMiddleware, TimedMiddlewareWrapper
from dynamic_agents.metrics.http_middleware import PrometheusHTTPMiddleware

__all__ = [
    "AgentMetrics",
    "MetricsAgentMiddleware",
    "PrometheusHTTPMiddleware",
    "TimedMiddlewareWrapper",
    "metrics",
]
