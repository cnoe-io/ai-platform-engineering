"""AgentRuntime cache (pool) with TTL-based cleanup.

Manages a pool of ``AgentRuntime`` instances keyed by
``(agent_id, session_id)``, with automatic expiry and config-change
invalidation.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from dynamic_agents.config import get_settings
from dynamic_agents.models import (
    ClientContext,
    DynamicAgentConfig,
    MCPServerConfig,
    UserContext,
)

if TYPE_CHECKING:
    from dynamic_agents.services.agent_runtime import AgentRuntime
    from dynamic_agents.services.mongo import MongoDBService

logger = logging.getLogger(__name__)


class AgentRuntimeCache:
    """Cache for AgentRuntime instances with TTL-based cleanup."""

    def __init__(self, ttl_seconds: int = 3600, mongo_service: "MongoDBService | None" = None):
        self._cache: dict[str, "AgentRuntime"] = {}
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
    ) -> "AgentRuntime":
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
        from dynamic_agents.services.agent_runtime import AgentRuntime

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
