# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for Webex space-to-team resolution."""

from __future__ import annotations

import asyncio

import pytest

from ai_platform_engineering.integrations.webex_bot.utils.space_team_resolver import (
    WebexSpaceTeamResolver,
)


def test_resolve_denies_when_mongo_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    resolver = WebexSpaceTeamResolver()
    monkeypatch.setattr(resolver, "_get_client", lambda: None)

    result = asyncio.run(resolver.resolve("space-12345678"))
    assert result.team_slug is None
    assert result.deny_message is not None


def test_resolve_returns_team_slug_without_membership_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolver = WebexSpaceTeamResolver()

    team_doc = {
        "_id": "507f1f77bcf86cd799439011",
        "slug": "platform-eng",
        "name": "Platform Eng",
        "members": [],
    }

    monkeypatch.setattr(resolver, "_load_space_team_sync", lambda _space_id: team_doc)

    result = asyncio.run(resolver.resolve("space-12345678"))
    assert result.team_slug == "platform-eng"
    assert result.deny_message is None


def test_resolve_denies_invalid_team_slug(monkeypatch: pytest.MonkeyPatch) -> None:
    resolver = WebexSpaceTeamResolver()

    team_doc = {
        "_id": "507f1f77bcf86cd799439011",
        "slug": "",
        "name": "Broken Team",
        "members": [{"user_id": "kc-user-1"}],
    }

    monkeypatch.setattr(
        resolver,
        "_load_space_team_sync",
        lambda _space_id: team_doc,
    )

    result = asyncio.run(resolver.resolve("space-12345678"))
    assert result.team_slug is None
    assert result.deny_message is not None
