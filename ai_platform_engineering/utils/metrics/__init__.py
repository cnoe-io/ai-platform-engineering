# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Prometheus metrics for AI Platform Engineering Multi-Agent System.

This module provides centralized metrics collection for:
- Request-level metrics (user, latency, status)
- Subagent invocation tracking
- MCP tool usage tracking

Usage:
    from ai_platform_engineering.utils.metrics import (
        agent_metrics,
        PrometheusMetricsMiddleware,
    )
"""

from .agent_metrics import (
    AgentMetrics,
    agent_metrics,
    record_request,
    record_subagent_call,
    record_mcp_tool_call,
)
from .middleware import PrometheusMetricsMiddleware

__all__ = [
    "AgentMetrics",
    "agent_metrics",
    "record_request",
    "record_subagent_call",
    "record_mcp_tool_call",
    "PrometheusMetricsMiddleware",
]

