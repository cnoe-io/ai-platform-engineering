"""Direct-user resolver modes and route matching."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from ai_platform_engineering.integrations.webex_bot.utils.webex_direct_users import (
    WebexDirectUserResolver,
)


class _Collection:
    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.documents = documents

    def find_one(self, query: dict[str, Any]) -> dict[str, Any] | None:
        return next(
            (doc for doc in self.documents if all(doc.get(key) == value for key, value in query.items())),
            None,
        )


def _set_bot_policy(
    monkeypatch,
    *,
    mode: str,
    bot_id: str = "primary",
) -> None:
    candidate: dict[str, object] = {
        "id": bot_id,
        "name": bot_id.title(),
        "tokenEnv": f"{bot_id.upper()}_TOKEN",
        "spaces": {"accessMode": "allowlist"},
        "directMessages": {"accessMode": mode},
    }
    if mode == "all_users":
        candidate["directMessages"] = {
            "accessMode": "all_users",
            "defaultAgentId": "agent-default",
        }
    monkeypatch.setenv("WEBEX_INTEGRATION_BOTS_JSON", json.dumps([candidate]))


def test_disabled_mode_never_reads_storage(monkeypatch) -> None:
    _set_bot_policy(monkeypatch, mode="disabled")
    resolver = WebexDirectUserResolver(
        collection_factory=lambda: (_ for _ in ()).throw(AssertionError("storage read")),
    )
    result = asyncio.run(
        resolver.resolve(bot_id="primary", webex_user_id="person1234", person_email="user@example.com")
    )
    assert result.allowed is False
    assert result.reason == "disabled"


def test_allowlist_matches_bot_and_email(monkeypatch) -> None:
    _set_bot_policy(monkeypatch, mode="allowlist", bot_id="secondary")
    collection = _Collection([
        {
            "bot_id": "secondary",
            "status": "active",
            "expected_webex_email": "user@example.com",
            "keycloak_user_id": "kc-user-1",
            "agent_id": "agent-1",
        }
    ])
    resolver = WebexDirectUserResolver(collection_factory=lambda: collection)  # type: ignore[arg-type]
    result = asyncio.run(
        resolver.resolve(bot_id="secondary", webex_user_id="person1234", person_email="USER@example.com")
    )
    assert result.allowed is True
    assert result.keycloak_user_id == "kc-user-1"
    assert result.agent_id == "agent-1"


def test_all_users_admits_enabled_deployment_user_with_bot_defaults(monkeypatch) -> None:
    _set_bot_policy(monkeypatch, mode="all_users")

    async def user_by_email(email: str) -> dict[str, Any] | None:
        return {"id": "kc-user-1", "email": email, "enabled": True}

    resolver = WebexDirectUserResolver(
        collection_factory=lambda: _Collection([]),  # type: ignore[arg-type]
        user_by_email=user_by_email,
    )
    result = asyncio.run(
        resolver.resolve(bot_id="primary", webex_user_id="person1234", person_email="user@example.com")
    )
    assert result.allowed is True
    assert result.keycloak_user_id == "kc-user-1"
    assert result.agent_id == "agent-default"
    assert result.reason == "all_users"


def test_same_user_can_have_independent_routes_for_multiple_bots(monkeypatch) -> None:
    monkeypatch.setenv(
        "WEBEX_INTEGRATION_BOTS_JSON",
        json.dumps(
            [
                {
                    "id": bot_id,
                    "name": bot_id.title(),
                    "tokenEnv": f"{bot_id.upper()}_TOKEN",
                    "spaces": {"accessMode": "allowlist"},
                    "directMessages": {"accessMode": "allowlist"},
                }
                for bot_id in ("primary", "secondary")
            ]
        ),
    )
    collection = _Collection([
        {
            "bot_id": "primary",
            "status": "active",
            "expected_webex_email": "user@example.com",
            "keycloak_user_id": "kc-user-1",
            "agent_id": "agent-1",
        },
        {
            "bot_id": "secondary",
            "status": "active",
            "expected_webex_email": "user@example.com",
            "keycloak_user_id": "kc-user-1",
            "agent_id": "agent-2",
        },
    ])
    resolver = WebexDirectUserResolver(collection_factory=lambda: collection)  # type: ignore[arg-type]

    result = asyncio.run(
        resolver.resolve(
            bot_id="secondary",
            webex_user_id="person1234",
            person_email="user@example.com",
        )
    )

    assert result.allowed is True
    assert result.agent_id == "agent-2"


def test_all_users_explicit_deny_overrides_inherited_access(monkeypatch) -> None:
    _set_bot_policy(monkeypatch, mode="all_users")
    collection = _Collection(
        [
            {
                "bot_id": "primary",
                "status": "disabled",
                "expected_webex_email": "user@example.com",
                "keycloak_user_id": "kc-user-1",
            }
        ]
    )
    resolver = WebexDirectUserResolver(
        collection_factory=lambda: collection,  # type: ignore[arg-type]
    )

    result = asyncio.run(
        resolver.resolve(
            bot_id="primary",
            webex_user_id="person1234",
            person_email="user@example.com",
        )
    )

    assert result.allowed is False
    assert result.reason == "explicit_deny"
