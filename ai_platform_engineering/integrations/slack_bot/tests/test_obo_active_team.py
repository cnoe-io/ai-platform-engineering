# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Phase 2 OBO contract (spec 2026-05-24-derive-team-from-channel).

After Phase 2, the bot's OBO exchange is **team-agnostic**:

1. ``impersonate_user`` takes only the Keycloak ``sub`` — no
   ``active_team`` parameter. The bot does not select a Keycloak client
   scope per team anymore.
2. The OBO request body has ``scope=openid`` and **does not** include any
   ``team-<slug>`` / ``team-personal`` scope.
3. ``_do_exchange`` does **not** compare any "expected active team"
   against the returned token. That mismatch check existed only to
   defend the Phase 1 team-scope contract; Phase 2 deletes that contract.
4. ``downstream_auth_headers`` keeps emitting just ``Authorization`` —
   the legacy ``X-Team-Id`` header has been gone since Spec 104.

Phase 3 will delete the now-unused ``_apply_active_team`` helper,
``PERSONAL_ACTIVE_TEAM`` constant, and the ``OboToken.active_team``
field. Until then this file proves the helper is unreachable from the
production code path.
"""

from __future__ import annotations

import asyncio
import base64
import inspect
import json
from typing import Any
from unittest.mock import patch

import pytest

from ai_platform_engineering.integrations.slack_bot.utils import obo_exchange
from ai_platform_engineering.integrations.slack_bot.utils.obo_exchange import (
    OboExchangeConfig,
    downstream_auth_headers,
    exchange_token,
    impersonate_user,
)


def _make_jwt(claims: dict[str, Any]) -> str:
    """Build an unsigned JWT-shaped string with the given payload claims."""
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
        caipe_platform_audience="caipe-platform",
    )


class FakeResponse:
    """Drop-in for httpx.Response used by `_do_exchange`."""

    def __init__(self, status_code: int, payload: dict[str, Any]):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self) -> dict[str, Any]:
        return self._payload


def test_default_audience_targets_caipe_ui_bff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KEYCLOAK_BOT_AUDIENCE", raising=False)
    monkeypatch.delenv("CAIPE_PLATFORM_AUDIENCE", raising=False)

    assert OboExchangeConfig().caipe_platform_audience == "caipe-platform"


def test_caipe_platform_audience_env_overrides_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("KEYCLOAK_BOT_AUDIENCE", raising=False)
    monkeypatch.setenv("CAIPE_PLATFORM_AUDIENCE", "custom-platform")

    assert OboExchangeConfig().caipe_platform_audience == "custom-platform"


class TestPhase2Signatures:
    """The public OBO functions must not accept an `active_team` parameter."""

    def test_impersonate_user_has_no_active_team_param(self) -> None:
        sig = inspect.signature(impersonate_user)
        assert "active_team" not in sig.parameters, (
            "Phase 2 removed active_team from impersonate_user; OBO is now "
            "team-agnostic. Found: " + ", ".join(sig.parameters)
        )

    def test_exchange_token_has_no_active_team_param(self) -> None:
        sig = inspect.signature(exchange_token)
        assert "active_team" not in sig.parameters, (
            "Phase 2 removed active_team from exchange_token; OBO is now "
            "team-agnostic. Found: " + ", ".join(sig.parameters)
        )


class TestPhase2RequestBody:
    """The OBO POST body MUST NOT include any team-<slug> / team-personal scope."""

    def _run_impersonate(self, captured: dict[str, Any]) -> None:
        minted = _make_jwt({"sub": "u1"})
        fake_resp = FakeResponse(
            200,
            {"access_token": minted, "token_type": "Bearer", "expires_in": 60},
        )

        class FakeClient:
            async def __aenter__(self) -> "FakeClient":
                return self

            async def __aexit__(self, *exc: object) -> None:
                return None

            async def post(
                self, url: str, *, data: dict[str, str], **_: object
            ) -> FakeResponse:
                captured["url"] = url
                captured["data"] = data
                return fake_resp

        with patch.object(obo_exchange.httpx, "AsyncClient", lambda *a, **kw: FakeClient()):
            asyncio.run(impersonate_user("u1", _config()))

    def test_impersonate_user_does_not_request_team_scope(self) -> None:
        captured: dict[str, Any] = {}
        self._run_impersonate(captured)

        data = captured["data"]
        scope_tokens = data.get("scope", "").split() if data.get("scope") else []
        assert all(not t.startswith("team-") for t in scope_tokens), (
            f"Phase 2 OBO request body must not include a team-<slug> scope; "
            f"got scope={data.get('scope')!r}"
        )
        # Audience pin remains — that's the platform-token contract.
        assert data.get("audience") == "caipe-platform"

    def test_exchange_token_does_not_request_team_scope(self) -> None:
        captured: dict[str, Any] = {}
        minted = _make_jwt({"sub": "u1"})
        fake_resp = FakeResponse(
            200,
            {"access_token": minted, "token_type": "Bearer", "expires_in": 60},
        )

        class FakeClient:
            async def __aenter__(self) -> "FakeClient":
                return self

            async def __aexit__(self, *exc: object) -> None:
                return None

            async def post(
                self, url: str, *, data: dict[str, str], **_: object
            ) -> FakeResponse:
                captured["data"] = data
                return fake_resp

        with patch.object(obo_exchange.httpx, "AsyncClient", lambda *a, **kw: FakeClient()):
            asyncio.run(exchange_token("user-token", _config()))

        data = captured["data"]
        scope_tokens = data.get("scope", "").split() if data.get("scope") else []
        assert all(not t.startswith("team-") for t in scope_tokens)


class TestPhase2NoMismatchCheck:
    """Phase 2 deletes the active_team-mismatch defense in _do_exchange.

    The defense existed solely to protect the per-team-scope contract.
    With OBO team-agnostic the check is meaningless — the returned token
    has no active_team to compare against, and a stray active_team claim
    in the response (from a stale Keycloak mapper) MUST NOT block the
    exchange.
    """

    def test_response_with_stale_active_team_claim_is_accepted(self) -> None:
        # Token comes back carrying an unexpected `active_team` claim
        # (e.g. a legacy Keycloak mapper that survived the migration).
        # Phase 2 says: we don't care.
        minted = _make_jwt({"sub": "u1", "active_team": "leftover-from-old-mapper"})
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
            token = asyncio.run(impersonate_user("u1", _config()))

        # The OboToken.active_team field still surfaces whatever the
        # token contains (Phase 3 will remove the field entirely), but
        # the exchange itself must succeed.
        assert token.access_token == minted


def test_downstream_auth_headers_drops_x_team_id() -> None:
    """The legacy X-Team-Id header is gone."""
    headers = downstream_auth_headers("any-token")
    assert headers == {"Authorization": "Bearer any-token"}
    assert "X-Team-Id" not in headers
    assert "x-team-id" not in {k.lower() for k in headers}
