# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import os
import asyncio
import logging
import httpx
import time
import threading
from typing import Dict, Any, Optional, Callable
import importlib
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeoutError
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import (
    A2ARemoteAgentConnectTool,
)
from ai_platform_engineering.utils.agntcy.agntcy_remote_agent_connect import AgntcySlimRemoteAgentConnectTool
from ai_platform_engineering.utils.misc.misc import run_coroutine_sync

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

GENERIC_CLIENT = "generic_client"

class AgentRegistry:
    """Centralized registry for transport-aware agent management."""

    # Default agent names - to be overridden by subclasses
    AGENT_NAMES = []

    # Map agent names to their import paths
    AGENT_IMPORT_MAP = {
        "github": {
            "slim": "ai_platform_engineering.agents.github.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.github.clients.a2a.agent"
        },
        "pagerduty": {
            "slim": "ai_platform_engineering.agents.pagerduty.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.pagerduty.clients.a2a.agent"
        },
        "jira": {
            "slim": "ai_platform_engineering.agents.jira.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.jira.clients.a2a.agent"
        },
        "backstage": {
            "slim": "ai_platform_engineering.agents.backstage.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.backstage.clients.a2a.agent"
        },
        "confluence": {
            "slim": "ai_platform_engineering.agents.confluence.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.confluence.clients.a2a.agent"
        },
        "argocd": {
            "slim": "ai_platform_engineering.agents.argocd.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.argocd.clients.a2a.agent"
        },
        "aws": {
            "slim": "ai_platform_engineering.agents.aws.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.aws.clients.a2a.agent"
        },
        "slack": {
            "slim": "ai_platform_engineering.agents.slack.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.slack.clients.a2a.agent"
        },
        "komodor": {
            "slim": "ai_platform_engineering.agents.komodor.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.komodor.clients.a2a.agent"
        },
        "weather": {
            "slim": "ai_platform_engineering.agents.weather.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.weather.clients.a2a.agent"
        },
        "splunk": {
            "slim": "ai_platform_engineering.agents.splunk.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.splunk.clients.a2a.agent"
        },
        "webex": {
            "slim": "ai_platform_engineering.agents.webex.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.webex.clients.a2a.agent"
        },
        "petstore": {
            "slim": "ai_platform_engineering.agents.template.clients.slim.agent",
            "a2a": "ai_platform_engineering.agents.template.clients.a2a.agent"
        },
        "rag": {
            "slim": "ai_platform_engineering.knowledge_bases.rag.agent_rag.src.agent_rag.clients.slim.agent",
            "a2a": "ai_platform_engineering.knowledge_bases.rag.agent_rag.src.agent_rag.clients.a2a.agent"
        },
    }

    def __init__(self):
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

    @property
    def agents(self) -> Dict[str, Any]:
        """Get all available agents."""
        return self._agents

    @property
    def transport(self) -> str:
        """Get the current transport mode."""
        return self._transport

    def get_agent(self, name: str) -> Any:
        """Get a specific agent by name."""
        if name not in self.agents:
            raise ValueError(f"Agent '{name}' not found. Available: {list(self.agents.keys())}")
        return self.agents[name]

    def agent_exists(self, name: str) -> bool:
        return name in self.agents

    def get_all_agents(self):
        return list(self.agents.values())

    def get_examples(self):
        """
        Handy method to get all examples from all agents.
        """
        examples = []
        for agent in self.agents.values():
            examples.extend(agent.get_examples())
        return examples

    def _create_generic_a2a_client(self, name: str, transport: str):
        """
        Creates a generic A2A client for a remote agent. Infers the agent card URL from environment variables.

        Args:
            name: Name of the remote agent
            transport: Transport mode ("p2p" or "slim")

        Returns:
            A2ARemoteAgentConnectTool: The created A2A client
        """
        if transport == "p2p":
            agent_url = self._infer_agent_url_from_env_var(name)
            return A2ARemoteAgentConnectTool(
                name=name,
                remote_agent_card=agent_url,
                skill_id="",
                description=""
            )
        elif transport == "slim":
            return AgntcySlimRemoteAgentConnectTool(
                endpoint=os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357"),
                name=name,
                remote_agent_card=os.getenv("SLIM_ENDPOINT", "http://slim-dataplane:46357")
            )
        else:
            raise ValueError(f"Unknown transport mode: {transport}")

    def _check_agent_connectivity(self, agent_name: str, agent_url: str) -> bool:
        """
        Check if an agent is reachable and has correct identity.
        For A2A transport: tests HTTP agent card endpoint.
        For SLIM transport: currently no connectivity check is performed.

        Args:
            agent_name: Name of the agent for logging
            agent_url: URL of the agent to test

        Returns:
            bool: True if agent is reachable and valid, False otherwise
        """
        if not self._check_connectivity:
            logger.debug(f"Connectivity checks disabled, assuming {agent_name} is reachable")
            return True

        if self.transport == "slim":
            # For SLIM transport, we currently do not perform any connectivity checks.
            return True
        else:
            # For A2A transport, use HTTP connectivity check
            return self._check_http_agent_connectivity(agent_name, agent_url)

    def _check_http_agent_connectivity(self, agent_name: str, agent_url: str) -> bool:
        """
        Check A2A agent connectivity by testing the agent card endpoint. Only for P2P transport.

        Args:
            agent_name: Name of the agent for logging
            agent_url: URL of the agent to test

        Returns:
            bool: True if agent is reachable and valid
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
                    card_url = f"{agent_url.rstrip('/')}/.well-known/agent.json"
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
                            return False

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
                                return False

                        logger.debug(f"✓ Agent {agent_name} identity validated: card_name='{card_name}'")

                    except (ValueError, KeyError) as e:
                        logger.warning(f"❌ Agent {agent_name} at {agent_url} returned invalid agent card JSON: {e}")
                        logger.debug(f"🌐 Raw response content: {response.text[:500]}...")
                        return False

                    if attempt > 0:
                        logger.info(f"✅ Agent {agent_name} is reachable at {agent_url} (succeeded on attempt {attempt + 1})")
                    else:
                        logger.info(f"✅ Agent {agent_name} is reachable at {agent_url}")
                    return True

            except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError) as e:
                last_exception = e
                if attempt < self._max_retries:
                    # Log as debug for retryable attempts
                    logger.debug(f"Agent {agent_name} connectivity attempt {attempt + 1} failed: {type(e).__name__}")
                continue
            except Exception as e:
                # Non-retryable exception
                logger.warning(f"❌ Agent {agent_name} at {agent_url} connectivity check failed: {e}")
                return False

        # All attempts failed
        if isinstance(last_exception, httpx.TimeoutException):
            logger.warning(f"❌ Agent {agent_name} at {agent_url} timed out after {self._max_retries + 1} attempts")
        elif isinstance(last_exception, httpx.ConnectError):
            logger.warning(f"❌ Agent {agent_name} at {agent_url} is not reachable after {self._max_retries + 1} attempts (connection refused)")
        elif isinstance(last_exception, httpx.HTTPStatusError):
            logger.warning(f"❌ Agent {agent_name} at {agent_url} returned HTTP {last_exception.response.status_code} after {self._max_retries + 1} attempts")
        else:
            logger.warning(f"❌ Agent {agent_name} at {agent_url} connectivity check failed after {self._max_retries + 1} attempts: {last_exception}")

        return False

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

    def _run_connectivity_checks(self, connectivity_tasks) -> Dict[str, bool]:
        """
        Run connectivity checks in parallel using thread pool.

        Args:
            connectivity_tasks: List of (agent_name, agent_url) tuples to check
            loaded_modules: Dict of loaded agent modules (for slim transport validation)

        Returns:
            Dict[str, bool]: Mapping of agent_name to connectivity status
        """
        connectivity_results = {}

        # Use thread pool for parallel connectivity checks
        max_workers = min(len(connectivity_tasks), 10)  # Limit concurrent connections

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all connectivity check tasks
            future_to_agent = {
                executor.submit(
                    self._check_agent_connectivity,
                    agent_name,
                    agent_url,
                ): agent_name
                for agent_name, agent_url in connectivity_tasks
            }

            # Collect results as they complete
            for future in as_completed(future_to_agent):
                agent_name = future_to_agent[future]
                try:
                    is_reachable = future.result()
                    connectivity_results[agent_name] = is_reachable
                except Exception as e:
                    logger.error(f"Connectivity check for {agent_name} raised exception: {e}")
                    connectivity_results[agent_name] = False

        return connectivity_results

    def _load_agents(self) -> None:
        """Load the appropriate agent implementations based on transport mode with connectivity checks."""
        logger.info("Loading agents with connectivity verification...")

        # Step 1: Load all agent modules first
        loaded_modules = {}
        logger.debug(f"Configured agents: {self.AGENT_NAMES}")
        for agent_name in self.AGENT_NAMES:
            if agent_name not in self.AGENT_IMPORT_MAP:
                logger.warning(f"Unknown agent: {agent_name}")
                continue

            try:
                transport_key = "slim" if self.transport == "slim" else "a2a"
                module_path = self.AGENT_IMPORT_MAP[agent_name][transport_key]

                # Load the module if it's not the generic client
                if module_path != GENERIC_CLIENT:
                    logger.debug(f"🔧 Loading {agent_name} module: {module_path}")
                    module = importlib.import_module(module_path)
                    loaded_modules[agent_name] = module
                    logger.debug(f"✅ Successfully loaded module for {agent_name}")
                else:
                    logger.debug(f"🔧 Loading {agent_name} with generic client")
                    loaded_modules[agent_name] = GENERIC_CLIENT

            except ModuleNotFoundError as e:
                logger.warning(f"⚠️ Agent {agent_name} does not have {transport_key.upper()} client implementation: {e}")
                continue
            except Exception as e:
                logger.error(f"❌ Failed to load module for {agent_name}: {e}")
                continue

        # Step 2: Apply startup delay if configured (helps with Docker Compose race conditions)
        if self._startup_delay > 0:
            logger.info(f"Waiting {self._startup_delay}s for services to start up before connectivity checks...")
            time.sleep(self._startup_delay)

        # Step 3: Check connectivity and build registry using extracted methods
        connectivity_results = self._check_connectivity_for_modules(loaded_modules)
        agents = self._build_registry_from_modules(loaded_modules, connectivity_results)

        # Compute stats for logging
        reachable_count = len(agents)
        unreachable_agents = [name for name, is_reachable in connectivity_results.items() if not is_reachable]

        # Log results
        for agent_name in agents.keys():
            logger.info(f"✅ Added {agent_name} to registry (reachable)")
        for agent_name in unreachable_agents:
            logger.warning(f"❌ Excluded {agent_name} from registry (unreachable)")

        # Log summary
        logger.info(f"Agent loading complete: {reachable_count}/{len(loaded_modules)} agents reachable")
        if unreachable_agents:
            logger.warning(f"Unreachable agents excluded: {', '.join(unreachable_agents)}")
            logger.info("To skip connectivity checks, set SKIP_AGENT_CONNECTIVITY_CHECK=true")

        self._agents = agents
        self._loaded_modules = loaded_modules  # Cache modules for efficient refresh

    def _check_connectivity_for_modules(self, loaded_modules: Dict[str, Any]) -> Dict[str, bool]:
        """Check connectivity for a set of loaded modules."""
        connectivity_tasks = []
        if self.transport != "slim" and self._check_connectivity:
            for agent_name, module in loaded_modules.items():
                agent_url = self._get_agent_url_from_module(agent_name, module)
                connectivity_tasks.append((agent_name, agent_url))

        if connectivity_tasks:
            logger.info(f"Running connectivity checks for {len(connectivity_tasks)} agents (max {self._max_retries + 1} attempts per agent)...")
            return self._run_connectivity_checks(connectivity_tasks)
        else:
            # If no connectivity checks, assume all loaded modules are reachable
            logger.debug(f"Skipping connectivity checks for {len(loaded_modules)} agents (SLIM transport or disabled)")
            return {name: True for name in loaded_modules.keys()}

    def _build_registry_from_modules(self, loaded_modules: Dict[str, Any], connectivity_results: Dict[str, bool]) -> Dict[str, Any]:
        """Build agents and tools registry from loaded modules and connectivity results."""
        agents = {}

        for agent_name, module in loaded_modules.items():
            reachable = connectivity_results.get(agent_name, True)
            if not reachable:
                logger.warning(f"Agent {agent_name} is unreachable, skipping registration...")
                continue

            try:
                logger.debug(f"Registering agent {agent_name}...")
                # Use a bounded timeout for the connect call to avoid startup hangs
                connect_timeout_env = os.getenv("AGENT_CONNECT_TIMEOUT")
                connect_timeout = float(connect_timeout_env) if connect_timeout_env else self._connectivity_timeout

                if isinstance(module, str) and module == GENERIC_CLIENT:
                    agent_client = self._create_generic_a2a_client(agent_name, self.transport)
                    try:
                        # Attempt to connect but do not block startup indefinitely
                        run_coroutine_sync(agent_client.connect(), timeout=connect_timeout)
                        logger.debug(f"Connected {agent_name} within {connect_timeout}s")
                    except (asyncio.TimeoutError, FuturesTimeoutError, TimeoutError) as te:
                        logger.warning(f"Connect timeout for {agent_name} after {connect_timeout}s; proceeding with lazy connection: {te}")
                    except Exception as e:
                        logger.error(f"Failed to register agent {agent_name}: {e}, skipping...")
                        continue
                    # Add the agent to the registry regardless; it can lazy-connect on first use
                    agents[agent_name] = agent_client
                else:
                    try:
                        # Attempt to connect module client with bounded timeout
                        run_coroutine_sync(module.a2a_remote_agent.connect(), timeout=connect_timeout)
                        logger.debug(f"Connected {agent_name} within {connect_timeout}s")
                    except (asyncio.TimeoutError, FuturesTimeoutError, TimeoutError) as te:
                        logger.warning(f"Connect timeout for {agent_name} after {connect_timeout}s; proceeding with lazy connection: {te}")
                    except Exception as e:
                        logger.error(f"Failed to register agent {agent_name}: {e}, skipping...")
                        continue
                    # Add the agent to the registry regardless; it can lazy-connect on first use
                    agents[agent_name] = module.a2a_remote_agent
            except Exception as e:
                logger.error(f"Unexpected error while registering {agent_name}: {e}, skipping...")
                continue

        return agents

    def _refresh_connectivity_only(self) -> bool:
        """Efficiently refresh agent connectivity without reloading modules."""
        if not self._loaded_modules:
            logger.debug("No cached modules available, falling back to full reload")
            self._load_agents()
            return True

        logger.debug(f"Refreshing connectivity for {len(self._loaded_modules)} cached modules...")

        # Store current state
        old_agent_versions = ""
        for agent_name, agent in self._agents.items():
            old_agent_versions += f"{agent_name}={agent.version}\n"

        # Check connectivity and rebuild registry
        connectivity_results = self._check_connectivity_for_modules(self._loaded_modules)
        agents = self._build_registry_from_modules(self._loaded_modules, connectivity_results)

        # Update registry
        self._agents = agents

        # Check for changes
        new_agent_versions = ""
        for agent_name, agent in self._agents.items():
            new_agent_versions += f"{agent_name}={agent.version}\n"

        has_changes = old_agent_versions != new_agent_versions
        logger.debug(f"Old agent versions: {old_agent_versions}")
        logger.debug(f"New agent versions: {new_agent_versions}")

        if has_changes:
            logger.debug("Connectivity refresh: Changes detected")
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
