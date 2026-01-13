# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""SigNoz MCP Server - Provides tools for SigNoz observability platform."""

import os
import time
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastmcp import FastMCP

load_dotenv()

# Initialize FastMCP server
mcp = FastMCP("SigNoz MCP Server")

# SigNoz API configuration
SIGNOZ_API_URL = os.getenv("SIGNOZ_API_URL", "http://localhost:3301")
SIGNOZ_API_KEY = os.getenv("SIGNOZ_API_KEY", "")


def get_client() -> httpx.Client:
    """Get HTTP client for SigNoz API."""
    headers = {"Content-Type": "application/json"}
    if SIGNOZ_API_KEY:
        headers["SIGNOZ-API-KEY"] = SIGNOZ_API_KEY
    return httpx.Client(base_url=SIGNOZ_API_URL, headers=headers, timeout=30.0)


def get_default_time_range():
    """Get default time range (last 1 hour)."""
    end_time = int(time.time() * 1_000_000_000)  # nanoseconds
    start_time = end_time - (3600 * 1_000_000_000)  # 1 hour ago
    return start_time, end_time


# ============================================
# SERVICE TOOLS
# ============================================


@mcp.tool()
def list_services(start_time: Optional[int] = None, end_time: Optional[int] = None) -> dict:
    """List all services being monitored in SigNoz.

    Args:
        start_time: Start timestamp in nanoseconds (optional, defaults to 1 hour ago)
        end_time: End timestamp in nanoseconds (optional, defaults to now)
    """
    if start_time is None or end_time is None:
        start_time, end_time = get_default_time_range()

    with get_client() as client:
        response = client.get(
            "/api/v1/services",
            params={"start": start_time, "end": end_time},
        )
        response.raise_for_status()
        return response.json()


@mcp.tool()
def get_service_overview(
    service_name: str,
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
) -> dict:
    """Get overview metrics for a specific service.

    Args:
        service_name: Name of the service
        start_time: Start timestamp in nanoseconds (optional)
        end_time: End timestamp in nanoseconds (optional)
    """
    if start_time is None or end_time is None:
        start_time, end_time = get_default_time_range()

    with get_client() as client:
        response = client.get(
            f"/api/v1/services/{service_name}/overview",
            params={"start": start_time, "end": end_time},
        )
        response.raise_for_status()
        return response.json()


# ============================================
# TRACE TOOLS
# ============================================


@mcp.tool()
def query_traces(
    service_name: Optional[str] = None,
    operation_name: Optional[str] = None,
    min_duration_ms: Optional[int] = None,
    max_duration_ms: Optional[int] = None,
    status: Optional[str] = None,
    limit: int = 20,
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
) -> dict:
    """Query traces with optional filters.

    Args:
        service_name: Filter by service name (optional)
        operation_name: Filter by operation name (optional)
        min_duration_ms: Minimum duration in milliseconds (optional)
        max_duration_ms: Maximum duration in milliseconds (optional)
        status: Filter by status - 'ok' or 'error' (optional)
        limit: Maximum number of traces to return (default: 20)
        start_time: Start timestamp in nanoseconds (optional)
        end_time: End timestamp in nanoseconds (optional)
    """
    if start_time is None or end_time is None:
        start_time, end_time = get_default_time_range()

    params = {
        "start": start_time,
        "end": end_time,
        "limit": limit,
    }

    if service_name:
        params["serviceName"] = service_name
    if operation_name:
        params["operation"] = operation_name
    if min_duration_ms:
        params["minDuration"] = min_duration_ms * 1_000_000  # Convert to nanoseconds
    if max_duration_ms:
        params["maxDuration"] = max_duration_ms * 1_000_000
    if status:
        params["status"] = status

    with get_client() as client:
        response = client.get("/api/v2/traces", params=params)
        response.raise_for_status()
        return response.json()


@mcp.tool()
def get_trace(trace_id: str) -> dict:
    """Get detailed information about a specific trace.

    Args:
        trace_id: The trace ID to retrieve
    """
    with get_client() as client:
        response = client.get(f"/api/v2/traces/{trace_id}")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def get_trace_flamegraph(trace_id: str) -> dict:
    """Get flamegraph data for a trace.

    Args:
        trace_id: The trace ID to get flamegraph for
    """
    with get_client() as client:
        response = client.get(f"/api/v2/traces/{trace_id}/flamegraph")
        response.raise_for_status()
        return response.json()


# ============================================
# METRICS TOOLS
# ============================================


@mcp.tool()
def query_metrics(
    query: str,
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
    step: int = 60,
) -> dict:
    """Execute a PromQL metrics query.

    Args:
        query: PromQL query string
        start_time: Start timestamp in nanoseconds (optional)
        end_time: End timestamp in nanoseconds (optional)
        step: Query resolution step in seconds (default: 60)
    """
    if start_time is None or end_time is None:
        start_time, end_time = get_default_time_range()

    # Convert nanoseconds to seconds for Prometheus API
    start_sec = start_time // 1_000_000_000
    end_sec = end_time // 1_000_000_000

    with get_client() as client:
        response = client.get(
            "/api/v1/query_range",
            params={
                "query": query,
                "start": start_sec,
                "end": end_sec,
                "step": step,
            },
        )
        response.raise_for_status()
        return response.json()


@mcp.tool()
def query_metrics_instant(query: str) -> dict:
    """Execute an instant PromQL query.

    Args:
        query: PromQL query string
    """
    with get_client() as client:
        response = client.get("/api/v1/query", params={"query": query})
        response.raise_for_status()
        return response.json()


@mcp.tool()
def list_metric_names() -> dict:
    """List all available metric names."""
    with get_client() as client:
        response = client.get("/api/v1/label/__name__/values")
        response.raise_for_status()
        return response.json()


# ============================================
# LOG TOOLS
# ============================================


@mcp.tool()
def query_logs(
    query: Optional[str] = None,
    service_name: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = 100,
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
) -> dict:
    """Query logs with optional filters.

    Args:
        query: Full-text search query (optional)
        service_name: Filter by service name (optional)
        severity: Filter by log severity - INFO, WARN, ERROR, DEBUG (optional)
        limit: Maximum number of logs to return (default: 100)
        start_time: Start timestamp in nanoseconds (optional)
        end_time: End timestamp in nanoseconds (optional)
    """
    if start_time is None or end_time is None:
        start_time, end_time = get_default_time_range()

    params = {
        "start": start_time,
        "end": end_time,
        "limit": limit,
    }

    if query:
        params["q"] = query
    if service_name:
        params["serviceName"] = service_name
    if severity:
        params["severity"] = severity

    with get_client() as client:
        response = client.get("/api/v1/logs", params=params)
        response.raise_for_status()
        return response.json()


@mcp.tool()
def get_log_fields() -> dict:
    """Get available log fields for filtering."""
    with get_client() as client:
        response = client.get("/api/v1/logs/fields")
        response.raise_for_status()
        return response.json()


# ============================================
# DASHBOARD TOOLS
# ============================================


@mcp.tool()
def list_dashboards() -> dict:
    """List all available dashboards."""
    with get_client() as client:
        response = client.get("/api/v1/dashboards")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def get_dashboard(dashboard_id: str) -> dict:
    """Get a specific dashboard by ID.

    Args:
        dashboard_id: The dashboard ID to retrieve
    """
    with get_client() as client:
        response = client.get(f"/api/v1/dashboards/{dashboard_id}")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def create_dashboard(title: str, description: str = "", tags: list = None) -> dict:
    """Create a new dashboard.

    Args:
        title: Dashboard title
        description: Dashboard description (optional)
        tags: List of tags (optional)
    """
    with get_client() as client:
        response = client.post(
            "/api/v1/dashboards",
            json={
                "title": title,
                "description": description,
                "tags": tags or [],
            },
        )
        response.raise_for_status()
        return response.json()


@mcp.tool()
def delete_dashboard(dashboard_id: str) -> dict:
    """Delete a dashboard.

    Args:
        dashboard_id: The dashboard ID to delete
    """
    with get_client() as client:
        response = client.delete(f"/api/v1/dashboards/{dashboard_id}")
        response.raise_for_status()
        return {"status": "deleted", "dashboard_id": dashboard_id}


# ============================================
# ALERT TOOLS
# ============================================


@mcp.tool()
def list_alerts() -> dict:
    """List all configured alert rules."""
    with get_client() as client:
        response = client.get("/api/v1/rules")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def get_alert(alert_id: str) -> dict:
    """Get a specific alert rule by ID.

    Args:
        alert_id: The alert rule ID to retrieve
    """
    with get_client() as client:
        response = client.get(f"/api/v1/rules/{alert_id}")
        response.raise_for_status()
        return response.json()


@mcp.tool()
def get_alert_history(
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
    limit: int = 100,
) -> dict:
    """Get alert firing history.

    Args:
        start_time: Start timestamp in nanoseconds (optional)
        end_time: End timestamp in nanoseconds (optional)
        limit: Maximum number of alerts to return (default: 100)
    """
    if start_time is None or end_time is None:
        start_time, end_time = get_default_time_range()

    with get_client() as client:
        response = client.get(
            "/api/v1/rules/history",
            params={"start": start_time, "end": end_time, "limit": limit},
        )
        response.raise_for_status()
        return response.json()


@mcp.tool()
def create_alert(
    name: str,
    query: str,
    condition: str,
    threshold: float,
    severity: str = "warning",
    description: str = "",
) -> dict:
    """Create a new alert rule.

    Args:
        name: Alert rule name
        query: PromQL query for the alert
        condition: Condition operator (gt, lt, eq, gte, lte)
        threshold: Threshold value
        severity: Alert severity - 'info', 'warning', 'error', 'critical' (default: warning)
        description: Alert description (optional)
    """
    with get_client() as client:
        response = client.post(
            "/api/v1/rules",
            json={
                "name": name,
                "query": query,
                "condition": condition,
                "threshold": threshold,
                "severity": severity,
                "description": description,
            },
        )
        response.raise_for_status()
        return response.json()


@mcp.tool()
def delete_alert(alert_id: str) -> dict:
    """Delete an alert rule.

    Args:
        alert_id: The alert rule ID to delete
    """
    with get_client() as client:
        response = client.delete(f"/api/v1/rules/{alert_id}")
        response.raise_for_status()
        return {"status": "deleted", "alert_id": alert_id}


# ============================================
# TOPOLOGY / SERVICE MAP TOOLS
# ============================================


@mcp.tool()
def get_service_dependencies(
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
) -> dict:
    """Get service dependency map showing how services communicate.

    Args:
        start_time: Start timestamp in nanoseconds (optional)
        end_time: End timestamp in nanoseconds (optional)
    """
    if start_time is None or end_time is None:
        start_time, end_time = get_default_time_range()

    with get_client() as client:
        response = client.get(
            "/api/v1/service_dependency_graph",
            params={"start": start_time, "end": end_time},
        )
        response.raise_for_status()
        return response.json()
