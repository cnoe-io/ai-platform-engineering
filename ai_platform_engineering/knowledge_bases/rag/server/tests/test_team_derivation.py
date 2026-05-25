"""Tests for ``derive_team_for_request`` (Spec 2026-05-24-derive-team-from-channel).

Phase 3 of spec 2026-05-24-derive-team-from-channel is complete: the
signed team-scope JWT claim is gone. The RAG server picks the team
scope purely from request headers, with the channel-to-team mapping as
the canonical data-layer source.

Order of preference (deterministic for audit):

1. ``X-Team-Id`` request header — set by the Web UI BFF and the Slack/Webex
   bot envelopes once a channel→team mapping has been resolved upstream.
2. ``X-Channel-Id`` request header → ``channel_team_mappings`` →
   ``teams.slug`` — used when the caller hasn't pre-resolved a team.
3. ``None`` — caller (e.g. ``get_accessible_kb_ids``) interprets as "no
   team scope" and falls back to user / OpenFGA grants only.

The literal sentinel ``"__personal__"`` in ``X-Team-Id`` is normalized to
``None`` so downstream code stays simple. A missing or malformed
``user_context`` is also tolerated (some MCP / trusted-network paths pass
duck-typed stubs).
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


@pytest.mark.asyncio
class TestDeriveTeamForRequest:
    async def test_header_wins_over_channel(self):
        """``X-Team-Id`` is the explicit upstream-resolved team scope."""
        request = _make_request(
            {"X-Team-Id": "platform-eng", "X-Channel-Id": "C123"},
        )
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(return_value="should-not-be-used"),
        ) as resolver:
            result = await derive_team_for_request(request, SimpleNamespace())
        assert result == "platform-eng"
        resolver.assert_not_awaited()

    async def test_channel_id_fallback_when_no_header(self):
        request = _make_request({"X-Channel-Id": "C9999"})
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(return_value="ops-team"),
        ) as resolver:
            result = await derive_team_for_request(request, SimpleNamespace())
        assert result == "ops-team"
        resolver.assert_awaited_once_with("C9999")

    async def test_unmapped_channel_returns_none(self):
        """Unknown channel → DM-like fallback (no team scope)."""
        request = _make_request({"X-Channel-Id": "C-unknown"})
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(return_value=None),
        ):
            result = await derive_team_for_request(request, SimpleNamespace())
        assert result is None

    async def test_no_signals_returns_none(self):
        request = _make_request({})
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(return_value="should-not-be-called"),
        ) as resolver:
            result = await derive_team_for_request(request, SimpleNamespace())
        assert result is None
        resolver.assert_not_awaited()

    async def test_header_personal_marker_becomes_none_without_channel_fallback(self):
        request = _make_request(
            {"X-Team-Id": "__personal__", "X-Channel-Id": "C42"},
        )
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(return_value="ops-team"),
        ) as resolver:
            result = await derive_team_for_request(request, SimpleNamespace())
        # X-Team-Id=__personal__ is an explicit "personal mode" signal — honor
        # it instead of silently re-binding to a channel team.
        assert result is None
        resolver.assert_not_awaited()

    async def test_channel_resolver_error_returns_none_not_raises(self):
        """Mongo errors must NOT crash the request — degrade to no team."""
        request = _make_request({"X-Channel-Id": "C-broken"})
        with patch(
            "server.rbac._resolve_team_slug_from_channel",
            new=AsyncMock(side_effect=RuntimeError("mongo down")),
        ):
            result = await derive_team_for_request(request, SimpleNamespace())
        assert result is None

    async def test_none_request_returns_none(self):
        """Tools layer (MCP) may not have a Request object."""
        result = await derive_team_for_request(None, SimpleNamespace())
        assert result is None
