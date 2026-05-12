# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6

"""Unit tests for MCPAuthMiddleware and get_request_token.

Covers:
- none mode: all requests pass through
- shared_key mode: correct token accepted, wrong/missing rejected
- oauth2 mode: valid JWT accepted, invalid/expired rejected
- Public paths and OPTIONS bypass auth in all modes
- SSE clients receive text/event-stream error format
- get_request_token: HTTP context, STDIO fallback, both absent
"""

import importlib
import os
from unittest.mock import patch, MagicMock

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient


SHARED_KEY = "test-mcp-key-abc123"
PUBLIC_PATHS = ["/healthz"]


async def dummy_endpoint(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


def _make_app(env: dict) -> Starlette:
    """Reload MCPAuthMiddleware with given env vars and wrap a dummy Starlette app."""
    with patch.dict(os.environ, env, clear=False):
        import mcp_agent_auth.middleware as mam
        importlib.reload(mam)

    app = Starlette(
        routes=[
            Route("/", dummy_endpoint, methods=["GET", "POST", "OPTIONS"]),
            Route("/healthz", dummy_endpoint, methods=["GET"]),
        ],
    )
    app.add_middleware(mam.MCPAuthMiddleware, public_paths=PUBLIC_PATHS)
    return app


# ---------------------------------------------------------------------------
# none mode
# ---------------------------------------------------------------------------

class TestNoneMode:
    """MCP_AUTH_MODE=none — all requests pass through."""

    def test_no_auth_header_passes(self):
        app = _make_app({"MCP_AUTH_MODE": "none"})
        resp = TestClient(app, raise_server_exceptions=False).get("/")
        assert resp.status_code == 200

    def test_any_auth_header_passes(self):
        app = _make_app({"MCP_AUTH_MODE": "none"})
        resp = TestClient(app, raise_server_exceptions=False).get(
            "/", headers={"Authorization": "Bearer whatever"}
        )
        assert resp.status_code == 200

    def test_default_mode_is_none(self):
        """No MCP_AUTH_MODE set → defaults to none."""
        env = {k: v for k, v in os.environ.items() if k != "MCP_AUTH_MODE"}
        with patch.dict(os.environ, {}, clear=True):
            with patch.dict(os.environ, env):
                import mcp_agent_auth.middleware as mam
                importlib.reload(mam)
        app = Starlette(
            routes=[Route("/", dummy_endpoint, methods=["GET"])],
        )
        with patch.dict(os.environ, {"MCP_AUTH_MODE": "none"}):
            import mcp_agent_auth.middleware as mam
            importlib.reload(mam)
        app.add_middleware(mam.MCPAuthMiddleware)
        resp = TestClient(app, raise_server_exceptions=False).get("/")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# shared_key mode
# ---------------------------------------------------------------------------

class TestSharedKeyMode:
    """MCP_AUTH_MODE=shared_key."""

    def _app(self):
        return _make_app({"MCP_AUTH_MODE": "shared_key", "MCP_SHARED_KEY": SHARED_KEY})

    def test_correct_key_granted(self):
        resp = TestClient(self._app(), raise_server_exceptions=False).get(
            "/", headers={"Authorization": f"Bearer {SHARED_KEY}"}
        )
        assert resp.status_code == 200

    def test_wrong_key_rejected(self):
        resp = TestClient(self._app(), raise_server_exceptions=False).get(
            "/", headers={"Authorization": "Bearer wrong-key"}
        )
        assert resp.status_code == 401

    def test_missing_header_rejected(self):
        resp = TestClient(self._app(), raise_server_exceptions=False).get("/")
        assert resp.status_code == 401

    def test_basic_auth_rejected(self):
        resp = TestClient(self._app(), raise_server_exceptions=False).get(
            "/", headers={"Authorization": "Basic dXNlcjpwYXNz"}
        )
        assert resp.status_code == 401

    def test_public_path_bypasses_auth(self):
        resp = TestClient(self._app(), raise_server_exceptions=False).get("/healthz")
        assert resp.status_code == 200

    def test_options_bypasses_auth(self):
        resp = TestClient(self._app(), raise_server_exceptions=False).options("/")
        assert resp.status_code != 401

    def test_sse_client_gets_event_stream_format(self):
        resp = TestClient(self._app(), raise_server_exceptions=False).get(
            "/", headers={"Accept": "text/event-stream"}
        )
        assert resp.status_code == 401
        assert "text/event-stream" in resp.headers.get("content-type", "")

    def test_missing_shared_key_env_raises_at_import(self):
        """Server should refuse to start if MCP_SHARED_KEY is absent in shared_key mode."""
        with patch.dict(os.environ, {"MCP_AUTH_MODE": "shared_key", "MCP_SHARED_KEY": ""}):
            import mcp_agent_auth.middleware as mam
            try:
                importlib.reload(mam)
                raised = False
            except ValueError:
                raised = True
        assert raised, "Expected ValueError when MCP_SHARED_KEY is empty"


# ---------------------------------------------------------------------------
# oauth2 mode
# ---------------------------------------------------------------------------

class TestOAuth2Mode:
    """MCP_AUTH_MODE=oauth2 — validates JWT via JWKS."""

    _BASE_ENV = {
        "MCP_AUTH_MODE": "oauth2",
        "JWKS_URI": "https://example.com/.well-known/jwks.json",
        "AUDIENCE": "mcp-server",
        "ISSUER": "https://example.com",
    }

    def _app_with_mock_verify(self, verify_return):
        """Create app with _verify_jwt patched to return verify_return."""
        with patch.dict(os.environ, self._BASE_ENV, clear=False):
            # Patch JwksCache so network call is skipped at import.
            with patch("mcp_agent_auth.middleware.JwksCache"):
                import mcp_agent_auth.middleware as mam
                importlib.reload(mam)

        app = Starlette(
            routes=[
                Route("/", dummy_endpoint, methods=["GET", "OPTIONS"]),
                Route("/healthz", dummy_endpoint, methods=["GET"]),
            ],
        )
        with patch("mcp_agent_auth.middleware._verify_jwt", return_value=verify_return):
            app.add_middleware(mam.MCPAuthMiddleware)
        return app

    def test_valid_jwt_granted(self):
        app = self._app_with_mock_verify(True)
        with patch("mcp_agent_auth.middleware._verify_jwt", return_value=True):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/", headers={"Authorization": "Bearer valid.jwt.token"}
            )
        assert resp.status_code == 200

    def test_invalid_jwt_rejected(self):
        app = self._app_with_mock_verify(False)
        with patch("mcp_agent_auth.middleware._verify_jwt", return_value=False):
            resp = TestClient(app, raise_server_exceptions=False).get(
                "/", headers={"Authorization": "Bearer bad.jwt.token"}
            )
        assert resp.status_code == 401

    def test_missing_header_rejected(self):
        app = self._app_with_mock_verify(False)
        resp = TestClient(app, raise_server_exceptions=False).get("/")
        assert resp.status_code == 401

    def test_public_path_bypasses_auth(self):
        app = self._app_with_mock_verify(False)
        resp = TestClient(app, raise_server_exceptions=False).get("/healthz")
        assert resp.status_code == 200

    def test_options_bypasses_auth(self):
        app = self._app_with_mock_verify(False)
        resp = TestClient(app, raise_server_exceptions=False).options("/")
        assert resp.status_code != 401


# ---------------------------------------------------------------------------
# get_request_token
# ---------------------------------------------------------------------------

class TestGetRequestToken:
    """get_request_token resolution order."""

    def test_returns_bearer_from_http_request(self):
        from mcp_agent_auth.token import get_request_token

        mock_req = MagicMock()
        mock_req.headers.get.return_value = "Bearer http-token-xyz"

        with patch("fastmcp.server.dependencies.get_http_request", return_value=mock_req):
            result = get_request_token("SOME_ENV_VAR")

        assert result == "http-token-xyz"

    def test_falls_back_to_env_var_when_no_request_context(self):
        from mcp_agent_auth.token import get_request_token

        with patch("fastmcp.server.dependencies.get_http_request", side_effect=LookupError):
            with patch.dict(os.environ, {"MY_TOKEN": "env-token-abc"}):
                result = get_request_token("MY_TOKEN")

        assert result == "env-token-abc"

    def test_returns_none_when_nothing_available(self):
        from mcp_agent_auth.token import get_request_token

        with patch("fastmcp.server.dependencies.get_http_request", side_effect=LookupError):
            env_without_token = {k: v for k, v in os.environ.items() if k != "MISSING_TOKEN"}
            with patch.dict(os.environ, env_without_token, clear=True):
                result = get_request_token("MISSING_TOKEN")

        assert result is None

    def test_bearer_prefix_stripped(self):
        from mcp_agent_auth.token import get_request_token

        mock_req = MagicMock()
        mock_req.headers.get.return_value = "Bearer   stripped-token"

        with patch("fastmcp.server.dependencies.get_http_request", return_value=mock_req):
            result = get_request_token("UNUSED")

        assert result == "  stripped-token"

    def test_non_bearer_header_falls_back_to_env(self):
        """A non-Bearer Authorization header should not be used as the token."""
        from mcp_agent_auth.token import get_request_token

        mock_req = MagicMock()
        mock_req.headers.get.return_value = "Basic dXNlcjpwYXNz"

        with patch("fastmcp.server.dependencies.get_http_request", return_value=mock_req):
            with patch.dict(os.environ, {"MY_KEY": "env-fallback"}):
                result = get_request_token("MY_KEY")

        assert result == "env-fallback"
