"""Tests for the dynamic-agents MCP endpoint normaliser.

Mirrors ``ui/src/lib/rbac/__tests__/mcp-endpoint-normalizer.test.ts``.
Keeping the two test suites symmetric is intentional: a divergence
between the Web UI's save-time normalisation and the dynamic-agents
read-time normalisation would re-introduce the bug we are fixing.
"""

from __future__ import annotations

from dynamic_agents.services.mcp_endpoint_normalizer import (
    is_agent_gateway_base_endpoint,
    normalize_mcp_endpoint_for_server,
)

BASE = "http://agentgateway:4000"


def fix(endpoint: str | None, server_id: str, base: str = BASE) -> str | None:
    return normalize_mcp_endpoint_for_server(endpoint, server_id, base)


def test_appends_server_id_when_endpoint_is_bare_gateway_base():
    assert fix("http://agentgateway:4000/mcp", "confluence") == (
        "http://agentgateway:4000/mcp/confluence"
    )


def test_appends_server_id_when_endpoint_is_origin_only():
    assert fix("http://agentgateway:4000", "confluence") == (
        "http://agentgateway:4000/mcp/confluence"
    )


def test_strips_trailing_slashes_before_suffixing():
    assert fix("http://agentgateway:4000/mcp/", "confluence") == (
        "http://agentgateway:4000/mcp/confluence"
    )
    assert fix("http://agentgateway:4000/", "confluence") == (
        "http://agentgateway:4000/mcp/confluence"
    )


def test_leaves_correctly_qualified_endpoint_alone():
    assert fix("http://agentgateway:4000/mcp/confluence", "confluence") == (
        "http://agentgateway:4000/mcp/confluence"
    )


def test_repairs_endpoint_that_names_wrong_target_id():
    assert fix("http://agentgateway:4000/mcp/atlassian-confluence", "confluence") == (
        "http://agentgateway:4000/mcp/confluence"
    )


def test_leaves_direct_upstream_endpoint_untouched():
    assert (
        fix("http://mcp-confluence:8000/mcp", "confluence")
        == "http://mcp-confluence:8000/mcp"
    )
    assert (
        fix("https://confluence.example.com/mcp", "confluence")
        == "https://confluence.example.com/mcp"
    )


def test_leaves_none_or_empty_endpoint_alone():
    assert fix(None, "confluence") is None
    assert fix("", "confluence") == ""


def test_uses_configured_base_url():
    assert fix(
        "https://gw.example.com/mcp",
        "confluence",
        "https://gw.example.com",
    ) == "https://gw.example.com/mcp/confluence"


def test_refuses_to_invent_a_suffix_when_server_id_is_empty():
    assert fix("http://agentgateway:4000/mcp", "") == "http://agentgateway:4000/mcp"


def test_collapses_double_slashes():
    assert fix("http://agentgateway:4000//mcp//", "confluence") == (
        "http://agentgateway:4000/mcp/confluence"
    )


def test_is_agent_gateway_base_endpoint_detects_bare_bases():
    assert is_agent_gateway_base_endpoint("http://agentgateway:4000/mcp", BASE) is True
    assert is_agent_gateway_base_endpoint("http://agentgateway:4000/mcp/", BASE) is True
    assert is_agent_gateway_base_endpoint("http://agentgateway:4000", BASE) is True
    assert is_agent_gateway_base_endpoint("http://agentgateway:4000/", BASE) is True


def test_is_agent_gateway_base_endpoint_rejects_target_qualified():
    assert (
        is_agent_gateway_base_endpoint("http://agentgateway:4000/mcp/confluence", BASE)
        is False
    )
    assert (
        is_agent_gateway_base_endpoint("http://agentgateway:4000/mcp/jira", BASE)
        is False
    )


def test_is_agent_gateway_base_endpoint_rejects_direct_upstream():
    assert (
        is_agent_gateway_base_endpoint("http://mcp-confluence:8000/mcp", BASE) is False
    )
