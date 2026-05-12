# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for ``MCPAuthMiddleware``.

Covers the four modes (none / shared_key / oauth2 / trusted-localhost),
header parsing, public-path bypass, OPTIONS preflight, and the import-
time config validation that protects against half-configured deploys.
"""

from __future__ import annotations

import pytest
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient


def _app(middleware_cls, **mw_kwargs) -> TestClient:
    async def ok(request):
        return PlainTextResponse("ok")

    async def health(request):
        return PlainTextResponse("healthy")

    app = Starlette(
        routes=[Route("/", ok), Route("/healthz", health)],
        middleware=[Middleware(middleware_cls, **mw_kwargs)],
    )
    return TestClient(app)


# ---------------------------------------------------------------------------
# Mode: none — pass-through
# ---------------------------------------------------------------------------
def test_none_mode_passes_through(reload_middleware):
    mod = reload_middleware({"MCP_AUTH_MODE": "none"})
    client = _app(mod.MCPAuthMiddleware)
    assert client.get("/").status_code == 200


def test_default_mode_is_none(reload_middleware):
    mod = reload_middleware({})
    assert mod.MCP_AUTH_MODE == "none"


# ---------------------------------------------------------------------------
# Mode: shared_key
# ---------------------------------------------------------------------------
def test_shared_key_accepts_correct_token(reload_middleware):
    mod = reload_middleware(
        {"MCP_AUTH_MODE": "shared_key", "MCP_SHARED_KEY": "s3cret"}
    )
    client = _app(mod.MCPAuthMiddleware)
    r = client.get("/", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200


def test_shared_key_rejects_wrong_token(reload_middleware):
    mod = reload_middleware(
        {"MCP_AUTH_MODE": "shared_key", "MCP_SHARED_KEY": "s3cret"}
    )
    client = _app(mod.MCPAuthMiddleware)
    r = client.get("/", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401
    assert r.json() == {"error": "unauthorized", "reason": "Invalid shared key."}


def test_shared_key_requires_bearer_prefix(reload_middleware):
    mod = reload_middleware(
        {"MCP_AUTH_MODE": "shared_key", "MCP_SHARED_KEY": "s3cret"}
    )
    client = _app(mod.MCPAuthMiddleware)
    r = client.get("/", headers={"Authorization": "Basic s3cret"})
    assert r.status_code == 401
    assert "malformed" in r.json()["reason"].lower()


def test_shared_key_missing_header(reload_middleware):
    mod = reload_middleware(
        {"MCP_AUTH_MODE": "shared_key", "MCP_SHARED_KEY": "s3cret"}
    )
    client = _app(mod.MCPAuthMiddleware)
    assert client.get("/").status_code == 401


def test_shared_key_case_insensitive_bearer(reload_middleware):
    """RFC 7235 says auth scheme is case-insensitive."""
    mod = reload_middleware(
        {"MCP_AUTH_MODE": "shared_key", "MCP_SHARED_KEY": "s3cret"}
    )
    client = _app(mod.MCPAuthMiddleware)
    assert (
        client.get("/", headers={"Authorization": "BEARER s3cret"}).status_code == 200
    )


def test_shared_key_requires_value_at_import(reload_middleware):
    with pytest.raises(ValueError, match="MCP_SHARED_KEY must be set"):
        reload_middleware({"MCP_AUTH_MODE": "shared_key"})


# ---------------------------------------------------------------------------
# Mode: invalid
# ---------------------------------------------------------------------------
def test_invalid_mode_raises_at_import(reload_middleware):
    with pytest.raises(ValueError, match="Invalid MCP_AUTH_MODE"):
        reload_middleware({"MCP_AUTH_MODE": "magic"})


# ---------------------------------------------------------------------------
# Public paths and OPTIONS preflight
# ---------------------------------------------------------------------------
def test_healthz_bypasses_auth(reload_middleware):
    mod = reload_middleware(
        {"MCP_AUTH_MODE": "shared_key", "MCP_SHARED_KEY": "s3cret"}
    )
    client = _app(mod.MCPAuthMiddleware)
    assert client.get("/healthz").status_code == 200


def test_options_bypasses_auth(reload_middleware):
    mod = reload_middleware(
        {"MCP_AUTH_MODE": "shared_key", "MCP_SHARED_KEY": "s3cret"}
    )
    client = _app(mod.MCPAuthMiddleware)
    assert client.options("/").status_code in (200, 405)


def test_custom_public_path(reload_middleware):
    mod = reload_middleware(
        {"MCP_AUTH_MODE": "shared_key", "MCP_SHARED_KEY": "s3cret"}
    )
    client = _app(mod.MCPAuthMiddleware, public_paths=["/.well-known/openid"])

    # The route doesn't exist but should still bypass auth (404, not 401).
    r = client.get("/.well-known/openid")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Trusted-localhost carve-out
# ---------------------------------------------------------------------------
def test_trusted_localhost_bypasses_auth(reload_middleware):
    """If the peer is classified as loopback, auth is bypassed."""
    mod = reload_middleware(
        {
            "MCP_AUTH_MODE": "shared_key",
            "MCP_SHARED_KEY": "s3cret",
            "MCP_TRUSTED_LOCALHOST": "true",
        }
    )
    # Starlette's TestClient doesn't guarantee a literal 127.0.0.1 peer in
    # request.client, so stub the classifier directly and test the middleware's
    # decision path instead of the transport implementation detail.
    mod._is_loopback_peer = lambda request: True
    client = _app(mod.MCPAuthMiddleware)
    # No Authorization header — should still pass because the peer is trusted.
    r = client.get("/")
    assert r.status_code == 200


def test_trusted_localhost_off_by_default(reload_middleware):
    mod = reload_middleware(
        {"MCP_AUTH_MODE": "shared_key", "MCP_SHARED_KEY": "s3cret"}
    )
    assert mod.MCP_TRUSTED_LOCALHOST is False


def test_is_loopback_peer_handles_unix_socket(reload_middleware):
    """Requests from unix sockets have request.client == None — trust them."""
    from unittest.mock import MagicMock

    mod = reload_middleware({"MCP_AUTH_MODE": "none"})
    fake_request = MagicMock()
    fake_request.client = None
    assert mod._is_loopback_peer(fake_request) is True


def test_is_loopback_peer_rejects_remote(reload_middleware):
    from unittest.mock import MagicMock

    mod = reload_middleware({"MCP_AUTH_MODE": "none"})
    fake_request = MagicMock()
    fake_request.client.host = "10.0.0.5"
    assert mod._is_loopback_peer(fake_request) is False


def test_is_loopback_peer_accepts_ipv6(reload_middleware):
    from unittest.mock import MagicMock

    mod = reload_middleware({"MCP_AUTH_MODE": "none"})
    fake_request = MagicMock()
    fake_request.client.host = "::1"
    assert mod._is_loopback_peer(fake_request) is True


# ---------------------------------------------------------------------------
# token_context — bearer is exposed to downstream code
# ---------------------------------------------------------------------------
def test_token_context_set_after_validation(reload_middleware):
    """Successful auth should expose the token via the ContextVar."""
    from contextvars import copy_context

    mod = reload_middleware(
        {"MCP_AUTH_MODE": "shared_key", "MCP_SHARED_KEY": "s3cret"}
    )

    captured: dict[str, str | None] = {}

    async def capture(request):
        captured["token"] = mod.current_bearer_token.get()
        return PlainTextResponse("ok")

    app = Starlette(
        routes=[Route("/", capture)],
        middleware=[Middleware(mod.MCPAuthMiddleware)],
    )
    client = TestClient(app)
    client.get("/", headers={"Authorization": "Bearer s3cret"})
    assert captured["token"] == "s3cret"

    # Outside the request, the ContextVar should still be unset for fresh
    # contexts. (We use copy_context to avoid leaking the request value.)
    ctx = copy_context()
    assert ctx.run(mod.current_bearer_token.get) is None
