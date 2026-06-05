"""Slack channel team resolution."""

from __future__ import annotations

import asyncio

from ai_platform_engineering.integrations.slack_bot.utils.channel_team_resolver import (
    ChannelTeamResolver,
)


def test_resolve_returns_team_slug_for_mapped_channel() -> None:
    resolver = ChannelTeamResolver()
    resolver._load_channel_team_sync = lambda _channel_id: {  # type: ignore[method-assign]
        "_id": "team-1",
        "slug": "platform-eng",
        "name": "Platform Eng",
    }

    result = asyncio.run(resolver.resolve("C123"))

    assert result.team_slug == "platform-eng"
    assert result.team_id == "team-1"
    assert result.team_name == "Platform Eng"
    assert result.deny_message is None


def test_resolve_denies_when_channel_not_mapped() -> None:
    resolver = ChannelTeamResolver()
    resolver._load_channel_team_sync = lambda _channel_id: None  # type: ignore[method-assign]

    result = asyncio.run(resolver.resolve("C123"))

    assert result.team_slug is None
    assert result.deny_message is not None


def test_resolve_denies_when_team_has_no_slug() -> None:
    resolver = ChannelTeamResolver()
    resolver._load_channel_team_sync = lambda _channel_id: {  # type: ignore[method-assign]
        "_id": "team-1",
        "name": "Platform Eng",
    }

    result = asyncio.run(resolver.resolve("C123"))

    assert result.team_slug is None
    assert result.deny_message is not None
