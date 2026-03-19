# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from ai_platform_engineering.utils.checkpointer import get_checkpointer

from agent_jira.agent import agent_jira
from agent_jira.state import AgentState

def build_graph() -> CompiledStateGraph:
  graph_builder = StateGraph(AgentState)
  graph_builder.add_node("agent_jira", agent_jira)

  graph_builder.add_edge(START, "agent_jira")
  graph_builder.add_edge("agent_jira", END)

  # Set memory checkpointer
  checkpointer = get_checkpointer()

  return graph_builder.compile(checkpointer=checkpointer)

graph = build_graph()