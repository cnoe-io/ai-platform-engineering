# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""AWS Agent package - supports both LangGraph and Strands backends."""

from .models import AgentConfig, ResponseMetadata
from .state import ConversationState
from .tools import AWSCLITool, get_aws_cli_tool, ReflectionTool, get_reflection_tool

# Lazy imports for backend-specific agents to avoid import errors
# when dependencies (like MCP for Strands) are not installed
def get_strands_agent():
    """Get the Strands-based AWS agent (requires MCP)."""
    from .agent import AWSAgent, create_agent
    return AWSAgent, create_agent

def get_langgraph_agent():
    """Get the LangGraph-based AWS agent."""
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
    "get_strands_agent",
    "get_langgraph_agent",
]
