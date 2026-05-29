"""Tests for MCP credential reference resolution."""

import pytest

from dynamic_agents.models import MCPCredentialSource, MCPServerConfig, TransportType
from dynamic_agents.services.mcp_client import build_mcp_connection_config, resolve_mcp_credential_refs


class FakeCredentialClient:
    async def retrieve_secret(self, secret_ref: str, *, intended_use: str) -> str:
        assert secret_ref == "secret-1"
        assert intended_use == "mcp_server"
        return "github-token-value"

    async def exchange_provider_connection_by_provider(self, provider: str, *, intended_use: str) -> dict:
        assert provider == "atlassian"
        assert intended_use == "mcp_server"
        return {"access_token": "atlassian-oauth-token", "provider_connection_id": "conn-for-user"}


@pytest.mark.asyncio
async def test_resolves_secret_ref_to_stdio_env_when_impersonation_enabled(monkeypatch):
    monkeypatch.setenv("USE_IMPERSONATION_TOKENS", "true")
    server = MCPServerConfig(
        _id="github",
        name="GitHub",
        transport=TransportType.STDIO,
        command="github-mcp",
        credential_sources=[
            MCPCredentialSource(kind="secret_ref", target="env", name="GITHUB_TOKEN", secret_ref="secret-1")
        ],
    )
    config = build_mcp_connection_config(server)

    resolved = await resolve_mcp_credential_refs(
        server,
        config,
        credential_client=FakeCredentialClient(),
    )

    assert resolved["env"]["GITHUB_TOKEN"] == "github-token-value"


@pytest.mark.asyncio
async def test_resolves_secret_ref_to_http_header_when_impersonation_enabled(monkeypatch):
    monkeypatch.setenv("USE_IMPERSONATION_TOKENS", "true")
    server = MCPServerConfig(
        _id="jira",
        name="Jira",
        transport=TransportType.HTTP,
        endpoint="http://jira-mcp:8080/mcp",
        credential_sources=[
            MCPCredentialSource(kind="secret_ref", target="header", name="Authorization", secret_ref="secret-1")
        ],
    )
    config = build_mcp_connection_config(server)

    resolved = await resolve_mcp_credential_refs(
        server,
        config,
        credential_client=FakeCredentialClient(),
    )

    assert resolved["headers"]["Authorization"] == "Bearer github-token-value"


@pytest.mark.asyncio
async def test_resolves_provider_connection_by_provider_to_dedicated_header_when_impersonation_enabled(monkeypatch):
    monkeypatch.setenv("USE_IMPERSONATION_TOKENS", "true")
    server = MCPServerConfig(
        _id="jira",
        name="Jira",
        transport=TransportType.HTTP,
        endpoint="http://jira-mcp:8080/mcp",
        credential_sources=[
            MCPCredentialSource(
                kind="provider_connection",
                target="header",
                name="X-CAIPE-Provider-Token",
                provider="atlassian",
            )
        ],
    )
    config = build_mcp_connection_config(server, auth_bearer="keycloak-user-jwt")

    resolved = await resolve_mcp_credential_refs(
        server,
        config,
        credential_client=FakeCredentialClient(),
    )

    assert resolved["headers"]["Authorization"] == "Bearer keycloak-user-jwt"
    assert resolved["headers"]["X-CAIPE-Provider-Token"] == "atlassian-oauth-token"


@pytest.mark.asyncio
async def test_credential_refs_are_noop_when_impersonation_disabled(monkeypatch):
    monkeypatch.setenv("USE_IMPERSONATION_TOKENS", "false")
    server = MCPServerConfig(
        _id="github",
        name="GitHub",
        transport=TransportType.STDIO,
        command="github-mcp",
        credential_sources=[
            MCPCredentialSource(kind="secret_ref", target="env", name="GITHUB_TOKEN", secret_ref="secret-1")
        ],
    )
    config = build_mcp_connection_config(server)

    resolved = await resolve_mcp_credential_refs(
        server,
        config,
        credential_client=FakeCredentialClient(),
    )

    assert "env" not in resolved
