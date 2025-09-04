# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""LangGraph configuration for Splunk agent."""

from langgraph.graph import StateGraph
from langgraph.prebuilt import create_react_agent
from langgraph.graph.state import CompiledStateGraph


def build_graph() -> CompiledStateGraph:
    """Build and compile the Splunk agent graph."""
    # This is a simple wrapper - the actual graph creation
    # happens in the agent.py file using create_react_agent
    # This file exists to maintain consistency with other agents
    
    # For now, we'll use a minimal graph structure
    # The real graph is created in the SplunkAgent class
    graph_builder = StateGraph(dict)
    
    return graph_builder.compile() 