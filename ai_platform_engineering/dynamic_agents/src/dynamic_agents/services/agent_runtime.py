"""Agent Runtime service for Dynamic Agents.

Creates and manages DeepAgent instances with MCP tools.
"""

import logging
import re
import time
import uuid
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING, Any

from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager
from deepagents import create_deep_agent
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.memory import InMemorySaver

from dynamic_agents.config import Settings, get_settings
from dynamic_agents.models import AgentContext, DynamicAgentConfig, MCPServerConfig, SubAgentRef
from dynamic_agents.prompts.extension import get_default_extension_prompt
from dynamic_agents.services.mcp_client import (
    build_mcp_connections,
    filter_tools_by_allowed,
)

if TYPE_CHECKING:
    from dynamic_agents.services.mongo import MongoDBService

logger = logging.getLogger(__name__)


def _make_artifact_id() -> str:
    """Generate a unique artifact ID."""
    return f"artifact-{uuid.uuid4().hex[:12]}"


def _sanitize_agent_name(name: str) -> str:
    """Sanitize an agent name for use as a LangChain/OpenAI message `name` field.

    OpenAI requires message `name` fields to match the pattern ``^[^\\s<|\\\\/>]+$``
    (no whitespace, ``<``, ``|``, ``\\``, ``/``, or ``>``).  deepagents propagates
    the agent ``name`` into message ``name`` fields via its middleware, so we must
    ensure it conforms.

    We replace disallowed characters with underscores.
    """
    return re.sub(r"[\s<|\\/>]+", "_", name)


class _ToolTracker:
    """Tracks tool calls during a single streaming session.

    Synthesizes execution_plan_update events that the ContextPanel can render
    as a task list with progress indicators.

    The plan format uses emoji + [AgentName] lines, which is Pattern 1 in
    ContextPanel's parseExecutionTasks:
        ⏳ [AgentName] description   (pending)
        🔄 [AgentName] description   (in_progress)
        ✅ [AgentName] description   (completed)
    """

    def __init__(self, agent_name: str):
        self.agent_name = agent_name
        # Ordered list of (tool_name, status) tuples
        self._tools: list[tuple[str, str]] = []  # (name, "pending"|"in_progress"|"completed")

    def start_tool(self, tool_name: str) -> None:
        """Register a tool call starting."""
        # Mark any previously in_progress tools as completed
        # (LangGraph sends start/end sequentially per tool)
        self._tools = [(name, "completed" if status == "in_progress" else status) for name, status in self._tools]
        self._tools.append((tool_name, "in_progress"))

    def end_tool(self, tool_name: str) -> None:
        """Mark a tool call as completed."""
        self._tools = [
            (name, "completed" if name == tool_name and status == "in_progress" else status)
            for name, status in self._tools
        ]

    def make_execution_plan_event(self) -> dict[str, Any]:
        """Build an execution_plan_update event from current tool state."""
        emoji_map = {
            "pending": "⏳",
            "in_progress": "🔄",
            "completed": "✅",
        }

        lines = []
        for tool_name, status in self._tools:
            emoji = emoji_map.get(status, "⏳")
            # Format: "✅ [AgentName] tool_name" — matches ContextPanel Pattern 1
            lines.append(f"{emoji} [{self.agent_name}] {tool_name}")

        plan_text = "\n".join(lines)

        return {
            "type": "execution_plan_update",
            "data": {
                "artifact": {
                    "artifactId": _make_artifact_id(),
                    "name": "execution_plan_update",
                    "description": "Dynamic agent execution plan",
                    "parts": [{"kind": "text", "text": plan_text}],
                    "metadata": {"sourceAgent": self.agent_name},
                },
            },
        }


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
                all_tools = await self._mcp_client.get_tools()

                # 4. Filter tools based on allowed_tools config
                tools, missing = filter_tools_by_allowed(all_tools, self.config.allowed_tools)

                if missing:
                    logger.warning(f"Agent '{self.config.name}': tools not found: {missing}")

                logger.info(
                    f"Agent '{self.config.name}': loaded {len(tools)} tools from {len(connections)} MCP servers"
                )

        # 5. Assemble system prompt
        system_prompt = self._build_system_prompt()

        # 6. Create the LLM
        # LLMFactory reads the model from provider-specific env vars (e.g.
        # AZURE_OPENAI_DEPLOYMENT, OPENAI_MODEL_NAME, AWS_BEDROCK_MODEL_ID).
        # Passing model_id as a kwarg only works for the AWS Bedrock provider;
        # for all other providers it leaks into model_kwargs and causes
        # "unexpected keyword argument 'model_id'" at API call time.
        # For the MVP, dynamic agents inherit the platform default LLM.
        if self.config.model_id:
            logger.info(
                f"Agent '{self.config.name}': model_id='{self.config.model_id}' is stored "
                "but per-agent model override is not yet supported — using platform default LLM"
            )
        llm = LLMFactory().get_llm()

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
        logger.info(f"Agent '{self.config.name}' initialized successfully")

    def _build_system_prompt(self) -> str:
        """Assemble the full system prompt from config."""
        parts = []

        # User instructions (required)
        parts.append(self.config.system_prompt)

        # AGENTS.md content (optional, stored inline)
        if self.config.agents_md:
            parts.append("\n\n# Project Instructions (AGENTS.md)\n")
            parts.append(self.config.agents_md)

        # Extension prompt (platform guidelines)
        extension = (
            self.config.extension_prompt or self.settings.default_extension_prompt or get_default_extension_prompt()
        )
        parts.append("\n\n" + extension)

        return "\n".join(parts)

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

        if subagent_config.agents_md:
            parts.append("\n\n# Project Instructions (AGENTS.md)\n")
            parts.append(subagent_config.agents_md)

        # Use subagent's extension prompt or default
        extension = (
            subagent_config.extension_prompt or self.settings.default_extension_prompt or get_default_extension_prompt()
        )
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

        Emits SSE events shaped to be compatible with the ContextPanel UI:
        - content: Streaming text tokens
        - tool_notification_start: Tool invocation started (with artifact shape)
        - tool_notification_end: Tool invocation completed (with artifact shape)
        - execution_plan_update: Synthetic execution plan from tool sequence
        - final_result: Completion signal with final content
        - error: Error events

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

        # Track tool calls for execution plan synthesis
        tool_tracker = _ToolTracker(agent_name=self.config.name)
        accumulated_content = []

        async for event in self._graph.astream_events(
            {"messages": [{"role": "user", "content": message}]},
            config=config,
            version="v2",
        ):
            for transformed in self._transform_event(event, tool_tracker, accumulated_content):
                yield transformed

        # Emit final_result with accumulated content
        final_text = "".join(accumulated_content)
        if final_text:
            yield {
                "type": "final_result",
                "data": {
                    "artifact": {
                        "artifactId": _make_artifact_id(),
                        "name": "final_result",
                        "description": "Final result from dynamic agent",
                        "parts": [{"kind": "text", "text": final_text}],
                        "metadata": {
                            "trace_id": self._current_trace_id,
                            "agent_name": self.config.name,
                        },
                    },
                },
            }

    def _transform_event(
        self,
        event: dict[str, Any],
        tool_tracker: "_ToolTracker",
        accumulated_content: list[str],
    ) -> list[dict[str, Any]]:
        """Transform a single LangGraph event into ContextPanel-compatible SSE events.

        May return zero or more events per input (e.g. tool_start also emits
        an execution_plan_update).

        Events are shaped so the frontend DynamicAgentClient can map them
        directly into A2AEvent objects for the Zustand store.
        """
        results: list[dict[str, Any]] = []
        kind = event.get("event", "")

        if kind == "on_chat_model_stream":
            chunk = event.get("data", {}).get("chunk")
            if chunk:
                content = getattr(chunk, "content", "")
                if content:
                    accumulated_content.append(content)
                    results.append({"type": "content", "data": content})

        elif kind == "on_tool_start":
            tool_name = event.get("name", "unknown")

            # Register tool with tracker and emit execution plan update
            tool_tracker.start_tool(tool_name)

            # Emit execution plan update (shows task list in ContextPanel)
            plan_event = tool_tracker.make_execution_plan_event()
            results.append(plan_event)

            # Emit tool_notification_start (shows active tool call)
            results.append(
                {
                    "type": "tool_notification_start",
                    "data": {
                        "artifact": {
                            "artifactId": _make_artifact_id(),
                            "name": "tool_notification_start",
                            "description": f"Tool call started: {tool_name}",
                            "parts": [
                                {
                                    "kind": "text",
                                    "text": f"{self.config.name}: Calling tool: {tool_name}",
                                }
                            ],
                            "metadata": {"sourceAgent": self.config.name},
                        },
                    },
                }
            )

        elif kind == "on_tool_end":
            tool_name = event.get("name", "unknown")

            # Mark tool as complete and emit updated execution plan
            tool_tracker.end_tool(tool_name)

            plan_event = tool_tracker.make_execution_plan_event()
            results.append(plan_event)

            # Emit tool_notification_end
            results.append(
                {
                    "type": "tool_notification_end",
                    "data": {
                        "artifact": {
                            "artifactId": _make_artifact_id(),
                            "name": "tool_notification_end",
                            "description": f"Tool call completed: {tool_name}",
                            "parts": [
                                {
                                    "kind": "text",
                                    "text": f"{self.config.name}: Tool completed: {tool_name}",
                                }
                            ],
                            "metadata": {"sourceAgent": self.config.name},
                        },
                    },
                }
            )

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
            if runtime.age_seconds < self._ttl:
                return runtime
            else:
                # TTL expired, cleanup and recreate
                await runtime.cleanup()
                del self._cache[key]

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
