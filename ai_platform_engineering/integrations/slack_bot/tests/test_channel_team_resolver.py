"""Slack channel team membership resolution."""

from __future__ import annotations

import asyncio
from typing import Optional

from ai_platform_engineering.integrations.slack_bot.utils.channel_team_resolver import (
    ChannelTeamResolver,
)


def test_resolve_allows_openfga_team_member_without_legacy_member_list() -> None:
    resolver = ChannelTeamResolver()
    resolver._load_channel_team_sync = lambda _channel_id: {  # type: ignore[method-assign]
        "_id": "team-1",
        "slug": "platform-eng",
        "name": "Platform Eng",
        "members": [],
    }

    async def openfga_member(_team_slug: str, _keycloak_user_id: str) -> Optional[bool]:
        return True

    resolver._user_is_openfga_team_member = openfga_member  # type: ignore[method-assign]

    result = asyncio.run(resolver.resolve("C123", "kc-user-1"))

    assert result.team_slug == "platform-eng"
    assert result.deny_message is None


def test_resolve_denies_when_openfga_team_member_check_denies_legacy_member() -> None:
    resolver = ChannelTeamResolver()
    resolver._load_channel_team_sync = lambda _channel_id: {  # type: ignore[method-assign]
        "_id": "team-1",
        "slug": "platform-eng",
        "name": "Platform Eng",
        "members": [{"user_id": "kc-user-1"}],
    }

    async def openfga_member(_team_slug: str, _keycloak_user_id: str) -> Optional[bool]:
        return False

    resolver._user_is_openfga_team_member = openfga_member  # type: ignore[method-assign]

    result = asyncio.run(resolver.resolve("C123", "kc-user-1"))

    assert result.team_slug is None
    assert "member" in (result.deny_message or "").lower()
