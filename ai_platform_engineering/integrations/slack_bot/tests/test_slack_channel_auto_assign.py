from __future__ import annotations

from bson import ObjectId

from ai_platform_engineering.integrations.slack_bot.utils.slack_channel_auto_assign import (
    SlackChannelAutoAssigner,
)


class _UpdateResult:
    def __init__(self, *, upserted_id: object | None = None) -> None:
        self.upserted_id = upserted_id


class _Collection:
    def __init__(self, rows: list[dict[str, object]] | None = None) -> None:
        self.rows = rows or []

    def find_one(self, query: dict[str, object]) -> dict[str, object] | None:
        for row in self.rows:
            if _matches(row, query):
                return row
        return None

    def update_one(
        self,
        filter_query: dict[str, object],
        update: dict[str, dict[str, object]],
        *,
        upsert: bool = False,
    ) -> _UpdateResult:
        row = self.find_one(filter_query)
        if row is None:
            if not upsert:
                return _UpdateResult()
            row = {**filter_query}
            self.rows.append(row)
        row.update(update.get("$set", {}))
        for key, value in update.get("$setOnInsert", {}).items():
            row.setdefault(key, value)
        return _UpdateResult(upserted_id=row.get("_id"))


def _matches(row: dict[str, object], query: dict[str, object]) -> bool:
    for key, expected in query.items():
        actual = row.get(key)
        if isinstance(expected, dict) and "$ne" in expected:
            if actual == expected["$ne"]:
                return False
            continue
        if actual != expected:
            return False
    return True


def test_auto_assign_is_disabled_unless_flag_team_and_agent_are_configured(monkeypatch) -> None:
    monkeypatch.delenv("SLACK_AUTO_ASSIGN_UNMAPPED_CHANNELS", raising=False)
    monkeypatch.setenv("SLACK_DEFAULT_TEAM_SLUG", "platform")
    monkeypatch.setenv("SLACK_DEFAULT_AGENT_ID", "test-april-2025")

    writes: list[dict[str, str]] = []
    assigner = SlackChannelAutoAssigner(
        collection_factory=lambda _name: _Collection([]),
        openfga_writer=lambda tuple_key: writes.append(tuple_key),
    )

    result = assigner.assign_channel(
        workspace_id="CAIPE",
        channel_id="CNEW",
        channel_name="new-slack-channel",
    )

    assert result.assigned is False
    assert result.reason == "disabled"
    assert writes == []


def test_auto_assign_creates_mapping_route_and_openfga_tuple(monkeypatch) -> None:
    team_id = ObjectId()
    teams = _Collection([{"_id": team_id, "slug": "platform", "name": "Platform"}])
    mappings = _Collection([])
    routes = _Collection([])
    collections = {
        "teams": teams,
        "channel_team_mappings": mappings,
        "slack_channel_agent_routes": routes,
    }
    writes: list[dict[str, str]] = []

    monkeypatch.setenv("SLACK_AUTO_ASSIGN_UNMAPPED_CHANNELS", "true")
    monkeypatch.setenv("SLACK_DEFAULT_TEAM_SLUG", "platform")
    monkeypatch.setenv("SLACK_DEFAULT_AGENT_ID", "test-april-2025")

    assigner = SlackChannelAutoAssigner(
        collection_factory=lambda name: collections[name],
        openfga_writer=lambda tuple_key: writes.append(tuple_key),
    )

    result = assigner.assign_channel(
        workspace_id="CAIPE",
        channel_id="CNEW",
        channel_name="new-slack-channel",
    )

    assert result.assigned is True
    assert result.team_slug == "platform"
    assert result.agent_id == "test-april-2025"
    assert mappings.rows[0]["slack_channel_id"] == "CNEW"
    assert mappings.rows[0]["channel_name"] == "new-slack-channel"
    assert mappings.rows[0]["team_id"] == str(team_id)
    assert mappings.rows[0]["team_slug"] == "platform"
    assert mappings.rows[0]["active"] is True
    assert routes.rows[0]["workspace_id"] == "CAIPE"
    assert routes.rows[0]["channel_id"] == "CNEW"
    assert routes.rows[0]["agent_id"] == "test-april-2025"
    assert routes.rows[0]["users"] == {"enabled": True, "listen": "mention"}
    assert writes == [
        {
            "user": "slack_channel:CAIPE--CNEW",
            "relation": "user",
            "object": "agent:test-april-2025",
        }
    ]


def test_auto_assign_does_not_overwrite_existing_active_mapping(monkeypatch) -> None:
    teams = _Collection([{"_id": ObjectId(), "slug": "platform", "name": "Platform"}])
    mappings = _Collection(
        [
            {
                "slack_channel_id": "CNEW",
                "team_slug": "existing-team",
                "active": True,
            }
        ]
    )
    routes = _Collection([])
    collections = {
        "teams": teams,
        "channel_team_mappings": mappings,
        "slack_channel_agent_routes": routes,
    }
    writes: list[dict[str, str]] = []

    monkeypatch.setenv("SLACK_AUTO_ASSIGN_UNMAPPED_CHANNELS", "true")
    monkeypatch.setenv("SLACK_DEFAULT_TEAM_SLUG", "platform")
    monkeypatch.setenv("SLACK_DEFAULT_AGENT_ID", "test-april-2025")

    assigner = SlackChannelAutoAssigner(
        collection_factory=lambda name: collections[name],
        openfga_writer=lambda tuple_key: writes.append(tuple_key),
    )

    result = assigner.assign_channel(
        workspace_id="CAIPE",
        channel_id="CNEW",
        channel_name="new-slack-channel",
    )

    assert result.assigned is False
    assert result.reason == "existing_mapping"
    assert mappings.rows[0]["team_slug"] == "existing-team"
    assert routes.rows == []
    assert writes == []
