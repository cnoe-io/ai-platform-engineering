"""Optional Mongo-backed Slack channel agent routes.

Static Slack bot config remains the default route source. This resolver is
enabled only when operators opt in while the UI-managed route feature stabilizes.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Literal, Optional

import requests
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import PyMongoError
from pydantic import ValidationError

from .config_models import AgentBinding, BotsConfig, EscalationConfig, UsersConfig

logger = logging.getLogger("caipe.slack_bot.slack_agent_routes")
DEFAULT_OPENFGA_HTTP = "http://openfga:8080"

SlackAgentRouteMode = Literal["config", "db_prefer", "db_only"]
CollectionFactory = Callable[[], Optional[Collection[Any]]]
AuditCollectionFactory = Callable[[], Optional[Collection[Any]]]
OpenFgaAgentIdsFactory = Callable[[str, str], list[str]]


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
    """Load OpenFGA-backed Slack agent routes with optional Mongo metadata."""

    def __init__(
        self,
        *,
        ttl_seconds: Optional[int] = None,
        collection_factory: Optional[CollectionFactory] = None,
        audit_collection_factory: Optional[AuditCollectionFactory] = None,
        openfga_agent_ids_factory: Optional[OpenFgaAgentIdsFactory] = None,
    ) -> None:
        self._ttl = ttl_seconds if ttl_seconds is not None else _ttl_from_env()
        self._collection_factory = collection_factory
        self._audit_collection_factory = audit_collection_factory
        self._openfga_agent_ids_factory = openfga_agent_ids_factory
        self._client: Optional[MongoClient] = None
        self._db_name = os.environ.get("MONGODB_DATABASE", "caipe")
        self._cache: dict[tuple[str, str], tuple[list[dict[str, Any]], float]] = {}
        self._last_errors: dict[tuple[str, str], str] = {}

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
                logger.warning("SlackAgentRouteResolver: MongoDB client init failed: %s", exc)
                return None
        return self._client

    def _get_collection(self) -> Optional[Collection[Any]]:
        if self._collection_factory is not None:
            return self._collection_factory()

        client = self._get_client()
        if client is None:
            return None
        return client[self._db_name]["slack_channel_agent_routes"]

    def _get_audit_collection(self) -> Optional[Collection[Any]]:
        if self._audit_collection_factory is not None:
            return self._audit_collection_factory()

        client = self._get_client()
        if client is None:
            return None
        return client[self._db_name]["audit_events"]

    def _record_runtime_error(
        self,
        *,
        workspace_id: str,
        channel_id: str,
        reason_code: str,
        action: str,
        message: str,
    ) -> None:
        collection = self._get_audit_collection()
        if collection is None:
            return
        try:
            collection.insert_one(
                {
                    "type": "slack_runtime",
                    "component": "slack_bot",
                    "outcome": "error",
                    "action": action,
                    "reason_code": reason_code,
                    "resource_ref": f"slack_channel:{slack_workspace_ref(workspace_id)}--{channel_id}",
                    "message": message,
                    "ts": datetime.now(timezone.utc).isoformat(),
                }
            )
        except PyMongoError as exc:
            logger.warning("SlackAgentRouteResolver: failed to write runtime audit event: %s", exc)

    def _load_routes(self, workspace_id: str, channel_id: str) -> list[dict[str, Any]]:
        agent_ids = self._load_openfga_agent_ids(workspace_id, channel_id)
        if agent_ids is None:
            return []
        if not agent_ids and workspace_id != "unknown":
            agent_ids = self._load_openfga_agent_ids("unknown", channel_id)
            if agent_ids is None:
                return []
        if not agent_ids:
            return []

        collection = self._get_collection()
        if collection is None:
            return [_default_route(agent_id) for agent_id in agent_ids]

        try:
            routes = self._query_routes(collection, workspace_id, channel_id)
            if not routes and workspace_id != "unknown":
                routes = self._query_routes(collection, "unknown", channel_id)
            return _merge_openfga_agents_with_route_metadata(agent_ids, routes)
        except PyMongoError as exc:
            logger.warning("SlackAgentRouteResolver: route query failed: %s", exc)
            return [_default_route(agent_id) for agent_id in agent_ids]

    def _load_openfga_agent_ids(self, workspace_id: str, channel_id: str) -> list[str] | None:
        if self._openfga_agent_ids_factory is not None:
            return self._openfga_agent_ids_factory(workspace_id, channel_id)

        base_url = (os.environ.get("OPENFGA_HTTP", "").strip() or DEFAULT_OPENFGA_HTTP).rstrip("/")

        try:
            store_id = _openfga_store_id(base_url)
            workspace_ref = slack_workspace_ref(workspace_id)
            agent_ids: list[str] = []
            seen: set[str] = set()
            continuation_token: str | None = None
            while True:
                channel_subject = f"slack_channel:{workspace_ref}--{channel_id}"
                body: dict[str, Any] = {"page_size": 100}
                if continuation_token:
                    body["continuation_token"] = continuation_token
                response = requests.post(
                    f"{base_url}/stores/{store_id}/read",
                    headers={"Content-Type": "application/json"},
                    json=body,
                    timeout=5,
                )
                response.raise_for_status()
                payload = response.json()
                for agent_id in _agent_ids_from_openfga_read(payload, channel_subject):
                    if agent_id not in seen:
                        seen.add(agent_id)
                        agent_ids.append(agent_id)
                continuation_token = payload.get("continuation_token") or None
                if not continuation_token:
                    self._last_errors.pop((workspace_id, channel_id), None)
                    return agent_ids
        except requests.RequestException as exc:
            logger.warning("SlackAgentRouteResolver: OpenFGA tuple read failed: %s", exc)
            self._last_errors[(workspace_id, channel_id)] = str(exc)
            self._record_runtime_error(
                workspace_id=workspace_id,
                channel_id=channel_id,
                action="slack.route.openfga_read",
                reason_code="OPENFGA_READ_FAILED",
                message=str(exc),
            )
            return None

    def last_error(self, workspace_id: str, channel_id: str) -> str | None:
        """Return the latest route-loading error for a channel, if any."""

        return self._last_errors.get((workspace_id, channel_id))

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

    def explain_no_route_match(
        self,
        *,
        workspace_id: str,
        channel_id: str,
        is_bot: bool,
        bot_username: Optional[str] = None,
        user_id: Optional[str] = None,
        listen: Optional[str] = None,
        app_name: str = "CAIPE",
        route_required: bool = False,
    ) -> str | None:
        """Return a user-facing explanation when a routed Slack message has no match."""

        if self.last_error(workspace_id, channel_id):
            return (
                f"{app_name} could not read Slack routing relationships from OpenFGA, "
                "so I cannot safely dispatch this message. Please try again shortly "
                "or ask an admin to check Slack Runtime Diagnostics."
            )

        candidates = self.match_routes(
            workspace_id=workspace_id,
            channel_id=channel_id,
            is_bot=is_bot,
            bot_username=bot_username,
            user_id=user_id,
            listen=None,
        )
        if self.last_error(workspace_id, channel_id):
            return (
                f"{app_name} could not read Slack routing relationships from OpenFGA, "
                "so I cannot safely dispatch this message. Please try again shortly "
                "or ask an admin to check Slack Runtime Diagnostics."
            )
        if candidates and listen == "message":
            return (
                f"This Slack channel has {app_name} agent routes, but none are configured "
                f"to listen to plain channel messages. Mention @{app_name}, or set the route "
                "Listen mode to `message` or `all` in Admin > OpenFGA ReBAC > Slack Channels."
            )
        if candidates and listen == "mention":
            return (
                f"This Slack channel has {app_name} agent routes, but none are configured "
                "to listen to mentions. Set the route Listen mode to `mention` or `all` "
                "in Admin > OpenFGA ReBAC > Slack Channels."
            )
        if route_required:
            return (
                "No OpenFGA channel-agent association is configured for this Slack channel. "
                "Ask an admin to add one in Admin > OpenFGA ReBAC > Slack Channels."
            )
        return None

    def invalidate(self, workspace_id: str, channel_id: str) -> None:
        """Drop cached routes for a channel."""

        self._cache.pop((workspace_id, channel_id), None)

    def invalidate_all(self) -> None:
        """Drop all cached Slack route decisions."""

        self._cache.clear()

    def cache_status(self) -> dict[str, Any]:
        """Return route-cache status for admin diagnostics."""

        return {
            "ttl_seconds": self._ttl,
            "cache_size": len(self._cache),
            "cached_channels": [f"{workspace_id}/{channel_id}" for workspace_id, channel_id in self._cache],
            "last_errors": {
                f"{workspace_id}/{channel_id}": error
                for (workspace_id, channel_id), error in self._last_errors.items()
            },
        }


def _ttl_from_env() -> int:
    try:
        return max(0, int(os.environ.get("SLACK_AGENT_ROUTES_TTL_SECONDS", "60")))
    except ValueError:
        return 60


def _openfga_store_id(base_url: str) -> str:
    explicit = os.environ.get("OPENFGA_STORE_ID", "").strip()
    if explicit:
        return explicit

    store_name = os.environ.get("OPENFGA_STORE_NAME", "caipe-openfga").strip()
    response = requests.get(f"{base_url}/stores", headers={"Content-Type": "application/json"}, timeout=5)
    response.raise_for_status()
    for store in response.json().get("stores", []):
        if store.get("name") == store_name and store.get("id"):
            return str(store["id"])
    raise requests.RequestException(f"OpenFGA store {store_name!r} was not found")


def _agent_ids_from_openfga_read(payload: dict[str, Any], channel_subject: str) -> list[str]:
    agent_ids: list[str] = []
    seen: set[str] = set()
    for tuple_row in payload.get("tuples", []):
        key = tuple_row.get("key") if isinstance(tuple_row, dict) else None
        if not isinstance(key, dict):
            continue
        if key.get("user") != channel_subject or key.get("relation") != "user":
            continue
        object_id = key.get("object") if isinstance(key, dict) else None
        if not isinstance(object_id, str) or not object_id.startswith("agent:"):
            continue
        agent_id = object_id.removeprefix("agent:").strip()
        if agent_id and agent_id not in seen:
            seen.add(agent_id)
            agent_ids.append(agent_id)
    return agent_ids


def _default_route(agent_id: str) -> dict[str, Any]:
    return {
        "agent_id": agent_id,
        "enabled": True,
        "priority": 100,
        "status": "active",
        "users": {"enabled": True, "listen": "mention"},
    }


def _merge_openfga_agents_with_route_metadata(
    agent_ids: list[str],
    routes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    metadata_by_agent_id = {
        route["agent_id"]: route
        for route in routes
        if isinstance(route.get("agent_id"), str) and route["agent_id"] in agent_ids
    }
    merged = [metadata_by_agent_id.get(agent_id, _default_route(agent_id)) for agent_id in agent_ids]
    return sorted(merged, key=lambda route: (route.get("priority", 100), route.get("agent_id", "")))


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
