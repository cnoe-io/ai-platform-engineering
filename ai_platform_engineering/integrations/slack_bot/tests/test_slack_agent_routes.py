"""Tests for optional Mongo-backed Slack agent routes."""

from __future__ import annotations

from ai_platform_engineering.integrations.slack_bot.utils.slack_agent_routes import (
    SlackAgentRouteResolver,
    slack_agent_route_mode,
    slack_workspace_ref,
)


class _Cursor:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self._rows = rows

    def sort(self, _sort: list[tuple[str, int]]) -> "_Cursor":
        self._rows = sorted(self._rows, key=lambda row: (row.get("priority", 100), row.get("agent_id", "")))
        return self

    def to_list(self) -> list[dict[str, object]]:
        return self._rows


class _Collection:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.filters: list[dict[str, object]] = []

    def find(self, filter_query: dict[str, object]) -> _Cursor:
        self.filters.append(filter_query)
        rows = [
            row
            for row in self.rows
            if row.get("workspace_id") == filter_query["workspace_id"]
            and row.get("channel_id") == filter_query["channel_id"]
            and row.get("status") == filter_query["status"]
            and row.get("enabled") is not False
        ]
        return _Cursor(rows)


def test_slack_agent_route_mode_defaults_to_static_config(monkeypatch) -> None:
    monkeypatch.delenv("SLACK_AGENT_ROUTES_MODE", raising=False)
    monkeypatch.delenv("SLACK_AGENT_ROUTES_ENABLED", raising=False)

    assert slack_agent_route_mode() == "config"


def test_slack_agent_route_mode_supports_legacy_enabled_flag(monkeypatch) -> None:
    monkeypatch.delenv("SLACK_AGENT_ROUTES_MODE", raising=False)
    monkeypatch.setenv("SLACK_AGENT_ROUTES_ENABLED", "true")

    assert slack_agent_route_mode() == "db_prefer"


def test_resolver_matches_enabled_routes_by_listen_and_priority() -> None:
    collection = _Collection(
        [
            {
                "workspace_id": "T123",
                "channel_id": "C123",
                "agent_id": "low-priority-agent",
                "enabled": True,
                "priority": 50,
                "status": "active",
                "users": {"enabled": True, "listen": "mention"},
            },
            {
                "workspace_id": "T123",
                "channel_id": "C123",
                "agent_id": "high-priority-agent",
                "enabled": True,
                "priority": 10,
                "status": "active",
                "users": {"enabled": True, "listen": "all"},
            },
            {
                "workspace_id": "T123",
                "channel_id": "C123",
                "agent_id": "message-only-agent",
                "enabled": True,
                "priority": 1,
                "status": "active",
                "users": {"enabled": True, "listen": "message"},
            },
        ]
    )
    resolver = SlackAgentRouteResolver(collection_factory=lambda: collection)

    matches = resolver.match_routes(
        workspace_id="T123",
        channel_id="C123",
        is_bot=False,
        user_id="U123",
        listen="mention",
    )

    assert [match.agent_id for match in matches] == ["high-priority-agent", "low-priority-agent"]
    assert matches[0].users is not None
    assert matches[0].users.listen == "all"


def test_slack_workspace_ref_prefers_configured_alias(monkeypatch) -> None:
    monkeypatch.setenv("SLACK_WORKSPACE_ALIAS", "CAIPE")
    monkeypatch.setenv("SLACK_WORKSPACE_ID", "TFALLBACK")

    assert slack_workspace_ref("TREALWORKSPACE") == "CAIPE"


def test_slack_workspace_ref_falls_back_to_team_id_then_env(monkeypatch) -> None:
    monkeypatch.delenv("SLACK_WORKSPACE_ALIAS", raising=False)
    monkeypatch.setenv("SLACK_WORKSPACE_ID", "TFALLBACK")

    assert slack_workspace_ref("TREALWORKSPACE") == "TREALWORKSPACE"
    assert slack_workspace_ref(None) == "TFALLBACK"


def test_resolver_matches_configured_workspace_alias_routes() -> None:
    collection = _Collection(
        [
            {
                "workspace_id": "CAIPE",
                "channel_id": "C123",
                "agent_id": "ui-managed-agent",
                "enabled": True,
                "priority": 100,
                "status": "active",
                "users": {"enabled": True, "listen": "mention"},
            }
        ]
    )
    resolver = SlackAgentRouteResolver(collection_factory=lambda: collection)

    matches = resolver.match_routes(
        workspace_id="CAIPE",
        channel_id="C123",
        is_bot=False,
        user_id="U123",
        listen="mention",
    )

    assert [match.agent_id for match in matches] == ["ui-managed-agent"]
