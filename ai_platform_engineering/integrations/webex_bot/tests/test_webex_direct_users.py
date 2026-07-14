"""Direct-user resolver modes and route matching."""

from __future__ import annotations

import asyncio
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


def test_disabled_mode_never_reads_storage(monkeypatch) -> None:
    monkeypatch.setenv("WEBEX_DM_ACCESS_MODE", "disabled")
    resolver = WebexDirectUserResolver(
        collection_factory=lambda: (_ for _ in ()).throw(AssertionError("storage read")),
    )
    result = asyncio.run(
        resolver.resolve(bot_id="primary", webex_user_id="person1234", person_email="user@example.com")
    )
    assert result.allowed is False
    assert result.reason == "disabled"


def test_allowlist_matches_bot_and_email(monkeypatch) -> None:
    monkeypatch.setenv("WEBEX_DM_ACCESS_MODE", "allowlist")
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


def test_all_users_requires_exact_enabled_deployment_user_and_default_agent(monkeypatch) -> None:
    monkeypatch.setenv("WEBEX_DM_ACCESS_MODE", "all_users")
    monkeypatch.setenv("WEBEX_DEFAULT_AGENT_ID", "agent-default")
    monkeypatch.setenv(
        "WEBEX_INTEGRATION_BOTS_JSON",
        '[{"id":"primary","name":"Primary","tokenEnv":"BOT_TOKEN"}]',
    )

    async def user_by_email(email: str) -> dict[str, Any] | None:
        return {"id": "kc-user-1", "email": email, "enabled": True}

    resolver = WebexDirectUserResolver(
        collection_factory=lambda: None,
        user_by_email=user_by_email,
    )
    result = asyncio.run(
        resolver.resolve(bot_id="primary", webex_user_id="person1234", person_email="user@example.com")
    )
    assert result.allowed is True
    assert result.keycloak_user_id == "kc-user-1"
    assert result.agent_id == "agent-default"


def test_same_user_can_have_independent_routes_for_multiple_bots(monkeypatch) -> None:
    monkeypatch.setenv("WEBEX_DM_ACCESS_MODE", "allowlist")
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
