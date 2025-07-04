# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.checkpoint.memory import InMemorySaver

from agent_confluence.agent import agent_confluence
from agent_confluence.state import AgentState

def build_graph() -> CompiledStateGraph:
  graph_builder = StateGraph(AgentState)
  graph_builder.add_node("agent_confluence", agent_confluence)

  graph_builder.add_edge(START, "agent_confluence")
  graph_builder.add_edge("agent_confluence", END)

  # Set memory checkpointer
  checkpointer = InMemorySaver()

  return graph_builder.compile(checkpointer=checkpointer)

graph = build_graph()