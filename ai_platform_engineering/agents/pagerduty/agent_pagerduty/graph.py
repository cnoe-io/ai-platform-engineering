# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph
from .agent import agent_pagerduty
from .state import AgentState

def build_graph() -> CompiledStateGraph:
    graph_builder = StateGraph(AgentState)
    graph_builder.add_node("agent_pagerduty", agent_pagerduty)

    graph_builder.add_edge(START, "agent_pagerduty")
    graph_builder.add_edge("agent_pagerduty", END)

    return graph_builder.compile()

# Export the graph for ACP to use
graph = build_graph() 