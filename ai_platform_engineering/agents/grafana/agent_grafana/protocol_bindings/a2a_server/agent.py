# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Grafana Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.prompt_templates import build_system_instruction, SCOPE_LIMITED_GUIDELINES, STANDARD_RESPONSE_GUIDELINES
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class GrafanaAgent(BaseLangGraphAgent):
    """Grafana Agent for monitoring, observability, and incident management operations."""

    @property
    def SYSTEM_INSTRUCTION(self):
        """Dynamic system instruction that includes the actual Grafana URL."""
        grafana_url = os.getenv("GRAFANA_URL", "https://grafana.demandbase.com")

        return build_system_instruction(
            agent_name="GRAFANA AGENT",
            agent_purpose=f"""You are a Grafana assistant that helps users interact with their Grafana instance
through natural language. You have access to Grafana MCP tools for searching dashboards,
querying datasources, managing incidents, and running Prometheus queries.

KEY CAPABILITIES:
- Search and list dashboards
- Query datasources (Prometheus, Loki, etc.)
- Manage incidents and alerts
- Execute PromQL queries
- Provide dashboard links and insights""",
            response_guidelines=SCOPE_LIMITED_GUIDELINES + STANDARD_RESPONSE_GUIDELINES + [
                "Only use the available Grafana MCP tools to interact with the Grafana API",
                "Do not provide general guidance from your knowledge base unless explicitly asked",
                "",
                "**IMPORTANT SEARCH LIMITATIONS**:",
                "- Dashboard search only supports text queries (title/tags), NOT creator/author filters",
                "- When asked about dashboards by a specific creator/author:",
                "  1. First search for dashboards with the person's name in the title",
                "  2. Then use get_dashboard to retrieve details and check the 'createdBy' field",
                "  3. If no results, explain that Grafana's search API doesn't support creator filtering",
                "  4. Suggest searching by dashboard name, tags, or folder instead",
                "",
                "**GRAFANA LINK FORMATTING**:",
                f"Always include clickable Grafana links when referencing resources:",
                f"- Dashboards: [Dashboard Name]({grafana_url}/d/dashboard_uid)",
                f"- Folders: [Folder Name]({grafana_url}/dashboards/f/folder_uid/folder-name)",
                f"- Alerts: [Alert Name]({grafana_url}/alerting/list)",
                f"- Alert Rules: [Alert Name]({grafana_url}/alerting/grafana/alert_uid/view)",
                "",
                "**RESPONSE FORMATTING**:",
                "- Be concise and actionable",
                "- When listing alerts, include their state (Firing, Pending, OK) and link",
                "- Summarize large responses - don't dump raw data",
                "- For errors or no results, suggest alternatives",
                "- Focus on what's most relevant to the user's question",
            ],
            include_error_handling=True,
            include_date_handling=True
        )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete. '
        'Select status as input_required if the input is a question to the user. '
        'Set response status to error if the input indicates an error.'
    )

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "grafana"

    def get_system_instruction(self) -> str:
        """Return the system instruction for the agent."""
        return self.SYSTEM_INSTRUCTION

    def get_response_format_instruction(self) -> str:
        """Return the response format instruction."""
        return self.RESPONSE_FORMAT_INSTRUCTION

    def get_response_format_class(self) -> type[BaseModel]:
        """Return the response format class."""
        return ResponseFormat

    def get_mcp_config(self, server_path: str) -> dict:
        """
        Return MCP configuration for Grafana.

        Note: When MCP_MODE=http, this method won't be called.
        The base class will use MCP_HOST and MCP_PORT env vars instead.
        This is only used for stdio mode (local development).
        """
        grafana_api_key = os.getenv("GRAFANA_API_KEY")
        if not grafana_api_key:
            raise ValueError("GRAFANA_API_KEY must be set as an environment variable.")

        grafana_url = os.getenv("GRAFANA_URL")
        if not grafana_url:
            raise ValueError("GRAFANA_URL must be set as an environment variable.")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "GRAFANA_API_KEY": grafana_api_key,
                "GRAFANA_URL": grafana_url,
                "PATH": os.environ.get("PATH", ""),
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message to show when agent is calling tools."""
        return "🔍 Querying Grafana..."

    def get_tool_processing_message(self) -> str:
        """Return message to show when agent is processing tool results."""
        return "📊 Analyzing Grafana data..."

    @trace_agent_stream("grafana")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with grafana-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event
