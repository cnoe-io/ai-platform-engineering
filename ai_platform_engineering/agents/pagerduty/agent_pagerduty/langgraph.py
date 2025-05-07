# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

from langgraph.graph import StateGraph, START, END

from .agent import agent_pagerduty
from .state import AgentState

def build_graph() -> StateGraph:
    """Build the state graph for the PagerDuty agent."""
    # Create the graph
    graph = StateGraph(AgentState)
    
    # Add the agent node
    graph.add_node("agent_pagerduty", agent_pagerduty)
    
    # Add edges
    graph.add_edge(START, "agent_pagerduty")
    graph.add_edge("agent_pagerduty", END)
    
    # Compile the graph
    return graph.compile()

# Create the graph instance
AGENT_GRAPH = build_graph() 