"""Agent Runtime service for Dynamic Agents.

Creates and manages DeepAgent instances with MCP tools.
"""

import json
import logging
import re
import time
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from botocore.config import Config as BotocoreConfig
from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager
from deepagents import create_deep_agent
from jinja2 import ChainableUndefined, TemplateSyntaxError
from jinja2.sandbox import SandboxedEnvironment, SecurityError
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.mongodb.saver import MongoDBSaver
from langgraph.types import Command
from pymongo import MongoClient

from dynamic_agents.config import Settings, get_settings
from dynamic_agents.models import (
    AgentContext,
    ClientContext,
    DynamicAgentConfig,
    MCPServerConfig,
    SubAgentRef,
    UserContext,
)
from dynamic_agents.services.builtin_tools import (
    create_current_datetime_tool,
    create_fetch_url_tool,
    create_request_user_input_tool,
    create_self_identity_tool,
    create_user_info_tool,
    create_wait_tool,
)
from dynamic_agents.services.encoders import StreamEncoder
from dynamic_agents.services.mcp_client import (
    build_mcp_connections,
    filter_tools_by_allowed,
    get_tools_with_resilience,
    wrap_tools_with_error_handling,
)
from dynamic_agents.services.middleware import build_middleware

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


# Module-level restricted Jinja2 sandbox for system prompt rendering.
# - ChainableUndefined: missing/nested keys return "" instead of raising.
# - Built-in globals stripped: agent prompts only need conditionals and
#   variable interpolation, not lipsum(), cycler(), namespace(), etc.
_jinja_env = SandboxedEnvironment(undefined=ChainableUndefined)
_jinja_env.globals = {}


class SystemPromptRenderError(Exception):
    """Raised when a system prompt Jinja2 template fails to render.

    Wraps TemplateSyntaxError, SecurityError, and other Jinja2 failures
    with a user-facing message so the caller can surface it cleanly.
    """


def _render_system_prompt(
    template_str: str,
    client_context: ClientContext | None,
    user: UserContext | None = None,
) -> str:
    """Render a system prompt template with client and user context via Jinja2.

    Uses a restricted ``SandboxedEnvironment`` to prevent code execution
    in templates.  All built-in globals (``lipsum``, ``range``, ``cycler``,
    etc.) are stripped — only variable interpolation and control flow
    (``if``/``for``) are available.

    ``ChainableUndefined`` ensures missing keys evaluate to falsy empty
    strings instead of raising errors — agent creators can safely write
    ``{%% if client_context.overthink %%}`` or ``{%% if user.is_admin %%}``
    without worrying about KeyError.

    Template variables:
        - ``client_context``: dict with ``source`` and any extra client fields
        - ``user``: dict with ``email`` and any extra auth fields (``name``,
          ``is_admin``, ``groups``, etc.)

    Args:
        template_str: The system prompt, possibly containing Jinja2 syntax.
        client_context: ClientContext from ChatRequest, or None.
        user: UserContext for the current user, or None.

    Returns:
        Rendered system prompt string.

    Raises:
        SystemPromptRenderError: If the template has syntax errors,
            attempts unsafe attribute access, or otherwise fails to render.
    """
    ctx = client_context.model_dump() if client_context else {}
    user_ctx = user.model_dump(exclude={"raw_claims"}) if user else {}
    try:
        template = _jinja_env.from_string(template_str)
        return template.render(client_context=ctx, user=user_ctx)
    except TemplateSyntaxError as exc:
        raise SystemPromptRenderError(f"Invalid system prompt template syntax: {exc}") from exc
    except SecurityError as exc:
        raise SystemPromptRenderError(f"System prompt template blocked unsafe operation: {exc}") from exc
    except Exception as exc:
        raise SystemPromptRenderError(f"System prompt template rendering failed: {exc}") from exc


class AgentRuntime:
    """Runtime for a single dynamic agent instance."""

    def __init__(
        self,
        config: DynamicAgentConfig,
        mcp_servers: list[MCPServerConfig],
        settings: Settings | None = None,
        mongo_service: "MongoDBService | None" = None,
        user: UserContext | None = None,
        client_context: ClientContext | None = None,
        session_id: str | None = None,
    ):
        self.config = config
        self.mcp_servers = mcp_servers
        self.settings = settings or get_settings()
        self._mongo_service = mongo_service
        self._user = user
        self._client_context = client_context
        # Spec 102 Phase 8 / T107: prefer the per-request bearer from
        # current_user_token (set by JwtAuthMiddleware) so the same token
        # the BFF authenticated us with is forwarded to MCP servers.
        # Fall back to UserContext-attached fields for backward compat
        # with the X-User-Context legacy path.
        from dynamic_agents.auth.token_context import current_user_token as _ctx_tok

        ctx_token = _ctx_tok.get()
        legacy_token = (user.obo_jwt or user.access_token) if user else None
        self._auth_bearer: str | None = ctx_token or legacy_token
        # Spec 104: never silently substitute the dynamic-agents service
        # account token here — the runtime must run with the user's OBO
        # token so AgentGateway can evaluate `team_member:<active_team>`
        # CEL against the JWT. If we have nothing, log loudly and let the
        # downstream call 401; we'd rather fail closed than show the user
        # tools that belong to the SA.
        if self._auth_bearer is None:
            logger.warning(
                "AgentRuntime for '%s' has no user JWT (ctx_token + legacy both empty); "
                "outbound MCP calls will be unauthenticated and AgentGateway will reject them. "
                "This usually means JwtAuthMiddleware was bypassed or the BFF stripped the "
                "Authorization header.",
                config.name,
            )
        self._session_id = session_id
        self._graph = None
        self._mongo_client = MongoClient(self.settings.mongodb_uri, tz_aware=True)
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
            connections = build_mcp_connections(
                self.mcp_servers,
                server_ids,
                agent_gateway_url=self.settings.agent_gateway_url,
                auth_bearer=self._auth_bearer,
            )

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
        client_ctx = self._client_context.model_dump() if self._client_context else None
        builtin_tools = self._build_builtin_tools(self._user, client_context=client_ctx)
        if builtin_tools:
            tools = tools + builtin_tools

        # 5. Wrap ALL tools with error handling so exceptions become
        #    LLM-visible "ERROR: ..." strings instead of crashing the agent loop.
        if tools:
            tools = wrap_tools_with_error_handling(tools, agent_name=self.config.name)

        # 6. System prompt from agent config, rendered with client context
        try:
            system_prompt = _render_system_prompt(self.config.system_prompt, self._client_context, self._user)
        except SystemPromptRenderError as exc:
            logger.error(f"Agent '{self.config.name}' failed to initialize: {exc}")
            raise RuntimeError(f"Agent '{self.config.name}' failed to initialize: {exc}") from exc

        # 7. Create the LLM
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

        # 8. Resolve subagents (other dynamic agents that this agent can delegate to)
        subagents = await self._resolve_subagents(self.config.subagents)
        if subagents:
            logger.info(
                f"Agent '{self.config.name}': resolved {len(subagents)} subagents: {[s['name'] for s in subagents]}"
            )

        # 9. Create the agent graph
        # Sanitize agent name for use as OpenAI message `name` field.
        # deepagents middleware (subagents.py) propagates this into message
        # name fields, which OpenAI validates against ^[^\s<|\\/>]+$.
        safe_name = _sanitize_agent_name(self.config.name)
        self._graph = create_deep_agent(
            model=llm,
            tools=tools,
            system_prompt=system_prompt,
            context_schema=AgentContext,
            checkpointer=self._checkpointer,
            name=safe_name,
            subagents=subagents if subagents else None,
            interrupt_on={"request_user_input": True},
            middleware=build_middleware(self.config.features, self._session_id),
        )

        self._initialized = True
        logger.info(
            f"[agent] Agent '{self.config.name}' initialized: "
            f"tools={len(tools)}, subagents={len(subagents) if subagents else 0}"
        )

    def _build_builtin_tools(
        self,
        user: UserContext | None = None,
        agent_config: DynamicAgentConfig | None = None,
        client_context: dict | None = None,
    ) -> list:
        """Build list of built-in tools based on agent config.

        Args:
            user: User context for tools that need user info
            agent_config: Agent config to use. Defaults to self.config (parent agent).
                          Pass subagent config to build tools for a subagent.
            client_context: Optional client context dict for the user_info tool.

        Returns:
            List of LangChain tools to add to the agent.
        """
        config = agent_config or self.config
        tools = []
        config_summary: dict[str, Any] = {}

        if not config.builtin_tools:
            return tools

        # fetch_url tool (disabled by default)
        fetch_url_config = config.builtin_tools.fetch_url
        if fetch_url_config and fetch_url_config.enabled:
            allowed_domains = fetch_url_config.allowed_domains or "*"
            tools.append(create_fetch_url_tool(allowed_domains=allowed_domains))
            config_summary["fetch_url"] = {"allowed_domains": allowed_domains}

        # current_datetime tool (enabled by default)
        current_datetime_config = config.builtin_tools.current_datetime
        if current_datetime_config and current_datetime_config.enabled:
            tools.append(create_current_datetime_tool())
            config_summary["current_datetime"] = {}

        # user_info tool (enabled by default)
        user_info_config = config.builtin_tools.user_info
        if user_info_config and user_info_config.enabled:
            if user:
                tools.append(create_user_info_tool(user, client_context=client_context))
                config_summary["user_info"] = {"user": user.email}
            else:
                logger.warning(f"Agent '{config.name}': user_info enabled but no user context available")

        # wait tool (enabled by default)
        wait_config = config.builtin_tools.wait
        if wait_config and wait_config.enabled:
            max_seconds = wait_config.max_seconds or 300
            tools.append(create_wait_tool(max_seconds=max_seconds))
            config_summary["wait"] = {"max_seconds": max_seconds}

        # request_user_input tool (enabled by default)
        request_user_input_config = config.builtin_tools.request_user_input
        if request_user_input_config and request_user_input_config.enabled:
            tools.append(create_request_user_input_tool())
            config_summary["request_user_input"] = {}

        # self_identity tool (enabled by default)
        self_identity_config = config.builtin_tools.self_identity
        if self_identity_config and self_identity_config.enabled:
            gradient_theme = config.ui.gradient_theme if config.ui else None
            tools.append(
                create_self_identity_tool(
                    name=config.name,
                    description=config.description,
                    model_id=config.model_id,
                    model_provider=config.model_provider,
                    gradient_theme=gradient_theme,
                )
            )
            config_summary["self_identity"] = {}

        if tools:
            logger.info(f"Agent '{config.name}': added built-in tools: {config_summary}")

        return tools

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
                "middleware": build_middleware(subagent_config.features, self._session_id),
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
        #    Inherit parent's AG routing and auth (FR-038f)
        server_ids = list(subagent_config.allowed_tools.keys())
        if server_ids:
            connections = build_mcp_connections(
                self.mcp_servers,
                server_ids,
                agent_gateway_url=self.settings.agent_gateway_url,
                auth_bearer=self._auth_bearer,
            )
            if connections:
                # Use resilient connection so one failing server doesn't break the subagent
                all_tools, failed, failed_errors = await get_tools_with_resilience(connections)
                if failed:
                    error_parts = [f"{s}: {failed_errors.get(s, 'Unknown error')}" for s in failed]
                    logger.warning(f"Subagent '{subagent_config.name}': failed MCP servers: {'; '.join(error_parts)}")
                mcp_tools, _ = filter_tools_by_allowed(all_tools, subagent_config.allowed_tools)
                tools.extend(mcp_tools)

        # 2. Add built-in tools based on subagent's config
        client_ctx = self._client_context.model_dump() if self._client_context else None
        builtin_tools = self._build_builtin_tools(self._user, subagent_config, client_context=client_ctx)
        if builtin_tools:
            tools.extend(builtin_tools)

        # 3. Wrap all subagent tools with error handling
        if tools:
            tools = wrap_tools_with_error_handling(tools, agent_name=subagent_config.name)

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
            user_name=self._user.name if self._user else None,
            user_groups=list(self._user.groups) if self._user else [],
            agent_config_id=self.config.id,
            session_id=session_id,
            obo_jwt=self._auth_bearer,
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
        encoder: StreamEncoder | None = None,
    ) -> AsyncGenerator[str, None]:
        """Stream agent response for a user message.

        Yields SSE frame strings produced by the encoder. The encoder handles
        all protocol-specific formatting — this method only orchestrates the
        LangGraph stream lifecycle.

        Args:
            message: User's input message
            session_id: Conversation/session ID for checkpointing
            user_id: User's email/identifier
            trace_id: Optional trace ID for Langfuse tracing
            encoder: StreamEncoder instance for protocol-specific formatting.
                     Must be provided by the caller.

        Yields:
            SSE frame strings
        """
        if not self._initialized:
            await self.initialize()

        assert encoder is not None, "encoder must be provided"

        # Reset cancellation flag at start of each stream
        self._cancelled = False

        config = self._build_stream_config(session_id, user_id, trace_id)
        run_id = f"run-{uuid4().hex[:12]}"

        logger.info(
            f"[stream] Starting stream for agent '{self.config.name}': "
            f"agent_id={self.config.id}, conv={session_id}, user={user_id}, "
            f"user_context={self._user}, client_context={self._client_context}"
        )

        # ── Core lifecycle: run start ──
        for frame in encoder.on_run_start(run_id, session_id):
            yield frame

        # ── Core lifecycle: warnings ──
        for server_name in self._failed_servers:
            for frame in encoder.on_warning(
                f"MCP server '{server_name}' is unavailable. Tools from this server will not work.",
            ):
                yield frame

        # ── Core lifecycle: chunks ──
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

            for frame in encoder.on_chunk(chunk):
                yield frame

        # ── Core lifecycle: stream end (flush) ──
        for frame in encoder.on_stream_end():
            yield frame

        # ── HITL interrupt check ──
        logger.debug("[stream] Stream loop completed, checking for pending interrupt...")
        interrupt_data = await self.has_pending_interrupt(session_id)
        logger.debug(f"[stream] has_pending_interrupt result: {interrupt_data}")
        if interrupt_data:
            logger.debug(f"[stream] Agent '{self.config.name}' has pending interrupt, emitting input_required event")
            for frame in encoder.on_input_required(
                interrupt_id=interrupt_data["interrupt_id"],
                prompt=interrupt_data["prompt"],
                fields=interrupt_data["fields"],
                agent=self.config.name,
            ):
                yield frame
            return  # Don't continue, stream paused for user input

        # ── Core lifecycle: run finish ──
        logger.info(
            f"[stream] Completed stream for agent '{self.config.name}': "
            f"conv={session_id}, content_length={len(encoder.get_accumulated_content())}"
        )
        for frame in encoder.on_run_finish(run_id, session_id):
            yield frame

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
        encoder: StreamEncoder | None = None,
    ) -> AsyncGenerator[str, None]:
        """Resume agent execution after user provides form input.

        Uses the HumanInTheLoopMiddleware pattern from deepagents. The form_data
        is converted to a decision format that the middleware expects.

        Args:
            session_id: Conversation/session ID
            user_id: User's email/identifier
            form_data: JSON string of form values (e.g. {"field_name": "value"}),
                      or rejection message if user dismissed the form
            trace_id: Optional trace ID for Langfuse tracing
            encoder: StreamEncoder instance for protocol-specific formatting.
                     Must be provided by the caller.

        Yields:
            SSE frame strings
        """
        if not self._initialized:
            await self.initialize()

        assert encoder is not None, "encoder must be provided"

        # Reset cancellation flag at start of resume
        self._cancelled = False

        config = self._build_stream_config(session_id, user_id, trace_id)
        run_id = f"run-{uuid4().hex[:12]}"

        logger.info(
            f"[resume] Resuming stream for agent '{self.config.name}': "
            f"agent_id={self.config.id}, conv={session_id}, user={user_id}, "
            f"user_context={self._user}, client_context={self._client_context}"
        )

        # ── Core lifecycle: run start ──
        for frame in encoder.on_run_start(run_id, session_id):
            yield frame

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

        # ── Core lifecycle: chunks ──
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

            for frame in encoder.on_chunk(chunk):
                yield frame

        # ── Core lifecycle: stream end (flush) ──
        for frame in encoder.on_stream_end():
            yield frame

        # ── HITL interrupt check ──
        interrupt_data = await self.has_pending_interrupt(session_id)
        if interrupt_data:
            logger.debug(f"[resume] Agent '{self.config.name}' has pending interrupt after resume")
            for frame in encoder.on_input_required(
                interrupt_id=interrupt_data["interrupt_id"],
                prompt=interrupt_data["prompt"],
                fields=interrupt_data["fields"],
                agent=self.config.name,
            ):
                yield frame
            return  # Don't continue, stream paused

        # ── Core lifecycle: run finish ──
        logger.info(
            f"[resume] Completed resume for agent '{self.config.name}': "
            f"conv={session_id}, content_length={len(encoder.get_accumulated_content())}"
        )
        for frame in encoder.on_run_finish(run_id, session_id):
            yield frame

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
        client_context: ClientContext | None = None,
    ) -> AgentRuntime:
        """Get an existing runtime or create a new one.

        Args:
            agent_config: Dynamic agent configuration
            mcp_servers: Available MCP server configurations
            session_id: Conversation/session ID
            user: User context for builtin tools
            client_context: Opaque client context for system prompt rendering

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
            client_context=client_context,
            session_id=session_id,
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
