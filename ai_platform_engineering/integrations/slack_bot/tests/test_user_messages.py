"""User-facing Slack bot error message copy."""

from __future__ import annotations

import asyncio

import pytest

from ai_platform_engineering.integrations.slack_bot.utils.channel_team_resolver import (
    ChannelTeamResolver,
)
from ai_platform_engineering.integrations.slack_bot.utils import user_messages


def test_team_session_message_is_plain_language() -> None:
    message = user_messages.TEAM_SESSION_UNAVAILABLE_MESSAGE

    assert "I couldn't start your CAIPE session for this channel." in message
    for internal_term in ("Keycloak", "scope", "team-scoped", "provisioned", "slug"):
        assert internal_term not in message


def test_team_setup_incomplete_message_is_plain_language() -> None:
    message = user_messages.TEAM_SETUP_INCOMPLETE_MESSAGE.format(surface="channel")

    assert "team setup is incomplete" in message
    assert "try again" in message
    for internal_term in ("Keycloak", "scope", "provisioned", "slug"):
        assert internal_term not in message


def test_channel_resolver_uses_plain_language_for_incomplete_team(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolver = ChannelTeamResolver()
    monkeypatch.setattr(
        resolver,
        "_load_channel_team_sync",
        lambda _channel_id: {"_id": "team-1", "name": "Platform Eng"},
    )

    result = asyncio.run(resolver.resolve("C123", "kc-user-1"))

    assert result.team_slug is None
    assert result.deny_message == user_messages.TEAM_SETUP_INCOMPLETE_MESSAGE.format(
        surface="channel"
    )
