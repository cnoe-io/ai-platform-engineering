"""Opt-in Webex space auto-assignment for first-message onboarding."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from urllib.parse import quote

import requests
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import PyMongoError

from .webex_bot_catalog import configured_webex_bot
from .webex_agent_routes import (
    DEFAULT_OPENFGA_HTTP,
    webex_bot_installation_openfga_subject,
    webex_space_openfga_subject,
    webex_workspace_ref,
)
from .webex_ids import public_webex_room_id_from_uuid

logger = logging.getLogger("caipe.webex_bot.webex_space_auto_assign")

CollectionFactory = Callable[[str], Optional[Collection[Any]]]
OpenFgaWriter = Callable[[dict[str, str]], None]
OpenFgaDeleter = Callable[[dict[str, str]], None]
RequestGet = Callable[..., requests.Response]


@dataclass(frozen=True)
class WebexSpaceAutoAssignResult:
    """Outcome of an auto-assignment attempt."""

    assigned: bool
    reason: str
    team_slug: str | None = None
    agent_id: str | None = None
    team_id: str | None = None


class WebexSpaceAutoAssigner:
    """Create explicit team + agent relationships for unmapped Webex spaces when enabled."""

    def __init__(
        self,
        *,
        collection_factory: CollectionFactory | None = None,
        openfga_writer: OpenFgaWriter | None = None,
        openfga_deleter: OpenFgaDeleter | None = None,
        webex_request_get: RequestGet = requests.get,
    ) -> None:
        self._collection_factory = collection_factory
        self._openfga_writer = openfga_writer
        self._openfga_deleter = openfga_deleter
        self._webex_request_get = webex_request_get
        self._client: Optional[MongoClient] = None
        self._db_name = os.environ.get("MONGODB_DATABASE", "caipe")

    def _get_client(self) -> Optional[MongoClient]:
        uri = os.environ.get("MONGODB_URI", "").strip()
        if not uri:
            return None
        if self._client is None:
            try:
                self._client = MongoClient(uri, serverSelectionTimeoutMS=5000, retryWrites=False)
            except PyMongoError as exc:
                logger.warning("WebexSpaceAutoAssigner: MongoDB client init failed: %s", exc)
                return None
        return self._client

    def _collection(self, name: str) -> Optional[Collection[Any]]:
        if self._collection_factory is not None:
            return self._collection_factory(name)
        client = self._get_client()
        if client is None:
            return None
        return client[self._db_name][name]

    @staticmethod
    def _enabled_config(bot_id: str) -> tuple[bool, str, str]:
        bot = configured_webex_bot(bot_id)
        if bot is None or bot.spaces_access_mode != "all_spaces":
            return False, "", ""
        return (
            True,
            bot.spaces.default_team_slug or "",
            bot.spaces.default_agent_id or "",
        )

    def _space_display_name(
        self,
        *,
        bot_id: str,
        space_id: str,
        space_title: str | None,
    ) -> str:
        explicit_title = (space_title or "").strip()
        if explicit_title:
            return explicit_title

        bot = configured_webex_bot(bot_id)
        token = os.environ.get(bot.token_env, "").strip() if bot else ""
        if not token:
            return space_id

        room_id = public_webex_room_id_from_uuid(space_id)
        try:
            response = self._webex_request_get(
                f"https://webexapis.com/v1/rooms/{quote(room_id, safe='')}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15,
            )
            response.raise_for_status()
            payload = response.json()
            title = str(payload.get("title") or "").strip() if isinstance(payload, dict) else ""
            return title or space_id
        except (requests.RequestException, ValueError) as exc:
            logger.warning(
                "Unable to resolve Webex space title bot=%s space=%s: %s",
                bot_id,
                space_id,
                exc,
            )
            return space_id

    def assign_space(
        self,
        *,
        bot_id: str,
        workspace_id: str,
        space_id: str,
        space_title: str | None = None,
    ) -> WebexSpaceAutoAssignResult:
        """Assign an unmapped Webex space to the configured team and agent.

        Fail-closed: disabled/misconfigured dependencies return non-assigned results.
        Writes are auditable via ``source_type`` and ``created_by`` fields.
        """

        enabled, team_slug, agent_id = self._enabled_config(bot_id)
        if not enabled:
            return WebexSpaceAutoAssignResult(False, "disabled")

        mappings = self._collection("webex_space_team_mappings")
        teams = self._collection("teams")
        routes = self._collection("webex_space_agent_routes")
        if mappings is None or teams is None or routes is None:
            return WebexSpaceAutoAssignResult(False, "mongo_unavailable")

        existing = mappings.find_one({
            "bot_id": bot_id,
            "webex_space_id": space_id,
            "active": {"$ne": False},
        })
        if existing:
            return WebexSpaceAutoAssignResult(False, "existing_mapping")

        team = teams.find_one({"slug": team_slug})
        if not team:
            return WebexSpaceAutoAssignResult(False, "default_team_missing", team_slug=team_slug)

        team_id = str(team.get("_id"))
        workspace_ref = webex_workspace_ref(workspace_id)
        mapping_id = json.dumps(
            [bot_id, workspace_ref, space_id], separators=(",", ":")
        )
        now = datetime.now(timezone.utc).isoformat()
        display_name = self._space_display_name(
            bot_id=bot_id,
            space_id=space_id,
            space_title=space_title,
        )

        installation = webex_bot_installation_openfga_subject(
            bot_id, workspace_id, space_id
        )
        tuple_keys = [
            {
                "user": f"team:{team_slug}#admin",
                "relation": "manager",
                "object": f"webex_space:{workspace_ref}--{space_id}",
            },
            {
                "user": f"team:{team_slug}#member",
                "relation": "user",
                "object": f"webex_space:{workspace_ref}--{space_id}",
            },
            {
                "user": f"webex_bot:{bot_id}",
                "relation": "bot",
                "object": installation,
            },
            {
                "user": webex_space_openfga_subject(workspace_id, space_id),
                "relation": "space",
                "object": installation,
            },
            {
                "user": installation,
                "relation": "user",
                "object": f"agent:{agent_id}",
            },
        ]
        route_filter = {"_id": mapping_id}
        route_key = {
            "bot_id": bot_id,
            "workspace_id": workspace_ref,
            "space_id": space_id,
        }
        routes_written = False
        mapping_written = False
        try:
            routes.update_one(
                route_filter,
                {
                    "$set": {
                        **route_key,
                        "agent_id": agent_id,
                        "enabled": True,
                        "priority": 100,
                        "users": {"enabled": True, "listen": "mention"},
                        "source_type": "auto",
                        "status": "active",
                        "created_by": "webex_auto_assign",
                        "created_at": now,
                        "updated_by": "webex_auto_assign",
                        "updated_at": now,
                    }
                },
                upsert=True,
            )
            routes_written = True
            mappings.update_one(
                {"_id": mapping_id},
                {
                    "$set": {
                        "bot_id": bot_id,
                        "webex_workspace_id": workspace_ref,
                        "webex_space_id": space_id,
                        "space_name": display_name,
                        "space_title": display_name,
                        "team_id": team_id,
                        "team_slug": team_slug,
                        "active": True,
                        "source_type": "webex_auto_assign",
                        "updated_at": now,
                    },
                    "$setOnInsert": {
                        "created_at": now,
                        "created_by": "webex_auto_assign",
                    },
                },
                upsert=True,
            )
            mapping_written = True
            # The tuple writer is independently idempotent and compensates any
            # successful writes if a later tuple fails.
            self._write_openfga_tuples(tuple_keys)
            routes.delete_many({**route_key, "_id": {"$ne": mapping_id}})
        except (PyMongoError, requests.RequestException) as exc:
            logger.warning("Webex space auto-assignment failed for space=%s: %s", space_id, exc)
            if mapping_written:
                mappings.delete_one({"_id": mapping_id})
            if routes_written:
                routes.delete_one(route_filter)
            return WebexSpaceAutoAssignResult(False, "write_failed")

        logger.info(
            "Auto-assigned Webex space=%s workspace=%s to team=%s default_agent=%s",
            space_id,
            workspace_ref,
            team_slug,
            agent_id,
        )
        return WebexSpaceAutoAssignResult(
            True,
            "assigned",
            team_slug=team_slug,
            agent_id=agent_id,
            team_id=team_id,
        )

    def ensure_space_agent_grant(
        self,
        *,
        bot_id: str,
        workspace_id: str,
        space_id: str,
        agent_id: str,
        team_slug: str | None = None,
    ) -> bool:
        """Idempotently repair the OpenFGA grants for an existing assignment."""

        workspace_ref = webex_workspace_ref(workspace_id)
        installation = webex_bot_installation_openfga_subject(
            bot_id, workspace_ref, space_id
        )
        tuple_keys: list[dict[str, str]] = []
        if team_slug:
            tuple_keys.extend(
                [
                    {
                        "user": f"team:{team_slug}#admin",
                        "relation": "manager",
                        "object": f"webex_space:{workspace_ref}--{space_id}",
                    },
                    {
                        "user": f"team:{team_slug}#member",
                        "relation": "user",
                        "object": f"webex_space:{workspace_ref}--{space_id}",
                    },
                ]
            )
        tuple_keys.extend(
            [
                {
                    "user": f"webex_bot:{bot_id}",
                    "relation": "bot",
                    "object": installation,
                },
                {
                    "user": webex_space_openfga_subject(workspace_ref, space_id),
                    "relation": "space",
                    "object": installation,
                },
                {
                    "user": installation,
                    "relation": "user",
                    "object": f"agent:{agent_id}",
                },
            ]
        )
        try:
            self._write_openfga_tuples(tuple_keys)
            return True
        except requests.RequestException as exc:
            logger.warning(
                "Unable to repair Webex space agent grant bot=%s space=%s agent=%s: %s",
                bot_id,
                space_id,
                agent_id,
                exc,
            )
            return False

    def _write_openfga_tuples(self, tuple_keys: list[dict[str, str]]) -> None:
        written: list[dict[str, str]] = []
        try:
            for tuple_key in tuple_keys:
                if self._openfga_writer is not None:
                    self._openfga_writer(tuple_key)
                    written.append(tuple_key)
                    continue

                base_url = (
                    os.environ.get("OPENFGA_HTTP", "").strip()
                    or DEFAULT_OPENFGA_HTTP
                ).rstrip("/")
                store_id = _openfga_store_id(base_url)
                response = requests.post(
                    f"{base_url}/stores/{store_id}/write",
                    headers={"Content-Type": "application/json"},
                    json={"writes": {"tuple_keys": [tuple_key]}},
                    timeout=5,
                )
                if response.status_code >= 400:
                    if "already" in response.text.lower():
                        continue
                    response.raise_for_status()
                written.append(tuple_key)
        except requests.RequestException:
            for tuple_key in reversed(written):
                try:
                    self._delete_openfga_tuple(tuple_key)
                except requests.RequestException as rollback_error:
                    logger.warning(
                        "Unable to roll back Webex OpenFGA tuple %s: %s",
                        tuple_key,
                        rollback_error,
                    )
            raise

    def _delete_openfga_tuple(self, tuple_key: dict[str, str]) -> None:
        if self._openfga_deleter is not None:
            self._openfga_deleter(tuple_key)
            return

        base_url = (os.environ.get("OPENFGA_HTTP", "").strip() or DEFAULT_OPENFGA_HTTP).rstrip("/")
        store_id = _openfga_store_id(base_url)
        response = requests.post(
            f"{base_url}/stores/{store_id}/write",
            headers={"Content-Type": "application/json"},
            json={"deletes": {"tuple_keys": [tuple_key]}},
            timeout=5,
        )
        if response.status_code >= 400:
            response.raise_for_status()


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


_default_assigner: WebexSpaceAutoAssigner | None = None


def get_webex_space_auto_assigner() -> WebexSpaceAutoAssigner:
    global _default_assigner
    if _default_assigner is None:
        _default_assigner = WebexSpaceAutoAssigner()
    return _default_assigner
