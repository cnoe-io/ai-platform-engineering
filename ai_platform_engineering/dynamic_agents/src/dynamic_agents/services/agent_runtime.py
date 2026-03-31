"""Agent Runtime service for Dynamic Agents.

Creates and manages DeepAgent instances with MCP tools.
"""

import json
import logging
import os
import re
import time
from collections.abc import AsyncGenerator, Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from botocore.config import Config as BotocoreConfig
from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager
from deepagents import create_deep_agent
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.mongodb.saver import MongoDBSaver
from langgraph.types import Command
from pymongo import MongoClient

from dynamic_agents.config import Settings, get_settings
from dynamic_agents.models import AgentContext, DynamicAgentConfig, MCPServerConfig, SubAgentRef, UserContext
from dynamic_agents.services.builtin_tools import (
    create_current_datetime_tool,
    create_fetch_url_tool,
    create_request_user_input_tool,
    create_sleep_tool,
    create_user_info_tool,
)
from dynamic_agents.services.mcp_client import (
    build_mcp_connections,
    filter_tools_by_allowed,
    get_tools_with_resilience,
)
from dynamic_agents.services.sandbox import SandboxManager, get_sandbox_manager
from dynamic_agents.services.stream_events import (
    make_input_required_event,
    transform_stream_chunk,
)
from dynamic_agents.services.tool_error_handling import (
    wrap_tools_with_error_handling,
)

if TYPE_CHECKING:
    from dynamic_agents.services.mongo import MongoDBService

logger = logging.getLogger(__name__)


def _sanitize_agent_name(name: str) -> str:
    """Sanitize an agent name for use as a LangChain/OpenAI message `name` field.

    OpenAI requires message `name` fields to match the pattern ``^[^\\s<|\\\\/>]+$``
    (no whitespace, ``<``, ``|``, ``\\``, ``/``, or ``>``).  deepagents propagates
    the agent ``name`` into message ``name`` fields via its middleware, so we must
    ensure it conforms.

    We replace disallowed characters with underscores.
    """
    return re.sub(r"[\s<|\\/>]+", "_", name)


class AgentRuntime:
    """Runtime for a single dynamic agent instance."""

    def __init__(
        self,
        config: DynamicAgentConfig,
        mcp_servers: list[MCPServerConfig],
        settings: Settings | None = None,
        mongo_service: "MongoDBService | None" = None,
        user: UserContext | None = None,
        event_adapter: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ):
        self.config = config
        self.mcp_servers = mcp_servers
        self.settings = settings or get_settings()
        self._mongo_service = mongo_service
        self._user = user
        self._event_adapter = event_adapter
        self._graph = None
        self._mongo_client = MongoClient(self.settings.mongodb_uri)
        # Use MongoDBSaver from langgraph-checkpoint-mongodb for persistent chat history
        self._checkpointer = MongoDBSaver(
            self._mongo_client,
            db_name=self.settings.mongodb_database,
            checkpoint_collection_name="checkpoints_conversation",
            writes_collection_name="checkpoint_writes_conversation",
        )
        self._mcp_client: MultiServerMCPClient | None = None
        self._initialized = False
        self._created_at = time.time()
        self.tracing = TracingManager()
        self._current_trace_id: str | None = None
        self._missing_tools: list[str] = []
        self._failed_servers: list[str] = []  # Just server names
        self._failed_servers_error: str = ""  # Error message for display
        # Track config timestamps for cache invalidation
        self._config_updated_at: datetime = config.updated_at
        self._mcp_servers_updated_at: datetime = max(
            (s.updated_at for s in mcp_servers), default=datetime.min.replace(tzinfo=timezone.utc)
        )
        # Cancellation flag for graceful stream termination
        self._cancelled: bool = False
        # OpenShell sandbox state
        self._sandbox_manager: SandboxManager | None = None
        self._sandbox_backend = None
        self._sandbox_name: str | None = None

    async def initialize(self) -> None:
        """Build the DeepAgent graph with tools and instructions."""
        if self._initialized:
            return

        # 1. Build MCP connections for servers referenced in allowed_tools
        server_ids = list(self.config.allowed_tools.keys())
        if not server_ids:
            logger.info(f"Agent '{self.config.name}' has no MCP tools configured")
            tools = []
        else:
            connections = build_mcp_connections(self.mcp_servers, server_ids)

            if not connections:
                logger.warning(f"Agent '{self.config.name}': no valid MCP connections found")
                tools = []
            else:
                # 2. Get tools from MCP servers with per-server error handling
                # This connects to each server independently so one failure doesn't affect others
                all_tools, failed_servers, failed_errors = await get_tools_with_resilience(connections)

                # Store failed servers for warning events
                if failed_servers:
                    self._failed_servers = failed_servers
                    # Combine error messages for display
                    error_parts = [f"{s}: {failed_errors.get(s, 'Unknown error')}" for s in failed_servers]
                    self._failed_servers_error = "; ".join(error_parts)

                # 3. Filter tools based on allowed_tools in the agent config
                tools, missing = filter_tools_by_allowed(all_tools, self.config.allowed_tools)

                # Only report missing tools for servers that connected successfully
                # (tools from failed servers are expected to be missing)
                if missing:
                    # Filter out tools from failed servers
                    missing_from_connected = [
                        t for t in missing if not any(t.startswith(f"{s}_") for s in failed_servers)
                    ]
                    if missing_from_connected:
                        logger.warning(f"Agent '{self.config.name}': tools not found: {missing_from_connected}")
                        self._missing_tools = missing_from_connected

                connected_count = len(connections) - len(failed_servers)
                logger.info(
                    f"Agent '{self.config.name}': loaded {len(tools)} tools from {connected_count}/{len(connections)} MCP servers"
                )

        # 4 Add built-in tools based on agent config
        builtin_tools = self._build_builtin_tools(self._user)
        if builtin_tools:
            tools = tools + builtin_tools

        # 5. System prompt from agent config
        system_prompt = self.config.system_prompt

        # 6. Create the LLM
        # model_id and model_provider are required fields - no fallback to env vars
        logger.info(
            f"[llm] Instantiating LLM for agent '{self.config.name}': "
            f"provider={self.config.model_provider}, model={self.config.model_id}"
        )
        # Configure botocore with extended timeouts for Bedrock to prevent
        # ReadTimeoutError during long-running agent operations (especially subagents)
        boto_config = BotocoreConfig(read_timeout=300, connect_timeout=60)
        llm = LLMFactory(provider=self.config.model_provider).get_llm(
            model=self.config.model_id,
            config=boto_config,
        )
        logger.info(f"[llm] LLM instantiated for agent '{self.config.name}': type={type(llm).__name__}")

        # 7. Resolve subagents (other dynamic agents that this agent can delegate to)
        subagents = await self._resolve_subagents(self.config.subagents)
        if subagents:
            logger.info(
                f"Agent '{self.config.name}': resolved {len(subagents)} subagents: {[s['name'] for s in subagents]}"
            )

        # 8. Set up OpenShell sandbox backend if enabled
        sandbox_backend_factory = None
        if self.config.sandbox and self.config.sandbox.enabled:
            sandbox_backend_factory = self._setup_sandbox_backend()

        # 9. Create the agent graph
        # Sanitize agent name for use as OpenAI message `name` field.
        # deepagents middleware (subagents.py) propagates this into message
        # name fields, which OpenAI validates against ^[^\s<|\\/>]+$.
        safe_name = _sanitize_agent_name(self.config.name)

        deep_agent_kwargs: dict[str, Any] = {
            "model": llm,
            "tools": tools,
            "system_prompt": system_prompt,
            "context_schema": AgentContext,
            "checkpointer": self._checkpointer,
            "name": safe_name,
            "subagents": subagents if subagents else None,
            "interrupt_on": {"request_user_input": True},
        }

        if sandbox_backend_factory:
            deep_agent_kwargs["backend"] = sandbox_backend_factory

        self._graph = create_deep_agent(**deep_agent_kwargs)

        self._initialized = True
        sandbox_info = f", sandbox={self._sandbox_name}" if self._sandbox_name else ""
        logger.info(
            f"[agent] Agent '{self.config.name}' initialized: "
            f"tools={len(tools)}, subagents={len(subagents) if subagents else 0}{sandbox_info}"
        )

    def _build_builtin_tools(
        self,
        user: UserContext | None = None,
        agent_config: DynamicAgentConfig | None = None,
    ) -> list:
        """Build list of built-in tools based on agent config.

        Args:
            user: User context for tools that need user info
            agent_config: Agent config to use. Defaults to self.config (parent agent).
                          Pass subagent config to build tools for a subagent.

        Returns:
            List of LangChain tools to add to the agent.
        """
        config = agent_config or self.config
        tools = []
        config_summary: dict[str, Any] = {}

        if not config.builtin_tools:
            return tools

        sandbox_on = config.sandbox and config.sandbox.enabled

        # fetch_url tool (disabled by default).
        # Runs in the host Python process, NOT inside the sandbox.
        # When sandbox is enabled, warn the operator.
        fetch_url_config = config.builtin_tools.fetch_url
        if fetch_url_config and fetch_url_config.enabled:
            allowed_domains = fetch_url_config.allowed_domains or "*"
            tools.append(create_fetch_url_tool(allowed_domains=allowed_domains))
            config_summary["fetch_url"] = {"allowed_domains": allowed_domains}
            if sandbox_on:
                logger.warning(
                    "[sandbox] Agent '%s': fetch_url runs outside the sandbox "
                    "and is NOT subject to sandbox network policies. "
                    "Restrict via allowed_domains or disable when strict isolation is needed.",
                    config.name,
                )

        # current_datetime tool (enabled by default)
        current_datetime_config = config.builtin_tools.current_datetime
        if current_datetime_config and current_datetime_config.enabled:
            tools.append(create_current_datetime_tool())
            config_summary["current_datetime"] = {}

        # user_info tool (enabled by default)
        user_info_config = config.builtin_tools.user_info
        if user_info_config and user_info_config.enabled:
            if user:
                tools.append(create_user_info_tool(user))
                config_summary["user_info"] = {"user": user.email}
            else:
                logger.warning(f"Agent '{config.name}': user_info enabled but no user context available")

        # sleep tool (enabled by default)
        sleep_config = config.builtin_tools.sleep
        if sleep_config and sleep_config.enabled:
            max_seconds = sleep_config.max_seconds or 300
            tools.append(create_sleep_tool(max_seconds=max_seconds))
            config_summary["sleep"] = {"max_seconds": max_seconds}

        # request_user_input tool (enabled by default)
        request_user_input_config = config.builtin_tools.request_user_input
        if request_user_input_config and request_user_input_config.enabled:
            tools.append(create_request_user_input_tool())
            config_summary["request_user_input"] = {}

        if tools:
            logger.info(f"Agent '{config.name}': added built-in tools: {config_summary}")

        return tools

    def _setup_sandbox_backend(self) -> Any:
        """Set up the OpenShell sandbox backend for this agent.

        Creates or connects to a persistent sandbox and builds a
        CompositeBackend with the OpenShellBackend as the default.

        Returns:
            Backend factory callable for create_deep_agent().
        """
        from deepagents.backends import CompositeBackend

        from dynamic_agents.services.openshell_backend import OpenShellBackend

        sandbox_config = self.config.sandbox
        self._sandbox_manager = get_sandbox_manager(self.settings)

        sandbox_name = sandbox_config.sandbox_name or f"da-{self.config.id}"
        self._sandbox_name = sandbox_name

        session = self._sandbox_manager.get_or_create_sandbox(sandbox_name)
        timeout = self.settings.openshell_default_timeout

        self._sandbox_backend = OpenShellBackend(session, default_timeout=timeout)

        policy_result = self._sandbox_manager.initialize_policy(
            sandbox_name,
            template=sandbox_config.policy_template.value,
            custom_yaml=sandbox_config.policy_yaml,
        )

        policy_status = policy_result.get("status", "unknown")
        if policy_status not in ("loaded",):
            policy_err = policy_result.get("error", "unknown error")
            logger.error(
                "[sandbox] Policy failed to load for agent '%s' sandbox '%s': %s",
                self.config.name,
                sandbox_name,
                policy_err,
            )
        else:
            logger.info(
                "[sandbox] Sandbox '%s' ready for agent '%s' "
                "(policy=%s)",
                sandbox_name,
                self.config.name,
                sandbox_config.policy_template.value,
            )

        # Inject credentials and SSL config into the sandbox so git/curl work
        self._configure_sandbox_env(self._sandbox_backend)

        backend = self._sandbox_backend

        def _backend_factory(runtime: Any) -> CompositeBackend:
            return CompositeBackend(default=backend, routes={})

        return _backend_factory

    def _configure_sandbox_env(self, backend: Any) -> None:
        """Inject host credentials, CA certs, and env config into the sandbox.

        Runs once per sandbox init to set up:
        1. OpenShell proxy CA certificate so git/curl trust TLS-intercepted connections
        2. Git credential helper with the GitHub PAT for authenticated operations
        3. GIT_TERMINAL_PROMPT=0 to prevent git from hanging on auth prompts
        """
        self._inject_ca_cert(backend)
        self._inject_git_credentials(backend)

    def _inject_ca_cert(self, backend: Any) -> None:
        """Install the OpenShell gateway CA cert into the sandbox trust store.

        The OpenShell proxy performs TLS interception on network traffic.
        Without its CA cert in the trust store, git/curl/pip fail with
        'server certificate verification failed'.
        """
        from pathlib import Path

        gw_name = self.settings.openshell_gateway_name or "openshell"
        ca_path = Path.home() / ".config" / "openshell" / "gateways" / gw_name / "mtls" / "ca.crt"

        if not ca_path.exists():
            logger.debug("[sandbox] No gateway CA cert found at %s, skipping", ca_path)
            return

        ca_pem = ca_path.read_text()
        sandbox_ca_path = "/usr/local/share/ca-certificates/openshell-proxy.crt"
        sandbox_bundle = "/etc/ssl/certs/ca-certificates.crt"

        install_script = f"""
mkdir -p /usr/local/share/ca-certificates 2>/dev/null
cat > {sandbox_ca_path} << 'CERT'
{ca_pem.strip()}
CERT
if command -v update-ca-certificates >/dev/null 2>&1; then
  update-ca-certificates 2>/dev/null
elif [ -f {sandbox_bundle} ]; then
  cat {sandbox_ca_path} >> {sandbox_bundle}
fi
git config --global http.sslCAInfo {sandbox_bundle}
"""
        try:
            result = backend.execute(install_script, timeout=30)
            if result.exit_code != 0:
                logger.warning("[sandbox] CA cert install returned non-zero: %s", result.output)
            else:
                logger.info("[sandbox] OpenShell CA cert installed for agent '%s'", self.config.name)
        except Exception as exc:
            logger.warning("[sandbox] Failed to install CA cert: %s", exc)

    def _inject_git_credentials(self, backend: Any) -> None:
        """Configure git credentials and environment inside the sandbox.

        Uses a git credential helper script that returns the PAT,
        avoiding url.insteadOf which can cause password prompt issues.
        """
        github_pat = os.environ.get("GITHUB_PERSONAL_ACCESS_TOKEN", "")
        if not github_pat:
            logger.debug("[sandbox] No GITHUB_PERSONAL_ACCESS_TOKEN set, skipping git credential setup")
            return

        credential_script = f"""
mkdir -p /sandbox/.git-credentials 2>/dev/null
cat > /sandbox/.git-credentials/helper.sh << 'HELPER'
#!/bin/bash
echo "protocol=https"
echo "host=github.com"
echo "username=x-access-token"
echo "password={github_pat}"
HELPER
chmod +x /sandbox/.git-credentials/helper.sh
git config --global credential.helper '/sandbox/.git-credentials/helper.sh'
git config --global credential.https://github.com.helper '/sandbox/.git-credentials/helper.sh'
export GIT_TERMINAL_PROMPT=0
echo 'export GIT_TERMINAL_PROMPT=0' >> ~/.bashrc 2>/dev/null
echo 'export GIT_TERMINAL_PROMPT=0' >> ~/.profile 2>/dev/null
"""
        try:
            result = backend.execute(credential_script, timeout=15)
            if result.exit_code != 0:
                logger.warning("[sandbox] Git credential setup returned non-zero: %s", result.output)
            else:
                logger.info("[sandbox] Git credentials configured for agent '%s'", self.config.name)
        except Exception as exc:
            logger.warning("[sandbox] Failed to configure git credentials: %s", exc)

    async def _resolve_subagents(
        self,
        refs: list[SubAgentRef],
        visited: set[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Resolve SubAgentRef list into deepagents SubAgent dicts.

        Loads each referenced dynamic agent from MongoDB and converts it to
        the SubAgent dict format expected by create_deep_agent().

        Args:
            refs: List of subagent references from parent agent config
            visited: Set of agent IDs already in the call chain (for cycle detection)

        Returns:
            List of SubAgent dicts with name, description, prompt, tools
        """
        if not refs:
            return []

        if not self._mongo_service:
            logger.warning(f"Agent '{self.config.name}': Cannot resolve subagents - no MongoDB service available")
            return []

        # Initialize visited set for cycle detection
        if visited is None:
            visited = set()
        visited.add(self.config.id)

        subagents: list[dict[str, Any]] = []

        for ref in refs:
            # Cycle detection: skip if this agent is already in the call chain
            if ref.agent_id in visited:
                logger.warning(
                    f"Agent '{self.config.name}': Skipping subagent '{ref.name}' (agent_id={ref.agent_id}) "
                    f"- circular reference detected"
                )
                continue

            # Load subagent config from MongoDB
            subagent_config = self._mongo_service.get_agent(ref.agent_id)
            if not subagent_config:
                logger.warning(f"Agent '{self.config.name}': Subagent '{ref.name}' not found (agent_id={ref.agent_id})")
                continue

            if not subagent_config.enabled:
                logger.warning(f"Agent '{self.config.name}': Subagent '{ref.name}' is disabled, skipping")
                continue

            # Build MCP tools for subagent
            subagent_tools = await self._build_subagent_tools(subagent_config)

            # System prompt from subagent config
            subagent_prompt = subagent_config.system_prompt

            # Create SubAgent dict in deepagents format
            # Use agent_id as the name - this ensures namespace[0] from LangGraph
            # matches the MongoDB agent_id exactly
            subagent_dict: dict[str, Any] = {
                "name": ref.agent_id,
                "description": ref.description,
                "system_prompt": subagent_prompt,
                "tools": subagent_tools,
            }

            # Note: Nested subagents (subagent of subagent) are not supported in this MVP.
            # If needed in the future, we could recursively resolve subagent_config.subagents
            # by passing the updated visited set.

            subagents.append(subagent_dict)
            logger.info(f"Agent '{self.config.name}': Resolved subagent '{ref.name}' with {len(subagent_tools)} tools")

        return subagents

    async def _build_subagent_tools(self, subagent_config: DynamicAgentConfig) -> list:
        """Build tools for a subagent (MCP tools + built-in tools).

        Args:
            subagent_config: The subagent's configuration

        Returns:
            List of LangChain tools (MCP + built-in based on subagent config)
        """
        tools: list = []

        # 1. Build MCP tools from subagent's allowed_tools config
        server_ids = list(subagent_config.allowed_tools.keys())
        if server_ids:
            connections = build_mcp_connections(self.mcp_servers, server_ids)
            if connections:
                mcp_client = MultiServerMCPClient(connections, tool_name_prefix=True)
                all_tools = await mcp_client.get_tools()
                mcp_tools, _ = filter_tools_by_allowed(all_tools, subagent_config.allowed_tools)
                mcp_tools = wrap_tools_with_error_handling(
                    mcp_tools, agent_name=subagent_config.name,
                )
                tools.extend(mcp_tools)

        # 2. Add built-in tools based on subagent's config
        builtin_tools = self._build_builtin_tools(self._user, subagent_config)
        if builtin_tools:
            tools.extend(builtin_tools)

        return tools

    def _build_stream_config(self, session_id: str, user_id: str, trace_id: str | None) -> dict[str, Any]:
        """Build config dict for stream/resume operations.

        Creates the LangGraph config with:
        - thread_id for conversation persistence (checkpointer)
        - AgentContext for tools that need user/session info
        - metadata for Langfuse tracing

        Args:
            session_id: Conversation/session ID
            user_id: User's email/identifier
            trace_id: Optional trace ID for distributed tracing

        Returns:
            Config dict for astream()
        """
        config = self.tracing.create_config(session_id)

        if "configurable" not in config:
            config["configurable"] = {}
        config["configurable"]["thread_id"] = session_id

        config["context"] = AgentContext(
            user_id=user_id,
            agent_config_id=self.config.id,
            session_id=session_id,
        )

        if "metadata" not in config:
            config["metadata"] = {}
        config["metadata"]["user_id"] = user_id
        config["metadata"]["agent_config_id"] = self.config.id
        config["metadata"]["agent_name"] = self.config.name

        if trace_id:
            config["metadata"]["trace_id"] = trace_id
        else:
            # Fallback to TracingManager context
            current_trace_id = self.tracing.get_trace_id()
            if current_trace_id:
                config["metadata"]["trace_id"] = current_trace_id

        self._current_trace_id = config.get("metadata", {}).get("trace_id")

        return config

    async def stream(
        self,
        message: str,
        session_id: str,
        user_id: str,
        trace_id: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Stream agent response for a user message.

        Emits structured SSE events for the UI:
        - content: Streaming text tokens
        - tool_start: Tool call started (with args). For task tool, includes agent_id.
        - tool_end: Tool call completed
        - input_required: Agent requests user input (HITL form)

        The stream ends with a 'done' SSE event (handled by the HTTP layer).

        Args:
            message: User's input message
            session_id: Conversation/session ID for checkpointing
            user_id: User's email/identifier
            trace_id: Optional trace ID for Langfuse tracing

        Yields:
            SSE-compatible event dicts
        """
        if not self._initialized:
            await self.initialize()

        # Reset cancellation flag at start of each stream
        self._cancelled = False

        config = self._build_stream_config(session_id, user_id, trace_id)

        accumulated_content: list[str] = []
        # Namespace mapping: LangGraph task UUID → tool_call_id for subagent correlation
        # See stream_events.py for details on why this mapping is needed.
        namespace_mapping: dict[str, str] = {}

        logger.info(f"[stream] Starting stream for agent '{self.config.name}': user={user_id}, conv={session_id}")

        # Stream with subgraphs=True and both messages and updates modes
        async for chunk in self._graph.astream(
            {"messages": [{"role": "user", "content": message}]},
            config=config,
            stream_mode=["messages", "updates", "tasks"],
            subgraphs=True,
        ):
            # Check for cancellation between chunks
            if self._cancelled:
                logger.info(
                    f"[stream] Stream cancelled by user for agent '{self.config.name}': "
                    f"conv={session_id}, user={user_id}"
                )
                return

            for event in transform_stream_chunk(chunk, accumulated_content, namespace_mapping):
                if self._event_adapter:
                    event = self._event_adapter(event)
                yield event

        # Check for pending interrupt (agent called request_user_input)
        logger.debug("[stream] Stream loop completed, checking for pending interrupt...")
        interrupt_data = await self.has_pending_interrupt(session_id)
        logger.debug(f"[stream] has_pending_interrupt result: {interrupt_data}")
        if interrupt_data:
            logger.debug(f"[stream] Agent '{self.config.name}' has pending interrupt, emitting input_required event")
            yield make_input_required_event(
                interrupt_id=interrupt_data["interrupt_id"],
                prompt=interrupt_data["prompt"],
                fields=interrupt_data["fields"],
                agent=self.config.name,
            )
            return  # Don't continue, stream paused for user input

        # Stream complete - the frontend relies on the SSE 'done' event to know
        # streaming has finished. Content was already sent via 'content' events.
        final_text = "".join(accumulated_content)
        logger.info(
            f"[stream] Completed stream for agent '{self.config.name}': "
            f"conv={session_id}, content_length={len(final_text)}"
        )

    async def has_pending_interrupt(self, session_id: str) -> dict[str, Any] | None:
        """Check if there's a pending interrupt for the given session.

        Uses the HumanInTheLoopMiddleware pattern from deepagents. When interrupt_on
        is configured for a tool, the middleware intercepts the tool call and creates
        an interrupt with action_requests containing the tool call info.

        Args:
            session_id: Conversation/session ID

        Returns:
            Interrupt data dict if there's a pending request_user_input interrupt, None otherwise.
            The dict contains: interrupt_id, prompt, fields, tool_call_id
        """
        if not self._graph:
            logger.warning("[has_pending_interrupt] No graph available")
            return None

        config = {"configurable": {"thread_id": session_id}}

        try:
            state = await self._graph.aget_state(config)
            logger.debug(
                f"[has_pending_interrupt] Got state: has_interrupts={hasattr(state, 'interrupts')}, "
                f"interrupts_count={len(state.interrupts) if hasattr(state, 'interrupts') and state.interrupts else 0}"
            )

            # HumanInTheLoopMiddleware stores interrupts in state.interrupts (not state.tasks)
            if not state or not hasattr(state, "interrupts") or not state.interrupts:
                logger.debug("[has_pending_interrupt] No interrupts in state")
                return None

            # Check each interrupt for request_user_input tool call
            for i, interrupt in enumerate(state.interrupts):
                interrupt_value = getattr(interrupt, "value", None)
                logger.debug(f"[has_pending_interrupt] Interrupt {i}: value_type={type(interrupt_value)}")

                if not isinstance(interrupt_value, dict):
                    continue

                # HumanInTheLoopMiddleware format: {"action_requests": [...], "review_configs": [...]}
                action_requests = interrupt_value.get("action_requests", [])
                for action in action_requests:
                    if action.get("name") == "request_user_input":
                        # Extract form metadata from tool arguments
                        args = action.get("args", {})
                        tool_call_id = action.get("id", str(id(interrupt)))
                        logger.info(
                            f"[has_pending_interrupt] Found request_user_input interrupt: tool_call_id={tool_call_id}"
                        )
                        return {
                            "interrupt_id": tool_call_id,
                            "prompt": args.get("prompt", ""),
                            "fields": args.get("fields", []),
                            "tool_call_id": tool_call_id,
                        }

            logger.debug("[has_pending_interrupt] No request_user_input interrupt found")
            return None
        except Exception as e:
            logger.warning(f"Error checking for pending interrupt: {e}")
            return None

    async def resume(
        self,
        session_id: str,
        user_id: str,
        form_data: str,
        trace_id: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Resume agent execution after user provides form input.

        Uses the HumanInTheLoopMiddleware pattern from deepagents. The form_data
        is converted to a decision format that the middleware expects.

        Args:
            session_id: Conversation/session ID
            user_id: User's email/identifier
            form_data: JSON string of form values (e.g. {"field_name": "value"}),
                      or rejection message if user dismissed the form
            trace_id: Optional trace ID for Langfuse tracing

        Yields:
            SSE-compatible event dicts
        """
        if not self._initialized:
            await self.initialize()

        # Reset cancellation flag at start of resume
        self._cancelled = False

        config = self._build_stream_config(session_id, user_id, trace_id)

        accumulated_content: list[str] = []
        # Namespace mapping: LangGraph task UUID → tool_call_id for subagent correlation
        namespace_mapping: dict[str, str] = {}

        logger.info(f"[resume] Resuming stream for agent '{self.config.name}': user={user_id}, conv={session_id}")

        # Check if this is a rejection (dismiss) or submission
        # Rejection message format: "User dismissed the input form without providing values."
        is_rejection = form_data.startswith("User dismissed")

        if is_rejection:
            # User rejected/dismissed the form
            resume_payload = {"decisions": [{"type": "reject", "message": form_data}]}
        else:
            # User submitted the form - parse values and build edited args
            try:
                user_values = json.loads(form_data)
            except json.JSONDecodeError:
                logger.warning(f"[resume] Invalid form_data JSON: {form_data[:100]}")
                user_values = {}

            # Get the pending interrupt to find original tool args
            interrupt_data = await self.has_pending_interrupt(session_id)
            if interrupt_data:
                # Build edited args with user values merged into fields
                original_fields = interrupt_data.get("fields", [])
                edited_fields = []
                for field in original_fields:
                    field_copy = dict(field)
                    field_name = field.get("field_name", "")
                    if field_name in user_values:
                        field_copy["value"] = user_values[field_name]
                    edited_fields.append(field_copy)

                edited_args = {
                    "prompt": interrupt_data.get("prompt", ""),
                    "fields": edited_fields,
                }

                resume_payload = {
                    "decisions": [
                        {
                            "type": "edit",
                            "edited_action": {
                                "name": "request_user_input",
                                "args": edited_args,
                            },
                        }
                    ]
                }
            else:
                # No interrupt found, just approve (shouldn't happen normally)
                logger.warning("[resume] No pending interrupt found, using simple approve")
                resume_payload = {"decisions": [{"type": "approve"}]}

        logger.debug(f"[resume] Resume payload: {resume_payload}")

        # Resume with Command containing the decisions
        async for chunk in self._graph.astream(
            Command(resume=resume_payload),
            config=config,
            stream_mode=["messages", "updates", "tasks"],
            subgraphs=True,
        ):
            # Check for cancellation between chunks
            if self._cancelled:
                logger.info(
                    f"[resume] Resume stream cancelled by user for agent '{self.config.name}': conv={session_id}"
                )
                return

            for event in transform_stream_chunk(chunk, accumulated_content, namespace_mapping):
                if self._event_adapter:
                    event = self._event_adapter(event)
                yield event

        # Check for another pending interrupt (agent might request more input)
        interrupt_data = await self.has_pending_interrupt(session_id)
        if interrupt_data:
            logger.debug(f"[resume] Agent '{self.config.name}' has pending interrupt after resume")
            yield make_input_required_event(
                interrupt_id=interrupt_data["interrupt_id"],
                prompt=interrupt_data["prompt"],
                fields=interrupt_data["fields"],
                agent=self.config.name,
            )
            return  # Don't continue, stream paused

        # Stream complete - the frontend relies on the SSE 'done' event to know
        # streaming has finished. Content was already sent via 'content' events.
        final_text = "".join(accumulated_content)
        logger.info(
            f"[resume] Completed resume for agent '{self.config.name}': "
            f"conv={session_id}, content_length={len(final_text)}"
        )

    async def cleanup(self) -> None:
        """Cleanup MCP client connections and MongoDB checkpointer."""
        if self._mcp_client:
            # Note: As of langchain-mcp-adapters 0.1.0, MultiServerMCPClient
            # doesn't require explicit cleanup when not used as context manager
            self._mcp_client = None

        if self._checkpointer:
            self._checkpointer.close()
            logger.info("Closed MongoDB checkpointer for agent runtime")

        self._initialized = False

    def cancel(self) -> bool:
        """Request cancellation of the active stream.

        This sets a flag that will be checked between LangGraph chunks,
        causing the stream to exit gracefully at the next opportunity.

        Returns:
            True if cancellation was requested, False if already cancelled.
        """
        if not self._cancelled:
            self._cancelled = True
            logger.info(f"[cancel] Cancellation requested for agent '{self.config.name}'")
            return True
        return False

    @property
    def age_seconds(self) -> float:
        """Get the age of this runtime in seconds."""
        return time.time() - self._created_at

    def is_stale(
        self,
        agent_config: DynamicAgentConfig,
        mcp_servers: list[MCPServerConfig],
    ) -> bool:
        """Check if cached runtime is stale due to config changes.

        Returns True if either the agent config or any MCP server has been
        updated since this runtime was created.
        """
        if agent_config.updated_at != self._config_updated_at:
            return True
        current_mcp_max = max((s.updated_at for s in mcp_servers), default=datetime.min.replace(tzinfo=timezone.utc))
        if current_mcp_max != self._mcp_servers_updated_at:
            return True
        return False


class AgentRuntimeCache:
    """Cache for AgentRuntime instances with TTL-based cleanup."""

    def __init__(self, ttl_seconds: int = 3600, mongo_service: "MongoDBService | None" = None):
        self._cache: dict[str, AgentRuntime] = {}
        self._ttl = ttl_seconds
        self._mongo_service = mongo_service

    def set_mongo_service(self, mongo_service: "MongoDBService") -> None:
        """Set the MongoDB service for subagent resolution.

        This is called after the cache is created, since the MongoDB service
        may not be available at cache creation time.
        """
        self._mongo_service = mongo_service

    def _make_key(self, agent_id: str, session_id: str) -> str:
        """Create cache key from agent and session IDs."""
        return f"{agent_id}:{session_id}"

    async def get_or_create(
        self,
        agent_config: DynamicAgentConfig,
        mcp_servers: list[MCPServerConfig],
        session_id: str,
        user: UserContext | None = None,
    ) -> AgentRuntime:
        """Get an existing runtime or create a new one.

        Args:
            agent_config: Dynamic agent configuration
            mcp_servers: Available MCP server configurations
            session_id: Conversation/session ID
            user: User context for builtin tools

        Returns:
            Initialized AgentRuntime instance
        """
        key = self._make_key(agent_config.id, session_id)

        # Check if we have a cached runtime
        if key in self._cache:
            runtime = self._cache[key]
            # Invalidate if config has changed or TTL expired
            if runtime.is_stale(agent_config, mcp_servers):
                logger.info(
                    "Runtime cache invalidated due to config change for agent %s",
                    agent_config.id,
                )
                await runtime.cleanup()
                del self._cache[key]
            elif runtime.age_seconds >= self._ttl:
                # TTL expired, cleanup and recreate
                await runtime.cleanup()
                del self._cache[key]
            else:
                return runtime

        # Create new runtime with MongoDB service for subagent resolution
        runtime = AgentRuntime(
            agent_config,
            mcp_servers,
            mongo_service=self._mongo_service,
            user=user,
        )
        await runtime.initialize()
        self._cache[key] = runtime

        # Cleanup old entries
        await self._cleanup_expired()

        return runtime

    async def _cleanup_expired(self) -> None:
        """Remove expired runtimes from cache."""
        expired_keys = [key for key, runtime in self._cache.items() if runtime.age_seconds >= self._ttl]
        for key in expired_keys:
            runtime = self._cache.pop(key, None)
            if runtime:
                await runtime.cleanup()

    async def clear(self) -> None:
        """Clear all cached runtimes."""
        for runtime in self._cache.values():
            await runtime.cleanup()
        self._cache.clear()

    async def invalidate(self, agent_id: str, session_id: str) -> bool:
        """Invalidate a specific runtime from the cache.

        Args:
            agent_id: Agent configuration ID
            session_id: Conversation/session ID

        Returns:
            True if a runtime was invalidated, False if not found
        """
        key = self._make_key(agent_id, session_id)
        runtime = self._cache.pop(key, None)
        if runtime:
            await runtime.cleanup()
            logger.info(f"Runtime cache invalidated for agent={agent_id}, conv={session_id}")
            return True
        return False

    def cancel_stream(self, agent_id: str, session_id: str) -> bool:
        """Cancel an active stream for a specific agent/session.

        This sets the cancellation flag on the runtime, which will cause
        the stream to exit gracefully at the next chunk boundary.

        Args:
            agent_id: Agent configuration ID
            session_id: Conversation/session ID

        Returns:
            True if cancellation was requested, False if no runtime or already cancelled
        """
        key = self._make_key(agent_id, session_id)
        runtime = self._cache.get(key)
        if runtime:
            cancelled = runtime.cancel()
            logger.info(
                f"[cancel_stream] Cancel requested for agent={agent_id}, session={session_id}: cancelled={cancelled}"
            )
            return cancelled
        logger.warning(f"[cancel_stream] No runtime found for agent={agent_id}, session={session_id}")
        return False


# Singleton cache instance
_runtime_cache: AgentRuntimeCache | None = None


def get_runtime_cache() -> AgentRuntimeCache:
    """Get the singleton runtime cache."""
    global _runtime_cache
    if _runtime_cache is None:
        settings = get_settings()
        _runtime_cache = AgentRuntimeCache(ttl_seconds=settings.agent_runtime_ttl_seconds)
    return _runtime_cache
