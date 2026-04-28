"""Agent Runtime service for Dynamic Agents.

Creates and manages DeepAgent instances with MCP tools.

This module contains the core ``AgentRuntime`` class.  Streaming,
skill-loading, and caching logic live in sibling modules:

- ``streaming.py``  — ``StreamingMixin`` (stream / resume / interrupt)
- ``skills.py``     — ``load_skills()`` / ``extract_llm_prompt()``
- ``pool.py``       — ``AgentRuntimeCache`` / ``get_runtime_cache()``
"""

import logging
import re
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from botocore.config import Config as BotocoreConfig
from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager
from deepagents import create_deep_agent
from jinja2 import ChainableUndefined, TemplateSyntaxError
from jinja2.sandbox import SandboxedEnvironment, SecurityError
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.mongodb.saver import MongoDBSaver
from pymongo import MongoClient

from dynamic_agents.config import Settings, get_settings
from dynamic_agents.metrics import metrics as prom_metrics
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
from dynamic_agents.services.mcp_client import (
    build_mcp_connections,
    filter_tools_by_allowed,
    get_tools_with_resilience,
    wrap_tools_with_error_handling,
)
from dynamic_agents.services.middleware import build_middleware
from dynamic_agents.services.skills import load_skills
from dynamic_agents.services.streaming import StreamingMixin

# Re-export for backward compatibility — external code imports from here.
from dynamic_agents.services.runtime_cache import AgentRuntimeCache, get_runtime_cache  # noqa: F401

if TYPE_CHECKING:
    from dynamic_agents.services.stream_encoders import StreamEncoder
    from dynamic_agents.services.mongo import MongoDBService

logger = logging.getLogger(__name__)


def _sanitize_agent_name(name: str) -> str:
    """Sanitize an agent name for use as a LangChain/OpenAI message ``name`` field.

    OpenAI requires message ``name`` fields to match the pattern ``^[^\\s<|\\\\/>]+$``
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


class AgentRuntime(StreamingMixin):
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

        t_start = time.monotonic()

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
                t_mcp = time.monotonic()
                all_tools, failed_servers, failed_errors = await get_tools_with_resilience(connections)
                logger.info(
                    f"[init] MCP tools fetched in {time.monotonic() - t_mcp:.2f}s "
                    f"(agent='{self.config.name}', servers={len(connections)}, "
                    f"failed={len(failed_servers)})"
                )

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
        # model.id and model.provider are required fields - no fallback to env vars
        logger.info(
            f"[llm] Instantiating LLM for agent '{self.config.name}': "
            f"provider={self.config.model.provider}, model={self.config.model.id}"
        )
        # Configure botocore with extended timeouts for Bedrock to prevent
        # ReadTimeoutError during long-running agent operations (especially subagents)
        boto_config = BotocoreConfig(read_timeout=300, connect_timeout=60)
        llm = LLMFactory(provider=self.config.model.provider).get_llm(
            model=self.config.model.id,
            config=boto_config,
        )
        logger.info(f"[llm] LLM instantiated for agent '{self.config.name}': type={type(llm).__name__}")

        # 8. Resolve subagents (other dynamic agents that this agent can delegate to)
        subagents = await self._resolve_subagents(self.config.subagents)
        if subagents:
            logger.info(
                f"Agent '{self.config.name}': resolved {len(subagents)} subagents: {[s['name'] for s in subagents]}"
            )

        # 8b. Load skills from agent_skills collection if configured
        self._skills_files: dict[str, Any] = {}
        skills_middleware_list: list = []
        if self.config.skills:
            try:
                skills_data = load_skills(
                    self.config.skills,
                    mongodb_uri=self.settings.mongodb_uri,
                    mongodb_database=self.settings.mongodb_database,
                )
                if skills_data:
                    from ai_platform_engineering.skills_middleware import build_skills_files

                    self._skills_files, skills_sources = build_skills_files(skills_data)
                    if skills_sources:
                        from deepagents.backends.state import StateBackend
                        from deepagents.middleware.skills import SkillsMiddleware

                        skills_middleware_list.append(SkillsMiddleware(backend=StateBackend, sources=skills_sources))
                        logger.info(
                            f"Agent '{self.config.name}': loaded {len(skills_data)} skills "
                            f"({len(self._skills_files)} files, {len(skills_sources)} sources)"
                        )
            except Exception as e:
                logger.warning(f"Agent '{self.config.name}': failed to load skills: {e}")

        # 9. Build middleware stack
        middleware_stack = build_middleware(
            self.config.features,
            self._session_id,
            agent_name=self.config.name,
            model_id=self.config.model.id,
        )
        # Prepend skills middleware so it runs before other middleware
        if skills_middleware_list:
            middleware_stack = skills_middleware_list + middleware_stack

        # 10. Create the agent graph
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
            middleware=middleware_stack,
        )

        self._initialized = True
        init_duration = time.monotonic() - t_start
        prom_metrics.runtime_init_duration_seconds.labels(agent_name=self.config.name).observe(init_duration)
        prom_metrics.runtime_init_duration_summary.labels(agent_name=self.config.name).observe(init_duration)
        logger.info(
            f"[agent] Agent '{self.config.name}' initialized in {init_duration:.2f}s: "
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
                    model_id=config.model.id,
                    model_provider=config.model.provider,
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
                "middleware": build_middleware(
                    subagent_config.features,
                    self._session_id,
                    agent_name=subagent_config.name,
                    model_id=subagent_config.model.id,
                ),
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
