"""Spec 104 — resolve a Slack channel to its CAIPE team slug.

Sits between :func:`channel_agent_mapper.resolve_channel_agent` and
:func:`obo_exchange.impersonate_user`. Maps:

  Slack channel ID
    ─→ ``channel_team_mappings.team_id`` (team Mongo ObjectId hex)
        ─→ ``teams._id`` document
            ─→ ``teams.slug`` (used as ``active_team`` in the OBO token)

We also verify that the requesting user is a member of that team — the
bot is the first of two RBAC checkpoints (the second is AGW CEL
evaluating ``team_member:<slug>`` against the JWT). Doing it here lets us
return a friendly "you're not in this team" message rather than letting
the request 403 silently downstream.

Uses an in-process TTL cache to avoid hammering Mongo on every Slack
event; the same cache invalidation strategy as :class:`ChannelAgentMapper`
applies (admins should restart bots after large team-membership changes
or rely on the 60s TTL).
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

logger = logging.getLogger("caipe.slack_bot.channel_team_resolver")


# Sentinel team slug used in OBO tokens for DM / personal interactions.
# MUST match `obo_exchange.PERSONAL_ACTIVE_TEAM` and the hardcoded value
# in the Keycloak `team-personal` client scope.
PERSONAL_ACTIVE_TEAM = "__personal__"


CHANNEL_NOT_MAPPED_TO_TEAM_MESSAGE = (
    "This channel isn't assigned to a CAIPE team yet. "
    "Ask your admin to assign it to a team in the CAIPE Admin panel "
    "(Teams ▸ <team> ▸ Slack channels)."
)

USER_NOT_IN_TEAM_MESSAGE_TMPL = (
    "You aren't a member of the team that owns this channel ({team_name}). "
    "Ask your team admin to add you, or move the conversation to a DM with the bot."
)


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
    """Resolve Slack channel → team slug with membership gating."""

    def __init__(self, ttl_seconds: int = 60) -> None:
        # Cache key: channel_id → (team doc, monotonic timestamp).
        self._team_by_channel: dict[str, tuple[dict[str, Any], float]] = {}
        # Cache key: (channel_id, kc_user_id) → (allowed?, monotonic ts).
        self._membership: dict[tuple[str, str], tuple[bool, float]] = {}
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
        # Also drop any membership cache entries for this channel.
        for key in [k for k in self._membership if k[0] == channel_id]:
            self._membership.pop(key, None)

    async def resolve(
        self,
        channel_id: str,
        keycloak_user_id: str,
    ) -> ChannelTeamResolution:
        """Resolve channel → team_slug, gated on user membership.

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
            # Team predates Spec 104 and the BFF startup auto-sync hasn't
            # backfilled a slug yet. Fail loud — the bot can't mint a
            # token-exchange scope without a slug.
            logger.error(
                "Team %s (id=%s) has no slug; cannot mint active_team token. "
                "Restart caipe-ui to trigger the team-scope auto-sync.",
                team_name,
                team_id,
            )
            return ChannelTeamResolution(
                team_slug=None,
                team_id=team_id,
                team_name=team_name,
                deny_message=(
                    f"Team {team_name!r} is not fully provisioned yet "
                    f"(missing slug). Ask your admin to retry."
                ),
            )

        # Membership pre-check: bot is the first checkpoint, AGW CEL is the
        # second. Doing it here lets us return a friendlier message instead
        # of a 403 from AGW.
        member_key = (channel_id, keycloak_user_id)
        cached_member = self._membership.get(member_key)
        if cached_member and now - cached_member[1] < self._ttl:
            is_member = cached_member[0]
        else:
            is_member = await self._user_is_member(team_doc, keycloak_user_id)
            self._membership[member_key] = (is_member, now)

        if not is_member:
            return ChannelTeamResolution(
                team_slug=None,
                team_id=team_id,
                team_name=team_name,
                deny_message=USER_NOT_IN_TEAM_MESSAGE_TMPL.format(team_name=team_name),
            )

        return ChannelTeamResolution(
            team_slug=slug.strip(),
            team_id=team_id,
            team_name=team_name,
            deny_message=None,
        )

    @staticmethod
    async def _user_is_member(
        team_doc: dict[str, Any], keycloak_user_id: str
    ) -> bool:
        """Return True if ``keycloak_user_id`` is in the team's member list.

        Team members are stored by *email* in the BFF (see
        ``CreateTeamRequest`` in `ui/src/types/teams.ts`), but the Slack bot
        knows the user only by their Keycloak ``sub`` UUID. We try the UUID
        form first (free, no extra HTTP); if that misses, we resolve the
        UUID → email via Keycloak Admin API and try again. This lets the
        resolver work whether admins use email- or UUID-keyed membership
        lists, including the common case where the BFF's team CRUD writes
        emails.
        """
        members = team_doc.get("members") or []
        if not isinstance(members, list):
            return False

        member_keys: set[str] = set()
        for m in members:
            if not isinstance(m, dict):
                continue
            uid = m.get("user_id")
            if isinstance(uid, str) and uid:
                member_keys.add(uid.lower())

        if not member_keys:
            return False

        if keycloak_user_id.lower() in member_keys:
            return True

        # Fall back to the user's email — the common BFF-writes-email case.
        # Best-effort: any KC Admin failure returns False (the request will
        # be denied with the standard "not in team" message, which is the
        # safe default).
        try:
            from utils.keycloak_admin import get_user_by_id

            user = await get_user_by_id(keycloak_user_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Could not look up Keycloak user %s for membership check: %s",
                keycloak_user_id,
                exc,
            )
            return False

        if not user:
            return False
        email = user.get("email")
        if isinstance(email, str) and email.lower() in member_keys:
            return True
        username = user.get("username")
        if isinstance(username, str) and username.lower() in member_keys:
            return True
        return False


_default_resolver: Optional[ChannelTeamResolver] = None


def get_channel_team_resolver() -> ChannelTeamResolver:
    global _default_resolver
    if _default_resolver is None:
        _default_resolver = ChannelTeamResolver()
    return _default_resolver


async def resolve_channel_team(
    channel_id: Optional[str],
    keycloak_user_id: str,
) -> ChannelTeamResolution:
    """Convenience wrapper around the default resolver instance."""
    if not channel_id:
        return ChannelTeamResolution(
            team_slug=None,
            team_id=None,
            team_name=None,
            deny_message=CHANNEL_NOT_MAPPED_TO_TEAM_MESSAGE,
        )
    return await get_channel_team_resolver().resolve(channel_id, keycloak_user_id)


def is_dm_channel(channel_id: Optional[str]) -> bool:
    """Slack DM channel IDs start with ``D``. ``None``/empty → not a DM."""
    return bool(channel_id) and channel_id.startswith("D")
