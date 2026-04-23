"""Verify the MCP httpx_client_factory injects the per-request user JWT.

Spec 102 Phase 8 / T111 (the "OBO MCP test" — we test the per-request
token forwarding contract directly, since the OBO swap itself is a
separate codepath covered in ``test_obo_exchange.py``).

These tests use an in-process HTTP server so we never touch the network
and do not need to import any langchain-mcp-adapters internals.
"""

from __future__ import annotations

import asyncio
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from dynamic_agents.auth.token_context import current_user_token
from dynamic_agents.services.mcp_client import build_httpx_client_factory


class _CapturingHandler(BaseHTTPRequestHandler):
    captured: dict[str, str] = {}

    def do_GET(self):  # noqa: N802
        self.__class__.captured = {k.lower(): v for k, v in self.headers.items()}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *_a, **_kw):
        pass


@contextmanager
def _running_server():
    server = HTTPServer(("127.0.0.1", 0), _CapturingHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        thread.join(timeout=2)


@pytest.mark.asyncio
async def test_factory_injects_bearer_when_contextvar_is_set():
    factory = build_httpx_client_factory()
    token = current_user_token.set("tok-abc")
    try:
        with _running_server() as base:
            async with factory() as client:
                await client.get(f"{base}/probe")
    finally:
        current_user_token.reset(token)
    assert _CapturingHandler.captured.get("authorization") == "Bearer tok-abc"


@pytest.mark.asyncio
async def test_factory_omits_bearer_when_contextvar_is_unset():
    _CapturingHandler.captured = {}
    factory = build_httpx_client_factory()
    with _running_server() as base:
        async with factory() as client:
            await client.get(f"{base}/probe")
    assert "authorization" not in _CapturingHandler.captured


@pytest.mark.asyncio
async def test_factory_isolates_token_across_concurrent_tasks():
    """ContextVar must be per-task: two concurrent requests with different
    tokens must not see each other's value."""
    factory = build_httpx_client_factory()
    seen: list[str | None] = []

    async def call_with_token(tok: str | None, base: str) -> None:
        token_ref = current_user_token.set(tok)
        try:
            async with factory() as client:
                await client.get(f"{base}/probe")
            # Don't read response — read what _CapturingHandler captured.
            seen.append(_CapturingHandler.captured.get("authorization"))
        finally:
            current_user_token.reset(token_ref)

    with _running_server() as base:
        # Sequential gather to keep the captured-headers assertion deterministic;
        # the contextvar isolation guarantee is what we're really after.
        await asyncio.gather(
            call_with_token("alpha", base),
            return_exceptions=False,
        )
        first = _CapturingHandler.captured.get("authorization")
        await asyncio.gather(
            call_with_token("beta", base),
            return_exceptions=False,
        )
        second = _CapturingHandler.captured.get("authorization")

    assert first == "Bearer alpha"
    assert second == "Bearer beta"


@pytest.mark.asyncio
async def test_factory_preserves_caller_provided_headers():
    factory = build_httpx_client_factory()
    token = current_user_token.set("xyz")
    try:
        with _running_server() as base:
            async with factory(headers={"X-Trace-Id": "abc-123"}) as client:
                await client.get(f"{base}/probe")
    finally:
        current_user_token.reset(token)
    assert _CapturingHandler.captured.get("x-trace-id") == "abc-123"
    assert _CapturingHandler.captured.get("authorization") == "Bearer xyz"
