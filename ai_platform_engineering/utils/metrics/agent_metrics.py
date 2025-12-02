# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Prometheus metrics for tracking AI Platform Engineering agent usage.

Metrics collected:
- agent_requests_total: Counter of all requests by user, status
- agent_request_duration_seconds: Histogram of request latencies
- subagent_invocations_total: Counter of subagent calls by agent name
- subagent_invocation_duration_seconds: Histogram of subagent call durations
- mcp_tool_calls_total: Counter of MCP tool invocations
- mcp_tool_duration_seconds: Histogram of MCP tool execution times
"""

import logging
import time
from contextlib import contextmanager
from typing import Optional

from prometheus_client import Counter, Histogram, Gauge, Info, generate_latest, CONTENT_TYPE_LATEST

logger = logging.getLogger(__name__)


class AgentMetrics:
    """
    Centralized Prometheus metrics for the AI Platform Engineering system.

    This class provides a singleton pattern for metrics to ensure
    consistent metric collection across the application.
    """

    _instance: Optional["AgentMetrics"] = None

    def __new__(cls) -> "AgentMetrics":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        # Labels for all metrics
        self._common_labels = ["user_email", "user_id"]

        # =========================================================================
        # REQUEST METRICS - Track overall requests to the supervisor agent
        # =========================================================================
        self.requests_total = Counter(
            "agent_requests_total",
            "Total number of requests to the AI Platform Engineer",
            labelnames=["user_email", "user_id", "status", "routing_mode"],
        )

        self.request_duration_seconds = Histogram(
            "agent_request_duration_seconds",
            "Request duration in seconds",
            labelnames=["user_email", "user_id", "status"],
            buckets=(0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0, float("inf")),
        )

        self.active_requests = Gauge(
            "agent_active_requests",
            "Number of currently active requests",
            labelnames=["user_email"],
        )

        # =========================================================================
        # SUBAGENT METRICS - Track which subagents are invoked
        # =========================================================================
        self.subagent_invocations_total = Counter(
            "subagent_invocations_total",
            "Total number of subagent invocations",
            labelnames=["agent_name", "user_email", "status"],
        )

        self.subagent_duration_seconds = Histogram(
            "subagent_invocation_duration_seconds",
            "Subagent invocation duration in seconds",
            labelnames=["agent_name", "user_email", "status"],
            buckets=(0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0, float("inf")),
        )

        # =========================================================================
        # MCP TOOL METRICS (SUPERVISOR) - Track MCP tools observed from streaming
        # These are best-effort observations from the supervisor side
        # =========================================================================
        self.mcp_tool_calls_total = Counter(
            "mcp_tool_calls_observed_total",
            "Total number of MCP tool calls observed by supervisor (best-effort)",
            labelnames=["tool_name", "agent_name", "user_email", "status"],
        )

        self.mcp_tool_duration_seconds = Histogram(
            "mcp_tool_duration_observed_seconds",
            "MCP tool execution duration observed by supervisor (best-effort)",
            labelnames=["tool_name", "agent_name", "status"],
            buckets=(0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, float("inf")),
        )

        # =========================================================================
        # SUBAGENT-SIDE METRICS - Used by subagents to track their own activity
        # =========================================================================
        self.subagent_requests_total = Counter(
            "subagent_requests_total",
            "Total number of A2A requests received by this subagent",
            labelnames=["agent_name", "status"],
        )

        self.subagent_request_duration_seconds = Histogram(
            "subagent_request_duration_seconds",
            "Subagent request processing duration in seconds",
            labelnames=["agent_name", "status"],
            buckets=(0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0, float("inf")),
        )

        self.mcp_tool_execution_total = Counter(
            "mcp_tool_execution_total",
            "Total number of MCP tool executions (actual, from subagent)",
            labelnames=["tool_name", "agent_name", "status"],
        )

        self.mcp_tool_execution_duration_seconds = Histogram(
            "mcp_tool_execution_duration_seconds",
            "MCP tool execution duration in seconds (actual, from subagent)",
            labelnames=["tool_name", "agent_name", "status"],
            buckets=(0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, float("inf")),
        )

        # =========================================================================
        # AGENT INFO - Static info about the agent configuration
        # =========================================================================
        self.agent_info = Info(
            "agent",
            "Information about the AI Platform Engineer agent",
        )

        # Track which agents are currently enabled
        self.enabled_agents = Gauge(
            "enabled_subagents",
            "Currently enabled subagents (1=enabled, 0=disabled)",
            labelnames=["agent_name"],
        )

        self._initialized = True
        logger.info("AgentMetrics initialized successfully")

    def set_agent_info(self, version: str, routing_mode: str, enabled_agents: list[str]):
        """Set static agent info metrics."""
        self.agent_info.info({
            "version": version,
            "routing_mode": routing_mode,
            "enabled_agents": ",".join(enabled_agents),
        })

        # Set enabled agents gauge
        for agent in enabled_agents:
            self.enabled_agents.labels(agent_name=agent).set(1)

    @contextmanager
    def track_request(self, user_email: str, user_id: str = "", routing_mode: str = ""):
        """
        Context manager to track a request's duration and status.

        Usage:
            with agent_metrics.track_request(user_email="user@example.com") as tracker:
                # ... process request ...
                tracker.set_status("success")
        """
        start_time = time.time()
        status = "error"  # Default to error, override on success

        class RequestTracker:
            def __init__(self):
                self.status = "error"

            def set_status(self, s: str):
                self.status = s

        tracker = RequestTracker()
        email_label = user_email or "anonymous"

        # Increment active requests
        self.active_requests.labels(user_email=email_label).inc()

        try:
            yield tracker
        finally:
            # Decrement active requests
            self.active_requests.labels(user_email=email_label).dec()

            # Record metrics
            duration = time.time() - start_time
            self.requests_total.labels(
                user_email=email_label,
                user_id=user_id or "",
                status=tracker.status,
                routing_mode=routing_mode,
            ).inc()

            self.request_duration_seconds.labels(
                user_email=email_label,
                user_id=user_id or "",
                status=tracker.status,
            ).observe(duration)

            logger.debug(
                f"Request completed: user={email_label}, status={tracker.status}, "
                f"duration={duration:.2f}s"
            )

    @contextmanager
    def track_subagent_call(self, agent_name: str, user_email: str = ""):
        """
        Context manager to track a subagent invocation.

        Usage:
            with agent_metrics.track_subagent_call("komodor", "user@example.com") as tracker:
                # ... invoke subagent ...
                tracker.set_status("success")
        """
        start_time = time.time()

        class SubagentTracker:
            def __init__(self):
                self.status = "error"

            def set_status(self, s: str):
                self.status = s

        tracker = SubagentTracker()
        email_label = user_email or "anonymous"

        try:
            yield tracker
        finally:
            duration = time.time() - start_time
            self.subagent_invocations_total.labels(
                agent_name=agent_name,
                user_email=email_label,
                status=tracker.status,
            ).inc()

            self.subagent_duration_seconds.labels(
                agent_name=agent_name,
                user_email=email_label,
                status=tracker.status,
            ).observe(duration)

            logger.debug(
                f"Subagent call: agent={agent_name}, user={email_label}, "
                f"status={tracker.status}, duration={duration:.2f}s"
            )

    def record_mcp_tool_call(
        self,
        tool_name: str,
        agent_name: str,
        user_email: str = "",
        status: str = "success",
        duration: float = 0.0,
    ):
        """
        Record an MCP tool call.

        Args:
            tool_name: Name of the MCP tool (e.g., "list_applications", "get_incidents")
            agent_name: Name of the subagent that invoked the tool
            user_email: Email of the user who initiated the request
            status: Status of the tool call ("success" or "error")
            duration: Duration of the tool call in seconds
        """
        email_label = user_email or "anonymous"

        self.mcp_tool_calls_total.labels(
            tool_name=tool_name,
            agent_name=agent_name,
            user_email=email_label,
            status=status,
        ).inc()

        if duration > 0:
            self.mcp_tool_duration_seconds.labels(
                tool_name=tool_name,
                agent_name=agent_name,
                status=status,
            ).observe(duration)

        logger.debug(
            f"MCP tool call (observed): tool={tool_name}, agent={agent_name}, "
            f"user={email_label}, status={status}, duration={duration:.2f}s"
        )

    def record_mcp_tool_execution(
        self,
        tool_name: str,
        agent_name: str,
        status: str = "success",
        duration: float = 0.0,
    ):
        """
        Record an MCP tool execution (from subagent side).

        This is the actual tool execution, not an observation from streaming.

        Args:
            tool_name: Name of the MCP tool (e.g., "list_applications", "get_incidents")
            agent_name: Name of this subagent
            status: Status of the tool execution ("success" or "error")
            duration: Duration of the tool execution in seconds
        """
        self.mcp_tool_execution_total.labels(
            tool_name=tool_name,
            agent_name=agent_name,
            status=status,
        ).inc()

        if duration > 0:
            self.mcp_tool_execution_duration_seconds.labels(
                tool_name=tool_name,
                agent_name=agent_name,
                status=status,
            ).observe(duration)

        logger.debug(
            f"MCP tool execution: tool={tool_name}, agent={agent_name}, "
            f"status={status}, duration={duration:.2f}s"
        )

    def generate_metrics(self) -> bytes:
        """Generate Prometheus metrics output for scraping."""
        return generate_latest()

    def get_content_type(self) -> str:
        """Get the content type for Prometheus metrics."""
        return CONTENT_TYPE_LATEST


# Singleton instance for easy access
agent_metrics = AgentMetrics()


# Convenience functions for direct access
def record_request(
    user_email: str,
    user_id: str = "",
    status: str = "success",
    routing_mode: str = "",
    duration: float = 0.0,
):
    """Record a request metric directly without context manager."""
    email_label = user_email or "anonymous"
    agent_metrics.requests_total.labels(
        user_email=email_label,
        user_id=user_id,
        status=status,
        routing_mode=routing_mode,
    ).inc()

    if duration > 0:
        agent_metrics.request_duration_seconds.labels(
            user_email=email_label,
            user_id=user_id,
            status=status,
        ).observe(duration)


def record_subagent_call(
    agent_name: str,
    user_email: str = "",
    status: str = "success",
    duration: float = 0.0,
):
    """Record a subagent call metric directly without context manager."""
    email_label = user_email or "anonymous"
    agent_metrics.subagent_invocations_total.labels(
        agent_name=agent_name,
        user_email=email_label,
        status=status,
    ).inc()

    if duration > 0:
        agent_metrics.subagent_duration_seconds.labels(
            agent_name=agent_name,
            user_email=email_label,
            status=status,
        ).observe(duration)


def record_mcp_tool_call(
    tool_name: str,
    agent_name: str,
    user_email: str = "",
    status: str = "success",
    duration: float = 0.0,
):
    """Record an MCP tool call metric (observed by supervisor)."""
    agent_metrics.record_mcp_tool_call(
        tool_name=tool_name,
        agent_name=agent_name,
        user_email=user_email,
        status=status,
        duration=duration,
    )


def record_mcp_tool_execution(
    tool_name: str,
    agent_name: str,
    status: str = "success",
    duration: float = 0.0,
):
    """Record an MCP tool execution metric (actual execution in subagent)."""
    agent_metrics.record_mcp_tool_execution(
        tool_name=tool_name,
        agent_name=agent_name,
        status=status,
        duration=duration,
    )

