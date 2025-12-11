# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""AWS Agent package - supports both LangGraph and Strands backends."""

# Lazy imports to avoid import errors when modules aren't available
def get_models():
    """Get model classes."""
    from .models import AgentConfig, ResponseMetadata
    return AgentConfig, ResponseMetadata

def get_state():
    """Get state classes."""
    from .state import ConversationState
    return ConversationState

def get_tools():
    """Get tool classes and functions."""
    from .tools import AWSCLITool, get_aws_cli_tool, ReflectionTool, get_reflection_tool
    return AWSCLITool, get_aws_cli_tool, ReflectionTool, get_reflection_tool

def get_strands_agent():
    """Get the Strands-based AWS agent (requires MCP)."""
    from .agent_strands import AWSAgent, create_agent
    return AWSAgent, create_agent

def get_langgraph_agent():
    """Get the LangGraph-based AWS agent."""
    from .agent_langgraph import AWSAgentLangGraph
    return AWSAgentLangGraph

__all__ = [
    "get_models",
    "get_state",
    "get_tools",
    "get_strands_agent",
    "get_langgraph_agent",
]
