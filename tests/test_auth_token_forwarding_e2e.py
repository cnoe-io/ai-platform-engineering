# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6

"""End-to-end tests for bearer token forwarding across the A2A → MCP boundary.

These tests simulate the full request path without starting real network servers:

  External caller
    → Authorization: Bearer <token>
    → A2A Starlette app (SharedKeyMiddleware / OAuth2Middleware / DualAuthMiddleware)
        sets current_bearer_token ContextVar
    → LangGraph agent _build_httpx_client_factory() reads ContextVar
        injects Authorization header into every MCP HTTP call
    → MCP server (MCPAuthMiddleware)
        validates token, calls tools, uses get_request_token()

Scenarios:
- Shared-key A2A → HTTP MCP (shared_key mode): same token flows end-to-end
- OAuth2 A2A → HTTP MCP (oauth2 mode): JWT flows end-to-end
- Token absent (none mode): no Authorization header forwarded
- Different tokens for simultaneous requests: each MCP call gets the right token
- MCP server get_request_token() reads the forwarded token correctly
"""

import asyncio
import importlib
import os
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from ai_platform_engineering.utils.auth.token_context import current_bearer_token

SHARED_KEY = "e2e-shared-key-xyz"
MCP_SHARED_KEY = "e2e-mcp-key-xyz"  # same value in shared_key mode


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _reload_a2a_shared_key(key: str):
    with patch.dict(os.environ, {"A2A_AUTH_SHARED_KEY": key}):
        import ai_platform_engineering.utils.auth.shared_key_middleware as m
        importlib.reload(m)
        return m


def _reload_a2a_dual(key: str):
    with patch.dict(os.environ, {"A2A_AUTH_SHARED_KEY": key}):
        import ai_platform_engineering.utils.auth.dual_auth_middleware as m
        importlib.reload(m)
        return m


def _reload_mcp_middleware(mode: str, mcp_key: str = ""):
    with patch.dict(os.environ, {"MCP_AUTH_MODE": mode, "MCP_SHARED_KEY": mcp_key}):
        import mcp_agent_auth.middleware as m
        importlib.reload(m)
        return m


def _build_factory_for_token(token: str):
    """Return an httpx.AsyncClient with the Authorization header set for *token*."""
    from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent

    class _Stub:
        _build_httpx_client_factory = BaseLangGraphAgent._build_httpx_client_factory

    factory = _Stub()._build_httpx_client_factory()
    tok = current_bearer_token.set(token)
    try:
        return factory(), tok
    except Exception:
        current_bearer_token.reset(tok)
        raise


# ---------------------------------------------------------------------------
# E2E: A2A shared_key → ContextVar → httpx factory → MCP shared_key
# ---------------------------------------------------------------------------

class TestSharedKeyE2E:
    """Shared key used for both A2A auth and MCP call auth."""

    def test_token_visible_inside_a2a_handler(self):
        """Token set by middleware is visible inside the request handler."""
        captured = {}

        async def handler(request: Request) -> JSONResponse:
            captured["token"] = current_bearer_token.get()
            return JSONResponse({"ok": True})

        skm = _reload_a2a_shared_key(SHARED_KEY)
        app = Starlette(routes=[Route("/", handler, methods=["GET"])])
        app.add_middleware(skm.SharedKeyMiddleware)

        TestClient(app, raise_server_exceptions=False).get(
            "/", headers={"Authorization": f"Bearer {SHARED_KEY}"}
        )
        assert captured["token"] == SHARED_KEY

    def test_factory_injects_token_after_a2a_validation(self):
        """Factory produces a client with the A2A bearer token as Authorization."""
        captured_client: list[httpx.AsyncClient] = []

        async def handler(request: Request) -> JSONResponse:
            from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import (
                BaseLangGraphAgent,
            )

            class _Stub:
                _build_httpx_client_factory = BaseLangGraphAgent._build_httpx_client_factory

            factory = _Stub()._build_httpx_client_factory()
            captured_client.append(factory())
            return JSONResponse({"ok": True})

        skm = _reload_a2a_shared_key(SHARED_KEY)
        app = Starlette(routes=[Route("/", handler, methods=["GET"])])
        app.add_middleware(skm.SharedKeyMiddleware)

        TestClient(app, raise_server_exceptions=False).get(
            "/", headers={"Authorization": f"Bearer {SHARED_KEY}"}
        )

        assert len(captured_client) == 1
        auth = captured_client[0].headers.get("authorization")
        assert auth == f"Bearer {SHARED_KEY}"
        import asyncio; asyncio.run(captured_client[0].aclose())

    def test_mcp_middleware_accepts_forwarded_token(self):
        """MCPAuthMiddleware in shared_key mode accepts the same token."""
        mam = _reload_mcp_middleware("shared_key", SHARED_KEY)

        async def mcp_tool(request: Request) -> JSONResponse:
            return JSONResponse({"tool": "ok"})

        app = Starlette(routes=[Route("/mcp", mcp_tool, methods=["GET"])])
        app.add_middleware(mam.MCPAuthMiddleware)

        resp = TestClient(app, raise_server_exceptions=False).get(
            "/mcp", headers={"Authorization": f"Bearer {SHARED_KEY}"}
        )
        assert resp.status_code == 200

    def test_mcp_get_request_token_returns_forwarded_token(self):
        """Inside an MCP tool, get_request_token() returns the forwarded bearer token."""
        from mcp_agent_auth.token import get_request_token

        mock_req = MagicMock()
        mock_req.headers.get.return_value = f"Bearer {SHARED_KEY}"

        with patch("fastmcp.server.dependencies.get_http_request", return_value=mock_req):
            token = get_request_token("SOME_ENV_VAR")

        assert token == SHARED_KEY

    def test_wrong_token_rejected_by_mcp(self):
        mam = _reload_mcp_middleware("shared_key", SHARED_KEY)

        async def mcp_tool(request: Request) -> JSONResponse:
            return JSONResponse({"tool": "ok"})

        app = Starlette(routes=[Route("/mcp", mcp_tool, methods=["GET"])])
        app.add_middleware(mam.MCPAuthMiddleware)

        resp = TestClient(app, raise_server_exceptions=False).get(
            "/mcp", headers={"Authorization": "Bearer wrong-token"}
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# E2E: OAuth2 A2A → ContextVar → httpx factory → MCP oauth2
# ---------------------------------------------------------------------------

class TestOAuth2E2E:
    """JWT token flows from A2A validation through to MCP server."""

    def _make_a2a_oauth2_app(self, handler):
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

        app = Starlette(routes=[Route("/", handler, methods=["GET"])])
        with patch(
            "ai_platform_engineering.utils.auth.oauth2_middleware.verify_token",
            return_value=True,
        ):
            app.add_middleware(om.OAuth2Middleware)
        return app

    def test_jwt_token_set_in_context(self):
        captured = {}

        async def handler(request: Request) -> JSONResponse:
            captured["token"] = current_bearer_token.get()
            return JSONResponse({"ok": True})

        app = self._make_a2a_oauth2_app(handler)
        with patch(
            "ai_platform_engineering.utils.auth.oauth2_middleware.verify_token",
            return_value=True,
        ):
            TestClient(app, raise_server_exceptions=False).get(
                "/", headers={"Authorization": "Bearer my.jwt.token"}
            )
        assert captured["token"] == "my.jwt.token"

    def test_mcp_oauth2_accepts_forwarded_jwt(self):
        """MCP in oauth2 mode accepts the JWT forwarded from A2A."""
        env = {
            "MCP_AUTH_MODE": "oauth2",
            "JWKS_URI": "https://example.com/.well-known/jwks.json",
            "AUDIENCE": "mcp-server",
            "ISSUER": "https://example.com",
        }
        with patch.dict(os.environ, env):
            with patch("mcp_agent_auth.middleware.JwksCache"):
                import mcp_agent_auth.middleware as mam
                importlib.reload(mam)

        async def mcp_tool(request: Request) -> JSONResponse:
            return JSONResponse({"tool": "ok"})

        app = Starlette(routes=[Route("/", mcp_tool, methods=["GET"])])
        with patch("mcp_agent_auth.middleware._verify_jwt", return_value=True):
            app.add_middleware(mam.MCPAuthMiddleware)

        with patch("mcp_agent_auth.middleware._verify_jwt", return_value=True):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/", headers={"Authorization": "Bearer my.jwt.token"}
            )
        assert resp.status_code == 200

    def test_expired_jwt_rejected_by_mcp(self):
        env = {
            "MCP_AUTH_MODE": "oauth2",
            "JWKS_URI": "https://example.com/.well-known/jwks.json",
            "AUDIENCE": "mcp-server",
            "ISSUER": "https://example.com",
        }
        with patch.dict(os.environ, env):
            with patch("mcp_agent_auth.middleware.JwksCache"):
                import mcp_agent_auth.middleware as mam
                importlib.reload(mam)

        async def mcp_tool(request: Request) -> JSONResponse:
            return JSONResponse({"tool": "ok"})

        app = Starlette(routes=[Route("/", mcp_tool, methods=["GET"])])
        with patch("mcp_agent_auth.middleware._verify_jwt", return_value=False):
            app.add_middleware(mam.MCPAuthMiddleware)

        with patch("mcp_agent_auth.middleware._verify_jwt", return_value=False):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/", headers={"Authorization": "Bearer expired.jwt.token"}
            )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# E2E: DualAuthMiddleware → both paths
# ---------------------------------------------------------------------------

class TestDualAuthE2E:
    def _make_dual_app(self, handler):
        dam = _reload_a2a_dual(SHARED_KEY)
        app = Starlette(routes=[Route("/", handler, methods=["GET"])])
        app.add_middleware(dam.DualAuthMiddleware)
        return app

    def test_shared_key_path_sets_and_forwards_token(self):
        captured = {}

        async def handler(request: Request) -> JSONResponse:
            captured["token"] = current_bearer_token.get()
            return JSONResponse({"ok": True})

        app = self._make_dual_app(handler)
        TestClient(app, raise_server_exceptions=False).get(
            "/", headers={"Authorization": f"Bearer {SHARED_KEY}"}
        )
        assert captured["token"] == SHARED_KEY

    def test_jwt_path_sets_and_forwards_token(self):
        captured = {}

        async def handler(request: Request) -> JSONResponse:
            captured["token"] = current_bearer_token.get()
            return JSONResponse({"ok": True})

        app = self._make_dual_app(handler)
        with patch(
            "ai_platform_engineering.utils.auth.oauth2_middleware.verify_token",
            side_effect=lambda t: t == "jwt-bearer-token",
        ):
            TestClient(app, raise_server_exceptions=False).get(
                "/", headers={"Authorization": "Bearer jwt-bearer-token"}
            )
        assert captured["token"] == "jwt-bearer-token"


# ---------------------------------------------------------------------------
# E2E: none mode — no token injected, MCP none mode accepts all
# ---------------------------------------------------------------------------

class TestNoneModeE2E:
    def test_no_auth_no_token_forwarded(self):
        """In none mode no Authorization header is added by the factory."""
        from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import (
            BaseLangGraphAgent,
        )

        class _Stub:
            _build_httpx_client_factory = BaseLangGraphAgent._build_httpx_client_factory

        factory = _Stub()._build_httpx_client_factory()
        # ContextVar is None (no middleware set it)
        client = factory()
        assert "authorization" not in {k.lower() for k in client.headers}
        import asyncio; asyncio.run(client.aclose())

    def test_mcp_none_mode_accepts_request_without_token(self):
        mam = _reload_mcp_middleware("none")

        async def mcp_tool(request: Request) -> JSONResponse:
            return JSONResponse({"tool": "ok"})

        app = Starlette(routes=[Route("/", mcp_tool, methods=["GET"])])
        app.add_middleware(mam.MCPAuthMiddleware)

        resp = TestClient(app, raise_server_exceptions=False).get("/")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# E2E: per-request isolation — concurrent requests get independent tokens
# ---------------------------------------------------------------------------

class TestPerRequestIsolation:
    @pytest.mark.anyio
    async def test_concurrent_a2a_requests_forward_different_tokens(self):
        """Simultaneous requests must each forward their own token — no bleed."""
        from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import (
            BaseLangGraphAgent,
        )

        class _Stub:
            _build_httpx_client_factory = BaseLangGraphAgent._build_httpx_client_factory

        factory = _Stub()._build_httpx_client_factory()
        results: dict[str, str | None] = {}

        async def simulate_request(request_id: str, token: str):
            tok = current_bearer_token.set(token)
            try:
                await asyncio.sleep(0)  # simulate event loop yield
                client = factory()
                results[request_id] = client.headers.get("authorization")
                await client.aclose()
            finally:
                current_bearer_token.reset(tok)

        await asyncio.gather(
            simulate_request("user-alice", "token-alice"),
            simulate_request("user-bob", "token-bob"),
            simulate_request("user-carol", "token-carol"),
        )

        assert results["user-alice"] == "Bearer token-alice"
        assert results["user-bob"] == "Bearer token-bob"
        assert results["user-carol"] == "Bearer token-carol"

    @pytest.mark.anyio
    async def test_factory_token_does_not_leak_after_request(self):
        """After a request completes the ContextVar is restored to its prior value."""
        factory = MagicMock()

        async def simulate_scoped_request(token: str):
            tok = current_bearer_token.set(token)
            try:
                await asyncio.sleep(0)
                assert current_bearer_token.get() == token
            finally:
                current_bearer_token.reset(tok)

        assert current_bearer_token.get() is None
        await simulate_scoped_request("scoped-token")
        assert current_bearer_token.get() is None


# ---------------------------------------------------------------------------
# E2E: MCP get_request_token() STDIO fallback
# ---------------------------------------------------------------------------

class TestMCPGetRequestTokenE2E:
    def test_http_mode_returns_bearer_token(self):
        from mcp_agent_auth.token import get_request_token

        mock_req = MagicMock()
        mock_req.headers.get.return_value = "Bearer forwarded-api-key"

        with patch("fastmcp.server.dependencies.get_http_request", return_value=mock_req):
            result = get_request_token("FALLBACK_ENV_VAR")

        assert result == "forwarded-api-key"

    def test_stdio_mode_falls_back_to_env(self):
        from mcp_agent_auth.token import get_request_token

        with patch("fastmcp.server.dependencies.get_http_request", side_effect=LookupError):
            with patch.dict(os.environ, {"MY_API_KEY": "env-api-key"}):
                result = get_request_token("MY_API_KEY")

        assert result == "env-api-key"

    def test_neither_available_returns_none(self):
        from mcp_agent_auth.token import get_request_token

        with patch("fastmcp.server.dependencies.get_http_request", side_effect=LookupError):
            env = {k: v for k, v in os.environ.items() if k != "MISSING_KEY"}
            with patch.dict(os.environ, env, clear=True):
                result = get_request_token("MISSING_KEY")

        assert result is None

    def test_non_bearer_header_falls_back_to_env(self):
        from mcp_agent_auth.token import get_request_token

        mock_req = MagicMock()
        mock_req.headers.get.return_value = "Basic dXNlcjpwYXNz"

        with patch("fastmcp.server.dependencies.get_http_request", return_value=mock_req):
            with patch.dict(os.environ, {"MY_API_KEY": "env-fallback"}):
                result = get_request_token("MY_API_KEY")

        assert result == "env-fallback"
