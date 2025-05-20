# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.checkpoint.memory import InMemorySaver

from .agent import agent_slack
from .state import AgentState

import logging
from langgraph.graph import StateGraph, START, END
from typing import Dict, Any



logger = logging.getLogger(__name__)

def start_node(state: AgentState) -> AgentState:
    logger.info("Agent Slack workflow started")
    state.conversation_history = state.conversation_history or []
    state.metadata = state.metadata or {}
    state.metadata["temperature"] = 0.0
    state.tools = state.tools or []  # empty because we're using MCP, not local registry
    return state

def should_execute_tool(state: AgentState) -> AgentState:
    """
    This function examines the state and sets a special attribute on it
    to help with routing in the conditional edge.
    """
    logger.info(f"Determining next step. next_action: {state.next_action}")
    state.metadata = state.metadata or {}
    
    # Set a routing attribute based on next_action
    # We'll check this attribute in the router function
    if state.next_action:
        # Add a routing indicator to metadata
        state.metadata["_next_node"] = "execute_tool"
    else:
        state.metadata["_next_node"] = "end"
    
    return state

def execute_tool(state: AgentState) -> AgentState:
    try:
        tool_name = state.next_action.get("tool")
        tool_input = state.next_action.get("tool_input", {})
        logger.info(f"Executing tool: {tool_name} with input: {tool_input}")
        state.tool_results = state.tool_results or {}
        # MCP tool is already embedded in the subprocess launched inside agent.py
        # So here, we just update state to allow loopback if needed
        state.conversation_history.append({
            "role": "tool",
            "name": tool_name,
            "content": f"Called tool with: {tool_input}"
        })
        state.next_action = None
        return state
    except Exception as e:
        state.error = f"Tool execution failed: {str(e)}"
        logger.error(state.error, exc_info=True)
        return state

def build_agent_graph() -> CompiledStateGraph:
    """Build the agent graph."""
    graph = StateGraph(AgentState)
    
    # Add nodes
    graph.add_node("start", start_node)
    graph.add_node("agent", agent_slack)
    graph.add_node("should_execute_tool", should_execute_tool)
    graph.add_node("execute_tool", execute_tool)
    
    # Connect the graph
    graph.add_edge(START, "start")
    graph.add_edge("start", "agent")
    graph.add_edge("agent", "should_execute_tool")
    
    # This is the key change - use a router function that looks at the metadata
    graph.add_conditional_edges(
        "should_execute_tool",
        # Use the metadata to determine the next node, correctly handling AgentState object
        lambda state: state.metadata.get("_next_node", "end") if state.metadata else "end",
        {
            "execute_tool": "execute_tool",
            "end": END
        }
    )
    
    graph.add_edge("execute_tool", "agent")
    
    # Set memory checkpointer
    checkpointer = InMemorySaver()
    
    # Compile the graph with checkpointer
    return graph.compile(checkpointer=checkpointer)

# Create and compile the graph
AGENT_GRAPH = build_agent_graph()

__all__ = ["AGENT_GRAPH"]