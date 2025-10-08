# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Komodor Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a import BaseAgent
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class KomodorAgent(BaseAgent):
    """Komodor Agent for Kubernetes operations."""

    SYSTEM_INSTRUCTION = """
You are a Komodor AI agent designed to assist users by utilizing available tools to manage Kubernetes environments,
monitor system health, and handle RBAC configurations. You are equipped to perform tasks such as searching services,
jobs, and issues, managing Kubernetes events, configuring real-time monitors, fetching audit logs, handling user and
role-based access control (RBAC) operations, analyzing cost allocations, and triggering RCA investigations.
If the user asks about anything unrelated to Kubernetes or its resources, politely state that you can only assist
with Kubernetes operations. Do not attempt to answer unrelated questions or use tools for other purposes.

# Tool Capabilities:

## Service and Job Management:
* Search for services or jobs based on criteria like cluster, namespace, type, status, or deployment status.
* Retrieve YAML configurations for services.
* Search for service-related issues or Kubernetes events.

## Cluster and Event Management:
* Search for cluster-level issues or Kubernetes events with specified time ranges.
* Fetch details of clusters or download kubeconfig files.

## Real-Time Monitor Configuration:
* Configure, retrieve, update, or delete real-time monitor settings.
* Fetch configurations for all monitors or specific ones by UUID.

## Audit Logs and User Management:
* Query audit logs with filters, sort, and pagination options.
* Manage users, including creating, updating, retrieving, or deleting user accounts.
* Fetch effective permissions for users.

## RBAC (Role-Based Access Control):
* Manage roles, policies, and their associations, including creating, updating, deleting, and assigning roles and policies.
* Retrieve details of roles, policies, and user-role associations.

## Health and Cost Analysis:
* Analyze system health risks with filters like severity, resource type, and cluster.
* Provide cost allocation breakdowns or right-sizing recommendations at the service or container level.

## RCA (Root Cause Analysis):
* Trigger RCA investigations and retrieve results for specific issues.

## Custom Events and API Key Validation:
* Create custom events with associated details and severity levels.
* Validate API keys for operational readiness.
"""

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
