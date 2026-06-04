"""Opt-in Webex space auto-assignment for first-message onboarding."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import requests
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import PyMongoError

from .webex_agent_routes import DEFAULT_OPENFGA_HTTP, webex_space_openfga_subject, webex_workspace_ref

logger = logging.getLogger("caipe.webex_bot.webex_space_auto_assign")

CollectionFactory = Callable[[str], Optional[Collection[Any]]]
OpenFgaWriter = Callable[[dict[str, str]], None]
OpenFgaDeleter = Callable[[dict[str, str]], None]


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
    ) -> None:
        self._collection_factory = collection_factory
        self._openfga_writer = openfga_writer
        self._openfga_deleter = openfga_deleter
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
    def _enabled_config() -> tuple[bool, str, str]:
        enabled = os.environ.get("WEBEX_AUTO_ASSIGN_UNMAPPED_SPACES", "false").lower() == "true"
        team_slug = os.environ.get("WEBEX_DEFAULT_TEAM_SLUG", "").strip()
        agent_id = os.environ.get("WEBEX_DEFAULT_AGENT_ID", "").strip()
        return enabled and bool(team_slug) and bool(agent_id), team_slug, agent_id

    def assign_space(
        self,
        *,
        workspace_id: str,
        space_id: str,
        space_title: str | None = None,
    ) -> WebexSpaceAutoAssignResult:
        """Assign an unmapped Webex space to the configured team and agent.

        Fail-closed: disabled/misconfigured dependencies return non-assigned results.
        Writes are auditable via ``source_type`` and ``created_by`` fields.
        """

        enabled, team_slug, agent_id = self._enabled_config()
        if not enabled:
            return WebexSpaceAutoAssignResult(False, "disabled")

        mappings = self._collection("webex_space_team_mappings")
        teams = self._collection("teams")
        routes = self._collection("webex_space_agent_routes")
        if mappings is None or teams is None or routes is None:
            return WebexSpaceAutoAssignResult(False, "mongo_unavailable")

        existing = mappings.find_one({"webex_space_id": space_id, "active": {"$ne": False}})
        if existing:
            return WebexSpaceAutoAssignResult(False, "existing_mapping")

        team = teams.find_one({"slug": team_slug})
        if not team:
            return WebexSpaceAutoAssignResult(False, "default_team_missing", team_slug=team_slug)

        team_id = str(team.get("_id"))
        workspace_ref = webex_workspace_ref(workspace_id)
        now = datetime.now(timezone.utc).isoformat()
        display_name = (space_title or space_id).strip()

        tuple_key = {
            "user": webex_space_openfga_subject(workspace_id, space_id),
            "relation": "user",
            "object": f"agent:{agent_id}",
        }
        route_filter = {
            "workspace_id": workspace_ref,
            "space_id": space_id,
            "agent_id": agent_id,
        }
        routes_written = False
        mapping_written = False
        try:
            routes.update_one(
                route_filter,
                {
                    "$set": {
                        "workspace_id": workspace_ref,
                        "space_id": space_id,
                        "agent_id": agent_id,
                        "enabled": True,
                        "priority": 100,
                        "users": {"enabled": True, "listen": "all"},
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
                {"webex_space_id": space_id},
                {
                    "$set": {
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
            # `_write_openfga_tuple` is the last step in the try block; if it
            # raises, control flows to except with no OpenFGA write to roll
            # back. If it succeeds, no later statement can raise. Therefore
            # we never need to roll back an OpenFGA tuple here.
            self._write_openfga_tuple(tuple_key)
        except (PyMongoError, requests.RequestException) as exc:
            logger.warning("Webex space auto-assignment failed for space=%s: %s", space_id, exc)
            if mapping_written:
                mappings.delete_one({"webex_space_id": space_id})
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

    def _write_openfga_tuple(self, tuple_key: dict[str, str]) -> None:
        if self._openfga_writer is not None:
            self._openfga_writer(tuple_key)
            return

        base_url = (os.environ.get("OPENFGA_HTTP", "").strip() or DEFAULT_OPENFGA_HTTP).rstrip("/")
        store_id = _openfga_store_id(base_url)
        response = requests.post(
            f"{base_url}/stores/{store_id}/write",
            headers={"Content-Type": "application/json"},
            json={"writes": {"tuple_keys": [tuple_key]}},
            timeout=5,
        )
        if response.status_code >= 400 and "already" not in response.text.lower():
            response.raise_for_status()

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
