"""Tests for runtime self-heal of stale AgentGateway MCP endpoints.

Background: when an MCP server card is saved with a bare AgentGateway
URL (``http://agentgateway:4000/mcp``) instead of the target-qualified
form (``http://agentgateway:4000/mcp/<server_id>``), every probe and
tool call returns ``HTTP 404 Not Found`` because AgentGateway dispatches
by path prefix.

The Web UI BFF now normalises endpoints on save, but legacy rows can
still exist in Mongo (and were the trigger for the Confluence 404). The
dynamic-agents side defends against those by normalising at read time
inside ``build_mcp_connection_config``. These tests pin that behaviour.
"""

from __future__ import annotations

from dynamic_agents.models import MCPServerConfig, TransportType
from dynamic_agents.services.mcp_client import build_mcp_connection_config


def _server_with_endpoint(endpoint: str) -> MCPServerConfig:
    return MCPServerConfig(
        _id="confluence",
        name="Confluence",
        transport=TransportType.HTTP,
        endpoint=endpoint,
    )


def test_runtime_rewrites_bare_gateway_url_when_no_explicit_gateway_arg(monkeypatch):
    """The probe path passes no ``agent_gateway_url`` argument, so it
    relies on read-time self-heal. With ``AGENT_GATEWAY_URL`` set and a
    stale bare endpoint, the transport URL must be repaired to
    ``/mcp/<server_id>``.
    """
    monkeypatch.setenv("AGENT_GATEWAY_URL", "http://agentgateway:4000")
    server = _server_with_endpoint("http://agentgateway:4000/mcp")

    config = build_mcp_connection_config(server)

    assert config["url"] == "http://agentgateway:4000/mcp/confluence"
    assert config["transport"] == "streamable_http"


def test_runtime_leaves_correctly_qualified_endpoint_alone(monkeypatch):
    monkeypatch.setenv("AGENT_GATEWAY_URL", "http://agentgateway:4000")
    server = _server_with_endpoint("http://agentgateway:4000/mcp/confluence")

    config = build_mcp_connection_config(server)

    assert config["url"] == "http://agentgateway:4000/mcp/confluence"


def test_runtime_leaves_direct_upstream_endpoint_alone(monkeypatch):
    """Direct-to-pod URLs must not be rewritten — AgentGateway routing is
    opt-in per server, and silently rewriting these would break stdio
    and in-cluster topologies.
    """
    monkeypatch.setenv("AGENT_GATEWAY_URL", "http://agentgateway:4000")
    server = _server_with_endpoint("http://mcp-confluence:8000/mcp")

    config = build_mcp_connection_config(server)

    assert config["url"] == "http://mcp-confluence:8000/mcp"


def test_runtime_self_heal_no_op_when_no_gateway_url_env(monkeypatch):
    """Without ``AGENT_GATEWAY_URL`` we have no anchor to recognise a
    "naked" gateway URL, so the read-time normaliser must NOT rewrite
    anything (else it would mangle legitimate URLs in tenants that
    don't use AgentGateway at all).
    """
    monkeypatch.delenv("AGENT_GATEWAY_URL", raising=False)
    monkeypatch.delenv("AGENTGATEWAY_URL", raising=False)
    server = _server_with_endpoint("http://agentgateway:4000/mcp")

    config = build_mcp_connection_config(server)

    # No env → no anchor → leave the endpoint exactly as it was. The
    # probe will still fail (this is real misconfiguration) but the
    # failure mode is preserved and obvious instead of mysteriously
    # changing depending on env.
    assert config["url"] == "http://agentgateway:4000/mcp"


def test_runtime_explicit_gateway_arg_still_works(monkeypatch):
    """When called from ``build_mcp_connections`` (which DOES pass
    ``agent_gateway_url``), the explicit-gateway rewrite still wins.
    Self-heal is the fallback, not a replacement.
    """
    monkeypatch.setenv("AGENT_GATEWAY_URL", "http://agentgateway:4000")
    server = _server_with_endpoint("http://agentgateway:4000/mcp")

    config = build_mcp_connection_config(
        server, agent_gateway_url="http://agentgateway:4000"
    )

    assert config["url"] == "http://agentgateway:4000/mcp/confluence"
