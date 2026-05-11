"""Tests for MCP client connection config."""

# assisted-by Codex Codex-sonnet-4-6

from dynamic_agents.models import MCPServerConfig, TransportType
from dynamic_agents.services.mcp_client import build_mcp_connection_config


def test_github_http_mcp_uses_container_github_token(monkeypatch):
    """GitHub HTTP MCP servers receive the container token as an auth header."""
    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    server = MCPServerConfig(
        _id="mcp-github",
        name="GitHub MCP",
        transport=TransportType.HTTP,
        endpoint="http://github-mcp-server:8082/mcp",
    )

    config = build_mcp_connection_config(server)

    assert config["transport"] == "streamable_http"
    assert config["headers"] == {"Authorization": "Bearer test-token"}


def test_non_github_http_mcp_does_not_receive_github_token(monkeypatch):
    """The GitHub token is scoped only to GitHub MCP endpoints."""
    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    server = MCPServerConfig(
        _id="mcp-jira",
        name="Jira MCP",
        transport=TransportType.HTTP,
        endpoint="http://mcp-jira:8000/mcp",
    )

    config = build_mcp_connection_config(server)

    assert "headers" not in config


def test_github_http_mcp_prefers_personal_access_token_over_placeholder(monkeypatch):
    """Dev placeholder tokens are ignored when a PAT is available."""
    monkeypatch.setenv("GITHUB_TOKEN", "dummy")
    monkeypatch.setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "pat-token")
    server = MCPServerConfig(
        _id="mcp-github",
        name="GitHub MCP",
        transport=TransportType.HTTP,
        endpoint="http://github-mcp-server:8082/",
    )

    config = build_mcp_connection_config(server)

    assert config["headers"] == {"Authorization": "Bearer pat-token"}
