"""Tests for opt-in Webex space auto-assignment."""

from __future__ import annotations

import json

import requests
from pymongo.errors import PyMongoError

from ai_platform_engineering.integrations.webex_bot.utils.webex_space_auto_assign import (
    WebexSpaceAutoAssigner,
)


class _MappingCollection:
    def __init__(self, existing: dict[str, object] | None = None) -> None:
        self.existing = existing
        self.updates: list[dict[str, object]] = []
        self.deletes: list[dict[str, object]] = []
        self.fail_on_update: bool = False

    def find_one(self, query: dict[str, object]) -> dict[str, object] | None:
        if self.existing and query.get("webex_space_id") == self.existing.get("webex_space_id"):
            return self.existing
        return None

    def update_one(self, query: dict[str, object], update: dict[str, object], upsert: bool = False) -> None:
        if self.fail_on_update:
            raise PyMongoError("mapping write failed")
        self.updates.append({"query": query, "update": update, "upsert": upsert})

    def delete_one(self, query: dict[str, object]) -> None:
        self.deletes.append(query)

    def delete_many(self, query: dict[str, object]) -> None:
        self.deletes.append(query)


class _TeamCollection:
    def __init__(self, team: dict[str, object]) -> None:
        self.team = team

    def find_one(self, query: dict[str, object]) -> dict[str, object] | None:
        if query.get("slug") == self.team.get("slug"):
            return self.team
        return None


class _WebexResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return

    def json(self) -> dict[str, object]:
        return self._payload


class _OpenFgaResponse:
    def __init__(self, status_code: int, text: str = "") -> None:
        self.status_code = status_code
        self.text = text

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(self.text)


def _enable_auto_assign(monkeypatch) -> None:
    monkeypatch.setenv(
        "WEBEX_INTEGRATION_BOTS_JSON",
        json.dumps(
            [
                {
                    "id": "primary",
                    "name": "Primary",
                    "tokenEnv": "PRIMARY_TOKEN",
                    "spaces": {
                        "accessMode": "all_spaces",
                        "defaultTeamSlug": "platform-eng",
                        "defaultAgentId": "default-agent",
                    },
                    "directMessages": {"accessMode": "disabled"},
                }
            ]
        ),
    )


def test_auto_assign_disabled_by_default(monkeypatch) -> None:
    assigner = WebexSpaceAutoAssigner()

    result = assigner.assign_space(bot_id="primary", workspace_id="CAIPE-WEBEX", space_id="space-new")

    assert result.assigned is False
    assert result.reason == "disabled"


def test_auto_assign_writes_explicit_mappings_when_enabled(monkeypatch) -> None:
    _enable_auto_assign(monkeypatch)
    monkeypatch.setenv("WEBEX_WORKSPACE_ALIAS", "CAIPE-WEBEX")

    mappings = _MappingCollection()
    teams = _TeamCollection({"_id": "team-1", "slug": "platform-eng"})
    routes = _MappingCollection()

    openfga_writes: list[dict[str, str]] = []

    def factory(name: str):
        if name == "webex_space_team_mappings":
            return mappings
        if name == "teams":
            return teams
        if name == "webex_space_agent_routes":
            return routes
        return None

    assigner = WebexSpaceAutoAssigner(
        collection_factory=factory,
        openfga_writer=lambda key: openfga_writes.append(key),
    )

    result = assigner.assign_space(
        bot_id="primary",
        workspace_id="CAIPE-WEBEX",
        space_id="space-new",
        space_title="New Space",
    )

    assert result.assigned is True
    assert result.team_slug == "platform-eng"
    assert result.agent_id == "default-agent"
    assert openfga_writes == [
        {
            "user": "team:platform-eng#admin",
            "relation": "manager",
            "object": "webex_space:CAIPE-WEBEX--space-new",
        },
        {
            "user": "team:platform-eng#member",
            "relation": "user",
            "object": "webex_space:CAIPE-WEBEX--space-new",
        },
        {
            "user": "webex_bot:primary",
            "relation": "bot",
            "object": "webex_bot_installation:primary--CAIPE-WEBEX--space-new",
        },
        {
            "user": "webex_space:CAIPE-WEBEX--space-new",
            "relation": "space",
            "object": "webex_bot_installation:primary--CAIPE-WEBEX--space-new",
        },
        {
            "user": "webex_bot_installation:primary--CAIPE-WEBEX--space-new",
            "relation": "user",
            "object": "agent:default-agent",
        },
    ]
    assert routes.updates[0]["update"]["$set"]["source_type"] == "auto"
    assert routes.updates[0]["query"] == {
        "_id": '["primary","CAIPE-WEBEX","space-new"]'
    }
    assert mappings.updates[0]["update"]["$set"]["space_name"] == "New Space"


def test_auto_assign_resolves_space_title_with_selected_bot_token(monkeypatch) -> None:
    _enable_auto_assign(monkeypatch)
    monkeypatch.setenv("PRIMARY_TOKEN", "bot-token")

    mappings = _MappingCollection()
    teams = _TeamCollection({"_id": "team-1", "slug": "platform-eng"})
    routes = _MappingCollection()
    requests_seen: list[dict[str, object]] = []

    def request_get(url: str, **kwargs: object) -> _WebexResponse:
        requests_seen.append({"url": url, **kwargs})
        return _WebexResponse({"title": "Incident Room"})

    assigner = WebexSpaceAutoAssigner(
        collection_factory=lambda name: {
            "webex_space_team_mappings": mappings,
            "teams": teams,
            "webex_space_agent_routes": routes,
        }.get(name),
        openfga_writer=lambda _key: None,
        webex_request_get=request_get,  # type: ignore[arg-type]
    )

    result = assigner.assign_space(
        bot_id="primary",
        workspace_id="CAIPE-WEBEX",
        space_id="251c27f0-81d7-11f1-9933-91f1e9e34211",
    )

    assert result.assigned is True
    assert requests_seen[0]["headers"] == {"Authorization": "Bearer bot-token"}
    assert mappings.updates[0]["update"]["$set"]["space_name"] == "Incident Room"


def test_auto_assign_writes_new_grants_when_visibility_tuples_already_exist(
    monkeypatch,
) -> None:
    _enable_auto_assign(monkeypatch)
    monkeypatch.setenv("OPENFGA_STORE_ID", "01KVB2J0SQTP3T2QD2JWVWJDAZ")

    mappings = _MappingCollection()
    teams = _TeamCollection({"_id": "team-1", "slug": "platform-eng"})
    routes = _MappingCollection()
    writes: list[dict[str, str]] = []

    def post(_url: str, **kwargs: object) -> _OpenFgaResponse:
        payload = kwargs["json"]
        assert isinstance(payload, dict)
        tuple_key = payload["writes"]["tuple_keys"][0]
        writes.append(tuple_key)
        if len(writes) <= 2:
            return _OpenFgaResponse(400, "tuple already exists")
        return _OpenFgaResponse(200)

    monkeypatch.setattr(
        "ai_platform_engineering.integrations.webex_bot.utils.webex_space_auto_assign.requests.post",
        post,
    )
    assigner = WebexSpaceAutoAssigner(
        collection_factory=lambda name: {
            "webex_space_team_mappings": mappings,
            "teams": teams,
            "webex_space_agent_routes": routes,
        }.get(name),
    )

    result = assigner.assign_space(
        bot_id="primary",
        workspace_id="CAIPE-WEBEX",
        space_id="space-new",
        space_title="New Space",
    )

    assert result.assigned is True
    assert len(writes) == 5
    assert writes[-1] == {
        "user": "webex_bot_installation:primary--CAIPE-WEBEX--space-new",
        "relation": "user",
        "object": "agent:default-agent",
    }


def test_auto_assign_does_not_overwrite_existing_active_mapping(monkeypatch) -> None:
    _enable_auto_assign(monkeypatch)

    existing = {
        "webex_space_id": "space-existing",
        "team_slug": "other-team",
        "active": True,
    }
    mappings = _MappingCollection(existing=existing)
    teams = _TeamCollection({"_id": "team-1", "slug": "platform-eng"})
    routes = _MappingCollection()
    openfga_writes: list[dict[str, str]] = []

    assigner = WebexSpaceAutoAssigner(
        collection_factory=lambda name: {
            "webex_space_team_mappings": mappings,
            "teams": teams,
            "webex_space_agent_routes": routes,
        }.get(name),
        openfga_writer=lambda key: openfga_writes.append(key),
    )

    result = assigner.assign_space(bot_id="primary", workspace_id="CAIPE-WEBEX", space_id="space-existing")

    assert result.assigned is False
    assert result.reason == "existing_mapping"
    assert openfga_writes == []
    assert routes.updates == []


def test_auto_assign_mongo_failure_does_not_leave_openfga_tuple(monkeypatch) -> None:
    _enable_auto_assign(monkeypatch)
    monkeypatch.setenv("WEBEX_WORKSPACE_ALIAS", "CAIPE-WEBEX")

    mappings = _MappingCollection()
    mappings.fail_on_update = True
    teams = _TeamCollection({"_id": "team-1", "slug": "platform-eng"})
    routes = _MappingCollection()
    openfga_writes: list[dict[str, str]] = []
    openfga_deletes: list[dict[str, str]] = []

    assigner = WebexSpaceAutoAssigner(
        collection_factory=lambda name: {
            "webex_space_team_mappings": mappings,
            "teams": teams,
            "webex_space_agent_routes": routes,
        }.get(name),
        openfga_writer=lambda key: openfga_writes.append(key),
        openfga_deleter=lambda key: openfga_deletes.append(key),
    )

    result = assigner.assign_space(bot_id="primary", workspace_id="CAIPE-WEBEX", space_id="space-new")

    assert result.assigned is False
    assert result.reason == "write_failed"
    assert openfga_writes == []
    assert openfga_deletes == []
    assert len(routes.deletes) == 1
