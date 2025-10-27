# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""ArgoCD Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.prompt_templates import build_system_instruction, graceful_error_handling_template, SCOPE_LIMITED_GUIDELINES, STANDARD_RESPONSE_GUIDELINES, HUMAN_IN_LOOP_NOTES, LOGGING_NOTES, DATE_HANDLING_NOTES
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class ArgoCDAgent(BaseLangGraphAgent):
    """ArgoCD Agent for managing ArgoCD resources."""

    SYSTEM_INSTRUCTION = build_system_instruction(
        agent_name="ARGOCD AGENT",
        agent_purpose="You are an expert assistant for managing ArgoCD resources. Your sole purpose is to help users perform CRUD operations on ArgoCD applications, projects, and related resources. Always return any ArgoCD resource links in markdown format.",
        response_guidelines=SCOPE_LIMITED_GUIDELINES + STANDARD_RESPONSE_GUIDELINES + [
            "Only use the available ArgoCD tools to interact with the ArgoCD API",
            "Do not provide general guidance from your knowledge base unless explicitly asked",
            "Always send tool results directly to the user without analyzing or interpreting",
            "When querying applications or resources with date-based filters, use the current date provided above as reference"
        ],
        important_notes=HUMAN_IN_LOOP_NOTES + LOGGING_NOTES + DATE_HANDLING_NOTES,
        graceful_error_handling=graceful_error_handling_template("ArgoCD")
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete'
        'Select status as input_required if the input is a question to the user'
        'Set response status to error if the input indicates an error'
    )

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "argocd"

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
        """Return MCP configuration for ArgoCD."""
        argocd_token = os.getenv("ARGOCD_TOKEN")
        if not argocd_token:
            raise ValueError("ARGOCD_TOKEN must be set as an environment variable.")

        argocd_api_url = os.getenv("ARGOCD_API_URL")
        if not argocd_api_url:
            raise ValueError("ARGOCD_API_URL must be set as an environment variable.")

        return {
            "command": "uv",
            "args": ["run", "--project", os.path.dirname(server_path), server_path],
            "env": {
                "ARGOCD_TOKEN": argocd_token,
                "ARGOCD_API_URL": argocd_api_url,
                "ARGOCD_VERIFY_SSL": "false"
            },
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return 'Looking up ArgoCD Resources...'

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return 'Processing ArgoCD Resources...'

    @trace_agent_stream("argocd")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with argocd-specific tracing.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        async for event in super().stream(query, sessionId, trace_id):
            yield event
