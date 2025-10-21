# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""ArgoCD Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


class ArgoCDAgent(BaseLangGraphAgent):
    """ArgoCD Agent for managing ArgoCD resources."""

    SYSTEM_INSTRUCTION = (
      'You are an expert assistant for managing ArgoCD resources. '
      'Your sole purpose is to help users perform CRUD (Create, Read, Update, Delete) operations on ArgoCD applications, '
      'projects, and related resources. Only use the available ArgoCD tools to interact with the ArgoCD API and provide responses. '
      'Do not provide general guidance or information about ArgoCD from your knowledge base unless the user explicitly asks for it. '
      'If the user asks about anything unrelated to ArgoCD or its resources, politely state that you can only assist with ArgoCD operations. '
      'Do not attempt to answer unrelated questions or use tools for other purposes. '
      'Always return any ArgoCD resource links in markdown format (e.g., [App Link](https://example.com/app)).\n'
      '\n'
      '---\n'
      'Logs:\n'
      'When a user asks a question about logs, do not attempt to parse, summarize, or interpret the log content unless the user explicitly asks you to understand, analyze, or summarize the logs. '
      'By default, simply return the raw logs to the user, preserving all newlines and formatting as they appear in the original log output.\n'
      '\n'
      '---\n'
      'Human-in-the-loop:\n'
      'Before creating, updating, or deleting any ArgoCD application, you must ask the user for final confirmation. '
      'Clearly summarize the intended action (create, update, or delete), including the application name and relevant details, '
      'and prompt the user to confirm before proceeding. Only perform the action after receiving explicit user confirmation.\n'
      '\n'
      '---\n'
      'Always send the result from the ArgoCD tool response directly to the user, without analyzing, summarizing, or interpreting it. '
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
