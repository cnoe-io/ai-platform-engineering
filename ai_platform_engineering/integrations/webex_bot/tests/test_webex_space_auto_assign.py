"""Tests for opt-in Webex space auto-assignment."""

from __future__ import annotations

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


class _TeamCollection:
    def __init__(self, team: dict[str, object]) -> None:
        self.team = team

    def find_one(self, query: dict[str, object]) -> dict[str, object] | None:
        if query.get("slug") == self.team.get("slug"):
            return self.team
        return None


def test_auto_assign_disabled_by_default(monkeypatch) -> None:
    monkeypatch.delenv("WEBEX_AUTO_ASSIGN_UNMAPPED_SPACES", raising=False)
    assigner = WebexSpaceAutoAssigner()

    result = assigner.assign_space(bot_id="primary", workspace_id="CAIPE-WEBEX", space_id="space-new")

    assert result.assigned is False
    assert result.reason == "disabled"


def test_auto_assign_writes_explicit_mappings_when_enabled(monkeypatch) -> None:
    monkeypatch.setenv("WEBEX_AUTO_ASSIGN_UNMAPPED_SPACES", "true")
    monkeypatch.setenv("WEBEX_DEFAULT_TEAM_SLUG", "platform-eng")
    monkeypatch.setenv("WEBEX_DEFAULT_AGENT_ID", "default-agent")
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


def test_auto_assign_does_not_overwrite_existing_active_mapping(monkeypatch) -> None:
    monkeypatch.setenv("WEBEX_AUTO_ASSIGN_UNMAPPED_SPACES", "true")
    monkeypatch.setenv("WEBEX_DEFAULT_TEAM_SLUG", "platform-eng")
    monkeypatch.setenv("WEBEX_DEFAULT_AGENT_ID", "default-agent")

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
    monkeypatch.setenv("WEBEX_AUTO_ASSIGN_UNMAPPED_SPACES", "true")
    monkeypatch.setenv("WEBEX_DEFAULT_TEAM_SLUG", "platform-eng")
    monkeypatch.setenv("WEBEX_DEFAULT_AGENT_ID", "default-agent")
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
