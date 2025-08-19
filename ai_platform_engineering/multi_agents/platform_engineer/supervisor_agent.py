# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import logging
import uuid
import os
import threading
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.graph.state import CompiledStateGraph
from langgraph_supervisor import create_supervisor
from langgraph_supervisor.handoff import create_forward_message_tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from cnoe_agent_utils import LLMFactory

from langchain_core.runnables import RunnableLambda
import json

from ai_platform_engineering.multi_agents.platform_engineer import platform_registry

from ai_platform_engineering.multi_agents.platform_engineer.prompts import system_prompt
from ai_platform_engineering.multi_agents.platform_engineer.response_format import PlatformEngineerResponse

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class AIPlatformEngineerMAS:
  def __init__(self):
    # Use existing platform_registry and enable dynamic monitoring
    platform_registry.enable_dynamic_monitoring(on_change_callback=self._on_agents_changed)

    # Thread safety for graph access
    self._graph_lock = threading.RLock()
    self._graph = None
    self._graph_generation = 0  # Track graph version for debugging

    # Build initial graph
    self._build_graph()

    logger.info(f"AIPlatformEngineerMAS initialized with {len(platform_registry.agents)} agents")

  def get_graph(self) -> CompiledStateGraph:
    """
    Returns the current compiled LangGraph instance.
    Thread-safe access to the graph.

    Returns:
        CompiledStateGraph: The current compiled LangGraph instance.
    """
    with self._graph_lock:
      return self._graph

  def _on_agents_changed(self):
    """Callback triggered when agent registry detects changes."""
    logger.info("Agent registry change detected, rebuilding graph...")
    self._rebuild_graph()

  def _rebuild_graph(self) -> bool:
    """
    Rebuild the graph with current agents from registry.

    Returns:
        bool: True if graph was rebuilt successfully
    """
    try:
      with self._graph_lock:
        old_generation = self._graph_generation
        self._build_graph()
        logger.info(f"Graph successfully rebuilt (generation {old_generation} → {self._graph_generation})")
        return True
    except Exception as e:
      logger.error(f"Failed to rebuild graph: {e}")
      return False

  def force_refresh_agents(self) -> bool:
    """
    Force immediate refresh of agent connectivity and rebuild graph if needed.

    Returns:
        bool: True if changes were detected and graph was rebuilt
    """
    logger.info("Force refresh requested")
    return platform_registry.force_refresh()

  def get_status(self) -> dict:
    """Get current status for monitoring/debugging."""
    with self._graph_lock:
      return {
        "graph_generation": self._graph_generation,
        "registry_status": platform_registry.get_registry_status()
      }

  def _build_graph(self) -> None:
    """
    Internal method to construct and compile a LangGraph instance with current agents.
    Updates self._graph and increments generation counter.
    """
    logger.debug(f"Building graph (generation {self._graph_generation + 1})...")

    base_model = LLMFactory().get_llm()

    # Check if LANGGRAPH_DEV is defined in the environment
    if os.getenv("LANGGRAPH_DEV"):
      checkpointer = None
      store = None
    else:
      checkpointer = InMemorySaver()
      store = InMemoryStore()

    # Get current agents from platform registry
    agent_tools = platform_registry.get_all_agents()

    # The argument is the name to assign to the resulting forwarded message
    forwarding_tool = create_forward_message_tool("platform_engineer_supervisor")

    # Get schema and fix for OpenAI strict validation requirements
    schema = PlatformEngineerResponse.model_json_schema()
    def fix_schema_for_openai(obj):
        if isinstance(obj, dict):
            if obj.get('type') == 'object':
                obj['additionalProperties'] = False
                # OpenAI strict mode requires ALL properties to be in required array
                if 'properties' in obj:
                    obj['required'] = list(obj['properties'].keys())
            for value in obj.values():
                fix_schema_for_openai(value)
        elif isinstance(obj, list):
            for item in obj:
                fix_schema_for_openai(item)

    fix_schema_for_openai(schema)

    # Create a base model with tools (for tool calling)
    model_with_tools = base_model.bind_tools([forwarding_tool] + agent_tools)

    # Create a conditional output processor that handles both tool calls and structured responses
    def process_model_output(message):
        # If the message has tool calls, return it as-is (don't apply structured output)
        if hasattr(message, 'tool_calls') and message.tool_calls:
            return message

        # If it's a final response without tool calls, apply structured output
        try:
            # Try to parse the content as structured output
            if hasattr(message, 'content') and message.content:
                # Use the base model with structured output for final responses
                structured_model = base_model.with_structured_output(
                    schema=schema,
                    method="json_schema",
                    strict=True,
                )
                # Re-invoke with structured output
                structured_response = structured_model.invoke([HumanMessage(content=message.content)])
                return AIMessage(
                    content=json.dumps(structured_response.model_dump() if hasattr(structured_response, 'model_dump') else structured_response)
                )
        except Exception as e:
            logger.warning(f"Failed to apply structured output formatting: {e}")

        # Fallback: return original message
        return message

    model = model_with_tools | RunnableLambda(process_model_output)

    new_graph = create_supervisor(
      model=model,
      agents=[],
      prompt=system_prompt,
      add_handoff_back_messages=True,
      parallel_tool_calls=True,
      tools=[forwarding_tool] + agent_tools,
      output_mode="last_message",
      supervisor_name="platform_engineer_supervisor",
    ).compile(
      checkpointer=checkpointer,
      store=store,
    )

    # Atomically update graph and increment generation
    self._graph = new_graph
    self._graph_generation += 1

    logger.debug(f"LangGraph supervisor created and compiled successfully (generation {self._graph_generation})")
    logger.info(f"Graph updated with {len(agent_tools)} agent tools")

  async def serve(self, prompt: str):
    """
    Processes the input prompt and returns a response from the graph.
    Args:
        prompt (str): The input prompt to be processed by the graph.
    Returns:
        str: The response generated by the graph based on the input prompt.
    """
    try:
      logger.debug(f"Received prompt: {prompt}")
      if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("Prompt must be a non-empty string.")
      result = await self.graph.ainvoke({
          "messages": [
              {
                  "role": "user",
                  "content": prompt
              }
          ],
      }, {"configurable": {"thread_id": uuid.uuid4()}})

      messages = result.get("messages", [])
      if not messages:
        raise RuntimeError("No messages found in the graph response.")

      # Find the last AIMessage with non-empty content
      for message in reversed(messages):
        if isinstance(message, AIMessage) and message.content.strip():
          logger.debug(f"Valid AIMessage found: {message.content.strip()}")
          return message.content.strip()

      raise RuntimeError("No valid AIMessage found in the graph response.")
    except ValueError as ve:
      logger.error(f"ValueError in serve method: {ve}")
      raise ValueError(str(ve))
    except Exception as e:
      logger.error(f"Error in serve method: {e}")
      raise Exception(str(e))
