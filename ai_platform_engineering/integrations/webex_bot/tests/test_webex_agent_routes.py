"""Tests for OpenFGA-backed Webex space agent routes."""

from __future__ import annotations

import asyncio

import pytest
import requests

from ai_platform_engineering.integrations.webex_bot.app import handle_webex_message
from ai_platform_engineering.integrations.webex_bot.tests.test_runtime_gate import (
    FakeDispatcher,
    FakeIdentityLinker,
    FakeOboExchanger,
    FakeRebacChecker,
    FakeTeamResolver,
    _event,
)
from ai_platform_engineering.integrations.webex_bot.utils.webex_agent_routes import (
    WebexAgentRouteResolver,
    resolve_webex_agent_route,
    webex_agent_route_mode,
    webex_space_openfga_subject,
    webex_workspace_ref,
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
        self.rows = [{**row, "bot_id": row.get("bot_id", "primary")} for row in rows]
        self.filters: list[dict[str, object]] = []

    def find(self, filter_query: dict[str, object]) -> _Cursor:
        self.filters.append(filter_query)
        rows = [
            row
            for row in self.rows
            if row.get("bot_id") == filter_query["bot_id"]
            and row.get("workspace_id") == filter_query["workspace_id"]
            and row.get("space_id") == filter_query["space_id"]
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


def test_webex_agent_route_mode_defaults_to_static_config(monkeypatch) -> None:
    monkeypatch.delenv("WEBEX_AGENT_ROUTES_MODE", raising=False)
    monkeypatch.delenv("WEBEX_AGENT_ROUTES_ENABLED", raising=False)

    assert webex_agent_route_mode() == "config"


def test_webex_agent_route_mode_supports_legacy_enabled_flag(monkeypatch) -> None:
    monkeypatch.delenv("WEBEX_AGENT_ROUTES_MODE", raising=False)
    monkeypatch.setenv("WEBEX_AGENT_ROUTES_ENABLED", "true")

    assert webex_agent_route_mode() == "db_prefer"


def test_webex_space_openfga_subject_respects_explicit_workspace_id(monkeypatch) -> None:
    monkeypatch.setenv("WEBEX_WORKSPACE_ALIAS", "CAIPE-WEBEX")

    # Explicit workspace_id is used as-is so _load_routes' "unknown" fallback works.
    assert webex_space_openfga_subject("CAIPE-WEBEX", "space-abc") == "webex_space:CAIPE-WEBEX--space-abc"
    assert webex_space_openfga_subject("unknown", "space-abc") == "webex_space:unknown--space-abc"


def test_resolver_matches_enabled_routes_by_listen_and_priority() -> None:
    collection = _Collection(
        [
            {
                "workspace_id": "CAIPE-WEBEX",
                "space_id": "space12345",
                "agent_id": "low-priority-agent",
                "enabled": True,
                "priority": 50,
                "status": "active",
                "users": {"enabled": True, "listen": "mention"},
            },
            {
                "workspace_id": "CAIPE-WEBEX",
                "space_id": "space12345",
                "agent_id": "high-priority-agent",
                "enabled": True,
                "priority": 10,
                "status": "active",
                "users": {"enabled": True, "listen": "all"},
            },
        ]
    )
    resolver = WebexAgentRouteResolver(
        collection_factory=lambda: collection,
        openfga_agent_ids_factory=lambda _workspace_id, _space_id: [
            "low-priority-agent",
            "high-priority-agent",
        ],
    )

    matches = resolver.match_routes(
        bot_id="primary",
        workspace_id="CAIPE-WEBEX",
        space_id="space12345",
        is_bot=False,
        user_id="person1234",
        listen="mention",
    )

    assert [match.agent_id for match in matches] == ["high-priority-agent", "low-priority-agent"]


def test_resolve_direct_webex_message_uses_existing_mention_route(monkeypatch) -> None:
    monkeypatch.setenv("WEBEX_AGENT_ROUTES_MODE", "db_only")
    collection = _Collection(
        [
            {
                "workspace_id": "CAIPE-WEBEX",
                "space_id": "direct-space12345",
                "agent_id": "personal-agent",
                "enabled": True,
                "priority": 10,
                "status": "active",
                "users": {"enabled": True, "listen": "mention"},
            },
        ]
    )
    resolver = WebexAgentRouteResolver(
        collection_factory=lambda: collection,
        openfga_agent_ids_factory=lambda _workspace_id, _space_id: ["personal-agent"],
    )

    async def _run() -> tuple[str | None, str | None]:
        return await resolve_webex_agent_route(
            bot_id="primary",
            workspace_id="CAIPE-WEBEX",
            space_id="direct-space12345",
            person_id="person1234",
            text="howdy",
            is_direct=True,
            resolver=resolver,
        )

    agent_id, deny = asyncio.run(_run())

    assert agent_id == "personal-agent"
    assert deny is None


def test_plain_group_message_route_mismatch_uses_plain_language() -> None:
    collection = _Collection(
        [
            {
                "workspace_id": "CAIPE-WEBEX",
                "space_id": "space12345",
                "agent_id": "mention-only-agent",
                "enabled": True,
                "priority": 10,
                "status": "active",
                "users": {"enabled": True, "listen": "mention"},
            },
        ]
    )
    resolver = WebexAgentRouteResolver(
        collection_factory=lambda: collection,
        openfga_agent_ids_factory=lambda _workspace_id, _space_id: ["mention-only-agent"],
    )

    explanation = resolver.explain_no_route_match(
        bot_id="primary",
        workspace_id="CAIPE-WEBEX",
        space_id="space12345",
        is_bot=False,
        user_id="person1234",
        listen="message",
        route_required=True,
    )

    assert explanation == (
        "I can help in this Webex space when you mention CAIPE. Try mentioning "
        "CAIPE with your question, or ask an admin to enable always-on replies "
        "for this space."
    )
    for internal_term in ("OpenFGA", "Listen mode", "plain space messages", "Admin >"):
        assert internal_term not in explanation


def test_resolver_ignores_mongo_routes_without_openfga_tuple() -> None:
    collection = _Collection(
        [
            {
                "workspace_id": "CAIPE-WEBEX",
                "space_id": "space12345",
                "agent_id": "tuple-backed-agent",
                "enabled": True,
                "priority": 100,
                "status": "active",
                "users": {"enabled": True, "listen": "mention"},
            },
            {
                "workspace_id": "CAIPE-WEBEX",
                "space_id": "space12345",
                "agent_id": "stale-mongo-agent",
                "enabled": True,
                "priority": 1,
                "status": "active",
                "users": {"enabled": True, "listen": "mention"},
            },
        ]
    )
    resolver = WebexAgentRouteResolver(
        collection_factory=lambda: collection,
        openfga_agent_ids_factory=lambda _workspace_id, _space_id: ["tuple-backed-agent"],
    )

    matches = resolver.match_routes(
        bot_id="primary",
        workspace_id="CAIPE-WEBEX",
        space_id="space12345",
        is_bot=False,
        user_id="person1234",
        listen="mention",
    )

    assert [match.agent_id for match in matches] == ["tuple-backed-agent"]


def test_same_space_routes_are_isolated_by_bot() -> None:
    collection = _Collection(
        [
            {
                "bot_id": "primary",
                "workspace_id": "CAIPE-WEBEX",
                "space_id": "shared-space",
                "agent_id": "primary-agent",
                "enabled": True,
                "priority": 10,
                "status": "active",
                "users": {"enabled": True, "listen": "all"},
            },
            {
                "bot_id": "secondary",
                "workspace_id": "CAIPE-WEBEX",
                "space_id": "shared-space",
                "agent_id": "secondary-agent",
                "enabled": True,
                "priority": 10,
                "status": "active",
                "users": {"enabled": True, "listen": "all"},
            },
        ]
    )
    resolver = WebexAgentRouteResolver(
        collection_factory=lambda: collection,
        openfga_agent_ids_factory=lambda _workspace_id, _space_id: [
            "primary-agent",
            "secondary-agent",
        ],
    )

    primary = resolver.match_routes(
        bot_id="primary",
        workspace_id="CAIPE-WEBEX",
        space_id="shared-space",
        is_bot=False,
        user_id="user-1",
        listen="mention",
    )
    secondary = resolver.match_routes(
        bot_id="secondary",
        workspace_id="CAIPE-WEBEX",
        space_id="shared-space",
        is_bot=False,
        user_id="user-1",
        listen="mention",
    )

    assert [match.agent_id for match in primary] == ["primary-agent"]
    assert [match.agent_id for match in secondary] == ["secondary-agent"]


def test_openfga_read_includes_tuple_key_filter_and_pagination(monkeypatch) -> None:
    monkeypatch.setenv("OPENFGA_STORE_ID", "store-1")
    post_calls: list[dict[str, object]] = []
    call_count = {"n": 0}

    def fake_post(_url: str, **_kwargs: object) -> _Response:
        body = _kwargs.get("json")
        assert isinstance(body, dict)
        post_calls.append(body)
        call_count["n"] += 1
        if call_count["n"] == 1:
            return _Response(
                {
                    "tuples": [
                        {
                            "key": {
                                "user": "webex_space:CAIPE-WEBEX--space12345",
                                "relation": "user",
                                "object": "agent:page-one",
                            }
                        }
                    ],
                    "continuation_token": "page-2",
                }
            )
        return _Response(
            {
                "tuples": [
                    {
                        "key": {
                            "user": "webex_space:CAIPE-WEBEX--space12345",
                            "relation": "user",
                            "object": "agent:page-two",
                        }
                    }
                ],
                "continuation_token": "",
            }
        )

    monkeypatch.setattr(
        "ai_platform_engineering.integrations.webex_bot.utils.webex_agent_routes.requests.post",
        fake_post,
    )
    resolver = WebexAgentRouteResolver(collection_factory=lambda: _Collection([]))
    matches = resolver.match_routes(
        bot_id="primary",
        workspace_id="CAIPE-WEBEX",
        space_id="space12345",
        is_bot=False,
        user_id="person1234",
        listen="mention",
    )

    assert matches == []
    assert len(post_calls) == 2
    assert post_calls[0]["tuple_key"] == {
        "user": "webex_space:CAIPE-WEBEX--space12345",
        "relation": "user",
        "object": "agent:",
    }
    assert post_calls[1]["continuation_token"] == "page-2"
    assert post_calls[1]["tuple_key"] == post_calls[0]["tuple_key"]


def test_resolver_records_openfga_read_failures_to_audit_service(monkeypatch) -> None:
    monkeypatch.setenv("OPENFGA_STORE_ID", "store-1")
    audit_records: list[dict[str, object]] = []

    def fake_post(_url: str, **_kwargs: object) -> _Response:
        raise requests.RequestException("400 Bad Request")

    monkeypatch.setattr(
        "ai_platform_engineering.integrations.webex_bot.utils.webex_agent_routes.requests.post",
        fake_post,
    )
    resolver = WebexAgentRouteResolver(
        collection_factory=lambda: _Collection([]),
        audit_event_writer=audit_records.append,
    )

    matches = resolver.match_routes(
        bot_id="primary",
        workspace_id="CAIPE-WEBEX",
        space_id="space12345",
        is_bot=False,
        user_id="person1234",
        listen="mention",
    )

    assert matches == []
    assert len(audit_records) == 1
    assert audit_records[0] | {"ts": "ignored"} == {
        "type": "webex_runtime",
        "component": "webex_bot",
        "source": "webex",
        "outcome": "error",
        "action": "webex.route.openfga_read",
        "reason_code": "OPENFGA_READ_FAILED",
        "resource_ref": "webex_space:CAIPE-WEBEX--space12345",
        "message": "400 Bad Request",
        "ts": "ignored",
    }


def test_webex_workspace_ref_explicit_id_wins_over_alias(monkeypatch) -> None:
    monkeypatch.setenv("WEBEX_WORKSPACE_ALIAS", "CAIPE-WEBEX")
    monkeypatch.setenv("WEBEX_WORKSPACE_ID", "WFALLBACK")

    # Explicit workspace_id takes precedence so _load_routes' "unknown" fallback works.
    assert webex_workspace_ref("org-123") == "org-123"
    assert webex_workspace_ref("unknown") == "unknown"


def test_webex_workspace_ref_alias_used_when_no_id(monkeypatch) -> None:
    monkeypatch.setenv("WEBEX_WORKSPACE_ALIAS", "CAIPE-WEBEX")
    monkeypatch.setenv("WEBEX_WORKSPACE_ID", "WFALLBACK")

    # No argument → alias is the canonical namespace.
    assert webex_workspace_ref() == "CAIPE-WEBEX"


def test_resolver_explains_openfga_route_read_failure(monkeypatch) -> None:
    monkeypatch.setenv("OPENFGA_STORE_ID", "store-1")

    def fake_post(_url: str, **_kwargs: object) -> _Response:
        raise requests.RequestException("503 unavailable")

    monkeypatch.setattr(
        "ai_platform_engineering.integrations.webex_bot.utils.webex_agent_routes.requests.post",
        fake_post,
    )
    resolver = WebexAgentRouteResolver(collection_factory=lambda: _Collection([]))

    explanation = resolver.explain_no_route_match(
        bot_id="primary",
        workspace_id="CAIPE-WEBEX",
        space_id="space12345",
        is_bot=False,
        user_id="person1234",
        listen="mention",
        route_required=True,
    )

    assert explanation is not None
    assert "OpenFGA" in explanation
    assert resolver.last_error("primary", "CAIPE-WEBEX", "space12345") is not None


def _resolve_denies_when_last_error(mode: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEBEX_AGENT_ROUTES_MODE", mode)
    monkeypatch.delenv("WEBEX_DEFAULT_AGENT_ID", raising=False)

    class _FailingResolver(WebexAgentRouteResolver):
        def _load_openfga_agent_ids(self, workspace_id: str, space_id: str) -> list[str] | None:
            self._last_errors[(workspace_id, space_id)] = "openfga down"
            return None

    resolver = _FailingResolver(collection_factory=lambda: _Collection([]))

    async def _run() -> tuple[str | None, str | None]:
        return await resolve_webex_agent_route(
            bot_id="primary",
            workspace_id="CAIPE-WEBEX",
            space_id="space12345",
            person_id="person1234",
            text="hello",
            resolver=resolver,
        )

    agent_id, deny = asyncio.run(_run())

    assert agent_id is None
    assert deny is not None
    assert "OpenFGA" in deny


def test_resolve_webex_agent_route_denies_on_openfga_outage_db_prefer(monkeypatch) -> None:
    _resolve_denies_when_last_error("db_prefer", monkeypatch)


def test_resolve_webex_agent_route_denies_on_openfga_outage_db_only(monkeypatch) -> None:
    _resolve_denies_when_last_error("db_only", monkeypatch)


def test_route_required_without_space_agent_association_uses_setup_message() -> None:
    resolver = WebexAgentRouteResolver(
        collection_factory=lambda: _Collection([]),
        openfga_agent_ids_factory=lambda _workspace_id, _space_id: [],
    )

    explanation = resolver.explain_no_route_match(
        bot_id="primary",
        workspace_id="CAIPE-WEBEX",
        space_id="space12345",
        is_bot=False,
        user_id="person1234",
        listen="message",
        route_required=True,
    )

    assert explanation == (
        "This Webex space is not set up for CAIPE yet. Ask an admin to set up "
        "the Webex integration for this space in CAIPE."
    )


def test_resolve_webex_agent_route_db_prefer_falls_back_to_default_agent(monkeypatch) -> None:
    monkeypatch.setenv("WEBEX_AGENT_ROUTES_MODE", "db_prefer")
    monkeypatch.setenv("WEBEX_DEFAULT_AGENT_ID", "env-default-agent")

    resolver = WebexAgentRouteResolver(
        collection_factory=lambda: _Collection([]),
        openfga_agent_ids_factory=lambda _workspace_id, _space_id: [],
    )

    async def _run() -> tuple[str | None, str | None]:
        return await resolve_webex_agent_route(
            bot_id="primary",
            workspace_id="CAIPE-WEBEX",
            space_id="space12345",
            person_id="person1234",
            text="hello",
            resolver=resolver,
        )

    agent_id, deny = asyncio.run(_run())

    assert agent_id == "env-default-agent"
    assert deny is None


def test_gate_route_denied_when_default_resolver_openfga_fails(monkeypatch) -> None:
    monkeypatch.setenv("WEBEX_AGENT_ROUTES_MODE", "db_only")
    monkeypatch.setenv("OPENFGA_STORE_ID", "store-1")
    monkeypatch.delenv("WEBEX_DEFAULT_AGENT_ID", raising=False)

    def fake_post(_url: str, **_kwargs: object) -> _Response:
        raise requests.RequestException("openfga read failed")

    monkeypatch.setattr(
        "ai_platform_engineering.integrations.webex_bot.utils.webex_agent_routes.requests.post",
        fake_post,
    )
    import ai_platform_engineering.integrations.webex_bot.utils.webex_agent_routes as routes_mod

    routes_mod._default_resolver = None

    dispatcher = FakeDispatcher()
    result = asyncio.run(
        handle_webex_message(
            _event(),
            identity_linker=FakeIdentityLinker(),
            team_resolver=FakeTeamResolver(),
            obo_exchanger=FakeOboExchanger(),
            rebac_checker=FakeRebacChecker(),
            dispatcher=dispatcher,
        )
    )

    assert result.reason_code == "WEBEX_ROUTE_DENIED"
    assert dispatcher.calls == []
