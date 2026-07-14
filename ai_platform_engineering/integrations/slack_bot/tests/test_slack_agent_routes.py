"""Tests for optional Mongo-backed Slack route metadata."""

from __future__ import annotations

import requests

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


class _Response:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self._payload


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
    resolver = SlackAgentRouteResolver(
        collection_factory=lambda: collection,
        openfga_agent_ids_factory=lambda _workspace_id, _channel_id: [
            "low-priority-agent",
            "high-priority-agent",
            "message-only-agent",
        ],
    )

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
    resolver = SlackAgentRouteResolver(
        collection_factory=lambda: collection,
        openfga_agent_ids_factory=lambda _workspace_id, _channel_id: ["ui-managed-agent"],
    )

    matches = resolver.match_routes(
        workspace_id="CAIPE",
        channel_id="C123",
        is_bot=False,
        user_id="U123",
        listen="mention",
    )

    assert [match.agent_id for match in matches] == ["ui-managed-agent"]


def test_resolver_ignores_mongo_routes_without_openfga_tuple() -> None:
    collection = _Collection(
        [
            {
                "workspace_id": "CAIPE",
                "channel_id": "C123",
                "agent_id": "tuple-backed-agent",
                "enabled": True,
                "priority": 100,
                "status": "active",
                "users": {"enabled": True, "listen": "mention"},
            },
            {
                "workspace_id": "CAIPE",
                "channel_id": "C123",
                "agent_id": "stale-mongo-agent",
                "enabled": True,
                "priority": 1,
                "status": "active",
                "users": {"enabled": True, "listen": "mention"},
            },
        ]
    )
    resolver = SlackAgentRouteResolver(
        collection_factory=lambda: collection,
        openfga_agent_ids_factory=lambda _workspace_id, _channel_id: ["tuple-backed-agent"],
    )

    matches = resolver.match_routes(
        workspace_id="CAIPE",
        channel_id="C123",
        is_bot=False,
        user_id="U123",
        listen="mention",
    )

    assert [match.agent_id for match in matches] == ["tuple-backed-agent"]


def test_resolver_uses_default_metadata_for_openfga_tuple_without_mongo_route() -> None:
    collection = _Collection([])
    resolver = SlackAgentRouteResolver(
        collection_factory=lambda: collection,
        openfga_agent_ids_factory=lambda _workspace_id, _channel_id: ["tuple-only-agent"],
    )

    matches = resolver.match_routes(
        workspace_id="CAIPE",
        channel_id="C123",
        is_bot=False,
        user_id="U123",
        listen="mention",
    )

    assert [match.agent_id for match in matches] == ["tuple-only-agent"]
    assert matches[0].users is not None
    assert matches[0].users.listen == "mention"


def test_resolver_defaults_to_internal_openfga_url_when_env_is_unset(monkeypatch) -> None:
    monkeypatch.delenv("OPENFGA_HTTP", raising=False)
    monkeypatch.setenv("OPENFGA_STORE_ID", "store-1")
    post_calls: list[tuple[str, dict[str, object] | None]] = []

    def fake_post(url: str, **_kwargs: object) -> _Response:
        post_calls.append((url, _kwargs.get("json") if isinstance(_kwargs.get("json"), dict) else None))
        return _Response(
            {
                "tuples": [
                    {
                        "key": {
                            "user": "slack_channel:CAIPE--C123",
                            "relation": "user",
                            "object": "agent:tuple-backed-agent",
                        }
                    },
                    {
                        "key": {
                            "user": "slack_channel:CAIPE--OTHER",
                            "relation": "user",
                            "object": "agent:other-channel-agent",
                        }
                    }
                ],
                "continuation_token": "",
            }
        )

    monkeypatch.setattr(
        "ai_platform_engineering.integrations.slack_bot.utils.slack_agent_routes.requests.post",
        fake_post,
    )

    resolver = SlackAgentRouteResolver(collection_factory=lambda: _Collection([]))

    matches = resolver.match_routes(
        workspace_id="CAIPE",
        channel_id="C123",
        is_bot=False,
        user_id="U123",
        listen="mention",
    )

    assert [match.agent_id for match in matches] == ["tuple-backed-agent"]
    assert post_calls == [
        (
            "http://openfga:8080/stores/store-1/read",
            {
                "page_size": 100,
                "tuple_key": {"user": "slack_channel:CAIPE--C123", "relation": "user", "object": "agent:"},
            },
        )
    ]


def test_resolver_records_openfga_read_failures_to_audit_service(monkeypatch) -> None:
    monkeypatch.setenv("OPENFGA_STORE_ID", "store-1")
    audit_records: list[dict[str, object]] = []

    def fake_post(_url: str, **_kwargs: object) -> _Response:
        raise requests.RequestException("400 Bad Request")

    monkeypatch.setattr(
        "ai_platform_engineering.integrations.slack_bot.utils.slack_agent_routes.requests.post",
        fake_post,
    )
    resolver = SlackAgentRouteResolver(
        collection_factory=lambda: _Collection([]),
        audit_event_writer=audit_records.append,
    )

    matches = resolver.match_routes(
        workspace_id="CAIPE",
        channel_id="C123",
        is_bot=False,
        user_id="U123",
        listen="mention",
    )

    assert matches == []
    assert len(audit_records) == 1
    assert audit_records[0] | {"ts": "ignored"} == {
        "type": "slack_runtime",
        "component": "slack_bot",
        "source": "slack",
        "outcome": "error",
        "action": "slack.route.openfga_read",
        "reason_code": "OPENFGA_READ_FAILED",
        "resource_ref": "slack_channel:CAIPE--C123",
        "message": "400 Bad Request",
        "ts": "ignored",
    }


def test_resolver_explains_message_listen_mismatch() -> None:
    collection = _Collection(
        [
            {
                "workspace_id": "CAIPE",
                "channel_id": "C123",
                "agent_id": "mention-only-agent",
                "enabled": True,
                "priority": 100,
                "status": "active",
                "users": {"enabled": True, "listen": "mention"},
            },
        ]
    )
    resolver = SlackAgentRouteResolver(
        collection_factory=lambda: collection,
        openfga_agent_ids_factory=lambda _workspace_id, _channel_id: ["mention-only-agent"],
    )

    assert (
        resolver.explain_no_route_match(
            workspace_id="CAIPE",
            channel_id="C123",
            is_bot=False,
            user_id="U123",
            listen="message",
            app_name="CAIPE",
        )
        == "This Slack channel has CAIPE agent routes, but none are configured to listen to plain channel messages. Mention @CAIPE, or set the route Listen mode to `message` or `all` in Admin > OpenFGA ReBAC > Slack Channels."
    )


def test_resolver_explains_openfga_route_read_failure(monkeypatch) -> None:
    monkeypatch.setenv("OPENFGA_STORE_ID", "store-1")

    def fake_post(_url: str, **_kwargs: object) -> _Response:
        raise requests.RequestException("400 Bad Request")

    monkeypatch.setattr(
        "ai_platform_engineering.integrations.slack_bot.utils.slack_agent_routes.requests.post",
        fake_post,
    )
    resolver = SlackAgentRouteResolver(collection_factory=lambda: _Collection([]))
    assert (
        resolver.explain_no_route_match(
            workspace_id="CAIPE",
            channel_id="C123",
            is_bot=False,
            user_id="U123",
            listen="message",
            app_name="CAIPE",
            route_required=True,
        )
        == "CAIPE could not read Slack routing relationships from OpenFGA, so I cannot safely dispatch this message. Please try again shortly or ask an admin to check Slack Runtime Diagnostics."
    )


def test_escalation_for_returns_db_route_escalation() -> None:
    collection = _Collection(
        [
            {
                "workspace_id": "CAIPE",
                "channel_id": "C123",
                "agent_id": "ui-agent",
                "enabled": True,
                "priority": 1,
                "status": "active",
                "users": {"enabled": True, "listen": "all"},
                "escalation": {
                    "victorops": {"enabled": True, "team": "dao"},
                    "emoji": {"enabled": True, "name": "rotating_light"},
                    "users": ["U027"],
                },
            },
        ]
    )
    resolver = SlackAgentRouteResolver(
        collection_factory=lambda: collection,
        openfga_agent_ids_factory=lambda _workspace_id, _channel_id: ["ui-agent"],
    )

    esc = resolver.escalation_for(workspace_id="CAIPE", channel_id="C123", agent_id="ui-agent")

    assert esc is not None
    assert esc.victorops.enabled is True
    assert esc.victorops.team == "dao"
    assert esc.emoji.enabled is True
    assert esc.users == ["U027"]


def test_escalation_for_returns_none_when_no_escalation_configured() -> None:
    collection = _Collection(
        [
            {
                "workspace_id": "CAIPE",
                "channel_id": "C123",
                "agent_id": "ui-agent",
                "enabled": True,
                "priority": 1,
                "status": "active",
                "users": {"enabled": True, "listen": "all"},
            },
        ]
    )
    resolver = SlackAgentRouteResolver(
        collection_factory=lambda: collection,
        openfga_agent_ids_factory=lambda _workspace_id, _channel_id: ["ui-agent"],
    )

    # Route exists but has no escalation block, and an unknown agent yields None.
    assert resolver.escalation_for(workspace_id="CAIPE", channel_id="C123", agent_id="ui-agent") is None
    assert resolver.escalation_for(workspace_id="CAIPE", channel_id="C123", agent_id="other") is None
