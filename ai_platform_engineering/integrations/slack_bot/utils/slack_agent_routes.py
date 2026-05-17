"""Optional Mongo-backed Slack channel agent routes.

Static Slack bot config remains the default route source. This resolver is
enabled only when operators opt in while the UI-managed route feature stabilizes.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Callable, Literal, Optional

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import PyMongoError
from pydantic import ValidationError

from .config_models import AgentBinding, BotsConfig, EscalationConfig, UsersConfig

logger = logging.getLogger("caipe.slack_bot.slack_agent_routes")

SlackAgentRouteMode = Literal["config", "db_prefer", "db_only"]
CollectionFactory = Callable[[], Optional[Collection[Any]]]


def slack_agent_route_mode() -> SlackAgentRouteMode:
    """Return how Slack should source channel agent routes.

    Modes:
    - ``config``: use static YAML/env config only. This is the default.
    - ``db_prefer``: use active Mongo routes when present, otherwise fall back to config.
    - ``db_only``: use active Mongo routes only.

    ``SLACK_AGENT_ROUTES_ENABLED=true`` is accepted as an early rollout alias for
    ``db_prefer``.
    """

    explicit = os.environ.get("SLACK_AGENT_ROUTES_MODE", "").strip().lower()
    if explicit in {"config", "db_prefer", "db_only"}:
        return explicit  # type: ignore[return-value]
    if os.environ.get("SLACK_AGENT_ROUTES_ENABLED", "false").lower() == "true":
        return "db_prefer"
    return "config"


def slack_workspace_ref(team_id: Optional[str] = None) -> str:
    """Return the canonical workspace reference used by Slack ReBAC.

    Deployments may configure a human-readable alias (for example, ``CAIPE``)
    that becomes the stable workspace namespace for UI-managed Slack channel
    routes and OpenFGA subjects. Slack's incoming ``team_id`` remains useful
    runtime metadata, but policy lookups use the alias when it is configured.
    """

    alias = os.environ.get("SLACK_WORKSPACE_ALIAS", "").strip()
    if alias:
        return alias
    if team_id and team_id.strip():
        return team_id.strip()
    fallback = os.environ.get("SLACK_WORKSPACE_ID", "").strip()
    return fallback or "unknown"


class SlackAgentRouteResolver:
    """Load and match UI-managed Slack agent routes from MongoDB."""

    def __init__(
        self,
        *,
        ttl_seconds: Optional[int] = None,
        collection_factory: Optional[CollectionFactory] = None,
    ) -> None:
        self._ttl = ttl_seconds if ttl_seconds is not None else _ttl_from_env()
        self._collection_factory = collection_factory
        self._client: Optional[MongoClient] = None
        self._db_name = os.environ.get("MONGODB_DATABASE", "caipe")
        self._cache: dict[tuple[str, str], tuple[list[dict[str, Any]], float]] = {}

    def _get_collection(self) -> Optional[Collection[Any]]:
        if self._collection_factory is not None:
            return self._collection_factory()

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
                logger.warning("SlackAgentRouteResolver: MongoDB client init failed: %s", exc)
                return None
        return self._client[self._db_name]["slack_channel_agent_routes"]

    def _load_routes(self, workspace_id: str, channel_id: str) -> list[dict[str, Any]]:
        collection = self._get_collection()
        if collection is None:
            return []

        try:
            routes = self._query_routes(collection, workspace_id, channel_id)
            if routes or workspace_id == "unknown":
                return routes
            return self._query_routes(collection, "unknown", channel_id)
        except PyMongoError as exc:
            logger.warning("SlackAgentRouteResolver: route query failed: %s", exc)
            return []

    def _query_routes(
        self,
        collection: Collection[Any],
        workspace_id: str,
        channel_id: str,
    ) -> list[dict[str, Any]]:
        cursor = collection.find(
            {
                "workspace_id": workspace_id,
                "channel_id": channel_id,
                "status": "active",
                "enabled": {"$ne": False},
            }
        ).sort([("priority", 1), ("agent_id", 1)])
        if hasattr(cursor, "to_list"):
            return list(cursor.to_list())  # type: ignore[no-any-return, operator]
        return list(cursor)

    def _cached_routes(self, workspace_id: str, channel_id: str) -> list[dict[str, Any]]:
        now = time.monotonic()
        key = (workspace_id, channel_id)
        cached = self._cache.get(key)
        if cached and now - cached[1] < self._ttl:
            return cached[0]

        routes = self._load_routes(workspace_id, channel_id)
        self._cache[key] = (routes, now)
        return routes

    def match_routes(
        self,
        *,
        workspace_id: str,
        channel_id: str,
        is_bot: bool,
        bot_username: Optional[str] = None,
        user_id: Optional[str] = None,
        listen: Optional[str] = None,
    ) -> list[AgentBinding]:
        """Return active DB route matches as ``AgentBinding`` objects."""

        matches: list[AgentBinding] = []
        for route in self._cached_routes(workspace_id, channel_id):
            binding = _route_to_agent_binding(route)
            if binding is None:
                continue
            if is_bot:
                if _side_matches(binding.bots, listen, bot_username, "bot_list"):
                    matches.append(binding)
            elif _side_matches(binding.users, listen, user_id, "user_list"):
                matches.append(binding)
        return matches

    def invalidate(self, workspace_id: str, channel_id: str) -> None:
        """Drop cached routes for a channel."""

        self._cache.pop((workspace_id, channel_id), None)


def _ttl_from_env() -> int:
    try:
        return max(0, int(os.environ.get("SLACK_AGENT_ROUTES_TTL_SECONDS", "60")))
    except ValueError:
        return 60


def _side_matches(
    side: UsersConfig | BotsConfig | None,
    listen: Optional[str],
    actor_id: Optional[str],
    list_field: Literal["user_list", "bot_list"],
) -> bool:
    if side is None or not side.enabled:
        return False
    if listen and side.listen not in ("all", listen):
        return False
    allowed_ids = getattr(side, list_field, None)
    if allowed_ids is not None and actor_id not in allowed_ids:
        return False
    return True


def _route_to_agent_binding(route: dict[str, Any]) -> AgentBinding | None:
    agent_id = route.get("agent_id")
    if not isinstance(agent_id, str) or not agent_id.strip():
        return None

    try:
        return AgentBinding(
            agent_id=agent_id.strip(),
            users=UsersConfig(**route["users"]) if isinstance(route.get("users"), dict) else None,
            bots=BotsConfig(**route["bots"]) if isinstance(route.get("bots"), dict) else None,
            escalation=(
                EscalationConfig(**route["escalation"])
                if isinstance(route.get("escalation"), dict)
                else None
            ),
        )
    except ValidationError as exc:
        logger.warning("SlackAgentRouteResolver: invalid route for agent=%s: %s", agent_id, exc)
        return None


_default_resolver: Optional[SlackAgentRouteResolver] = None


def get_slack_agent_route_resolver() -> SlackAgentRouteResolver:
    """Return the process-wide Slack route resolver."""

    global _default_resolver
    if _default_resolver is None:
        _default_resolver = SlackAgentRouteResolver()
    return _default_resolver
