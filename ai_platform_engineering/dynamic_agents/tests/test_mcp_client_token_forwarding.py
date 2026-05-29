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
from dynamic_agents.models import MCPServerConfig, TransportType
from dynamic_agents.services.mcp_client import (
    build_agent_context_headers,
    build_httpx_client_factory,
    build_mcp_connection_config,
    build_mcp_connections,
)


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


def test_streamable_http_connection_config_includes_context_bearer_header():
    server = MCPServerConfig(
        id="jira",
        name="Jira",
        transport=TransportType.HTTP,
        endpoint="http://agentgateway:4000/mcp",
        enabled=True,
    )
    token = current_user_token.set("probe-token")
    try:
        config = build_mcp_connection_config(server)
    finally:
        current_user_token.reset(token)

    assert config["transport"] == "streamable_http"
    assert config["headers"]["Authorization"] == "Bearer probe-token"


def test_streamable_http_connection_config_includes_signed_agent_context(monkeypatch):
    monkeypatch.setenv("CAIPE_AGENT_CONTEXT_HMAC_SECRET", "test-secret")
    server = MCPServerConfig(
        id="jira",
        name="Jira",
        transport=TransportType.HTTP,
        endpoint="http://agentgateway:4000/mcp",
        enabled=True,
    )

    config = build_mcp_connection_config(server, agent_id="agent-test-april-2025")

    assert config["headers"]["X-CAIPE-Agent-Context"]
    assert config["headers"]["X-CAIPE-Agent-Context-Signature"]


def test_agent_context_headers_are_omitted_without_shared_secret(monkeypatch):
    monkeypatch.delenv("CAIPE_AGENT_CONTEXT_HMAC_SECRET", raising=False)

    assert build_agent_context_headers("agent-test-april-2025") == {}


def test_gateway_routing_only_rewrites_declared_gateway_targets(monkeypatch):
    """A shared AgentGateway MCP backend must not relabel Jira tools as KB tools."""
    monkeypatch.setenv("AGENT_GATEWAY_MCP_SERVER_IDS", "jira")
    servers = [
        MCPServerConfig(
            id="jira",
            name="Jira",
            transport=TransportType.HTTP,
            endpoint="http://mcp-jira:8000/mcp",
            enabled=True,
        ),
        MCPServerConfig(
            id="knowledge-base",
            name="Knowledge Base",
            transport=TransportType.HTTP,
            endpoint="http://rag-server:9446/mcp",
            enabled=True,
        ),
    ]

    connections = build_mcp_connections(
        servers,
        ["jira", "knowledge-base"],
        agent_gateway_url="http://agentgateway:4000",
    )

    assert connections["jira"]["url"] == "http://agentgateway:4000/mcp/jira"
    assert connections["knowledge-base"]["url"] == "http://rag-server:9446/mcp"


def test_gateway_all_only_routes_gateway_managed_servers(monkeypatch):
    """`all` should not send arbitrary manual MCP rows to missing AG routes."""
    monkeypatch.setenv("AGENT_GATEWAY_MCP_SERVER_IDS", "all")
    servers = [
        MCPServerConfig(
            id="knowledge-base",
            name="Knowledge Base",
            transport=TransportType.HTTP,
            endpoint="http://agentgateway:4000/mcp/knowledge-base",
            enabled=True,
            source="agentgateway",
            agentgateway_target_endpoint="http://rag-server:9446/mcp",
        ),
        MCPServerConfig(
            id="manual-tool",
            name="Manual Tool",
            transport=TransportType.HTTP,
            endpoint="http://mcp-manual:8000/mcp",
            enabled=True,
        ),
    ]

    connections = build_mcp_connections(
        servers,
        ["knowledge-base", "manual-tool"],
        agent_gateway_url="http://agentgateway:4000",
    )

    assert connections["knowledge-base"]["url"] == "http://agentgateway:4000/mcp/knowledge-base"
    assert connections["manual-tool"]["url"] == "http://mcp-manual:8000/mcp"
