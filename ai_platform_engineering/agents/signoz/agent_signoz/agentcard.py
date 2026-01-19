# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""SigNoz Agent Card - Defines agent capabilities and skills."""

from a2a.types import AgentCapabilities, AgentCard, AgentSkill


def get_agent_card(host: str, port: int) -> AgentCard:
    """Generate the SigNoz Agent Card with capabilities and skills."""
    return AgentCard(
        name="SigNoz Agent",
        description="AI Agent for SigNoz observability platform management. "
        "Provides capabilities for distributed tracing, metrics monitoring, "
        "log management, dashboards, and alerting.",
        url=f"http://{host}:{port}/",
        version="0.1.0",
        capabilities=AgentCapabilities(streaming=True, pushNotifications=False),
        defaultInputModes=["text"],
        defaultOutputModes=["text"],
        skills=[
            AgentSkill(
                id="signoz-traces",
                name="Distributed Tracing",
                description="Query, analyze, and search distributed traces. "
                "Find slow requests, trace errors, and understand service dependencies.",
                tags=["tracing", "observability", "apm", "debugging"],
                examples=[
                    "Show me the slowest traces for the payment service",
                    "Find all traces with errors in the last hour",
                    "What services are involved in the checkout flow?",
                ],
            ),
            AgentSkill(
                id="signoz-metrics",
                name="Metrics Monitoring",
                description="Query and analyze metrics from services and infrastructure. "
                "Monitor application performance, resource usage, and custom metrics.",
                tags=["metrics", "monitoring", "prometheus", "performance"],
                examples=[
                    "What's the average response time for the API service?",
                    "Show me CPU usage for all pods in the production namespace",
                    "Graph the request rate over the last 24 hours",
                ],
            ),
            AgentSkill(
                id="signoz-logs",
                name="Log Management",
                description="Search, filter, and analyze logs from applications and services. "
                "Correlate logs with traces and metrics for full observability.",
                tags=["logs", "logging", "observability", "debugging"],
                examples=[
                    "Find all error logs from the auth service",
                    "Show me logs correlated with trace ID xyz",
                    "Search for 'connection timeout' in all services",
                ],
            ),
            AgentSkill(
                id="signoz-dashboards",
                name="Dashboard Management",
                description="Create, list, and manage observability dashboards. "
                "Build custom visualizations for metrics, traces, and logs.",
                tags=["dashboards", "visualization", "monitoring"],
                examples=[
                    "List all available dashboards",
                    "Create a dashboard for the order service",
                    "Show me the infrastructure overview dashboard",
                ],
            ),
            AgentSkill(
                id="signoz-alerts",
                name="Alert Management",
                description="Create, list, and manage alerting rules. "
                "Configure notifications for service health and performance thresholds.",
                tags=["alerts", "alerting", "notifications", "sre"],
                examples=[
                    "List all active alerts",
                    "Create an alert for high error rate",
                    "What alerts fired in the last 24 hours?",
                ],
            ),
            AgentSkill(
                id="signoz-services",
                name="Service Discovery",
                description="List and analyze services in the observability platform. "
                "View service dependencies, health status, and metrics summary.",
                tags=["services", "topology", "dependencies", "discovery"],
                examples=[
                    "What services are being monitored?",
                    "Show me the service dependency map",
                    "What's the health status of all services?",
                ],
            ),
        ],
    )
