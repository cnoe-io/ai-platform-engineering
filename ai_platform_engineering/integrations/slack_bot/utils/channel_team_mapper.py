"""Slack channel → CAIPE team resolution (FR-031).

Reads ``channel_team_mappings`` from MongoDB with a short TTL cache.
Validates that referenced teams still exist in ``teams``. Unmapped channels
fall back to the user's Keycloak attribute ``caipe_default_team_id``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Optional

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import PyMongoError

from .keycloak_admin import get_user_attribute

logger = logging.getLogger("caipe.slack_bot.channel_team_mapper")

DEFAULT_TEAM_USER_ATTR = "caipe_default_team_id"

UNLINKED_CHANNEL_MESSAGE = (
    "This Slack channel is not mapped to a CAIPE team, and your profile has no "
    "default team. Ask an admin to map this channel or set your default team "
    "attribute (`caipe_default_team_id`) in Keycloak."
)

DEFAULT_TEAM_INVALID_MESSAGE = (
    "Your default CAIPE team is no longer valid. Contact your admin to update "
    "your profile or map this channel to a team."
)


def user_has_team_member_role(realm_roles: list[str], team_id: str) -> bool:
    """Return True if *realm_roles* contains ``team_member(<team_id>)``."""
    expected = f"team_member({team_id})"
    return any(r == expected for r in realm_roles)


@dataclass
class EffectiveTeamResolution:
    team_id: Optional[str]
    user_denial_message: Optional[str]


class ChannelTeamMapper:
    """Resolve Slack channel IDs to CAIPE MongoDB team ids."""

    def __init__(self, ttl_seconds: int = 60) -> None:
        self._cache: dict[str, tuple[str, float]] = {}
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
                logger.warning("ChannelTeamMapper: MongoDB client init failed: %s", e)
                return None
        return self._client

    def _mapping_collection(self) -> Optional[Collection[Any]]:
        client = self._get_client()
        if not client:
            return None
        return client[self._db_name]["channel_team_mappings"]

    def _teams_collection(self) -> Optional[Collection[Any]]:
        client = self._get_client()
        if not client:
            return None
        return client[self._db_name]["teams"]

    def invalidate(self, channel_id: str) -> None:
        self._cache.pop(channel_id, None)

    def _team_exists_sync(self, team_id: str) -> bool:
        coll = self._teams_collection()
        if coll is None:
            return False

        try:
            if ObjectId.is_valid(team_id):
                return coll.find_one({"_id": ObjectId(team_id)}) is not None
        except (InvalidId, PyMongoError):
            pass
        try:
            return coll.find_one({"_id": team_id}) is not None
        except PyMongoError:
            return False

    async def resolve_team(self, channel_id: str) -> Optional[str]:
        """Return CAIPE ``team_id`` for *channel_id*, or ``None`` if unmapped/inactive."""
        if not channel_id or not isinstance(channel_id, str):
            return None

        now = time.monotonic()
        cached = self._cache.get(channel_id)
        if cached:
            team_id, ts = cached
            if now - ts < self._ttl:
                if await asyncio.to_thread(self._team_exists_sync, team_id):
                    return team_id
                self.invalidate(channel_id)
                logger.warning(
                    "channel_team_mappings: cached team_id=%s missing from teams; invalidated channel=%s",
                    team_id,
                    channel_id,
                )

        coll = self._mapping_collection()
        if coll is None:
            return None

        def _load() -> Optional[dict[str, Any]]:
            try:
                return coll.find_one(
                    {"slack_channel_id": channel_id, "active": {"$ne": False}},
                )
            except PyMongoError as e:
                logger.warning("channel_team_mappings query failed: %s", e)
                return None

        doc = await asyncio.to_thread(_load)
        if not doc:
            return None

        raw_team = doc.get("team_id")
        if not isinstance(raw_team, str) or not raw_team.strip():
            return None
        tid = raw_team.strip()

        exists = await asyncio.to_thread(self._team_exists_sync, tid)
        if not exists:
            logger.warning(
                "channel_team_mappings: mapping for channel=%s references missing team_id=%s; treating as inactive",
                channel_id,
                tid,
            )
            self.invalidate(channel_id)
            return None

        self._cache[channel_id] = (tid, now)
        return tid


_default_mapper: Optional[ChannelTeamMapper] = None


def get_channel_team_mapper() -> ChannelTeamMapper:
    global _default_mapper
    if _default_mapper is None:
        _default_mapper = ChannelTeamMapper()
    return _default_mapper


async def resolve_effective_team_for_user(
    channel_id: Optional[str],
    keycloak_user_id: str,
) -> EffectiveTeamResolution:
    """Resolve platform team id from channel mapping, else Keycloak default team attribute."""
    mapper = get_channel_team_mapper()

    if channel_id:
        mapped = await mapper.resolve_team(channel_id)
        if mapped:
            return EffectiveTeamResolution(team_id=mapped, user_denial_message=None)

    default_raw = await get_user_attribute(keycloak_user_id, DEFAULT_TEAM_USER_ATTR)
    if isinstance(default_raw, str) and default_raw.strip():
        dt = default_raw.strip()
        if await asyncio.to_thread(mapper._team_exists_sync, dt):
            return EffectiveTeamResolution(team_id=dt, user_denial_message=None)
        logger.warning(
            "User %s has %s=%s but team document is missing",
            keycloak_user_id,
            DEFAULT_TEAM_USER_ATTR,
            dt,
        )
        return EffectiveTeamResolution(team_id=None, user_denial_message=DEFAULT_TEAM_INVALID_MESSAGE)

    return EffectiveTeamResolution(team_id=None, user_denial_message=UNLINKED_CHANNEL_MESSAGE)
