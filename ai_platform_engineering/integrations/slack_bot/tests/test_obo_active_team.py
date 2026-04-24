# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Spec 104 — OBO token exchange with `active_team` Keycloak client scope.

Verifies the load-bearing invariants of
:func:`ai_platform_engineering.integrations.slack_bot.utils.obo_exchange`:

1. ``impersonate_user`` rejects empty / invalid team slugs as a programmer
   error before any HTTP call (no token leak, no weird audit trail).
2. The OBO request body is built with ``scope=openid team-<slug>`` for a
   real team and ``scope=openid team-personal`` for the ``__personal__``
   sentinel.
3. ``aud=<agentgateway audience>`` is always pinned in the request so the
   minted token is acceptable to AGW.
4. The returned JWT's ``active_team`` claim is verified against what was
   requested. A mismatch (Keycloak misconfiguration / scope spoofing)
   raises ``OboExchangeError`` instead of silently issuing a token with
   the wrong team scope.
5. ``downstream_auth_headers`` no longer attaches the legacy
   ``X-Team-Id`` header — team scope MUST come from the JWT now.
"""

from __future__ import annotations

import asyncio
import base64
import json
from typing import Any
from unittest.mock import patch

import pytest

from ai_platform_engineering.integrations.slack_bot.utils import obo_exchange
from ai_platform_engineering.integrations.slack_bot.utils.obo_exchange import (
    OboExchangeConfig,
    OboExchangeError,
    PERSONAL_ACTIVE_TEAM,
    PERSONAL_SCOPE_NAME,
    _apply_active_team,
    _is_valid_slug,
    downstream_auth_headers,
    impersonate_user,
)


def _make_jwt(claims: dict[str, Any]) -> str:
    """Build an unsigned JWT-shaped string with the given payload claims.

    The OBO verifier only base64-decodes the payload — it never validates
    signatures (Keycloak already did that on the wire). So a header.payload.
    blob is enough to exercise the `_extract_active_team_claim` branch.
    """
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
    payload = (
        base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    )
    return f"{header}.{payload}.sig"


def _config() -> OboExchangeConfig:
    return OboExchangeConfig(
        server_url="http://kc.example",
        realm="caipe",
        bot_client_id="caipe-slack-bot",
        bot_client_secret="shh",
        agentgateway_audience="agentgateway",
    )


class FakeResponse:
    """Drop-in for httpx.Response used by `_do_exchange`."""

    def __init__(self, status_code: int, payload: dict[str, Any]):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self) -> dict[str, Any]:
        return self._payload


@pytest.mark.parametrize("slug", ["", " ", None, "Has Space", "_leading", "x" * 64, "-bad"])
def test_is_valid_slug_rejects_bad_inputs(slug: str | None) -> None:
    assert not _is_valid_slug(slug or "")


@pytest.mark.parametrize("slug", ["a", "platform-eng", "team1", "x" * 63])
def test_is_valid_slug_accepts_good_inputs(slug: str) -> None:
    assert _is_valid_slug(slug)


def test_apply_active_team_personal_marker() -> None:
    data: dict[str, str] = {"scope": "openid"}
    _apply_active_team(data, PERSONAL_ACTIVE_TEAM)
    assert PERSONAL_SCOPE_NAME in data["scope"].split()


def test_apply_active_team_team_slug() -> None:
    data: dict[str, str] = {"scope": "openid"}
    _apply_active_team(data, "platform-eng")
    assert "team-platform-eng" in data["scope"].split()


def test_apply_active_team_invalid_slug_raises() -> None:
    """An invalid slug at the OBO call site is a programmer error — we
    never want to silently mint a token with no team scope when the
    caller asked for a specific one."""
    with pytest.raises(ValueError):
        _apply_active_team({}, "Bad Slug!")


def test_apply_active_team_none_is_noop() -> None:
    data: dict[str, str] = {"scope": "openid"}
    _apply_active_team(data, None)
    assert data["scope"] == "openid"


def test_impersonate_user_requires_active_team() -> None:
    with pytest.raises(ValueError):
        asyncio.run(impersonate_user("kc-user-id", _config(), active_team=""))


def test_impersonate_user_pins_audience_and_scope_for_personal() -> None:
    """For DMs the bot calls with active_team=__personal__ → the request
    body must include `audience=agentgateway` and `scope` containing
    `team-personal`."""
    captured: dict[str, Any] = {}

    minted = _make_jwt({"sub": "u1", "active_team": PERSONAL_ACTIVE_TEAM})
    fake_resp = FakeResponse(
        200,
        {"access_token": minted, "token_type": "Bearer", "expires_in": 60},
    )

    class FakeClient:
        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def post(self, url: str, *, data: dict[str, str], **_: object) -> FakeResponse:
            captured["url"] = url
            captured["data"] = data
            return fake_resp

    with patch.object(obo_exchange.httpx, "AsyncClient", lambda *a, **kw: FakeClient()):
        token = asyncio.run(
            impersonate_user("u1", _config(), active_team=PERSONAL_ACTIVE_TEAM)
        )

    assert token.access_token == minted
    assert token.active_team == PERSONAL_ACTIVE_TEAM
    data = captured["data"]
    assert data.get("audience") == "agentgateway"
    assert PERSONAL_SCOPE_NAME in data.get("scope", "").split()


def test_impersonate_user_pins_team_slug_scope() -> None:
    captured: dict[str, Any] = {}
    slug = "platform-eng"
    minted = _make_jwt({"sub": "u1", "active_team": slug})
    fake_resp = FakeResponse(
        200,
        {"access_token": minted, "token_type": "Bearer", "expires_in": 60},
    )

    class FakeClient:
        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def post(self, url: str, *, data: dict[str, str], **_: object) -> FakeResponse:
            captured["data"] = data
            return fake_resp

    with patch.object(obo_exchange.httpx, "AsyncClient", lambda *a, **kw: FakeClient()):
        token = asyncio.run(impersonate_user("u1", _config(), active_team=slug))

    assert token.active_team == slug
    assert f"team-{slug}" in captured["data"].get("scope", "").split()


def test_impersonate_user_rejects_active_team_mismatch() -> None:
    """If Keycloak returns a token whose `active_team` claim doesn't
    match what we asked for (misconfigured scope, scope spoofing, ...)
    the OBO module MUST raise — silently issuing the wrong-team token
    would defeat the entire spec 104 refactor."""
    requested = "platform-eng"
    minted = _make_jwt({"sub": "u1", "active_team": "OTHER-TEAM"})
    fake_resp = FakeResponse(
        200,
        {"access_token": minted, "token_type": "Bearer", "expires_in": 60},
    )

    class FakeClient:
        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def post(self, *a: object, **kw: object) -> FakeResponse:
            return fake_resp

    with patch.object(obo_exchange.httpx, "AsyncClient", lambda *a, **kw: FakeClient()):
        with pytest.raises(OboExchangeError, match="active_team"):
            asyncio.run(impersonate_user("u1", _config(), active_team=requested))


def test_downstream_auth_headers_drops_x_team_id() -> None:
    """Spec 104: the legacy X-Team-Id header is gone — team scope MUST
    travel inside the JWT now."""
    headers = downstream_auth_headers("any-token")
    assert headers == {"Authorization": "Bearer any-token"}
    assert "X-Team-Id" not in headers
    assert "x-team-id" not in {k.lower() for k in headers}
