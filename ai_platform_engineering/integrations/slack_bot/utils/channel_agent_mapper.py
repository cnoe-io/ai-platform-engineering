"""Slack channel → dynamic agent resolution.

Reads ``channel_agent_mappings`` from MongoDB with a short TTL cache.
Validates that the mapped agent exists, is enabled, and that the requesting
user has access (basic RBAC: global agents are always accessible; team agents
require a ``team_member:<team>`` Keycloak realm role for one of the agent's
``shared_with_teams``).
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Optional

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import PyMongoError

from .keycloak_admin import fetch_user_realm_role_names

logger = logging.getLogger("caipe.slack_bot.channel_agent_mapper")

CHANNEL_NOT_MAPPED_MESSAGE = (
    "This channel hasn't been set up for CAIPE yet. "
    "Ask your admin to add a channel-to-agent mapping in the CAIPE Admin panel."
)

AGENT_ACCESS_DENIED_MESSAGE = (
    "You don't have access to the agent configured for this channel. "
    "Contact your admin to update your access."
)

AGENT_DISABLED_MESSAGE = (
    "The agent configured for this channel is currently disabled. "
    "Contact your admin to re-enable it."
)


@dataclass
class ChannelAgentResolution:
    agent_id: Optional[str]
    agent_name: Optional[str]
    user_denial_message: Optional[str]


class ChannelAgentMapper:
    """Resolve Slack channel IDs to dynamic agent IDs with RBAC gating."""

    def __init__(self, ttl_seconds: int = 60) -> None:
        self._cache: dict[str, tuple[dict[str, Any], float]] = {}
        self._ttl = ttl_seconds
        self._client: Optional[MongoClient] = None
        self._db_name = os.environ.get("MONGODB_DATABASE", "caipe")

    def _get_client(self) -> Optional[MongoClient]:
        uri = os.environ.get("MONGODB_URI", "").strip()
        if not uri:
            return None
        if self._client is None:
            try:
                self._client = MongoClient(
                    uri,
                    serverSelectionTimeoutMS=5000,
                    retryWrites=False,
                )
            except PyMongoError as e:
                logger.warning("ChannelAgentMapper: MongoDB client init failed: %s", e)
                return None
        return self._client

    def _mapping_collection(self) -> Optional[Collection[Any]]:
        client = self._get_client()
        if not client:
            return None
        return client[self._db_name]["channel_agent_mappings"]

    def _agents_collection(self) -> Optional[Collection[Any]]:
        client = self._get_client()
        if not client:
            return None
        return client[self._db_name]["dynamic_agents"]

    def _load_mapping_sync(self, channel_id: str) -> Optional[dict[str, Any]]:
        coll = self._mapping_collection()
        if coll is None:
            return None
        try:
            return coll.find_one({"slack_channel_id": channel_id, "active": {"$ne": False}})
        except PyMongoError as e:
            logger.warning("channel_agent_mappings query failed: %s", e)
            return None

    def _load_agent_sync(self, agent_id: str) -> Optional[dict[str, Any]]:
        coll = self._agents_collection()
        if coll is None:
            return None
        try:
            return coll.find_one({"_id": agent_id})
        except PyMongoError as e:
            logger.warning("dynamic_agents query failed for %s: %s", agent_id, e)
            return None

    def invalidate(self, channel_id: str) -> None:
        self._cache.pop(channel_id, None)

    async def resolve(
        self,
        channel_id: str,
        keycloak_user_id: str,
    ) -> ChannelAgentResolution:
        """Resolve channel to dynamic agent, checking RBAC for the user.

        Returns a ChannelAgentResolution with agent_id set on success,
        or user_denial_message set on failure.
        """
        if not channel_id:
            return ChannelAgentResolution(None, None, CHANNEL_NOT_MAPPED_MESSAGE)

        now = time.monotonic()
        cached = self._cache.get(channel_id)
        if cached:
            doc, ts = cached
            if now - ts < self._ttl:
                return await self._check_access(doc, keycloak_user_id)
            del self._cache[channel_id]

        mapping = await asyncio.to_thread(self._load_mapping_sync, channel_id)
        if not mapping:
            return ChannelAgentResolution(None, None, CHANNEL_NOT_MAPPED_MESSAGE)

        agent_id = mapping.get("agent_id")
        if not isinstance(agent_id, str) or not agent_id.strip():
            return ChannelAgentResolution(None, None, CHANNEL_NOT_MAPPED_MESSAGE)

        agent = await asyncio.to_thread(self._load_agent_sync, agent_id.strip())
        if not agent:
            logger.warning(
                "channel_agent_mappings: channel=%s maps to missing agent=%s",
                channel_id, agent_id,
            )
            return ChannelAgentResolution(None, None, CHANNEL_NOT_MAPPED_MESSAGE)

        self._cache[channel_id] = (agent, now)
        return await self._check_access(agent, keycloak_user_id)

    async def _check_access(
        self,
        agent: dict[str, Any],
        keycloak_user_id: str,
    ) -> ChannelAgentResolution:
        agent_id = str(agent.get("_id", ""))
        agent_name = str(agent.get("name", agent_id))

        if not agent.get("enabled", True):
            return ChannelAgentResolution(None, None, AGENT_DISABLED_MESSAGE)

        visibility = agent.get("visibility", "global")

        if visibility == "global":
            return ChannelAgentResolution(agent_id, agent_name, None)

        if visibility == "private":
            # Private agents should not be used for channel routing
            logger.warning(
                "channel_agent_mappings: agent=%s has visibility=private; not suitable for channel mapping",
                agent_id,
            )
            return ChannelAgentResolution(None, None, AGENT_ACCESS_DENIED_MESSAGE)

        # visibility == "team": check Keycloak realm roles
        shared_with = agent.get("shared_with_teams", [])
        if not shared_with:
            return ChannelAgentResolution(agent_id, agent_name, None)

        try:
            roles = await fetch_user_realm_role_names(keycloak_user_id)
        except Exception as e:
            logger.warning(
                "Failed to fetch roles for user %s: %s — denying access to agent %s",
                keycloak_user_id, e, agent_id,
            )
            return ChannelAgentResolution(None, None, AGENT_ACCESS_DENIED_MESSAGE)

        role_set = set(roles)
        for team in shared_with:
            if f"team_member:{team}" in role_set:
                return ChannelAgentResolution(agent_id, agent_name, None)

        return ChannelAgentResolution(None, None, AGENT_ACCESS_DENIED_MESSAGE)


_default_mapper: Optional[ChannelAgentMapper] = None


def get_channel_agent_mapper() -> ChannelAgentMapper:
    global _default_mapper
    if _default_mapper is None:
        _default_mapper = ChannelAgentMapper()
    return _default_mapper


async def resolve_channel_agent(
    channel_id: Optional[str],
    keycloak_user_id: str,
) -> ChannelAgentResolution:
    """Resolve platform agent id from channel mapping with RBAC check."""
    if not channel_id:
        return ChannelAgentResolution(None, None, CHANNEL_NOT_MAPPED_MESSAGE)
    mapper = get_channel_agent_mapper()
    return await mapper.resolve(channel_id, keycloak_user_id)
