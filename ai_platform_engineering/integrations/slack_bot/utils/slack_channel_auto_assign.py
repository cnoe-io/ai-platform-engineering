"""Opt-in Slack channel auto-assignment for first-message onboarding."""

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

from .slack_agent_routes import DEFAULT_OPENFGA_HTTP, slack_workspace_ref

logger = logging.getLogger("caipe.slack_bot.slack_channel_auto_assign")

CollectionFactory = Callable[[str], Optional[Collection[Any]]]
OpenFgaWriter = Callable[[dict[str, str]], None]


@dataclass(frozen=True)
class SlackChannelAutoAssignResult:
    """Outcome of an auto-assignment attempt."""

    assigned: bool
    reason: str
    team_slug: str | None = None
    agent_id: str | None = None
    team_id: str | None = None


class SlackChannelAutoAssigner:
    """Create default Slack channel team and agent relationships when enabled."""

    def __init__(
        self,
        *,
        collection_factory: CollectionFactory | None = None,
        openfga_writer: OpenFgaWriter | None = None,
    ) -> None:
        self._collection_factory = collection_factory
        self._openfga_writer = openfga_writer
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
                logger.warning("SlackChannelAutoAssigner: MongoDB client init failed: %s", exc)
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
        enabled = os.environ.get("SLACK_AUTO_ASSIGN_UNMAPPED_CHANNELS", "false").lower() == "true"
        team_slug = os.environ.get("SLACK_DEFAULT_TEAM_SLUG", "").strip()
        agent_id = os.environ.get("SLACK_DEFAULT_AGENT_ID", "").strip()
        return enabled and bool(team_slug) and bool(agent_id), team_slug, agent_id

    def assign_channel(
        self,
        *,
        workspace_id: str,
        channel_id: str,
        channel_name: str | None = None,
    ) -> SlackChannelAutoAssignResult:
        """Assign an unmapped Slack channel to the configured team and agent.

        The method is fail-closed: disabled/misconfigured dependencies return a
        non-assigned result, and OpenFGA/Mongo write failures are logged without
        pretending the channel is ready.
        """

        enabled, team_slug, agent_id = self._enabled_config()
        if not enabled:
            return SlackChannelAutoAssignResult(False, "disabled")

        mappings = self._collection("channel_team_mappings")
        teams = self._collection("teams")
        routes = self._collection("slack_channel_agent_routes")
        if mappings is None or teams is None or routes is None:
            return SlackChannelAutoAssignResult(False, "mongo_unavailable")

        existing = mappings.find_one({"slack_channel_id": channel_id, "active": {"$ne": False}})
        if existing:
            return SlackChannelAutoAssignResult(False, "existing_mapping")

        team = teams.find_one({"slug": team_slug})
        if not team:
            return SlackChannelAutoAssignResult(False, "default_team_missing", team_slug=team_slug)

        team_id = str(team.get("_id"))
        workspace_ref = slack_workspace_ref(workspace_id)
        now = datetime.now(timezone.utc).isoformat()
        display_name = (channel_name or channel_id).lstrip("#")

        tuple_key = {
            "user": f"slack_channel:{workspace_ref}--{channel_id}",
            "relation": "user",
            "object": f"agent:{agent_id}",
        }
        try:
            self._write_openfga_tuple(tuple_key)
            routes.update_one(
                {
                    "workspace_id": workspace_ref,
                    "channel_id": channel_id,
                    "agent_id": agent_id,
                },
                {
                    "$set": {
                        "workspace_id": workspace_ref,
                        "channel_id": channel_id,
                        "agent_id": agent_id,
                        "enabled": True,
                        "priority": 100,
                        "users": {"enabled": True, "listen": "mention"},
                        "source_type": "auto",
                        "status": "active",
                        "created_by": "slack_auto_assign",
                        "created_at": now,
                        "updated_by": "slack_auto_assign",
                        "updated_at": now,
                    }
                },
                upsert=True,
            )
            mappings.update_one(
                {"slack_channel_id": channel_id},
                {
                    "$set": {
                        "slack_workspace_id": workspace_ref,
                        "slack_channel_id": channel_id,
                        "channel_name": display_name,
                        "team_id": team_id,
                        "team_slug": team_slug,
                        "active": True,
                        "source_type": "slack_auto_assign",
                        "updated_at": now,
                    },
                    "$setOnInsert": {
                        "created_at": now,
                        "created_by": "slack_auto_assign",
                    },
                },
                upsert=True,
            )
        except (PyMongoError, requests.RequestException) as exc:
            logger.warning("Slack channel auto-assignment failed for channel=%s: %s", channel_id, exc)
            return SlackChannelAutoAssignResult(False, "write_failed")

        logger.info(
            "Auto-assigned Slack channel=%s workspace=%s to team=%s default_agent=%s",
            channel_id,
            workspace_ref,
            team_slug,
            agent_id,
        )
        return SlackChannelAutoAssignResult(
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


_default_assigner: SlackChannelAutoAssigner | None = None


def get_slack_channel_auto_assigner() -> SlackChannelAutoAssigner:
    global _default_assigner
    if _default_assigner is None:
        _default_assigner = SlackChannelAutoAssigner()
    return _default_assigner
