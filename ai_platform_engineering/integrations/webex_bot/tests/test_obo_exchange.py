# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for Webex bot OBO token-exchange — Phase 2 (team-agnostic).

Mirror of the Slack-bot ``test_obo_active_team.py`` contract. Phase 2 of
spec 2026-05-24-derive-team-from-channel makes OBO team-agnostic:

1. ``impersonate_user`` no longer accepts an ``active_team`` parameter.
2. The OBO request body has no ``team-<slug>`` / ``team-personal`` scope.
3. ``_do_exchange`` no longer compares any expected active_team against
   the returned token's claim.
"""

from __future__ import annotations

import asyncio
import base64
import inspect
import json
from typing import Any
from unittest.mock import patch

import pytest

from ai_platform_engineering.integrations.webex_bot.utils import obo_exchange
from ai_platform_engineering.integrations.webex_bot.utils.obo_exchange import (
    OboExchangeConfig,
    downstream_auth_headers,
    impersonate_user,
)


def _make_jwt(claims: dict[str, Any]) -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    return f"{header}.{payload}.sig"


def _config() -> OboExchangeConfig:
    return OboExchangeConfig(
        server_url="http://kc.example",
        realm="caipe",
        bot_client_id="caipe-webex-bot",
        bot_client_secret="shh",
        caipe_platform_audience="caipe-platform",
    )


class FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any]):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self) -> dict[str, Any]:
        return self._payload


def test_default_audience_targets_caipe_ui_bff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KEYCLOAK_WEBEX_BOT_AUDIENCE", raising=False)
    monkeypatch.delenv("CAIPE_PLATFORM_AUDIENCE", raising=False)

    assert OboExchangeConfig().caipe_platform_audience == "caipe-platform"


def test_caipe_platform_audience_env_overrides_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("KEYCLOAK_WEBEX_BOT_AUDIENCE", raising=False)
    monkeypatch.setenv("CAIPE_PLATFORM_AUDIENCE", "custom-platform")

    assert OboExchangeConfig().caipe_platform_audience == "custom-platform"


class TestPhase2Signature:
    def test_impersonate_user_has_no_active_team_param(self) -> None:
        sig = inspect.signature(impersonate_user)
        assert "active_team" not in sig.parameters, (
            "Phase 2 removed active_team from Webex impersonate_user. "
            "Found params: " + ", ".join(sig.parameters)
        )


class TestPhase2RequestBody:
    def test_no_team_scope_in_request(self) -> None:
        captured: dict[str, Any] = {}
        minted = _make_jwt({"sub": "u1"})
        fake_resp = FakeResponse(
            200, {"access_token": minted, "token_type": "Bearer", "expires_in": 60}
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
            asyncio.run(impersonate_user("u1", _config()))

        data = captured["data"]
        scope_tokens = data.get("scope", "").split() if data.get("scope") else []
        assert all(not t.startswith("team-") for t in scope_tokens), (
            f"Phase 2 Webex OBO must not request team-* scope; got scope={data.get('scope')!r}"
        )
        assert data.get("audience") == "caipe-platform"


class TestPhase2NoMismatchCheck:
    def test_stale_active_team_claim_accepted(self) -> None:
        """A leftover active_team claim from a stale Keycloak mapper MUST
        NOT cause the exchange to fail."""
        minted = _make_jwt({"sub": "u1", "active_team": "stale"})
        fake_resp = FakeResponse(
            200, {"access_token": minted, "token_type": "Bearer", "expires_in": 60}
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

        assert token.access_token == minted


def test_downstream_auth_headers_only_bearer() -> None:
    headers = downstream_auth_headers("any-token")
    assert headers == {"Authorization": "Bearer any-token"}
