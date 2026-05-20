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

from .obo_exchange import is_valid_team_slug
from .user_messages import TEAM_SETUP_INCOMPLETE_MESSAGE

logger = logging.getLogger("caipe.webex_bot.space_team_resolver")

SPACE_NOT_MAPPED_MESSAGE = (
    "This Webex space isn't assigned to a CAIPE team yet. "
    "Ask your admin to assign it in CAIPE Admin (Teams ▸ <team> ▸ Webex spaces)."
)

USER_NOT_IN_TEAM_MESSAGE_TMPL = (
    "You aren't a member of the team that owns this Webex space ({team_name}). "
    "Ask your team admin to add you."
)


@dataclass
class SpaceTeamResolution:
    team_slug: Optional[str]
    team_id: Optional[str]
    team_name: Optional[str]
    deny_message: Optional[str]


class WebexSpaceTeamResolver:
    """Resolve Webex space → team slug with membership gating."""

    def __init__(self, ttl_seconds: int = 60) -> None:
        self._team_by_space: dict[str, tuple[dict[str, Any], float]] = {}
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
            except PyMongoError as exc:
                logger.warning("WebexSpaceTeamResolver: MongoDB init failed: %s", exc)
                return None
        return self._client

    def _coll(self, name: str) -> Optional[Collection[Any]]:
        client = self._get_client()
        if not client:
            return None
        return client[self._db_name][name]

    def _load_space_team_sync(self, space_id: str) -> Optional[dict[str, Any]]:
        mappings = self._coll("webex_space_team_mappings")
        teams = self._coll("teams")
        if mappings is None or teams is None:
            return None
        try:
            mapping = mappings.find_one(
                {"webex_space_id": space_id, "active": {"$ne": False}}
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
            return team_doc
        except PyMongoError as exc:
            logger.warning("webex_space_team_mappings query failed: %s", exc)
            return None

    def invalidate(self, space_id: str) -> None:
        self._team_by_space.pop(space_id, None)
        for key in [k for k in self._membership if k[0] == space_id]:
            self._membership.pop(key, None)

    async def resolve(
        self,
        space_id: str,
        keycloak_user_id: str,
    ) -> SpaceTeamResolution:
        if not space_id:
            return SpaceTeamResolution(
                team_slug=None,
                team_id=None,
                team_name=None,
                deny_message=SPACE_NOT_MAPPED_MESSAGE,
            )

        now = time.monotonic()
        cached = self._team_by_space.get(space_id)
        team_doc: Optional[dict[str, Any]] = None
        if cached and now - cached[1] < self._ttl:
            team_doc = cached[0]
        else:
            team_doc = await asyncio.to_thread(self._load_space_team_sync, space_id)
            if team_doc:
                self._team_by_space[space_id] = (team_doc, now)
            else:
                self._team_by_space.pop(space_id, None)

        if not team_doc:
            return SpaceTeamResolution(
                team_slug=None,
                team_id=None,
                team_name=None,
                deny_message=SPACE_NOT_MAPPED_MESSAGE,
            )

        slug = team_doc.get("slug")
        team_name = team_doc.get("name") or "(unnamed team)"
        team_id = str(team_doc.get("_id"))

        if not isinstance(slug, str) or not slug.strip():
            logger.error(
                "Team %s (id=%s) has no slug; cannot mint active_team token",
                team_name,
                team_id,
            )
            return SpaceTeamResolution(
                team_slug=None,
                team_id=team_id,
                team_name=team_name,
                deny_message=TEAM_SETUP_INCOMPLETE_MESSAGE.format(surface="Webex space"),
            )

        slug_value = slug.strip()
        if not is_valid_team_slug(slug_value):
            logger.error(
                "Team %s (id=%s) has invalid slug=%r; refusing OBO scope",
                team_name,
                team_id,
                slug_value,
            )
            return SpaceTeamResolution(
                team_slug=None,
                team_id=team_id,
                team_name=team_name,
                deny_message=TEAM_SETUP_INCOMPLETE_MESSAGE.format(surface="Webex space"),
            )

        member_key = (space_id, keycloak_user_id)
        cached_member = self._membership.get(member_key)
        if cached_member and now - cached_member[1] < self._ttl:
            is_member = cached_member[0]
        else:
            is_member = await self._user_is_member(team_doc, keycloak_user_id)
            self._membership[member_key] = (is_member, now)

        if not is_member:
            return SpaceTeamResolution(
                team_slug=None,
                team_id=team_id,
                team_name=team_name,
                deny_message=USER_NOT_IN_TEAM_MESSAGE_TMPL.format(team_name=team_name),
            )

        return SpaceTeamResolution(
            team_slug=slug_value,
            team_id=team_id,
            team_name=team_name,
            deny_message=None,
        )

    @staticmethod
    async def _user_is_member(
        team_doc: dict[str, Any], keycloak_user_id: str
    ) -> bool:
        members = team_doc.get("members") or []
        if not isinstance(members, list):
            return False

        member_keys: set[str] = set()
        for member in members:
            if not isinstance(member, dict):
                continue
            uid = member.get("user_id")
            if isinstance(uid, str) and uid:
                member_keys.add(uid.lower())

        if not member_keys:
            return False

        if keycloak_user_id.lower() in member_keys:
            return True

        try:
            from .keycloak_admin import get_user_by_id

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


_default_resolver: Optional[WebexSpaceTeamResolver] = None


def get_webex_space_team_resolver() -> WebexSpaceTeamResolver:
    global _default_resolver
    if _default_resolver is None:
        _default_resolver = WebexSpaceTeamResolver()
    return _default_resolver


async def resolve_space_team(
    space_id: Optional[str],
    keycloak_user_id: str,
) -> SpaceTeamResolution:
    if not space_id:
        return SpaceTeamResolution(
            team_slug=None,
            team_id=None,
            team_name=None,
            deny_message=SPACE_NOT_MAPPED_MESSAGE,
        )
    return await get_webex_space_team_resolver().resolve(space_id, keycloak_user_id)
