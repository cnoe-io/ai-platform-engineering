"""Tests for ``derive_team_for_request`` (Spec 2026-05-24-derive-team-from-channel).

Phase 1 of the active_team migration centralizes how the RAG server picks
which team scope to apply when fanning out a request. The legacy path is
still claim-first, but if the claim is absent the server falls back to a
data-layer lookup keyed by ``X-Channel-Id`` (set by the bots / BFF) against
the ``channel_team_mappings`` MongoDB collection.

Order of preference (must be deterministic for audit):

1. ``user_context.active_team`` (signed ``active_team`` JWT claim) — wins.
2. ``X-Team-Id`` request header — legacy fallback (still emitted by some
   service-account callers during the transition window).
3. ``X-Channel-Id`` request header → ``channel_team_mappings`` →
   ``teams.slug`` (Phase 1 addition).
4. ``None`` — caller (e.g. ``get_accessible_kb_ids``) interprets as "no
   team scope" and falls back to user / OpenFGA grants only.

The literal sentinel ``"__personal__"`` is normalized to ``None`` at any
step so downstream code stays simple.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Optional
from unittest.mock import AsyncMock, patch

import pytest

from server.rbac import derive_team_for_request


def _make_request(headers: Optional[dict] = None) -> SimpleNamespace:
    """Build a minimal duck-typed Request stub with .headers.get()."""
    headers = headers or {}
    return SimpleNamespace(headers=headers)


def _make_user(active_team: Optional[str] = None) -> SimpleNamespace:
    return SimpleNamespace(active_team=active_team)


@pytest.mark.asyncio
class TestDeriveTeamForRequest:
    async def test_claim_wins_over_header_and_channel(self):
        """The active_team claim is the single source of truth when present."""
        request = _make_request(
            {"X-Team-Id": "legacy-team", "X-Channel-Id": "C123"},
        )
        user = _make_user(active_team="platform-eng")
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(return_value="should-not-be-used"),
        ) as resolver:
            result = await derive_team_for_request(request, user)
        assert result == "platform-eng"
        resolver.assert_not_awaited()

    async def test_claim_personal_marker_becomes_none(self):
        request = _make_request({"X-Channel-Id": "C123"})
        user = _make_user(active_team="__personal__")
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(return_value="some-team"),
        ) as resolver:
            result = await derive_team_for_request(request, user)
        # __personal__ sentinel short-circuits to None — DO NOT fall back to
        # channel lookup (the user explicitly chose personal mode).
        assert result is None
        resolver.assert_not_awaited()

    async def test_header_fallback_when_claim_absent(self):
        request = _make_request({"X-Team-Id": "legacy-team"})
        user = _make_user(active_team=None)
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(return_value="channel-team"),
        ) as resolver:
            result = await derive_team_for_request(request, user)
        assert result == "legacy-team"
        # We tried the X-Team-Id path first, so channel lookup is not used.
        resolver.assert_not_awaited()

    async def test_channel_id_fallback_when_neither_claim_nor_header(self):
        request = _make_request({"X-Channel-Id": "C9999"})
        user = _make_user(active_team=None)
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(return_value="ops-team"),
        ) as resolver:
            result = await derive_team_for_request(request, user)
        assert result == "ops-team"
        resolver.assert_awaited_once_with("C9999")

    async def test_unmapped_channel_returns_none(self):
        """Unknown channel → DM-like fallback (no team scope)."""
        request = _make_request({"X-Channel-Id": "C-unknown"})
        user = _make_user(active_team=None)
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(return_value=None),
        ):
            result = await derive_team_for_request(request, user)
        assert result is None

    async def test_no_signals_returns_none(self):
        request = _make_request({})
        user = _make_user(active_team=None)
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(return_value="should-not-be-called"),
        ) as resolver:
            result = await derive_team_for_request(request, user)
        assert result is None
        resolver.assert_not_awaited()

    async def test_header_personal_marker_becomes_none_without_channel_fallback(self):
        request = _make_request(
            {"X-Team-Id": "__personal__", "X-Channel-Id": "C42"},
        )
        user = _make_user(active_team=None)
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(return_value="ops-team"),
        ) as resolver:
            result = await derive_team_for_request(request, user)
        # X-Team-Id=__personal__ is an explicit "personal mode" signal from
        # legacy callers — honor it instead of silently re-binding to a
        # channel team.
        assert result is None
        resolver.assert_not_awaited()

    async def test_channel_resolver_error_returns_none_not_raises(self):
        """Mongo errors must NOT crash the request — degrade to no team."""
        request = _make_request({"X-Channel-Id": "C-broken"})
        user = _make_user(active_team=None)
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(side_effect=RuntimeError("mongo down")),
        ):
            result = await derive_team_for_request(request, user)
        assert result is None

    async def test_user_context_without_active_team_attr_is_tolerated(self):
        """``UserContext`` may be a stub in trusted-network mode without the field."""
        request = _make_request({})
        # No active_team attribute at all.
        user = SimpleNamespace()
        result = await derive_team_for_request(request, user)
        assert result is None

    async def test_none_request_falls_back_to_user_claim(self):
        """Tools layer (MCP) may not have a Request object; still works."""
        user = _make_user(active_team="platform-eng")
        result = await derive_team_for_request(None, user)
        assert result == "platform-eng"

    async def test_none_request_and_no_claim_returns_none(self):
        user = _make_user(active_team=None)
        result = await derive_team_for_request(None, user)
        assert result is None
