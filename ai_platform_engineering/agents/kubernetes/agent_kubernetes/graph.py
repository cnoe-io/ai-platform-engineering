# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.checkpoint.memory import InMemorySaver

from .agent import agent_kubernetes
from .state import AgentState

import logging

logger = logging.getLogger(__name__)

def start_node(state: AgentState) -> AgentState:
    logger.info("Agent Kubernetes workflow started")

    # Add print statement for workflow start
    print("=" * 50)
    print("🚀 KUBERNETES AGENT WORKFLOW STARTED")
    print("=" * 50)

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

    # Add detailed print statements for next action decision
    print("=" * 50)
    print("🤔 DECIDING NEXT ACTION")
    print("=" * 50)
    if state.next_action:
        print(f"📋 Next Action: {state.next_action}")
        if isinstance(state.next_action, dict):
            tool_name = state.next_action.get("tool", "Unknown")
            tool_input = state.next_action.get("tool_input", {})
            print(f"🔧 Tool to Execute: {tool_name}")
            print("📥 Tool Input Data:")
            if tool_input:
                for key, value in tool_input.items():
                    print(f"   • {key}: {value}")
            else:
                print("   (No input data)")
            print(f"🔄 Setting route to: tool_execution")
            state.route = "tool_execution"
        else:
            print(f"🔄 Next action is not a dict: {state.next_action}")
            print(f"🔄 Setting route to: end")
            state.route = "end"
    else:
        print("❌ No next action specified")
        print(f"🔄 Setting route to: end")
        state.route = "end"

    print("=" * 50)
    return state

def tool_execution_node(state: AgentState) -> AgentState:
    """
    Execute the tool specified in next_action.
    """
    logger.info("Executing tool")

    print("=" * 50)
    print("🔧 EXECUTING TOOL")
    print("=" * 50)

    if state.next_action and isinstance(state.next_action, dict):
        tool_name = state.next_action.get("tool")
        tool_input = state.next_action.get("tool_input", {})

        print(f"🔧 Executing tool: {tool_name}")
        print(f"📥 With input: {tool_input}")

        # Here you would execute the actual tool
        # For now, we'll just simulate execution
        state.last_tool_result = f"Executed {tool_name} with input {tool_input}"

        print(f"✅ Tool execution completed: {state.last_tool_result}")

    print("=" * 50)
    return state

def agent_node(state: AgentState) -> AgentState:
    """
    Main agent processing node.
    """
    logger.info("Processing with agent")

    print("=" * 50)
    print("🤖 AGENT PROCESSING")
    print("=" * 50)

    # Call the actual agent
    try:
        result = agent_kubernetes(state)
        print(f"✅ Agent processing completed")
        return result
    except Exception as e:
        logger.error(f"Agent processing failed: {e}")
        print(f"❌ Agent processing failed: {e}")
        state.error = str(e)
        return state

def build_graph() -> CompiledStateGraph:
    """
    Build the Kubernetes agent workflow graph.
    """
    graph_builder = StateGraph(AgentState)

    # Add nodes
    graph_builder.add_node("start", start_node)
    graph_builder.add_node("agent", agent_node)
    graph_builder.add_node("should_execute_tool", should_execute_tool)
    graph_builder.add_node("tool_execution", tool_execution_node)

    # Add edges
    graph_builder.add_edge(START, "start")
    graph_builder.add_edge("start", "agent")
    graph_builder.add_edge("agent", "should_execute_tool")

    # Conditional edge based on route
    graph_builder.add_conditional_edges(
        "should_execute_tool",
        lambda state: state.route,
        {
            "tool_execution": "tool_execution",
            "end": END,
        }
    )
    graph_builder.add_edge("tool_execution", END)

    # Set memory checkpointer
    checkpointer = InMemorySaver()

    return graph_builder.compile(checkpointer=checkpointer)

graph = build_graph()

def should_execute_tool(state: AgentState) -> AgentState:
    """
    This function examines the state and sets a special attribute on it
    to help with routing in the conditional edge.
    """
    logger.info(f"Determining next step. next_action: {state.next_action}")

    # Add detailed print statements for next action decision
    print("=" * 50)
    print("🤔 DECIDING NEXT ACTION")
    print("=" * 50)
    if state.next_action:
        print(f"📋 Next Action: {state.next_action}")
        if isinstance(state.next_action, dict):
            tool_name = state.next_action.get("tool", "Unknown")
            tool_input = state.next_action.get("tool_input", {})
            print(f"🔧 Tool to Execute: {tool_name}")
            print("📥 Tool Input Data:")
            if tool_input:
                for key, value in tool_input.items():
                    print(f"   • {key}: {value}")
            else:
                print("   • No input data")
        print("➡️  Routing to: execute_tool")
    else:
        print("📋 Next Action: None")
        print("➡️  Routing to: end")
    print("=" * 50)

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

        # Add detailed print statements to display tool information
        print("=" * 50)
        print("🔧 TOOL EXECUTION")
        print("=" * 50)
        print(f"📋 Tool Name: {tool_name}")
        print("📥 Tool Input Data:")
        if tool_input:
            for key, value in tool_input.items():
                print(f"   • {key}: {value}")
        else:
            print("   • No input data provided")
        print("=" * 50)

        logger.info(f"Executing tool: {tool_name} with input: {tool_input}")
        state.tool_results = state.tool_results or {}

        # Try to execute the tool using the MCP client
        try:
            # Import the MCP client from the agent module
            from .agent import _mcp_client, _available_tools

            if _mcp_client and _available_tools:
                # Find the tool
                tool = None
                for t in _available_tools:
                    if t.name == tool_name:
                        tool = t
                        break

                if tool:
                    # Execute the tool
                    result = asyncio.run(_mcp_client.call_tool(tool_name, tool_input))
                    tool_output = f"Tool result: {result}"
                    print(f"✅ Tool executed successfully: {tool_output}")
                else:
                    tool_output = f"Tool '{tool_name}' not found in available tools"
                    print(f"❌ {tool_output}")
            else:
                tool_output = "MCP client not initialized"
                print(f"❌ {tool_output}")

        except Exception as tool_error:
            tool_output = f"Tool execution error: {str(tool_error)}"
            print(f"❌ {tool_output}")
            logger.error(f"Tool execution failed: {tool_error}", exc_info=True)

        # Add tool result to conversation history
        state.conversation_history.append({
            "role": "tool",
            "name": tool_name,
            "content": tool_output
        })

        # Store result in tool_results
        state.tool_results[tool_name] = tool_output

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
    graph.add_node("agent", agent_kubernetes)
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