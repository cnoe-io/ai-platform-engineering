# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""AWS Agent package."""

from .models import AgentConfig, ResponseMetadata
from .state import ConversationState
from .tools import AWSCLITool, get_aws_cli_tool, ReflectionTool, get_reflection_tool


def get_langgraph_agent():
    """Get the LangGraph-based AWS agent."""
    # assisted-by Codex Codex-sonnet-4-6
    from .agent_langgraph import AWSAgentLangGraph
    return AWSAgentLangGraph

__all__ = [
    "AgentConfig",
    "ResponseMetadata",
    "ConversationState",
    "AWSCLITool",
    "get_aws_cli_tool",
    "ReflectionTool",
    "get_reflection_tool",
    "get_langgraph_agent",
]
