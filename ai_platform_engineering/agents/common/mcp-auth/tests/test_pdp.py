# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for the optional Keycloak PDP scope check."""

from __future__ import annotations

import asyncio
import httpx
import pytest

from mcp_agent_auth import pdp

PDP_BASE_ENV = {
    "MCP_PDP_ENABLED": "true",
    "MCP_PDP_RESOURCE": "mcp_jira",
    "MCP_PDP_SCOPE": "invoke",
    "MCP_PDP_TOKEN_ENDPOINT": "https://kc.example/realms/r/protocol/openid-connect/token",
    "MCP_PDP_AUDIENCE": "mcp_jira",
}


@pytest.fixture
def pdp_env(monkeypatch):
    for k, v in PDP_BASE_ENV.items():
        monkeypatch.setenv(k, v)
    yield monkeypatch


def _patch_response(monkeypatch, *, status_code: int = 200, body=None):
    """Stub out httpx.AsyncClient so the test never touches the network.

    We replace ``httpx.AsyncClient`` at the module level to avoid the
    fragility of patching the real httpx transport (and to keep the
    test fast).
    """
    if body is None:
        body = {"result": True}

    class _StubResponse:
        def __init__(self):
            self.status_code = status_code
            self._body = body
            self.text = str(body)

        def json(self):
            if isinstance(self._body, Exception):
                raise self._body
            return self._body

    class _StubClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, *args, **kwargs):
            return _StubResponse()

    monkeypatch.setattr(pdp.httpx, "AsyncClient", _StubClient)


# ---------------------------------------------------------------------------
# is_pdp_enabled
# ---------------------------------------------------------------------------
def test_is_pdp_enabled_off_by_default(monkeypatch):
    for k in PDP_BASE_ENV:
        monkeypatch.delenv(k, raising=False)
    assert pdp.is_pdp_enabled() is False


def test_is_pdp_enabled_true_when_fully_configured(pdp_env):
    assert pdp.is_pdp_enabled() is True


def test_is_pdp_enabled_false_when_partial_config(monkeypatch):
    monkeypatch.setenv("MCP_PDP_ENABLED", "true")
    monkeypatch.setenv("MCP_PDP_RESOURCE", "mcp_jira")
    # Missing scope, endpoint, audience.
    pdp._logged_partial_config = False
    assert pdp.is_pdp_enabled() is False


# ---------------------------------------------------------------------------
# Allow / Deny
# ---------------------------------------------------------------------------
def test_allow_returns_none(pdp_env, monkeypatch):
    _patch_response(monkeypatch, status_code=200, body={"result": True})
    assert asyncio.run(pdp.check_scope_or_503("tok")) is None


def test_deny_returns_403(pdp_env, monkeypatch):
    _patch_response(monkeypatch, status_code=403, body={"error": "access_denied"})
    result = asyncio.run(pdp.check_scope_or_503("tok"))
    assert result == (403, "PDP denied: mcp_jira#invoke")


def test_kc_401_returns_401(pdp_env, monkeypatch):
    _patch_response(monkeypatch, status_code=401, body={"error": "invalid_token"})
    result = asyncio.run(pdp.check_scope_or_503("tok"))
    assert result == (401, "Token rejected by authorization service")


# ---------------------------------------------------------------------------
# Caching
# ---------------------------------------------------------------------------
def test_allow_decision_is_cached(pdp_env, monkeypatch):
    """A second call with the same token must not re-hit Keycloak."""
    call_count = {"n": 0}

    class _CountingClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, *args, **kwargs):
            call_count["n"] += 1

            class R:
                status_code = 200
                text = ""

                def json(self):
                    return {"result": True}

            return R()

    monkeypatch.setattr(pdp.httpx, "AsyncClient", _CountingClient)
    assert asyncio.run(pdp.check_scope_or_503("tok-A")) is None
    assert asyncio.run(pdp.check_scope_or_503("tok-A")) is None
    assert call_count["n"] == 1


def test_deny_decision_is_cached(pdp_env, monkeypatch):
    call_count = {"n": 0}

    class _CountingClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, *args, **kwargs):
            call_count["n"] += 1

            class R:
                status_code = 403
                text = ""

                def json(self):
                    return {"error": "access_denied"}

            return R()

    monkeypatch.setattr(pdp.httpx, "AsyncClient", _CountingClient)
    assert (asyncio.run(pdp.check_scope_or_503("tok-B")))[0] == 403
    assert (asyncio.run(pdp.check_scope_or_503("tok-B")))[0] == 403
    assert call_count["n"] == 1


def test_kc_401_is_not_cached(pdp_env, monkeypatch):
    """A 401 from KC means token expired — user might re-auth, so don't cache."""
    call_count = {"n": 0}

    class _CountingClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, *args, **kwargs):
            call_count["n"] += 1

            class R:
                status_code = 401
                text = ""

                def json(self):
                    return {}

            return R()

    monkeypatch.setattr(pdp.httpx, "AsyncClient", _CountingClient)
    asyncio.run(pdp.check_scope_or_503("tok-C"))
    asyncio.run(pdp.check_scope_or_503("tok-C"))
    assert call_count["n"] == 2


# ---------------------------------------------------------------------------
# Fail-open / fail-closed on transport errors
# ---------------------------------------------------------------------------
def test_transport_error_fails_closed_by_default(pdp_env, monkeypatch):
    class _BoomClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, *args, **kwargs):
            raise httpx.RequestError("kc unreachable")

    monkeypatch.setattr(pdp.httpx, "AsyncClient", _BoomClient)
    result = asyncio.run(pdp.check_scope_or_503("tok"))
    assert result == (503, "Authorization service unavailable")


def test_transport_error_can_fail_open(pdp_env, monkeypatch):
    monkeypatch.setenv("MCP_PDP_FAIL_OPEN", "true")

    class _BoomClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, *args, **kwargs):
            raise httpx.RequestError("kc unreachable")

    monkeypatch.setattr(pdp.httpx, "AsyncClient", _BoomClient)
    assert asyncio.run(pdp.check_scope_or_503("tok")) is None


# ---------------------------------------------------------------------------
# Token hashing — cache key must not be the raw token
# ---------------------------------------------------------------------------
def test_cache_key_is_sha256_not_token():
    key = pdp._token_key("super-secret-token")
    assert key != "super-secret-token"
    assert len(key) == 64  # sha256 hex digest


def test_invalid_int_env_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("MCP_PDP_CACHE_TTL", "not-a-number")
    assert pdp._env_int("MCP_PDP_CACHE_TTL", 99) == 99
