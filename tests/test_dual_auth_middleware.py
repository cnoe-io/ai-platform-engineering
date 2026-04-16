"""Unit tests for DualAuthMiddleware.

Verifies that:
- Shared key grants access immediately.
- Valid OAuth2 JWT grants access when shared key doesn't match.
- Invalid tokens (neither shared key nor valid JWT) are rejected.
- Public paths bypass auth.
- OPTIONS (CORS preflight) bypass auth.
- Missing/malformed Authorization header returns 401.
"""

import os
from unittest.mock import patch, MagicMock

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient


SHARED_KEY = "test-shared-key-12345"
PUBLIC_PATHS = ["/.well-known/agent.json", "/.well-known/agent-card.json"]


async def dummy_endpoint(request: Request):
    return JSONResponse({"status": "ok"})


async def agent_card_endpoint(request: Request):
    return JSONResponse({"name": "test-agent"})


def _make_app():
    """Create a Starlette app with DualAuthMiddleware.

    Patches the env so the middleware module-level check for
    A2A_AUTH_SHARED_KEY passes, then builds a fresh app with
    the middleware attached.
    """
    with patch.dict(os.environ, {"A2A_AUTH_SHARED_KEY": SHARED_KEY}):
        import importlib
        import ai_platform_engineering.utils.auth.dual_auth_middleware as dam
        importlib.reload(dam)

    app = Starlette(
        routes=[
            Route("/", dummy_endpoint, methods=["GET", "POST", "OPTIONS"]),
            Route("/.well-known/agent.json", agent_card_endpoint),
        ],
    )
    app.add_middleware(
        dam.DualAuthMiddleware,
        public_paths=PUBLIC_PATHS,
    )
    return app


class TestDualAuthMiddleware:
    """Tests for dual shared-key + OAuth2 authentication."""

    def test_shared_key_grants_access(self):
        """Shared key in Bearer header should be accepted immediately."""
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/", headers={"Authorization": f"Bearer {SHARED_KEY}"})
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_valid_jwt_grants_access(self):
        """Valid OAuth2 JWT should be accepted when shared key doesn't match."""
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        with patch(
            "ai_platform_engineering.utils.auth.oauth2_middleware.verify_token",
            side_effect=lambda t: t == "valid-jwt-token",
        ):
            resp = client.get(
                "/", headers={"Authorization": "Bearer valid-jwt-token"}
            )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_invalid_token_rejected(self):
        """Token that is neither shared key nor valid JWT should be rejected."""
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        with patch(
            "ai_platform_engineering.utils.auth.oauth2_middleware.verify_token",
            return_value=False,
        ):
            resp = client.get(
                "/", headers={"Authorization": "Bearer bad-token"}
            )
        assert resp.status_code == 401

    def test_missing_auth_header_rejected(self):
        """Missing Authorization header should return 401."""
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/")
        assert resp.status_code == 401

    def test_malformed_auth_header_rejected(self):
        """Non-Bearer Authorization header should return 401."""
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/", headers={"Authorization": "Basic dXNlcjpwYXNz"})
        assert resp.status_code == 401

    def test_public_path_bypasses_auth(self):
        """Public paths should be accessible without auth."""
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/.well-known/agent.json")
        assert resp.status_code == 200

    def test_options_bypasses_auth(self):
        """OPTIONS requests (CORS preflight) should bypass auth."""
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.options("/")
        # Starlette may return 400/405 for OPTIONS without CORS middleware,
        # but the auth middleware itself should not block it.
        assert resp.status_code != 401

    def test_jwt_validation_error_returns_403(self):
        """If JWT validation raises an exception, return 403."""
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        with patch(
            "ai_platform_engineering.utils.auth.oauth2_middleware.verify_token",
            side_effect=RuntimeError("JWKS fetch failed"),
        ):
            resp = client.get(
                "/", headers={"Authorization": "Bearer some-token"}
            )
        assert resp.status_code == 403

    def test_sse_unauthorized_format(self):
        """SSE-accepting clients should get text/event-stream error responses."""
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/", headers={"Accept": "text/event-stream"})
        assert resp.status_code == 401
        assert "text/event-stream" in resp.headers.get("content-type", "")
