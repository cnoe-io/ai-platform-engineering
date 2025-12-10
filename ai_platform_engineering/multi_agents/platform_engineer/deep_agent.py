# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import logging
import uuid
import os
import threading
import asyncio
from langchain_core.messages import AIMessage
from langgraph.graph.state import CompiledStateGraph
from langgraph.checkpoint.memory import InMemorySaver
from cnoe_agent_utils import LLMFactory
from langchain_mcp_adapters.client import MultiServerMCPClient
from typing import Optional, Dict, Any, List
import time
import httpx
import traceback


from ai_platform_engineering.multi_agents.platform_engineer import platform_registry
from ai_platform_engineering.multi_agents.platform_engineer.prompts import agent_prompts, generate_system_prompt
from ai_platform_engineering.multi_agents.tools import (
    reflect_on_output,
    format_markdown,
    fetch_url,
    get_current_date,
    write_workspace_file,
    read_workspace_file,
    list_workspace_files,
    clear_workspace
)
from deepagents import async_create_deep_agent

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# RAG Configuration
ENABLE_RAG = os.getenv("ENABLE_RAG", "false").lower() in ("true", "1", "yes")
RAG_SERVER_URL = os.getenv("RAG_SERVER_URL", "http://localhost:9446").strip("/")
RAG_CONNECTIVITY_RETRIES = 5
RAG_CONNECTIVITY_WAIT_SECONDS = 10

class AIPlatformEngineerMAS:
  def __init__(self):
    # Use existing platform_registry and enable dynamic monitoring
    platform_registry.enable_dynamic_monitoring(on_change_callback=self._on_agents_changed)

    # Thread safety for graph access
    # Thread safety for graph access
    self._graph_lock = asyncio.Lock()
    self._graph = None
    self._graph_generation = 0  # Track graph version for debugging
    # RAG-related instance variables
    self.rag_enabled = ENABLE_RAG # if the server is not reachable, this will be set to False
    self.rag_config: Optional[Dict[str, Any]] = None # the rag config returned from the server
    self.rag_config_timestamp: Optional[float] = None # the timestamp of the last time the rag config was fetched
    self.rag_mcp_client: Optional[MultiServerMCPClient] = None # the mcp client for the rag server
    self.rag_tools: List[Any] = [] # the MCP tools returned from the rag server, loaded at startup

    self._initialized = False

    logger.info(f"AIPlatformEngineerMAS initialized with {len(platform_registry.agents)} agents")
    if self.rag_enabled:
      logger.info(f"✅📚 RAG is ENABLED - will attempt to connect to {RAG_SERVER_URL}")
    else:
      logger.info("❌📚 RAG is DISABLED")

  async def ensure_initialized(self):
      """Ensure graph is built before use."""
      if self._initialized and self._graph:
          return

      async with self._graph_lock:
          if self._initialized and self._graph:
              return
          await self._build_graph()
          self._initialized = True

  def get_graph(self) -> CompiledStateGraph:
    """
    Returns the current compiled LangGraph instance.
    Warning: This returns None if ensure_initialized() hasn't been awaited.
    """
    return self._graph

  async def _on_agents_changed(self):
    """Callback triggered when agent registry detects changes."""
    logger.info("Agent registry change detected, rebuilding graph...")
    await self._rebuild_graph()

  async def _rebuild_graph(self) -> bool:
    """
    Rebuild the graph with current agents from registry.

    Returns:
        bool: True if graph was rebuilt successfully
    """
    try:
      async with self._graph_lock:
        old_generation = self._graph_generation
        await self._build_graph()
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
      status = {
        "graph_generation": self._graph_generation,
        "registry_status": platform_registry.get_registry_status()
      }
      if self.rag_enabled:
        status["rag_enabled"] = True
        status["rag_connected"] = self.rag_config is not None
        status["rag_config_age_seconds"] = (
          time.time() - self.rag_config_timestamp
          if self.rag_config_timestamp else None
        )
      else:
        status["rag_enabled"] = False
      return status

  async def _load_rag_tools(self) -> List[Any]:
    """
    Load RAG MCP tools from the server.
    Returns list of tools or empty list if unavailable.
    """
    if not self.rag_enabled or self.rag_config is None:
      return []

    try:
      # Initialize MCP client if not already done
      if self.rag_mcp_client is None:
        logger.info(f"Initializing RAG MCP client for {RAG_SERVER_URL}/mcp")
        self.rag_mcp_client = MultiServerMCPClient({
          "rag": {
            "url": f"{RAG_SERVER_URL}/mcp",
            "transport": "streamable_http",
          }
        })

      # Fetch tools from MCP server
      logger.info("Loading RAG tools from MCP server...")
      tools = await self.rag_mcp_client.get_tools()
      logger.info(f"✅ Loaded {len(tools)} RAG tools: {[t.name for t in tools]}")
      return tools

    except Exception as e:
      logger.error(f"Error loading RAG tools: {e}")
      logger.error(traceback.format_exc())
      return []


  async def _build_graph(self) -> None:
    """
    Internal method to construct and compile a DeepAgents graph with current agents.
    Updates self._graph and increments generation counter.
    """
    logger.debug(f"Building deep agent (generation {self._graph_generation + 1})...")

    base_model = LLMFactory().get_llm()

    # Dynamically generate system prompt and subagents from current registry
    current_agents = platform_registry.agents

    # Do RAG connectivity check and initial tool loading synchronously at startup
    if self.rag_enabled and self.rag_config is None:
        logger.info("Performing initial RAG setup...")
        try:
            # Use httpx synchronous client for connectivity check
            logger.info(f"Checking RAG server connectivity at {RAG_SERVER_URL}...")

            for attempt in range(1, RAG_CONNECTIVITY_RETRIES + 1):
                try:
                    with httpx.Client() as client:
                        response = client.get(f"{RAG_SERVER_URL}/healthz", timeout=5.0)
                        if response.status_code == 200:
                            logger.info(f"✅ RAG server connected successfully on attempt {attempt}")

                            # Fetch initial config synchronously
                            data = response.json()
                            self.rag_config = data.get("config", {})
                            self.rag_config_timestamp = time.time()

                            logger.info(f"RAG Server returned config: {self.rag_config}")

                            # Load MCP tools using a thread pool to avoid event loop conflicts
                            try:
                                import concurrent.futures
                                logger.info("Loading RAG MCP tools...")

                                # Run async code in a separate thread with its own event loop
                                with concurrent.futures.ThreadPoolExecutor() as executor:
                                    future = executor.submit(asyncio.run, self._load_rag_tools())
                                    self.rag_tools = future.result(timeout=10)

                                if self.rag_tools:
                                    logger.info(f"✅📚 Loaded {len(self.rag_tools)} RAG tools at startup")
                                    logger.info(f"📋 RAG tool names: {[t.name for t in self.rag_tools]}")
                                else:
                                    logger.warning("No RAG tools loaded (empty list returned)")
                            except Exception as e:
                                logger.error(f"Failed to load RAG tools: {e}")
                                import traceback
                                logger.error(traceback.format_exc())
                                self.rag_tools = []

                            break
                        else:
                            logger.warning(f"⚠️  RAG server returned status {response.status_code} on attempt {attempt}")
                except Exception as e:
                    logger.warning(f"❌ RAG server connection attempt {attempt} failed: {e}")

                # Wait with countdown if not last attempt
                if attempt < RAG_CONNECTIVITY_RETRIES:
                    logger.info(f"Retrying in {RAG_CONNECTIVITY_WAIT_SECONDS} seconds... ({attempt}/{RAG_CONNECTIVITY_RETRIES})")
                    for countdown in range(RAG_CONNECTIVITY_WAIT_SECONDS, 0, -1):
                        logger.info(f"  ⏳ {countdown}...")
                        time.sleep(1)

            # If still not connected, disable RAG
            if self.rag_config is None:
                logger.error(f"❌ Failed to connect to RAG server after {RAG_CONNECTIVITY_RETRIES} attempts. RAG disabled.")
                self.rag_enabled = False

        except Exception as e:
            logger.error(f"Error during RAG setup: {e}")
            self.rag_enabled = False

    system_prompt = generate_system_prompt(current_agents, self.rag_config)

    logger.info(f"📝 Generated system prompt: {len(system_prompt)} chars")

    # Get fresh tools from registry (for tool notifications and visibility)
    all_agents = platform_registry.get_all_agents()

    # Add utility tools: reflection, markdown formatting, URL fetching, current date, workspace
    all_tools = all_agents + [
        reflect_on_output,
        format_markdown,
        fetch_url,
        get_current_date,
        write_workspace_file,
        read_workspace_file,
        list_workspace_files,
        clear_workspace
    ]

    # Add RAG tools if initially loaded
    if self.rag_tools:
      all_tools.extend(self.rag_tools)
      logger.info(f"✅📚 Added {len(self.rag_tools)} RAG tools to supervisor")

    # Generate CustomSubAgents (pre-created react agents with A2A tools)
    subagents = platform_registry.generate_subagents(agent_prompts, base_model)

    # CHECK FOR SINGLE GRAPH MODE
    # If enabled, try to replace A2A subagents with local compiled graphs
    if os.getenv("SINGLE_GRAPH_MODE", "false").lower() == "true":
        logger.info("🔗 SINGLE GRAPH MODE detected - attempting to load local agent graphs")
        # This will both replace existing proxies AND append missing local agents
        subagents = await self._inject_local_graphs(subagents)

    logger.info(f'🔧 Rebuilding with {len(all_tools)} tools and {len(subagents)} subagents')
    logger.info(f'📦 Tools: {[t.name for t in all_tools]}')
    logger.info(f'🤖 Subagents: {[s["name"] for s in subagents]}')

    # Create the Deep Agent with CUSTOM SUBAGENT architecture
    # Each A2A agent is a pre-created react agent (CustomSubAgent) with ONE A2ARemoteAgentConnectTool
    # Benefits:
    # - Main supervisor has NO direct A2A tools (avoids conflicts with write_todos)
    # - Proper task delegation via task() tool (supervisor manages TODOs, delegates to subagents)
    # - Token-by-token streaming from subagents
    # - A2A protocol maintained (each subagent uses its A2ARemoteAgentConnectTool)

    logger.info("🎨 Creating deep agent with system prompt")

    deep_agent = async_create_deep_agent(
      tools=all_tools,  # A2A tools + RAG tools + reflect_on_output for validation
      instructions=system_prompt,  # System prompt enforces TODO-based execution workflow
      subagents=subagents,  # CustomSubAgents for proper task() delegation
      model=base_model,
      # response_format=PlatformEngineerResponse  # Removed: Causes embedded JSON in streaming output
      # Sub-agent DataParts (like Jarvis forms) still work - they're forwarded independently
    )

    # Check if LANGGRAPH_DEV is defined in the environment
    if os.getenv("LANGGRAPH_DEV"):
      checkpointer = None
    else:
      checkpointer = InMemorySaver()

    # Attach checkpointer if desired
    if checkpointer is not None:
      deep_agent.checkpointer = checkpointer

    # Atomically update graph and increment generation
    self._graph = deep_agent
    self._graph_generation += 1

    logger.debug(f"Deep agent created successfully (generation {self._graph_generation})")
    logger.info(f"✅ Deep agent updated with {len(all_agents)} tools and {len(subagents)} subagents")


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

      # Auto-inject current date into every query
      # This eliminates need for supervisor to call get_current_date() tool
      from datetime import datetime
      current_date = datetime.now().strftime("%Y-%m-%d")
      current_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
      date_enhanced_prompt = f"{prompt}\n\n[Current date: {current_date}, Current date/time: {current_datetime}]"

      graph = self.get_graph()
      result = await graph.ainvoke({
          "messages": [
              {
                  "role": "user",
                  "content": date_enhanced_prompt
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

  async def serve_stream(self, prompt: str):
    """
    Processes the input prompt and streams responses from the graph.
    This allows the UI to show the todo list as it's created, before tool calls are made.

    Args:
        prompt (str): The input prompt to be processed by the graph.
    Yields:
        dict: Streaming events from the graph including agent responses and tool calls.
    """
    try:
      logger.warning(f"Received streaming prompt: {prompt}")
      if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("Prompt must be a non-empty string.")

      graph = self.get_graph()
      thread_id = str(uuid.uuid4())

      # Stream events from the graph
      async for event in graph.astream_events(
          {
              "messages": [
                  {
                      "role": "user",
                      "content": prompt
                  }
              ],
          },
          {"configurable": {"thread_id": thread_id}},
          version="v2"
      ):

        logger.error(f"Streaming event: {event}")
        # Stream agent response chunks (includes todo list planning)
        if event["event"] == "on_chat_model_stream":
          chunk = event.get("data", {}).get("chunk")
          if chunk and hasattr(chunk, "content") and chunk.content:
            yield {
              "type": "content",
              "data": chunk.content
            }

        # Stream tool call start events
        elif event["event"] == "on_tool_start":
          tool_name = event.get("name", "unknown")
          yield {
            "type": "tool_start",
            "tool": tool_name,
            "data": f"\n\n🔧 Calling {tool_name}...\n"
          }

        # Stream tool results
        elif event["event"] == "on_tool_end":
          tool_name = event.get("name", "unknown")
          yield {
            "type": "tool_end",
            "tool": tool_name,
            "data": f"✅ {tool_name} completed\n"
          }

    except ValueError as ve:
      logger.error(f"ValueError in serve_stream method: {ve}")
      yield {
        "type": "error",
        "data": str(ve)
      }
    except Exception as e:
      logger.error(f"Error in serve_stream method: {e}")
      yield {
        "type": "error",
        "data": str(e)
      }

  async def _inject_local_graphs(self, subagents: list) -> list:
    """
    Helper to replace A2A proxy subagents with actual local compiled graphs.
    Also adds agents that are enabled via env vars but were filtered by registry connectivity checks.
    """
    # Mapping of agent name to (module_path, class_name)
    local_agent_registry = {
        "argocd": ("ai_platform_engineering.agents.argocd.agent_argocd.protocol_bindings.a2a_server.agent", "ArgoCDAgent"),
        "github": ("ai_platform_engineering.agents.github.agent_github.protocol_bindings.a2a_server.agent", "GitHubAgent"),
        "jira": ("ai_platform_engineering.agents.jira.agent_jira.protocol_bindings.a2a_server.agent", "JiraAgent"),
        "komodor": ("ai_platform_engineering.agents.komodor.agent_komodor.protocol_bindings.a2a_server.agent", "KomodorAgent"),
        "confluence": ("ai_platform_engineering.agents.confluence.agent_confluence.protocol_bindings.a2a_server.agent", "ConfluenceAgent"),
        "pagerduty": ("ai_platform_engineering.agents.pagerduty.agent_pagerduty.protocol_bindings.a2a_server.agent", "PagerDutyAgent"),
        "slack": ("ai_platform_engineering.agents.slack.agent_slack.protocol_bindings.a2a_server.agent", "SlackAgent"),
        "splunk": ("ai_platform_engineering.agents.splunk.agent_splunk.protocol_bindings.a2a_server.agent", "SplunkAgent"),
        "weather": ("ai_platform_engineering.agents.weather.agent_weather.protocol_bindings.a2a_server.agent", "WeatherAgent"),
        "webex": ("ai_platform_engineering.agents.webex.agent_webex.protocol_bindings.a2a_server.agent", "WebexAgent"),
        "backstage": ("ai_platform_engineering.agents.backstage.agent_backstage.protocol_bindings.a2a_server.agent", "BackstageAgent"),
    }

    # AWS requires special handling, skipping for now as it lacks standard MCP dir structure
    # "aws": ("ai_platform_engineering.agents.aws.agent_aws.protocol_bindings.a2a_server.agent", "AWSAgent"),

    from langchain_core.runnables.config import RunnableConfig
    import importlib
    import inspect
    
    # Import agent_prompts from prompts module for descriptions
    from ai_platform_engineering.multi_agents.platform_engineer.prompts import agent_prompts

    # 1. Identify which agents SHOULD be enabled based on env vars
    enabled_agents = []
    for agent_key in local_agent_registry.keys():
        env_var = f"ENABLE_{agent_key.upper()}"
        if os.getenv(env_var, "false").lower() == "true":
            enabled_agents.append(agent_key)
    
    logger.info(f"🔗 Single Graph Mode: Enabled local agents: {enabled_agents}")

    # 2. Process each enabled agent
    for agent_key in enabled_agents:
        module_path, class_name = local_agent_registry[agent_key]
        
        try:
            logger.info(f"🔄 Loading local graph for {agent_key} from {module_path}.{class_name}...")
            
            # Dynamic import
            module = importlib.import_module(module_path)
            agent_class = getattr(module, class_name)
            
            # Instantiate agent
            agent_instance = agent_class()
            
            # Logic to find the MCP server path relative to the agent module
            # Standard generic pattern:
            # Module: .../agents/{name}/agent_{name}/protocol_bindings/a2a_server/agent.py
            # Server: .../agents/{name}/mcp/mcp_{name}/server.py
            # Relative: ../../../../mcp/mcp_{name}/server.py
            
            agent_file = inspect.getfile(agent_class)
            agent_dir = os.path.dirname(agent_file)
            
            # Try standard path
            # Try standard path
            # Expected: .../agents/{name}/agent_{name}/protocol_bindings/a2a_server/agent.py
            # Go up 3 levels to reach .../agents/{name}
            possible_server_path = os.path.abspath(os.path.join(
                agent_dir, 
                "../../../mcp", 
                f"mcp_{agent_key}", 
                "server.py"
            ))
            
            config_args = {}
            if os.path.exists(possible_server_path):
                logger.info(f"   📍 Found local MCP server at: {possible_server_path}")
                config_args["server_path"] = possible_server_path
            else:
                logger.warning(f"   ⚠️ Could not find local MCP server at {possible_server_path}. Agent might rely on default or fail.")
            
            # Initialize graph
            await agent_instance._setup_mcp_and_graph(RunnableConfig(configurable=config_args))
            
            if not agent_instance.graph:
                logger.warning(f"❌ Local graph for {agent_key} resulted in None")
                continue

            # Check if this agent was already in the list (replace it) or needs to be added
            found = False
            for subagent in subagents:
                # Flexible name matching (argocd vs ArgoCD)
                if subagent.get("name", "").lower().replace(" ", "_") == agent_key:
                    subagent["graph"] = agent_instance.graph
                    # Get description from prompt_config or fallback to agent's instruction
                    agent_description = agent_prompts.get(agent_key, {}).get("system_prompt", None)
                    subagent["description"] = agent_description.strip() if agent_description else agent_instance.get_system_instruction()
                    logger.info(f"✅ Replaced existing A2A proxy with local graph for {agent_key}")
                    found = True
                    break
            
            if not found:
                # Add new subagent entry with description from prompt_config
                agent_description = agent_prompts.get(agent_key, {}).get("system_prompt", f"Manage {agent_key} resources.")
                logger.info(f"✅ Injecting missing local agent {agent_key} into graph")
                subagents.append({
                    "name": agent_key,  # Use key as canonical name
                    "description": agent_description.strip(),
                    "graph": agent_instance.graph
                })

        except Exception as e:
            logger.error(f"❌ Failed to load local graph for {agent_key}: {e}")
            import traceback
            logger.error(traceback.format_exc())

    return subagents

