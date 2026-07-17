"""Resolve a Webex space to its CAIPE team slug via ``webex_space_team_mappings``."""

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
logger = logging.getLogger("caipe.webex_bot.space_team_resolver")


def _app_name() -> str:
    return os.environ.get("WEBEX_INTEGRATION_APP_NAME") or os.environ.get("APP_NAME") or "CAIPE"


def _space_not_mapped_message() -> str:
    name = _app_name()
    return (
        f"This Webex space isn't assigned to a {name} team yet. "
        f"Ask your admin to assign it in the {name} Admin panel "
        "(Teams ▸ <team> ▸ Webex spaces)."
    )


SPACE_NOT_MAPPED_MESSAGE = _space_not_mapped_message()


@dataclass
class SpaceTeamResolution:
    team_slug: Optional[str]
    team_id: Optional[str]
    team_name: Optional[str]
    deny_message: Optional[str]
    bot_id: Optional[str] = None


class WebexSpaceTeamResolver:
    """Resolve Webex space → team slug (mapping only, no membership gate)."""

    def __init__(self, ttl_seconds: int = 60) -> None:
        self._team_by_space: dict[tuple[str, str], tuple[dict[str, Any], float]] = {}
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
            except PyMongoError as exc:
                logger.warning("WebexSpaceTeamResolver: MongoDB init failed: %s", exc)
                return None
        return self._client

    def _coll(self, name: str) -> Optional[Collection[Any]]:
        client = self._get_client()
        if not client:
            return None
        return client[self._db_name][name]

    def _load_space_team_sync(self, bot_id: str, space_id: str) -> Optional[dict[str, Any]]:
        mappings = self._coll("webex_space_team_mappings")
        teams = self._coll("teams")
        if mappings is None or teams is None:
            return None
        try:
            mapping = mappings.find_one({
                "bot_id": bot_id,
                "webex_space_id": space_id,
                "active": {"$ne": False},
            })
            if not mapping:
                return None
            team_id_str = mapping.get("team_id")
            if not isinstance(team_id_str, str) or not team_id_str.strip():
                return None
            try:
                team_oid = ObjectId(team_id_str.strip())
            except InvalidId:
                logger.warning(
                    "webex_space_team_mappings: space=%s has invalid team_id=%r",
                    space_id,
                    team_id_str,
                )
                return None
            team_doc = teams.find_one({"_id": team_oid})
            if not team_doc:
                logger.warning(
                    "webex_space_team_mappings: space=%s maps to missing team=%s",
                    space_id,
                    team_id_str,
                )
                return None
            return {
                "team": team_doc,
                "bot_id": str(mapping["bot_id"]).strip(),
            }
        except PyMongoError as exc:
            logger.warning("webex_space_team_mappings query failed: %s", exc)
            return None

    def invalidate(self, bot_id: str, space_id: str) -> None:
        self._team_by_space.pop((bot_id, space_id), None)

    async def resolve(self, bot_id: str, space_id: str) -> SpaceTeamResolution:
        """Resolve space → team metadata for routing and logging.

        User access (``can_use`` on an agent) is enforced downstream when the
        conversation is created — not via team membership on this resolver.
        """
        if not space_id:
            return SpaceTeamResolution(
                team_slug=None,
                team_id=None,
                team_name=None,
                deny_message=SPACE_NOT_MAPPED_MESSAGE,
            )

        now = time.monotonic()
        key = (bot_id, space_id)
        cached = self._team_by_space.get(key)
        resolved: Optional[dict[str, Any]] = None
        if cached and now - cached[1] < self._ttl:
            resolved = cached[0]
        else:
            resolved = await asyncio.to_thread(self._load_space_team_sync, bot_id, space_id)
            if resolved:
                self._team_by_space[key] = (resolved, now)
            else:
                self._team_by_space.pop(key, None)

        if not resolved:
            return SpaceTeamResolution(
                team_slug=None,
                team_id=None,
                team_name=None,
                deny_message=SPACE_NOT_MAPPED_MESSAGE,
            )

        team_doc = resolved["team"]
        bot_id = str(resolved.get("bot_id") or "").strip() or None
        slug = team_doc.get("slug")
        team_name = team_doc.get("name") or "(unnamed team)"
        team_id = str(team_doc.get("_id"))

        if not isinstance(slug, str) or not slug.strip():
            logger.error(
                "Team %s (id=%s) has no slug; cannot resolve space team metadata",
                team_name,
                team_id,
            )
            return SpaceTeamResolution(
                team_slug=None,
                team_id=team_id,
                team_name=team_name,
                deny_message=TEAM_SETUP_INCOMPLETE_MESSAGE.format(surface="Webex space"),
                bot_id=bot_id,
            )

        return SpaceTeamResolution(
            team_slug=slug.strip(),
            team_id=team_id,
            team_name=team_name,
            deny_message=None,
            bot_id=bot_id,
        )


_default_resolver: Optional[WebexSpaceTeamResolver] = None


def get_webex_space_team_resolver() -> WebexSpaceTeamResolver:
    global _default_resolver
    if _default_resolver is None:
        _default_resolver = WebexSpaceTeamResolver()
    return _default_resolver


async def resolve_space_team(bot_id: str, space_id: Optional[str]) -> SpaceTeamResolution:
    if not space_id:
        return SpaceTeamResolution(
            team_slug=None,
            team_id=None,
            team_name=None,
            deny_message=SPACE_NOT_MAPPED_MESSAGE,
        )
    return await get_webex_space_team_resolver().resolve(bot_id, space_id)
