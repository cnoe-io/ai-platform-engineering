"""Deployment-scoped access and agent routing for Webex direct messages."""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal, Optional

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import PyMongoError

from .keycloak_admin import get_user_by_email

logger = logging.getLogger("caipe.webex_bot.webex_direct_users")

WebexDmAccessMode = Literal["disabled", "allowlist", "all_users"]
CollectionFactory = Callable[[], Optional[Collection[Any]]]
UserByEmail = Callable[[str], Awaitable[Optional[dict[str, Any]]]]


@dataclass(frozen=True)
class WebexDirectUserAccess:
    allowed: bool
    keycloak_user_id: Optional[str]
    agent_id: Optional[str]
    reason: str


def webex_dm_access_mode() -> WebexDmAccessMode:
    value = os.environ.get("WEBEX_DM_ACCESS_MODE", "disabled").strip().lower()
    if value in {"disabled", "allowlist", "all_users"}:
        return value  # type: ignore[return-value]
    logger.error("Invalid WEBEX_DM_ACCESS_MODE=%r; disabling direct messages", value)
    return "disabled"


class WebexDirectUserResolver:
    """Resolve DM admission and the allowlist-selected agent, when applicable."""

    def __init__(
        self,
        *,
        collection_factory: CollectionFactory | None = None,
        user_by_email: UserByEmail = get_user_by_email,
    ) -> None:
        self._collection_factory = collection_factory
        self._user_by_email = user_by_email
        self._client: MongoClient | None = None
        self._db_name = os.environ.get("MONGODB_DATABASE", "caipe")

    def _collection(self) -> Collection[Any] | None:
        if self._collection_factory is not None:
            return self._collection_factory()
        uri = os.environ.get("MONGODB_URI", "").strip()
        if not uri:
            return None
        if self._client is None:
            self._client = MongoClient(
                uri,
                serverSelectionTimeoutMS=5000,
                retryWrites=False,
            )
        return self._client[self._db_name]["webex_direct_user_routes"]

    def _route(
        self,
        *,
        bot_id: str,
        webex_user_id: str,
        person_email: str,
    ) -> dict[str, Any] | None:
        collection = self._collection()
        if collection is None:
            return None
        base = {
            "bot_id": bot_id,
            "status": "active",
        }
        try:
            route = collection.find_one({**base, "webex_user_id": webex_user_id})
            if route is None and person_email:
                route = collection.find_one(
                    {**base, "expected_webex_email": person_email}
                )
            return route
        except PyMongoError as exc:
            logger.warning(
                "Webex direct-user route lookup failed (type=%s)",
                type(exc).__name__,
            )
            return None

    async def resolve(
        self,
        *,
        bot_id: str,
        webex_user_id: str,
        person_email: str | None,
    ) -> WebexDirectUserAccess:
        mode = webex_dm_access_mode()
        if mode == "disabled":
            return WebexDirectUserAccess(False, None, None, "disabled")

        email = (person_email or "").strip().lower()
        if mode == "allowlist":
            route_args = {
                "bot_id": bot_id,
                "webex_user_id": webex_user_id,
                "person_email": email,
            }
            route = (
                self._route(**route_args)
                if self._collection_factory is not None
                else await asyncio.to_thread(self._route, **route_args)
            )
            if route is not None:
                keycloak_user_id = str(route.get("keycloak_user_id") or "").strip()
                agent_id = str(route.get("agent_id") or "").strip()
                if keycloak_user_id and agent_id:
                    return WebexDirectUserAccess(
                        True,
                        keycloak_user_id,
                        agent_id,
                        "allowlist_route",
                    )
            return WebexDirectUserAccess(False, None, None, "not_onboarded")

        if not email:
            return WebexDirectUserAccess(False, None, None, "email_missing")
        try:
            user = await self._user_by_email(email)
        except Exception as exc:  # noqa: BLE001 - identity lookup fails closed
            logger.warning(
                "Webex direct-user deployment lookup failed (type=%s)",
                type(exc).__name__,
            )
            return WebexDirectUserAccess(False, None, None, "directory_unavailable")
        if not user or user.get("enabled") is False:
            return WebexDirectUserAccess(False, None, None, "not_deployment_user")

        user_id = str(user.get("id") or "").strip()
        if not user_id:
            return WebexDirectUserAccess(False, None, None, "user_id_missing")
        return WebexDirectUserAccess(True, user_id, None, "all_users")
