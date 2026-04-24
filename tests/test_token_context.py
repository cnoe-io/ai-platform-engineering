# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6

"""Unit tests for per-request bearer token context propagation.

Covers:
- token_context.ContextVar defaults to None
- SharedKeyMiddleware sets current_bearer_token after successful auth
- OAuth2Middleware sets current_bearer_token after successful auth
- DualAuthMiddleware sets current_bearer_token for both shared-key and JWT paths
- MCPAuthMiddleware (mcp_agent_auth) sets current_bearer_token after successful auth
- Middleware does NOT set token when request is rejected (401/403)
- _build_httpx_client_factory always returns a callable
- Factory injects Authorization header from ContextVar
- Factory merges with caller-supplied headers (preserves other headers)
- Factory is a no-op when ContextVar is unset
- SSL_VERIFY=false produces verify=False in client
- Concurrent asyncio tasks are isolated (no token bleed)
"""

import asyncio
import importlib
import os
from unittest.mock import patch

import httpx
import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from ai_platform_engineering.utils.auth.token_context import current_bearer_token
from mcp_agent_auth.token_context import current_bearer_token as mcp_current_bearer_token

SHARED_KEY = "unit-test-shared-key"
PUBLIC_PATHS = ["/healthz"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _echo_token_endpoint(request: Request) -> JSONResponse:
    """Endpoint that echoes back the ContextVar token value visible inside the request."""
    return JSONResponse({"token": current_bearer_token.get()})


def _make_a2a_app_shared_key(key: str) -> Starlette:
    with patch.dict(os.environ, {"A2A_AUTH_SHARED_KEY": key}):
        import ai_platform_engineering.utils.auth.shared_key_middleware as skm
        importlib.reload(skm)
    app = Starlette(routes=[
        Route("/", _echo_token_endpoint, methods=["GET", "OPTIONS"]),
        Route("/healthz", _echo_token_endpoint, methods=["GET"]),
    ])
    app.add_middleware(skm.SharedKeyMiddleware, public_paths=PUBLIC_PATHS)
    return app


def _make_a2a_app_oauth2() -> Starlette:
    env = {
        "A2A_AUTH_OAUTH2": "true",
        "JWKS_URI": "https://example.com/.well-known/jwks.json",
        "AUDIENCE": "test-audience",
        "ISSUER": "https://example.com",
        "OAUTH2_CLIENT_ID": "test-client",
    }
    with patch.dict(os.environ, env):
        with patch("ai_platform_engineering.utils.auth.oauth2_middleware.JwksCache"):
            import ai_platform_engineering.utils.auth.oauth2_middleware as om
            importlib.reload(om)
    app = Starlette(routes=[
        Route("/", _echo_token_endpoint, methods=["GET"]),
    ])
    with patch("ai_platform_engineering.utils.auth.oauth2_middleware.verify_token", return_value=True):
        app.add_middleware(om.OAuth2Middleware)
    return app


def _make_a2a_app_dual(key: str) -> Starlette:
    with patch.dict(os.environ, {"A2A_AUTH_SHARED_KEY": key}):
        import ai_platform_engineering.utils.auth.dual_auth_middleware as dam
        importlib.reload(dam)
    app = Starlette(routes=[
        Route("/", _echo_token_endpoint, methods=["GET"]),
    ])
    app.add_middleware(dam.DualAuthMiddleware)
    return app


def _make_mcp_app(mode: str, mcp_key: str = "") -> Starlette:
    env = {"MCP_AUTH_MODE": mode, "MCP_SHARED_KEY": mcp_key}
    with patch.dict(os.environ, env):
        import mcp_agent_auth.middleware as mam
        importlib.reload(mam)

    async def _mcp_echo(request: Request) -> JSONResponse:
        return JSONResponse({"token": mcp_current_bearer_token.get()})

    app = Starlette(routes=[
        Route("/", _mcp_echo, methods=["GET"]),
        Route("/healthz", _mcp_echo, methods=["GET"]),
    ])
    app.add_middleware(mam.MCPAuthMiddleware)
    return app


# ---------------------------------------------------------------------------
# ContextVar default
# ---------------------------------------------------------------------------

class TestTokenContextDefault:
    def test_default_is_none(self):
        assert current_bearer_token.get() is None

    def test_set_and_reset(self):
        token = current_bearer_token.set("abc")
        assert current_bearer_token.get() == "abc"
        current_bearer_token.reset(token)
        assert current_bearer_token.get() is None


# ---------------------------------------------------------------------------
# SharedKeyMiddleware — ContextVar injection
# ---------------------------------------------------------------------------

class TestSharedKeyMiddlewareTokenContext:
    def test_valid_key_sets_token(self):
        app = _make_a2a_app_shared_key(SHARED_KEY)
        resp = TestClient(app, raise_server_exceptions=False).get(
            "/", headers={"Authorization": f"Bearer {SHARED_KEY}"}
        )
        assert resp.status_code == 200
        assert resp.json()["token"] == SHARED_KEY

    def test_invalid_key_does_not_set_token(self):
        app = _make_a2a_app_shared_key(SHARED_KEY)
        resp = TestClient(app, raise_server_exceptions=False).get(
            "/", headers={"Authorization": "Bearer wrong-key"}
        )
        assert resp.status_code == 401

    def test_missing_header_does_not_set_token(self):
        app = _make_a2a_app_shared_key(SHARED_KEY)
        resp = TestClient(app, raise_server_exceptions=False).get("/")
        assert resp.status_code == 401

    def test_public_path_does_not_set_token(self):
        """Public path bypasses auth — token is not set."""
        app = _make_a2a_app_shared_key(SHARED_KEY)
        resp = TestClient(app, raise_server_exceptions=False).get("/healthz")
        assert resp.status_code == 200
        assert resp.json()["token"] is None


# ---------------------------------------------------------------------------
# OAuth2Middleware — ContextVar injection
# ---------------------------------------------------------------------------

class TestOAuth2MiddlewareTokenContext:
    def test_valid_jwt_sets_token(self):
        app = _make_a2a_app_oauth2()
        with patch(
            "ai_platform_engineering.utils.auth.oauth2_middleware.verify_token",
            return_value=True,
        ):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/", headers={"Authorization": "Bearer valid.jwt.token"}
            )
        assert resp.status_code == 200
        assert resp.json()["token"] == "valid.jwt.token"

    def test_invalid_jwt_does_not_set_token(self):
        app = _make_a2a_app_oauth2()
        with patch(
            "ai_platform_engineering.utils.auth.oauth2_middleware.verify_token",
            return_value=False,
        ):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/", headers={"Authorization": "Bearer bad.jwt.token"}
            )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# DualAuthMiddleware — ContextVar injection (both code paths)
# ---------------------------------------------------------------------------

class TestDualAuthMiddlewareTokenContext:
    def test_shared_key_path_sets_token(self):
        app = _make_a2a_app_dual(SHARED_KEY)
        resp = TestClient(app, raise_server_exceptions=False).get(
            "/", headers={"Authorization": f"Bearer {SHARED_KEY}"}
        )
        assert resp.status_code == 200
        assert resp.json()["token"] == SHARED_KEY

    def test_jwt_path_sets_token(self):
        app = _make_a2a_app_dual(SHARED_KEY)
        with patch(
            "ai_platform_engineering.utils.auth.oauth2_middleware.verify_token",
            side_effect=lambda t: t == "user-jwt-token",
        ):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/", headers={"Authorization": "Bearer user-jwt-token"}
            )
        assert resp.status_code == 200
        assert resp.json()["token"] == "user-jwt-token"

    def test_invalid_token_does_not_set_token(self):
        app = _make_a2a_app_dual(SHARED_KEY)
        with patch(
            "ai_platform_engineering.utils.auth.oauth2_middleware.verify_token",
            return_value=False,
        ):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/", headers={"Authorization": "Bearer neither"}
            )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# MCPAuthMiddleware — ContextVar injection
# ---------------------------------------------------------------------------

class TestMCPAuthMiddlewareTokenContext:
    def test_shared_key_mode_sets_token(self):
        app = _make_mcp_app("shared_key", SHARED_KEY)
        resp = TestClient(app, raise_server_exceptions=False).get(
            "/", headers={"Authorization": f"Bearer {SHARED_KEY}"}
        )
        assert resp.status_code == 200
        assert resp.json()["token"] == SHARED_KEY

    def test_none_mode_does_not_set_token(self):
        """In none mode auth is skipped — token ContextVar stays None."""
        app = _make_mcp_app("none")
        resp = TestClient(app, raise_server_exceptions=False).get(
            "/", headers={"Authorization": "Bearer some-token"}
        )
        assert resp.status_code == 200
        assert resp.json()["token"] is None

    def test_invalid_key_does_not_set_token(self):
        app = _make_mcp_app("shared_key", SHARED_KEY)
        resp = TestClient(app, raise_server_exceptions=False).get(
            "/", headers={"Authorization": "Bearer wrong"}
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# _build_httpx_client_factory
# ---------------------------------------------------------------------------

class MockAgent:
    """Minimal stub satisfying _build_httpx_client_factory dependencies."""

    def _build_httpx_client_factory(self):
        from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import (
            BaseLangGraphAgent,
        )
        return BaseLangGraphAgent._build_httpx_client_factory(self)


class TestBuildHttpxClientFactory:
    def _factory(self, **env):
        with patch.dict(os.environ, env, clear=False):
            return MockAgent()._build_httpx_client_factory()

    def test_always_returns_callable(self):
        f = self._factory()
        assert callable(f)

    def test_no_token_produces_no_auth_header(self):
        f = self._factory()
        token = current_bearer_token.set(None)
        try:
            client = f()
            assert "authorization" not in {k.lower() for k in client.headers}
        finally:
            current_bearer_token.reset(token)
            asyncio.run(client.aclose())

    def test_token_injected_into_headers(self):
        f = self._factory()
        tok = current_bearer_token.set("my-secret-token")
        try:
            client = f()
            assert client.headers.get("authorization") == "Bearer my-secret-token"
        finally:
            current_bearer_token.reset(tok)
            asyncio.run(client.aclose())

    def test_token_overrides_stale_static_header(self):
        """If a static Authorization was in the connection config, token wins."""
        f = self._factory()
        tok = current_bearer_token.set("fresh-token")
        try:
            client = f(headers={"Authorization": "Bearer stale-token"})
            assert client.headers.get("authorization") == "Bearer fresh-token"
        finally:
            current_bearer_token.reset(tok)
            asyncio.run(client.aclose())

    def test_other_headers_preserved(self):
        f = self._factory()
        tok = current_bearer_token.set("tok")
        try:
            client = f(headers={"X-Custom": "value"})
            assert client.headers.get("x-custom") == "value"
            assert client.headers.get("authorization") == "Bearer tok"
        finally:
            current_bearer_token.reset(tok)
            asyncio.run(client.aclose())

    def test_ssl_verify_false_disables_tls(self):
        ca_cleared = {k: v for k, v in os.environ.items()
                      if k not in ("CUSTOM_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "SSL_CERT_FILE")}
        with patch.dict(os.environ, {**ca_cleared, "SSL_VERIFY": "false"}, clear=True):
            f = MockAgent()._build_httpx_client_factory()
        tok = current_bearer_token.set("t")
        captured = {}
        real_client = httpx.AsyncClient

        def _capture(*args, **kw):
            captured["verify"] = kw.get("verify")
            return real_client(*args, **kw)

        try:
            with patch("httpx.AsyncClient", side_effect=_capture):
                client = f()
            assert captured["verify"] is False
        finally:
            current_bearer_token.reset(tok)
            asyncio.run(client.aclose())

    def test_default_ssl_verify_true(self):
        env = {k: v for k, v in os.environ.items()
               if k not in ("SSL_VERIFY", "CUSTOM_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "SSL_CERT_FILE")}
        with patch.dict(os.environ, env, clear=True):
            f = MockAgent()._build_httpx_client_factory()
        tok = current_bearer_token.set("t")
        captured = {}
        real_client = httpx.AsyncClient

        def _capture(*args, **kw):
            captured["verify"] = kw.get("verify")
            return real_client(*args, **kw)

        try:
            with patch("httpx.AsyncClient", side_effect=_capture):
                client = f()
            assert captured["verify"] is True
        finally:
            current_bearer_token.reset(tok)
            asyncio.run(client.aclose())


# ---------------------------------------------------------------------------
# Concurrent-task isolation
# ---------------------------------------------------------------------------

class TestConcurrentTaskIsolation:
    """Each asyncio Task must see only its own token — no bleed between requests."""

    @pytest.mark.anyio
    async def test_concurrent_requests_isolated(self):
        results = {}

        async def request_task(request_id: str, token: str):
            t = current_bearer_token.set(token)
            try:
                await asyncio.sleep(0)  # yield to event loop
                results[request_id] = current_bearer_token.get()
            finally:
                current_bearer_token.reset(t)

        await asyncio.gather(
            request_task("req-A", "token-for-A"),
            request_task("req-B", "token-for-B"),
            request_task("req-C", "token-for-C"),
        )

        assert results["req-A"] == "token-for-A"
        assert results["req-B"] == "token-for-B"
        assert results["req-C"] == "token-for-C"

    @pytest.mark.anyio
    async def test_factory_reads_correct_token_per_task(self):
        """httpx factory called inside different tasks returns different tokens."""
        f = MockAgent()._build_httpx_client_factory()
        clients = {}

        async def build_client(request_id: str, token: str):
            t = current_bearer_token.set(token)
            try:
                await asyncio.sleep(0)
                clients[request_id] = f()
            finally:
                current_bearer_token.reset(t)

        await asyncio.gather(
            build_client("A", "token-A"),
            build_client("B", "token-B"),
        )

        assert clients["A"].headers.get("authorization") == "Bearer token-A"
        assert clients["B"].headers.get("authorization") == "Bearer token-B"

        for c in clients.values():
            await c.aclose()
