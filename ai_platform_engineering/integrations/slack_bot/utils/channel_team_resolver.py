"""Resolve a Slack channel to its CAIPE team slug.

Runs before :func:`obo_exchange.impersonate_user`. Maps:

  Slack channel ID
    ─→ ``channel_team_mappings.team_id`` (team Mongo ObjectId hex)
        ─→ ``teams._id`` document
            ─→ ``teams.slug`` (used as the channel-resolved team scope
               carried via the dispatch envelope and ``X-Team-Id`` /
               ``X-Channel-Id`` headers — never in the OBO token).

Channel access is gated on agent-level ``can_use`` permission, not team
membership. Any authenticated user in the Slack workspace can interact
with an agent in a channel as long as:
  1. The channel is registered to a team (has a mapping).
  2. The agent is assigned to the channel (channel→agent grant).
  3. The user has ``can_use`` on the agent (direct or via team membership).

Uses an in-process TTL cache (channel → team doc, 60s TTL) to avoid
hammering Mongo on every Slack event.
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

from .user_messages import TEAM_SETUP_INCOMPLETE_MESSAGE

logger = logging.getLogger("caipe.slack_bot.channel_team_resolver")


def _app_name() -> str:
    return os.environ.get("SLACK_INTEGRATION_APP_NAME") or os.environ.get("APP_NAME") or "CAIPE"


def _channel_not_mapped_message() -> str:
    name = _app_name()
    return (
        f"This channel isn't assigned to a {name} team yet. "
        f"Ask your admin to assign it to a team in the {name} Admin panel "
        "(Teams ▸ <team> ▸ Slack channels)."
    )


CHANNEL_NOT_MAPPED_TO_TEAM_MESSAGE = _channel_not_mapped_message()


@dataclass
class ChannelTeamResolution:
    """Outcome of channel→team resolution.

    Exactly one of ``team_slug`` or ``deny_message`` is set.
    """

    team_slug: Optional[str]
    team_id: Optional[str]
    team_name: Optional[str]
    deny_message: Optional[str]


class ChannelTeamResolver:
    """Resolve Slack channel → team slug."""

    def __init__(self, ttl_seconds: int = 60) -> None:
        # Cache key: channel_id → (team doc, monotonic timestamp).
        self._team_by_channel: dict[str, tuple[dict[str, Any], float]] = {}
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
                logger.warning("ChannelTeamResolver: MongoDB client init failed: %s", e)
                return None
        return self._client

    def _coll(self, name: str) -> Optional[Collection[Any]]:
        client = self._get_client()
        if not client:
            return None
        return client[self._db_name][name]

    def _load_channel_team_sync(self, channel_id: str) -> Optional[dict[str, Any]]:
        """Look up channel → team doc; returns the *team* document or None.

        Returns None when:
          - There is no active mapping for the channel.
          - The mapping points at a team that no longer exists (orphan).
        """
        mappings = self._coll("channel_team_mappings")
        teams = self._coll("teams")
        if mappings is None or teams is None:
            return None
        try:
            mapping = mappings.find_one(
                {"slack_channel_id": channel_id, "active": {"$ne": False}}
            )
            if not mapping:
                return None
            team_id_str = mapping.get("team_id")
            if not isinstance(team_id_str, str) or not team_id_str.strip():
                return None
            try:
                team_oid = ObjectId(team_id_str.strip())
            except InvalidId:
                logger.warning(
                    "channel_team_mappings: channel=%s has invalid team_id=%r",
                    channel_id,
                    team_id_str,
                )
                return None
            team_doc = teams.find_one({"_id": team_oid})
            if not team_doc:
                logger.warning(
                    "channel_team_mappings: channel=%s maps to missing team=%s",
                    channel_id,
                    team_id_str,
                )
                return None
            return team_doc
        except PyMongoError as e:
            logger.warning("channel_team_mappings query failed: %s", e)
            return None

    def invalidate(self, channel_id: str) -> None:
        self._team_by_channel.pop(channel_id, None)

    async def resolve(
        self,
        channel_id: str,
    ) -> ChannelTeamResolution:
        """Resolve channel → team metadata.

        Returns team slug/id/name for routing and logging. Access control
        (whether the user can use a given agent) is enforced downstream via
        agent-level ``can_use`` checks, not team membership.

        Caller is expected to have already handled the DM / personal case
        (no channel_id, or channel starts with ``D``) before calling this.
        """
        if not channel_id:
            return ChannelTeamResolution(
                team_slug=None,
                team_id=None,
                team_name=None,
                deny_message=CHANNEL_NOT_MAPPED_TO_TEAM_MESSAGE,
            )

        now = time.monotonic()
        cached = self._team_by_channel.get(channel_id)
        team_doc: Optional[dict[str, Any]] = None
        if cached and now - cached[1] < self._ttl:
            team_doc = cached[0]
        else:
            team_doc = await asyncio.to_thread(
                self._load_channel_team_sync, channel_id
            )
            if team_doc:
                self._team_by_channel[channel_id] = (team_doc, now)
            else:
                # Drop any stale entry.
                self._team_by_channel.pop(channel_id, None)

        if not team_doc:
            return ChannelTeamResolution(
                team_slug=None,
                team_id=None,
                team_name=None,
                deny_message=CHANNEL_NOT_MAPPED_TO_TEAM_MESSAGE,
            )

        slug = team_doc.get("slug")
        team_name = team_doc.get("name") or "(unnamed team)"
        team_id = str(team_doc.get("_id"))

        if not isinstance(slug, str) or not slug.strip():
            logger.error(
                "Team %s (id=%s) has no slug. "
                "Run the team-slug migration or repair the Mongo `teams.slug` field.",
                team_name,
                team_id,
            )
            return ChannelTeamResolution(
                team_slug=None,
                team_id=team_id,
                team_name=team_name,
                deny_message=TEAM_SETUP_INCOMPLETE_MESSAGE.format(surface="channel"),
            )

        return ChannelTeamResolution(
            team_slug=slug.strip(),
            team_id=team_id,
            team_name=team_name,
            deny_message=None,
        )


_default_resolver: Optional[ChannelTeamResolver] = None


def get_channel_team_resolver() -> ChannelTeamResolver:
    global _default_resolver
    if _default_resolver is None:
        _default_resolver = ChannelTeamResolver()
    return _default_resolver


async def resolve_channel_team(
    channel_id: Optional[str],
) -> ChannelTeamResolution:
    """Convenience wrapper around the default resolver instance."""
    if not channel_id:
        return ChannelTeamResolution(
            team_slug=None,
            team_id=None,
            team_name=None,
            deny_message=CHANNEL_NOT_MAPPED_TO_TEAM_MESSAGE,
        )
    return await get_channel_team_resolver().resolve(channel_id)


def is_dm_channel(channel_id: Optional[str]) -> bool:
    """Slack DM channel IDs start with ``D``. ``None``/empty → not a DM."""
    return bool(channel_id) and channel_id.startswith("D")
