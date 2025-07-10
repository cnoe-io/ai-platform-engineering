# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.checkpoint.memory import InMemorySaver

from agent_atlassian.agent import agent_atlassian
from agent_atlassian.state import AgentState

def build_graph() -> CompiledStateGraph:
  graph_builder = StateGraph(AgentState)
  graph_builder.add_node("agent_atlassian", agent_atlassian)

  graph_builder.add_edge(START, "agent_atlassian")
  graph_builder.add_edge("agent_atlassian", END)

  # Set memory checkpointer
  checkpointer = InMemorySaver()

  return graph_builder.compile(checkpointer=checkpointer)

graph = build_graph()