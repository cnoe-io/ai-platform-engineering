"""Agent Runtime service for Dynamic Agents.

Creates and manages DeepAgent instances with MCP tools.
"""

import logging
import re
import time
from collections.abc import AsyncGenerator
from datetime import datetime
from typing import TYPE_CHECKING, Any

from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager
from deepagents import create_deep_agent
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.memory import InMemorySaver

from dynamic_agents.config import Settings, get_settings
from dynamic_agents.models import AgentContext, DynamicAgentConfig, MCPServerConfig, SubAgentRef
from dynamic_agents.prompts.extension import get_default_extension_prompt
from dynamic_agents.services.builtin_tools import create_fetch_url_tool
from dynamic_agents.services.mcp_client import (
    _extract_error_message,
    build_mcp_connections,
    filter_tools_by_allowed,
)
from dynamic_agents.services.stream_events import (
    make_content_event,
    make_final_result_event,
)
from dynamic_agents.services.stream_trackers import (
    SubagentTracker,
    TodoTracker,
    ToolTracker,
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
    ):
        self.config = config
        self.mcp_servers = mcp_servers
        self.settings = settings or get_settings()
        self._mongo_service = mongo_service
        self._graph = None
        self._mcp_client: MultiServerMCPClient | None = None
        self._initialized = False
        self._created_at = time.time()
        self.tracing = TracingManager()
        self._current_trace_id: str | None = None
        self._missing_tools: list[str] = []
        self._failed_servers: list[str] = []
        self._warned_sessions: set[str] = set()
        # Track config timestamps for cache invalidation
        self._config_updated_at: datetime = config.updated_at
        self._mcp_servers_updated_at: datetime = max((s.updated_at for s in mcp_servers), default=datetime.min)

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
                # 2. Create MCP client with tool_name_prefix=True
                # As of langchain-mcp-adapters 0.1.0, MultiServerMCPClient cannot be used
                # as a context manager. Use get_tools() directly instead.
                self._mcp_client = MultiServerMCPClient(connections, tool_name_prefix=True)

                # 3. Get all tools from connected servers
                # Handle connection errors gracefully - continue without failed servers
                try:
                    all_tools = await self._mcp_client.get_tools()
                except BaseException as e:
                    # Extract user-friendly error message
                    error_msg = _extract_error_message(e)
                    failed_servers = list(connections.keys())
                    logger.warning(
                        f"Agent '{self.config.name}': Failed to connect to MCP servers {failed_servers}: {error_msg}"
                    )
                    self._failed_servers = [f"{s} ({error_msg})" for s in failed_servers]
                    all_tools = []

                # 4. Filter tools based on allowed_tools config
                tools, missing = filter_tools_by_allowed(all_tools, self.config.allowed_tools)

                # Only report missing tools if we successfully connected to servers
                # (if connection failed, missing tools are expected and already reported as failed servers)
                if missing and not self._failed_servers:
                    logger.warning(f"Agent '{self.config.name}': tools not found: {missing}")
                    self._missing_tools = missing

                logger.info(
                    f"Agent '{self.config.name}': loaded {len(tools)} tools from {len(connections)} MCP servers"
                )

        # 4.5 Add built-in tools based on config
        builtin_tools_to_add = self._build_builtin_tools()
        if builtin_tools_to_add:
            tools = tools + builtin_tools_to_add
            logger.info(
                f"Agent '{self.config.name}': added {len(builtin_tools_to_add)} built-in tools: "
                f"{[t.name for t in builtin_tools_to_add]}"
            )

        # 5. Assemble system prompt
        system_prompt = self._build_system_prompt()

        # 6. Create the LLM
        # model_id and model_provider are required fields - no fallback to env vars
        logger.info(
            f"[llm] Instantiating LLM for agent '{self.config.name}': "
            f"provider={self.config.model_provider}, model={self.config.model_id}"
        )
        llm = LLMFactory(provider=self.config.model_provider).get_llm(model=self.config.model_id)
        logger.info(f"[llm] LLM instantiated for agent '{self.config.name}': type={type(llm).__name__}")

        # 7. Resolve subagents (other dynamic agents that this agent can delegate to)
        subagents = await self._resolve_subagents(self.config.subagents)
        if subagents:
            logger.info(
                f"Agent '{self.config.name}': resolved {len(subagents)} subagents: {[s['name'] for s in subagents]}"
            )

        # 8. Create the agent graph
        # Sanitize agent name for use as OpenAI message `name` field.
        # deepagents middleware (subagents.py) propagates this into message
        # name fields, which OpenAI validates against ^[^\s<|\\/>]+$.
        safe_name = _sanitize_agent_name(self.config.name)
        self._graph = create_deep_agent(
            model=llm,
            tools=tools,
            system_prompt=system_prompt,
            context_schema=AgentContext,
            checkpointer=InMemorySaver(),
            name=safe_name,
            subagents=subagents if subagents else None,
        )

        self._initialized = True
        logger.info(
            f"[agent] Agent '{self.config.name}' initialized: "
            f"tools={len(tools)}, subagents={len(subagents) if subagents else 0}"
        )

    def _build_system_prompt(self) -> str:
        """Assemble the full system prompt from config."""
        parts = []

        # User instructions (required)
        parts.append(self.config.system_prompt)

        # Extension prompt (platform guidelines)
        extension = self.settings.default_extension_prompt or get_default_extension_prompt()
        parts.append("\n\n" + extension)

        return "\n".join(parts)

    def _build_builtin_tools(self) -> list:
        """Build list of built-in tools based on agent config.

        Returns:
            List of LangChain tools to add to the agent.
        """
        tools = []

        if not self.config.builtin_tools:
            return tools

        # fetch_url tool
        fetch_url_config = self.config.builtin_tools.fetch_url
        if fetch_url_config and fetch_url_config.enabled:
            allowed_domains = fetch_url_config.allowed_domains or "*"
            fetch_url_tool = create_fetch_url_tool(allowed_domains=allowed_domains)
            tools.append(fetch_url_tool)

            # Log domain restrictions
            if allowed_domains == "*":
                logger.debug(f"Agent '{self.config.name}': fetch_url enabled (all domains allowed)")
            else:
                domain_count = len([d.strip() for d in allowed_domains.split(",") if d.strip()])
                logger.debug(f"Agent '{self.config.name}': fetch_url enabled with {domain_count} domain pattern(s)")

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

            # Build system prompt for subagent
            subagent_prompt = self._build_subagent_prompt(subagent_config)

            # Create SubAgent dict in deepagents format
            subagent_dict: dict[str, Any] = {
                "name": _sanitize_agent_name(ref.name),
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
        """Build MCP tools for a subagent.

        Args:
            subagent_config: The subagent's configuration

        Returns:
            List of LangChain tools from MCP servers
        """
        server_ids = list(subagent_config.allowed_tools.keys())
        if not server_ids:
            return []

        connections = build_mcp_connections(self.mcp_servers, server_ids)
        if not connections:
            return []

        # Create MCP client for subagent
        mcp_client = MultiServerMCPClient(connections, tool_name_prefix=True)
        all_tools = await mcp_client.get_tools()

        # Filter tools based on subagent's allowed_tools config
        tools, _ = filter_tools_by_allowed(all_tools, subagent_config.allowed_tools)
        return tools

    def _build_subagent_prompt(self, subagent_config: DynamicAgentConfig) -> str:
        """Build system prompt for a subagent.

        Args:
            subagent_config: The subagent's configuration

        Returns:
            System prompt string
        """
        parts = [subagent_config.system_prompt]

        # Use default extension prompt
        extension = self.settings.default_extension_prompt or get_default_extension_prompt()
        parts.append("\n\n" + extension)

        return "\n".join(parts)

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
        - tool_start: Tool call started (with args)
        - tool_end: Tool call completed
        - todo_update: Task list updated (from write_todos)
        - subagent_start: Subagent delegation started (task tool)
        - subagent_end: Subagent delegation completed
        - final_result: Completion signal with final content

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

        # Create tracing config using TracingManager for Langfuse integration
        config = self.tracing.create_config(session_id)

        # Ensure configurable exists and set thread_id
        if "configurable" not in config:
            config["configurable"] = {}
        config["configurable"]["thread_id"] = session_id

        # Add agent context
        config["context"] = AgentContext(
            user_id=user_id,
            agent_config_id=self.config.id,
            session_id=session_id,
        )

        # Ensure metadata exists
        if "metadata" not in config:
            config["metadata"] = {}

        # Add user_id and agent info to metadata for tracing
        config["metadata"]["user_id"] = user_id
        config["metadata"]["agent_config_id"] = self.config.id
        config["metadata"]["agent_name"] = self.config.name

        # Add trace_id to metadata for distributed tracing
        if trace_id:
            config["metadata"]["trace_id"] = trace_id
            logger.info(f"Using provided trace_id: {trace_id}")
        else:
            # Try to get trace_id from TracingManager context
            current_trace_id = self.tracing.get_trace_id()
            if current_trace_id:
                config["metadata"]["trace_id"] = current_trace_id
                logger.debug(f"Using trace_id from TracingManager context: {current_trace_id}")

        # Store trace_id for final_result event
        self._current_trace_id = config.get("metadata", {}).get("trace_id")

        # Initialize trackers
        tool_tracker = ToolTracker(agent_name=self.config.name)
        todo_tracker = TodoTracker(agent_name=self.config.name)
        subagent_tracker = SubagentTracker(parent_agent_name=self.config.name)
        accumulated_content: list[str] = []

        logger.info(f"[stream] Starting stream for agent '{self.config.name}': user={user_id}, session={session_id}")
        logger.info(f"[stream] _missing_tools={self._missing_tools}, _warned_sessions={self._warned_sessions}")

        # Emit warning about failed MCP servers once per session
        if self._failed_servers and session_id not in self._warned_sessions:
            servers_list = ", ".join(self._failed_servers)
            logger.info(f"[stream] Emitting warning event for failed MCP servers: {servers_list}")
            yield {
                "type": "warning",
                "data": {
                    "message": f"Failed to connect to MCP servers: {servers_list}. Tools from these servers are unavailable.",
                    "failed_servers": self._failed_servers,
                },
            }

        # Emit warning about missing tools once per session
        if self._missing_tools and session_id not in self._warned_sessions:
            tools_list = ", ".join(self._missing_tools)
            logger.info(f"[stream] Emitting warning event for missing tools: {tools_list}")
            yield {
                "type": "warning",
                "data": {
                    "message": f"Some configured tools are unavailable and will be skipped: {tools_list}",
                    "missing_tools": self._missing_tools,
                },
            }

        # Mark session as warned (for both failed servers and missing tools)
        if self._failed_servers or self._missing_tools:
            self._warned_sessions.add(session_id)

        # Stream with subgraphs=True and both messages and updates modes
        async for chunk in self._graph.astream(
            {"messages": [{"role": "user", "content": message}]},
            config=config,
            stream_mode=["messages", "updates"],
            subgraphs=True,
        ):
            for event in self._transform_stream_chunk(
                chunk, tool_tracker, todo_tracker, subagent_tracker, accumulated_content
            ):
                yield event

        # Emit final_result with accumulated content
        final_text = "".join(accumulated_content)
        if final_text:
            logger.info(
                f"[stream] Completed stream for agent '{self.config.name}': "
                f"session={session_id}, content_length={len(final_text)}"
            )
            yield make_final_result_event(
                content=final_text,
                agent=self.config.name,
                trace_id=self._current_trace_id,
            )

    def _transform_stream_chunk(
        self,
        chunk: tuple,
        tool_tracker: ToolTracker,
        todo_tracker: TodoTracker,
        subagent_tracker: SubagentTracker,
        accumulated_content: list[str],
    ) -> list[dict[str, Any]]:
        """Transform astream() chunks into structured SSE events.

        Handles the multi-mode streaming format from astream() with subgraphs=True.
        Chunks come as tuples: (namespace, mode, data)

        Args:
            chunk: Raw chunk from astream()
            tool_tracker: Tracks tool calls
            todo_tracker: Parses write_todos output
            subagent_tracker: Tracks task tool calls
            accumulated_content: List to accumulate final content

        Returns:
            List of SSE event dicts
        """
        results: list[dict[str, Any]] = []

        # Parse chunk format: (namespace, mode, data) or (mode, data)
        if len(chunk) == 3:
            namespace, mode, data = chunk
        elif len(chunk) == 2:
            mode, data = chunk
            namespace = ()
        else:
            logger.warning(f"Unexpected chunk format: {chunk}")
            return results

        # Only process parent agent events (namespace = empty tuple)
        # Subagent events from task tool are handled differently (see below)
        if len(namespace) > 0:
            # Ignore subgraph events - we track subagents via task tool calls
            return results

        if mode == "messages":
            # Token streaming from LLM
            if isinstance(data, tuple) and len(data) == 2:
                msg_chunk, _metadata = data

                # Skip ToolMessage/ToolMessageChunk content - these are tool results
                # (e.g., RAG search JSON) that should NOT be shown in chat.
                # We only want AIMessage/AIMessageChunk content for the final answer.
                msg_type = type(msg_chunk).__name__
                if "ToolMessage" in msg_type:
                    return results

                # Also skip if the chunk has tool_calls - this is an AIMessageChunk
                # that's invoking tools, not generating content for the user
                if getattr(msg_chunk, "tool_calls", None):
                    return results

                raw_content = getattr(msg_chunk, "content", "")

                # Normalize content to string
                if isinstance(raw_content, list):
                    content = "".join(
                        block.get("text", "") if isinstance(block, dict) else str(block) for block in raw_content
                    )
                else:
                    content = raw_content if isinstance(raw_content, str) else ""

                if content:
                    accumulated_content.append(content)
                    results.append(make_content_event(content))

        elif mode == "updates":
            # State updates - detect tool calls and results
            if isinstance(data, dict):
                for _node_name, node_data in data.items():
                    if not isinstance(node_data, dict):
                        continue

                    messages = node_data.get("messages", [])
                    if not isinstance(messages, list):
                        continue

                    for msg in messages:
                        # Handle AIMessage with tool_calls
                        tool_calls = getattr(msg, "tool_calls", None)
                        if tool_calls:
                            for tc in tool_calls:
                                tool_name = (
                                    tc.get("name", "unknown")
                                    if isinstance(tc, dict)
                                    else getattr(tc, "name", "unknown")
                                )
                                tool_call_id = tc.get("id", "") if isinstance(tc, dict) else getattr(tc, "id", "")
                                args = tc.get("args", {}) if isinstance(tc, dict) else getattr(tc, "args", {})

                                # Check if this is a subagent invocation (task tool)
                                if subagent_tracker.is_task_tool(tool_name):
                                    subagent_type = args.get("subagent_type", "unknown")
                                    # The task tool uses "description" arg, not "prompt"
                                    purpose = args.get("description", "")
                                    results.append(
                                        subagent_tracker.start_subagent(tool_call_id, subagent_type, purpose)
                                    )
                                else:
                                    # Regular tool call
                                    results.append(tool_tracker.start_tool(tool_name, tool_call_id, args))

                                    # Check for todo updates from write_todos args (primary method)
                                    # This is more reliable than parsing markdown from ToolMessage
                                    todo_event = todo_tracker.process_tool_call(tool_name, args)
                                    if todo_event:
                                        results.append(todo_event)

                        # Handle ToolMessage (tool results)
                        tool_call_id = getattr(msg, "tool_call_id", None)
                        if tool_call_id:
                            content = getattr(msg, "content", "")

                            # Check if this is a subagent result
                            if subagent_tracker.get_active_subagent(tool_call_id):
                                event = subagent_tracker.end_subagent(tool_call_id)
                                if event:
                                    results.append(event)
                            else:
                                # Regular tool result - emit tool_end
                                event = tool_tracker.end_tool(tool_call_id)
                                if event:
                                    results.append(event)

        return results

    async def cleanup(self) -> None:
        """Cleanup MCP client connections."""
        if self._mcp_client:
            # Note: As of langchain-mcp-adapters 0.1.0, MultiServerMCPClient
            # doesn't require explicit cleanup when not used as context manager
            self._mcp_client = None
        self._initialized = False

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
        current_mcp_max = max((s.updated_at for s in mcp_servers), default=datetime.min)
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
    ) -> AgentRuntime:
        """Get an existing runtime or create a new one.

        Args:
            agent_config: Dynamic agent configuration
            mcp_servers: Available MCP server configurations
            session_id: Conversation/session ID

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
        runtime = AgentRuntime(agent_config, mcp_servers, mongo_service=self._mongo_service)
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


# Singleton cache instance
_runtime_cache: AgentRuntimeCache | None = None


def get_runtime_cache() -> AgentRuntimeCache:
    """Get the singleton runtime cache."""
    global _runtime_cache
    if _runtime_cache is None:
        settings = get_settings()
        _runtime_cache = AgentRuntimeCache(ttl_seconds=settings.agent_runtime_ttl_seconds)
    return _runtime_cache
