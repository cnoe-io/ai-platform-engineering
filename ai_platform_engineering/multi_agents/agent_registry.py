# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Agent Registry for AI Platform Engineering Multi-Agent System.

This module provides the central registry for managing and discovering agents
across the platform, with integrated agent enablement logic.
"""

import os
import logging
import httpx
import time
import threading
from typing import Dict, Any, Optional, Callable, List
from concurrent.futures import ThreadPoolExecutor, as_completed
from ai_platform_engineering.utils.a2a_common.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import AgntcySlimRemoteAgentConnectTool
from a2a.types import AgentCard

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

GENERIC_CLIENT = "generic_client"

class AgentRegistry:
    """Centralized registry for transport-aware agent management."""

    # Comprehensive agent configuration with import paths
    # Environment variables follow the convention: ENABLE_{AGENT_NAME_UPPER}
    # e.g., "github" -> ENABLE_GITHUB, "pagerduty" -> ENABLE_PAGERDUTY

    def __init__(self):
        """
        Initialize the AgentRegistry.

        Args:
            agent_names: Optional list of agent names to enable. If None, uses get_enabled_agents().
            validate_imports: If True, validates that agent names exist in AGENT_IMPORT_MAP.
        """
        self._transport = os.getenv("A2A_TRANSPORT", "p2p").lower()
        # Disable connectivity checks by default, can be enabled with SKIP_AGENT_CONNECTIVITY_CHECK=false
        self._check_connectivity = os.getenv("SKIP_AGENT_CONNECTIVITY_CHECK", "true").lower() != "true"
        # Timeout for connectivity checks in seconds
        self._connectivity_timeout = float(os.getenv("AGENT_CONNECTIVITY_TIMEOUT", "5.0"))
        # Retry configuration for startup race conditions
        self._max_retries = int(os.getenv("AGENT_CONNECTIVITY_MAX_RETRIES", "3"))
        self._retry_delay = float(os.getenv("AGENT_CONNECTIVITY_RETRY_DELAY", "2.0"))
        # Initial startup delay before starting connectivity checks
        self._startup_delay = float(os.getenv("AGENT_CONNECTIVITY_STARTUP_DELAY", "0.0"))

        self.AGENT_NAMES = self.get_enabled_agents_from_env()
        self.AGENT_ADDRESS_MAPPING = self.get_agent_address_mapping(self.AGENT_NAMES)

        self._agents: Dict[str, Any] = {}  # Will be populated by _load_agents
        self._tools: Dict[str, Any] = {}  # Will be populated by _load_agents
        self._loaded_modules: Dict[str, Any] = {}  # Cache of loaded modules for refresh

        self._load_agents()

        logger.info("Running on A2A transport mode: %s", self._transport)
        logger.info("Connectivity checks enabled: %s", self._check_connectivity)
        if self._check_connectivity:
            logger.info("Connectivity config: timeout=%.1fs, retries=%d, retry_delay=%.1fs, startup_delay=%.1fs",
                       self._connectivity_timeout, self._max_retries, self._retry_delay, self._startup_delay)
        logger.info("Loaded agents: %s", list(self._agents.keys()))

    def get_enabled_agents_from_env(self) -> List[str]:
        """Get all environment variables that start with ENABLE_*."""
        enabled_agents = []
        for k, v in os.environ.items():
            if k.startswith('ENABLE_'):
                logger.info(f"Found env var: {k} = {v}")
                if v.lower() == "true":
                    logger.info(f"Env var {k} is enabled")
                    enabled_agents.append(k.split('ENABLE_')[1])
        logger.info(f"Enabled agents: {enabled_agents}")
        return enabled_agents

    def get_agent_address_mapping(self, agent_names: List[str]) -> Dict[str, str]:
        """Get the address mapping for all enabled agents."""
        address_mapping = {}
        for agent in agent_names:
            host = os.getenv(f"{agent.upper()}_AGENT_HOST", "localhost")
            port = os.getenv(f"{agent.upper()}_AGENT_PORT", "8000")
            address_mapping[agent] = f"http://{host}:{port}"
        return address_mapping

    @staticmethod
    def _sanitize_tool_name(name: str) -> str:
        r"""
        Sanitize tool name to match OpenAI's pattern requirement: ^[a-zA-Z0-9_\.-]+$

        Args:
            name: Original name (may contain spaces and special characters)

        Returns:
            Sanitized name with only allowed characters
        """
        if not name:
            return "unknown_agent"

        # Replace spaces with underscores
        sanitized = name.replace(' ', '_')
        # Keep only alphanumeric characters, underscores, dots, and hyphens
        sanitized = ''.join(c for c in sanitized if c.isalnum() or c in ('_', '.', '-'))

        # Ensure we have at least some valid characters
        if not sanitized:
            logger.warning(f"Tool name '{name}' sanitized to empty string, using 'unknown_agent'")
            return "unknown_agent"

        return sanitized

    def generate_subagents(self, agent_prompts, model) -> List[Dict[str, Any]]:
        """
        Generate Deep Agent CustomSubAgents for all enabled A2A agents.

        Creates react agents where each has ONE A2ARemoteAgentConnectTool.
        This enables proper task delegation and streaming while maintaining A2A protocol.

        Args:
            agent_prompts: Dict of agent-specific prompt overrides
            model: LLM model to use for subagents

        Returns:
            List of CustomSubAgent dicts with keys: name, description, graph
        """
        from langgraph.prebuilt import create_react_agent

        subagents = []
        for agent in self._agents:
            system_prompt_override = agent_prompts.get(agent, {}).get("system_prompt")
            agent_card = self._agents[agent]
            description = agent_card['description']
            prompt = system_prompt_override or description

            # Sanitize agent name to match OpenAI's tool name pattern
            agent_name = agent_card['name']
            sanitized_name = self._sanitize_tool_name(agent_name)

            # Log if sanitization changed the name
            if sanitized_name != agent_name:
                logger.warning(f"Subagent: Sanitized name from '{agent_name}' to '{sanitized_name}' to match OpenAI pattern requirements")

            # Get the A2A tool for this agent
            if agent not in self._tools:
                logger.warning(f"Tool not found for agent {agent}, skipping subagent creation")
                continue

            a2a_tool = self._tools[agent]

            # Create a react agent with ONLY this A2A tool
            subagent_graph = create_react_agent(
                model,
                prompt=prompt,
                tools=[a2a_tool],  # Single A2A tool
                checkpointer=False,
            )

            subagents.append({
                "name": sanitized_name,
                "description": description,
                "graph": subagent_graph  # CustomSubAgent with pre-created graph
            })
        return subagents

    @property
    def agents(self) -> Dict[str, Any]:
        """Get all available agents."""
        return self._agents

    @property
    def transport(self) -> str:
        """Get the current transport mode."""
        return self._transport

    def get_agent_examples(self, name: str) -> List[str]:
        """Get the examples for a specific agent."""
        if name not in self._agents:
            raise ValueError(f"Agent '{name}' not found. Available: {list(self.agents.keys())}")
        agent_card = self._agents[name]
        return agent_card["skills"][0]["examples"]

    def get_agent(self, name: str) -> Any:
        """Get a specific agent by name."""
        if name not in self.agents:
            raise ValueError(f"Agent '{name}' not found. Available: {list(self.agents.keys())}")
        return self.agents[name]

    def agent_exists(self, name: str) -> bool:
        return name in self.agents

    def get_all_agents(self):
        """Get all agent tools (not agent cards)."""
        return list(self._tools.values())

    def get_examples(self):
        """
        Handy method to get all examples from all agents.
        """
        examples = []
        for agent in self.agents.values():
            examples.extend(agent.get_examples())
        return examples

    def _create_generic_a2a_client(self, name: str, transport: str, agent_url: Optional[str] = None, agent_card: Optional[Dict[str, Any]] = None, tool_name: Optional[str] = None):
        """
        Creates a generic A2A client for a remote agent.

        Args:
            name: Name of the remote agent (registry key, used for URL inference)
            transport: Transport mode ("p2p" or "slim")
            agent_url: Optional URL of the agent (if not provided, infers from env vars)
            agent_card: Optional agent card dict (if provided, tool won't need to fetch it again)
            tool_name: Optional tool name to use (if not provided, uses name parameter)

        Returns:
            A2ARemoteAgentConnectTool: The created A2A client
        """
        # Use provided tool_name or fall back to name
        final_tool_name = tool_name if tool_name else name

        if transport == "p2p":
            if agent_url is None:
                agent_url = self._infer_agent_url_from_env_var(name)

            # If we have the agent card, pass it directly to avoid re-fetching
            # Otherwise, pass the URL and the tool will fetch it
            if agent_card:
                # Convert dict to AgentCard object
                try:
                    # Override the URL in agent_card with the correct URL from AGENT_ADDRESS_MAPPING
                    agent_card_with_url = {**agent_card, 'url': agent_url}
                    agent_card_obj = AgentCard(**agent_card_with_url)
                    return A2ARemoteAgentConnectTool(
                        name=final_tool_name,
                        remote_agent_card=agent_card_obj,
                        skill_id="",
                        description=""
                    )
                except Exception as e:
                    logger.warning(f"Failed to convert agent card to AgentCard object for {name}: {e}, using URL instead")
                    return A2ARemoteAgentConnectTool(
                        name=final_tool_name,
                        remote_agent_card=agent_url,
                        skill_id="",
                        description=""
                    )
            else:
                return A2ARemoteAgentConnectTool(
                    name=final_tool_name,
                    remote_agent_card=agent_url,
                    skill_id="",
                    description=""
                )
        elif transport == "slim":
            return AgntcySlimRemoteAgentConnectTool(
                endpoint=os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357"),
                name=final_tool_name,
                remote_agent_card=os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")
            )
        else:
            raise ValueError(f"Unknown transport mode: {transport}")

    def _check_agent_connectivity(self, agent_name: str, agent_url: str) -> tuple[bool, Optional[Dict[str, Any]]]:
        """
        Check if an agent is reachable and has correct identity.
        For A2A transport: tests HTTP agent card endpoint and returns agent card.
        For SLIM transport: currently no connectivity check is performed.

        Args:
            agent_name: Name of the agent for logging
            agent_url: URL of the agent to test

        Returns:
            Tuple of (is_reachable: bool, agent_card: Optional[Dict]).
            Returns (True, agent_card) if successful, (True, None) for SLIM/disabled checks,
            (False, None) if unreachable.
        """
        if not self._check_connectivity:
            logger.debug(f"Connectivity checks disabled, assuming {agent_name} is reachable")
            return (True, None)

        if self.transport == "slim":
            # For SLIM transport, we currently do not perform any connectivity checks.
            return (True, None)
        else:
            # For A2A transport, use HTTP connectivity check which returns agent card
            return self._check_http_agent_connectivity(agent_name, agent_url)

    def _check_http_agent_connectivity(self, agent_name: str, agent_url: str) -> tuple[bool, Optional[Dict[str, Any]]]:
        """
        Check A2A agent connectivity by testing the agent card endpoint. Only for P2P transport.

        Args:
            agent_name: Name of the agent for logging
            agent_url: URL of the agent to test

        Returns:
            Tuple of (is_reachable: bool, agent_card: Optional[Dict]).
            Returns (True, agent_card) if successful, (False, None) otherwise.
        """
        last_exception = None

        for attempt in range(self._max_retries + 1):  # +1 for initial attempt
            try:
                if attempt > 0:
                    # Exponential backoff: 2s, 4s, 8s, etc.
                    delay = self._retry_delay * (2 ** (attempt - 1))
                    logger.debug(f"Retrying {agent_name} connectivity check in {delay}s (attempt {attempt + 1}/{self._max_retries + 1})")
                    time.sleep(delay)

                logger.debug(f"Testing connectivity for {agent_name} at {agent_url} (attempt {attempt + 1}) [transport: {self.transport}]")

                # Use synchronous HTTP client to avoid event loop conflicts
                with httpx.Client(timeout=httpx.Timeout(self._connectivity_timeout)) as client:
                    # Try to fetch the agent card endpoint - this tests connectivity
                    card_url = f"{agent_url.rstrip('/')}/.well-known/agent-card.json"
                    logger.debug(f"🌐 Testing URL: {card_url}")

                    response = client.get(card_url)
                    logger.debug(f"🌐 Response status: {response.status_code}")
                    response.raise_for_status()  # Raises exception for 4xx/5xx status codes

                    # Validate that this is actually the correct agent by checking the agent card
                    try:
                        agent_card = response.json()
                        logger.debug(f"🌐 Response JSON keys: {list(agent_card.keys()) if isinstance(agent_card, dict) else 'not a dict'}")

                        card_name = agent_card.get('name', '').lower()
                        expected_name = agent_name.lower()
                        logger.debug(f"🌐 Agent card name: '{card_name}', expected: '{expected_name}'")

                        # Check if the agent name matches (handle variations like "AI Platform Engineer" vs "platform_engineer")
                        name_matches = (
                            card_name == expected_name or
                            card_name.replace(' ', '_') == expected_name or
                            card_name.replace('_', ' ') == expected_name or
                            expected_name in card_name or
                            card_name in expected_name
                        )

                        if not name_matches:
                            logger.warning(f"❌ Agent {agent_name} at {agent_url} returned wrong agent card (got '{card_name}', expected '{expected_name}')")
                            logger.debug(f"🌐 Full agent card response: {agent_card}")
                            return (False, None)

                        # Also check skills for additional validation
                        skills = agent_card.get('skills', [])
                        if skills:
                            skill_names = [skill.get('name', '').lower() for skill in skills]
                            skill_ids = [skill.get('id', '').lower() for skill in skills]
                            logger.debug(f"🌐 Agent skills: names={skill_names}, ids={skill_ids}")
                            # Check if agent name appears in any skill
                            agent_in_skills = any(expected_name in skill or skill in expected_name for skill in skill_names + skill_ids)
                            if not agent_in_skills and not name_matches:
                                logger.warning(f"❌ Agent {agent_name} at {agent_url} has no matching skills: {skill_names}")
                                return (False, None)

                        logger.debug(f"✓ Agent {agent_name} identity validated: card_name='{card_name}'")

                    except (ValueError, KeyError) as e:
                        logger.warning(f"❌ Agent {agent_name} at {agent_url} returned invalid agent card JSON: {e}")
                        logger.debug(f"🌐 Raw response content: {response.text[:500]}...")
                        return (False, None)

                    if attempt > 0:
                        logger.info(f"✅ Agent {agent_name} is reachable at {agent_url} (succeeded on attempt {attempt + 1})")
                    else:
                        logger.info(f"✅ Agent {agent_name} is reachable at {agent_url}")
                    return (True, agent_card)

            except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError) as e:
                last_exception = e
                if attempt < self._max_retries:
                    # Log as debug for retryable attempts
                    logger.debug(f"Agent {agent_name} connectivity attempt {attempt + 1} failed: {type(e).__name__}")
                continue
            except Exception as e:
                # Non-retryable exception
                logger.warning(f"❌ Agent {agent_name} at {agent_url} connectivity check failed: {e}")
                return (False, None)

        # All attempts failed
        if isinstance(last_exception, httpx.TimeoutException):
            logger.warning(f"❌ Agent {agent_name} at {agent_url} timed out after {self._max_retries + 1} attempts")
        elif isinstance(last_exception, httpx.ConnectError):
            logger.warning(f"❌ Agent {agent_name} at {agent_url} is not reachable after {self._max_retries + 1} attempts (connection refused)")
        elif isinstance(last_exception, httpx.HTTPStatusError):
            logger.warning(f"❌ Agent {agent_name} at {agent_url} returned HTTP {last_exception.response.status_code} after {self._max_retries + 1} attempts")
        else:
            logger.warning(f"❌ Agent {agent_name} at {agent_url} connectivity check failed after {self._max_retries + 1} attempts: {last_exception}")

        return (False, None)

    def _infer_agent_url_from_env_var(self, agent_name: str) -> str:
        return os.getenv(f"{agent_name.replace('-', '_').upper()}_AGENT_URL", "http://localhost:8000")

    def _get_agent_url_from_module(self, agent_name: str, module) -> str:
        """
        Extract agent URL from the agent module.

        Args:
            agent_name: Name of the agent
            module: The loaded agent module

        Returns:
            str: The agent URL or default if not found
        """
        try:
            logger.debug(f"🔍 Extracting URL for {agent_name} (transport: {self.transport})")

            # Try to get the agent card from the module and extract URL
            if hasattr(module, 'agent_card') and hasattr(module.agent_card, 'url'):
                url = module.agent_card.url
                logger.debug(f"🔍 Found agent card URL for {agent_name}: {url}")
                return url

            # Check if there's a SLIM_ENDPOINT for slim transport
            if self.transport == "slim" and hasattr(module, 'SLIM_ENDPOINT'):
                slim_url = module.SLIM_ENDPOINT
                logger.debug(f"🔍 Found SLIM_ENDPOINT for {agent_name}: {slim_url}")
                return slim_url

            # Fallback to environment variables based on agent name
            agent_url = self._infer_agent_url_from_env_var(agent_name)
            logger.debug(f"🔍 Using env vars for {agent_name}: {agent_url}")
            return agent_url

        except Exception as e:
            logger.debug(f"Could not extract URL for {agent_name}: {e}")
            # Final fallback
            final_url = f"http://agent-{agent_name}-p2p:8000"
            logger.debug(f"🔍 Using final fallback for {agent_name}: {final_url}")
            return final_url

    def _run_connectivity_checks(self) -> tuple[Dict[str, bool], Dict[str, Dict[str, Any]]]:
        """
        Run connectivity checks in parallel using thread pool.

        Returns:
            Tuple of (connectivity_results, agent_cards):
            - connectivity_results: Dict[str, bool] mapping agent_name to connectivity status
            - agent_cards: Dict[str, Dict] mapping agent_name to agent card JSON
        """
        connectivity_results = {}
        agent_cards = {}

        # Use thread pool for parallel connectivity checks
        max_workers = min(len(self.AGENT_ADDRESS_MAPPING), 10)  # Limit concurrent connections

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all connectivity check tasks
            future_to_agent = {
                executor.submit(
                    self._check_agent_connectivity,
                    agent_name,
                    agent_url,
                ): agent_name
                for agent_name, agent_url in self.AGENT_ADDRESS_MAPPING.items()
            }

            # Collect results as they complete
            for future in as_completed(future_to_agent):
                agent_name = future_to_agent[future]
                try:
                    is_reachable, agent_card = future.result()
                    connectivity_results[agent_name] = is_reachable
                    if agent_card:
                        agent_cards[agent_name] = agent_card
                except Exception as e:
                    logger.error(f"Connectivity check for {agent_name} raised exception: {e}")
                    connectivity_results[agent_name] = False

        return connectivity_results, agent_cards

    def _load_agents(self) -> None:
        """Load the appropriate agent implementations based on transport mode with connectivity checks."""
        logger.info("Loading agents with connectivity verification...")

        logger.debug(f"Configured agents: {self.AGENT_NAMES}")

        # Step 1: Apply startup delay if configured (helps with Docker Compose race conditions)
        if self._startup_delay > 0:
            logger.info(f"Waiting {self._startup_delay}s for services to start up before connectivity checks...")
            time.sleep(self._startup_delay)

        # Step 2: Check connectivity and get agent cards, then build registry
        connectivity_results, agent_cards = self._check_connectivity_for_modules()
        agents, tools = self._build_registry_from_active_agents(connectivity_results, agent_cards)

        # Compute stats for logging
        reachable_count = len(agents)
        total_configured = len(self.AGENT_NAMES)
        unreachable_agents = [name for name, is_reachable in connectivity_results.items() if not is_reachable]

        # Log results
        for agent_name in agents.keys():
            logger.info(f"✅ Added {agent_name} to registry (reachable)")
        for agent_name in unreachable_agents:
            logger.warning(f"❌ Excluded {agent_name} from registry (unreachable)")

        # Log summary
        logger.info(f"Agent loading complete: {reachable_count}/{total_configured} agents reachable")
        if unreachable_agents:
            logger.warning(f"Unreachable agents excluded: {', '.join(unreachable_agents)}")
            logger.info("To skip connectivity checks, set SKIP_AGENT_CONNECTIVITY_CHECK=true")

        self._agents = agents
        self._tools = tools
        self._loaded_modules = {}  # No longer using loaded modules

    def _check_connectivity_for_modules(self) -> tuple[Dict[str, bool], Dict[str, Dict[str, Any]]]:
        """Check connectivity for a set of loaded modules."""
        if self.transport == "slim":
            logger.info("Skipping connectivity checks for SLIM transport")
            return {name: True for name in self.AGENT_NAMES}, {}

        logger.info(f"Running connectivity checks for {len(self.AGENT_ADDRESS_MAPPING)} agents (max {self._max_retries + 1} attempts per agent)...")
        return self._run_connectivity_checks()

    def _build_registry_from_active_agents(self, connectivity_results: Dict[str, bool], agent_cards: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        """Build agents registry using connectivity results and cached agent cards."""
        agents = {}
        tools = {}

        for agent_name in self.AGENT_NAMES:
            reachable = connectivity_results.get(agent_name, True)
            if not reachable:
                logger.warning(f"Agent {agent_name} is unreachable, skipping registration...")
                continue

            # Use the cached agent card from connectivity check
            agent_card = agent_cards.get(agent_name)

            if not agent_card:
                logger.warning(f"No agent card available for {agent_name}, skipping registration...")
                continue

            logger.debug(f"Registering agent {agent_name} with cached agent card")
            agents[agent_name] = agent_card

            # Create tool object from agent card
            # Use the agent card's name (not the registry key) for the tool name
            # to ensure it matches the subagent name
            tool_name = agent_card.get('name', agent_name)

            # Sanitize tool name to match OpenAI's pattern: ^[a-zA-Z0-9_\.-]+$
            sanitized_tool_name = self._sanitize_tool_name(tool_name)

            # Log if sanitization changed the name
            if sanitized_tool_name != tool_name:
                logger.warning(f"Agent {agent_name}: Sanitized tool name from '{tool_name}' to '{sanitized_tool_name}' to match OpenAI pattern requirements")

            agent_url = self.AGENT_ADDRESS_MAPPING.get(agent_name)

            try:
                # Pass the actual agent_url and agent_card from connectivity check
                # Pass sanitized_tool_name to the constructor so it's set correctly from the start
                tool = self._create_generic_a2a_client(
                    agent_name,
                    self._transport,
                    agent_url,
                    agent_card,
                    tool_name=sanitized_tool_name
                )
                tool.description = agent_card.get('description', '')
                tools[agent_name] = tool
                logger.debug(f"Created tool for agent {agent_name} with name '{sanitized_tool_name}' (original: '{tool_name}') using URL {agent_url}")
            except Exception as e:
                logger.error(f"Failed to create tool for agent {agent_name}: {e}")
                # Remove the agent card if tool creation fails
                del agents[agent_name]
                continue

        return agents, tools

    def _refresh_connectivity_only(self) -> bool:
        """Efficiently refresh agent connectivity without reloading modules."""
        logger.debug(f"Refreshing connectivity for {len(self.AGENT_NAMES)} agents...")

        # Store current state
        old_agent_names = set(self._agents.keys())

        # Check connectivity and rebuild registry
        connectivity_results, agent_cards = self._check_connectivity_for_modules()
        agents, tools = self._build_registry_from_active_agents(connectivity_results, agent_cards)

        # Update registry
        self._agents = agents
        self._tools = tools

        # Check for changes
        new_agent_names = set(self._agents.keys())

        has_changes = old_agent_names != new_agent_names

        if has_changes:
            added = new_agent_names - old_agent_names
            removed = old_agent_names - new_agent_names
            if added:
                logger.debug(f"Connectivity refresh: Agents added: {', '.join(added)}")
            if removed:
                logger.debug(f"Connectivity refresh: Agents removed: {', '.join(removed)}")
        else:
            logger.debug("Connectivity refresh: No changes detected")

        return has_changes

    def enable_dynamic_monitoring(self, on_change_callback: Optional[Callable[[], None]] = None):
        """Initialize dynamic monitoring for existing AgentRegistry instance."""
        # Initialize monitoring configuration
        self._refresh_interval = float(os.getenv("AGENT_CONNECTIVITY_REFRESH_INTERVAL", "300"))  # 5 minutes
        self._enable_background_monitoring = os.getenv("AGENT_CONNECTIVITY_ENABLE_BACKGROUND", "false").lower() == "true"
        self._fast_check_timeout = float(os.getenv("AGENT_CONNECTIVITY_FAST_CHECK_TIMEOUT", "2.0"))

        # Thread safety
        self._lock = threading.RLock()
        self._monitoring_thread = None
        self._stop_monitoring = threading.Event()

        # Callback for when agent list changes
        self._on_change_callback = on_change_callback

        # Track initial state
        with self._lock:
            self._last_agent_list = set(self._agents.keys())
            self._last_tools_count = len(self._tools)

        # Start background monitoring if enabled
        if self._enable_background_monitoring and self._refresh_interval > 0:
            self.start_background_monitoring()

        logger.info(f"Dynamic monitoring enabled for {len(self._agents)} agents")
        if self._enable_background_monitoring:
            logger.info(f"Background monitoring enabled (interval: {self._refresh_interval}s)")

    def refresh_agents(self, use_fast_timeout: bool = False) -> bool:
        """
        Re-check agent connectivity and reload registry.

        Args:
            use_fast_timeout: Use faster timeout for background checks

        Returns:
            bool: True if agent list or tools changed
        """
        if not hasattr(self, '_lock'):
            logger.warning("Dynamic monitoring not initialized, call enable_dynamic_monitoring() first")
            return False

        with self._lock:
            # Store current state
            old_agents = set(self._agents.keys())
            old_tools_count = len(self._tools)

            # Temporarily adjust timeout for background checks
            original_timeout = self._connectivity_timeout
            if use_fast_timeout:
                self._connectivity_timeout = self._fast_check_timeout

            try:
                logger.debug("Refreshing agent connectivity...")
                # Use efficient connectivity-only refresh instead of full reload
                has_changes = self._refresh_connectivity_only()

                if has_changes:
                    # Get updated state for logging
                    new_agents = set(self._agents.keys())
                    new_tools_count = len(self._tools)

                    # Log changes
                    agents_changed = old_agents != new_agents
                    tools_changed = old_tools_count != new_tools_count

                    if agents_changed:
                        added = new_agents - old_agents
                        removed = old_agents - new_agents
                        if added:
                            logger.info(f"🔄 Agents added: {', '.join(added)}")
                        if removed:
                            logger.info(f"🔄 Agents removed: {', '.join(removed)}")

                    if tools_changed:
                        logger.info(f"🔄 Tools count changed: {old_tools_count} → {new_tools_count}")

                    # Update tracking
                    self._last_agent_list = new_agents
                    self._last_tools_count = new_tools_count

                    # Notify callback
                    if self._on_change_callback:
                        try:
                            self._on_change_callback()
                        except Exception as e:
                            logger.error(f"Error in change callback: {e}")
                else:
                    logger.debug("No agent changes detected")

                return has_changes

            finally:
                # Restore original timeout
                if use_fast_timeout:
                    self._connectivity_timeout = original_timeout

    def start_background_monitoring(self):
        """Start background thread for periodic agent monitoring."""
        if not hasattr(self, '_monitoring_thread'):
            logger.warning("Dynamic monitoring not initialized, call enable_dynamic_monitoring() first")
            return

        if self._monitoring_thread and self._monitoring_thread.is_alive():
            logger.warning("Background monitoring already running")
            return

        self._stop_monitoring.clear()
        self._monitoring_thread = threading.Thread(
            target=self._background_monitor,
            name="AgentConnectivityMonitor",
            daemon=True
        )
        self._monitoring_thread.start()
        logger.info(f"Started background agent monitoring (interval: {self._refresh_interval}s)")

    def stop_background_monitoring(self):
        """Stop background monitoring thread."""
        if not hasattr(self, '_monitoring_thread') or not self._monitoring_thread:
            return

        if self._monitoring_thread.is_alive():
            logger.info("Stopping background agent monitoring...")
            self._stop_monitoring.set()
            self._monitoring_thread.join(timeout=10)
            if self._monitoring_thread.is_alive():
                logger.warning("Background monitoring thread did not stop cleanly")
            else:
                logger.info("Background monitoring stopped")

    def _background_monitor(self):
        """Background thread function for periodic monitoring."""
        logger.info("Background agent monitoring started")

        while not self._stop_monitoring.is_set():
            try:
                # Wait for the refresh interval (or until stop signal)
                if self._stop_monitoring.wait(self._refresh_interval):
                    break  # Stop signal received

                # Perform connectivity refresh with fast timeout
                logger.info("Running background agent connectivity check...")
                start_time = time.time()

                has_changes = self.refresh_agents(use_fast_timeout=True)

                duration = time.time() - start_time
                if has_changes:
                    logger.info(f"Background check completed in {duration:.1f}s - changes detected")
                else:
                    logger.info(f"Background check completed in {duration:.1f}s - no changes")

            except Exception as e:
                logger.error(f"Error in background monitoring: {e}")
                # Continue monitoring despite errors

        logger.info("Background agent monitoring stopped")

    def force_refresh(self) -> bool:
        """Force immediate refresh (useful for manual triggers or API calls)."""
        logger.info("Force refresh requested")
        return self.refresh_agents(use_fast_timeout=False)

    def get_registry_status(self) -> Dict[str, Any]:
        """Get current registry status for monitoring/debugging."""
        if not hasattr(self, '_lock'):
            return {
                "agents_count": len(self._agents),
                "tools_count": len(self._tools),
                "agents": list(self._agents.keys()),
                "dynamic_monitoring": False
            }

        with self._lock:
            return {
                "agents_count": len(self._agents),
                "tools_count": len(self._tools),
                "agents": list(self._agents.keys()),
                "background_monitoring": self._enable_background_monitoring,
                "refresh_interval": self._refresh_interval,
                "monitoring_active": self._monitoring_thread and self._monitoring_thread.is_alive() if self._monitoring_thread else False
            }

    def __del__(self):
        """Cleanup background monitoring on destruction."""
        try:
            if hasattr(self, 'stop_background_monitoring'):
                self.stop_background_monitoring()
        except Exception as e:
            logger.error(f"Error in __del__: {e}")
            pass
