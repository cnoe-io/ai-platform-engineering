"""User-facing Webex bot error message copy."""

from __future__ import annotations

import asyncio

import pytest

from ai_platform_engineering.integrations.webex_bot.utils.space_team_resolver import (
    WebexSpaceTeamResolver,
)
from ai_platform_engineering.integrations.webex_bot.utils import user_messages


def test_team_session_message_is_plain_language() -> None:
    message = user_messages.TEAM_SESSION_UNAVAILABLE_MESSAGE

    assert "I couldn't start your CAIPE session for this Webex space." in message
    for internal_term in ("Keycloak", "scope", "team-scoped", "provisioned", "slug"):
        assert internal_term not in message


def test_team_setup_incomplete_message_is_plain_language() -> None:
    message = user_messages.TEAM_SETUP_INCOMPLETE_MESSAGE.format(surface="Webex space")

    assert "team setup is incomplete" in message
    assert "try again" in message
    for internal_term in ("Keycloak", "scope", "provisioned", "slug"):
        assert internal_term not in message


def test_space_resolver_uses_plain_language_for_incomplete_team(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolver = WebexSpaceTeamResolver()
    monkeypatch.setattr(
        resolver,
        "_load_space_team_sync",
        lambda _space_id: {"_id": "team-1", "name": "Platform Eng"},
    )

    result = asyncio.run(resolver.resolve("space12345", "kc-user-1"))

    assert result.team_slug is None
    assert result.deny_message == user_messages.TEAM_SETUP_INCOMPLETE_MESSAGE.format(
        surface="Webex space"
    )
