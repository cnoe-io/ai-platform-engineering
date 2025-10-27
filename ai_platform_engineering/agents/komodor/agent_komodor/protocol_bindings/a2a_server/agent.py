# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Komodor Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.prompt_templates import (
    AgentCapability, build_system_instruction, graceful_error_handling_template,
    SCOPE_LIMITED_GUIDELINES, STANDARD_RESPONSE_GUIDELINES, DATE_HANDLING_NOTES
)
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class KomodorAgent(BaseLangGraphAgent):
    """Komodor Agent for Kubernetes operations."""

    KOMODOR_CAPABILITIES = [
        AgentCapability(
            title="Service and Job Management",
            description="Manage Kubernetes services and jobs",
            items=[
                "Search for services or jobs based on criteria like cluster, namespace, type, status",
                "Retrieve YAML configurations for services",
                "Search for service-related issues or Kubernetes events"
            ]
        ),
        AgentCapability(
            title="Cluster and Event Management", 
            description="Monitor and manage cluster operations",
            items=[
                "Search for cluster-level issues or Kubernetes events with specified time ranges",
                "Fetch details of clusters or download kubeconfig files"
            ]
        ),
        AgentCapability(
            title="RBAC and User Management",
            description="Role-based access control and user operations", 
            items=[
                "Manage roles, policies, and their associations",
                "Query audit logs with filters, sort, and pagination options",
                "Manage users and fetch effective permissions"
            ]
        ),
        AgentCapability(
            title="Health and Cost Analysis",
            description="System monitoring and optimization",
            items=[
                "Analyze system health risks with filters",
                "Provide cost allocation breakdowns and right-sizing recommendations",
                "Trigger RCA investigations and retrieve results"
            ]
        ),
        AgentCapability(
            title="Configuration and Monitoring",
            description="Real-time monitoring and event management",
            items=[
                "Configure, retrieve, update, or delete real-time monitor settings",
                "Create custom events with associated details and severity levels",
                "Validate API keys for operational readiness"
            ]
        )
    ]

    SYSTEM_INSTRUCTION = build_system_instruction(
        agent_name="KOMODOR AGENT",
        agent_purpose="You are a Komodor AI agent designed to assist users with Kubernetes environments, system health monitoring, and RBAC configurations.",
        capabilities=KOMODOR_CAPABILITIES,
        response_guidelines=SCOPE_LIMITED_GUIDELINES + STANDARD_RESPONSE_GUIDELINES + [
            "When searching for events, audit logs, or issues with time ranges, use the current date provided above as reference",
            "For queries like 'today's issues' or 'last hour's events', calculate the time range from the current date/time"
        ],
        important_notes=DATE_HANDLING_NOTES,
        graceful_error_handling=graceful_error_handling_template("Komodor")
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete'
        'Select status as input_required if the input is a question to the user'
        'Set response status to error if the input indicates an error'
    )

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "komodor"

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
        """Return MCP configuration for Komodor."""
        komodor_token = os.getenv("KOMODOR_TOKEN")
        if not komodor_token:
            raise ValueError("KOMODOR_TOKEN must be set as an environment variable.")

        komodor_api_url = os.getenv("KOMODOR_API_URL")
        if not komodor_api_url:
            raise ValueError("KOMODOR_API_URL must be set as an environment variable.")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "KOMODOR_TOKEN": komodor_token,
                "KOMODOR_API_URL": komodor_api_url,
                "KOMODOR_VERIFY_SSL": "false"
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return 'Looking up Komodor Resources...'

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return 'Processing Komodor Resources...'

    @trace_agent_stream("komodor")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with komodor-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event
