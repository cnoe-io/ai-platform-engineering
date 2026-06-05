"""Tests for MCP credential reference resolution."""

import pytest

from dynamic_agents.auth.token_context import current_user_token
from dynamic_agents.models import MCPCredentialSource, MCPServerConfig, TransportType
from dynamic_agents.services import mcp_client
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


class NoConnectionCredentialClient:
    """Simulates a caller with no provider connection (exchange raises 404)."""

    async def exchange_provider_connection_by_provider(self, provider: str, *, intended_use: str) -> dict:
        raise RuntimeError("CREDENTIAL_NOT_FOUND")


class ConnectedCredentialClient:
    async def exchange_provider_connection_by_provider(self, provider: str, *, intended_use: str) -> dict:
        return {"access_token": "user-github-oauth-token"}


@pytest.mark.asyncio
async def test_provider_connection_falls_back_to_env_when_not_connected(monkeypatch):
    """No personal connection -> use the static service-account token from fallback_env."""
    monkeypatch.setenv("USE_IMPERSONATION_TOKENS", "true")
    monkeypatch.setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "org-pat-value")
    server = MCPServerConfig(
        _id="github",
        name="GitHub",
        transport=TransportType.HTTP,
        endpoint="http://agentgateway:4000/mcp",
        credential_sources=[
            MCPCredentialSource(
                kind="provider_connection",
                target="header",
                name="X-CAIPE-Provider-Token",
                provider="github",
                fallback_env="GITHUB_PERSONAL_ACCESS_TOKEN",
            )
        ],
    )
    config = build_mcp_connection_config(server)

    resolved = await resolve_mcp_credential_refs(
        server,
        config,
        credential_client=NoConnectionCredentialClient(),
    )

    assert resolved["headers"]["X-CAIPE-Provider-Token"] == "org-pat-value"


@pytest.mark.asyncio
async def test_per_user_token_wins_over_fallback_env(monkeypatch):
    """A connected caller's personal token must take precedence over the static fallback."""
    monkeypatch.setenv("USE_IMPERSONATION_TOKENS", "true")
    monkeypatch.setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "org-pat-value")
    server = MCPServerConfig(
        _id="github",
        name="GitHub",
        transport=TransportType.HTTP,
        endpoint="http://agentgateway:4000/mcp",
        credential_sources=[
            MCPCredentialSource(
                kind="provider_connection",
                target="header",
                name="X-CAIPE-Provider-Token",
                provider="github",
                fallback_env="GITHUB_PERSONAL_ACCESS_TOKEN",
            )
        ],
    )
    config = build_mcp_connection_config(server)

    resolved = await resolve_mcp_credential_refs(
        server,
        config,
        credential_client=ConnectedCredentialClient(),
    )

    assert resolved["headers"]["X-CAIPE-Provider-Token"] == "user-github-oauth-token"


@pytest.mark.asyncio
async def test_no_credential_and_no_fallback_skips_injection(monkeypatch):
    """No connection and no fallback_env -> no header injected, no exception raised."""
    monkeypatch.setenv("USE_IMPERSONATION_TOKENS", "true")
    monkeypatch.delenv("GITHUB_PERSONAL_ACCESS_TOKEN", raising=False)
    server = MCPServerConfig(
        _id="github",
        name="GitHub",
        transport=TransportType.HTTP,
        endpoint="http://agentgateway:4000/mcp",
        credential_sources=[
            MCPCredentialSource(
                kind="provider_connection",
                target="header",
                name="X-CAIPE-Provider-Token",
                provider="github",
            )
        ],
    )
    config = build_mcp_connection_config(server)

    resolved = await resolve_mcp_credential_refs(
        server,
        config,
        credential_client=NoConnectionCredentialClient(),
    )

    assert "X-CAIPE-Provider-Token" not in resolved.get("headers", {})


def _kb_server() -> MCPServerConfig:
    return MCPServerConfig(
        _id="knowledge-base",
        name="Knowledge Base",
        transport=TransportType.HTTP,
        endpoint="http://agentgateway:4000/mcp/knowledge-base",
        credential_sources=[
            MCPCredentialSource(
                kind="caller_token",
                target="header",
                name="X-CAIPE-Provider-Token",
                fallback_client_credentials=True,
            )
        ],
    )


@pytest.mark.asyncio
async def test_caller_token_forwards_user_jwt(monkeypatch):
    """A user-driven request forwards the caller's Keycloak JWT for per-user RBAC."""
    monkeypatch.setenv("USE_IMPERSONATION_TOKENS", "true")

    async def _should_not_mint():
        raise AssertionError("client-credentials must not be minted when a user JWT exists")

    monkeypatch.setattr(mcp_client, "mint_service_client_credentials_token", _should_not_mint)

    server = _kb_server()
    config = build_mcp_connection_config(server)
    token_ref = current_user_token.set("user-keycloak-jwt")
    try:
        resolved = await resolve_mcp_credential_refs(
            server, config, credential_client=FakeCredentialClient()
        )
    finally:
        current_user_token.reset(token_ref)

    assert resolved["headers"]["X-CAIPE-Provider-Token"] == "user-keycloak-jwt"


@pytest.mark.asyncio
async def test_caller_token_falls_back_to_client_credentials(monkeypatch):
    """No user context (background reconcile) -> mint a caipe-platform service token."""
    monkeypatch.setenv("USE_IMPERSONATION_TOKENS", "true")

    async def _mint():
        return "service-client-credentials-token"

    monkeypatch.setattr(mcp_client, "mint_service_client_credentials_token", _mint)

    server = _kb_server()
    config = build_mcp_connection_config(server)
    # Ensure no caller token is set.
    current_user_token.set(None)
    resolved = await resolve_mcp_credential_refs(
        server, config, credential_client=FakeCredentialClient()
    )

    assert resolved["headers"]["X-CAIPE-Provider-Token"] == "service-client-credentials-token"


@pytest.mark.asyncio
async def test_caller_token_no_jwt_no_mint_skips_injection(monkeypatch):
    """No user JWT and mint unavailable -> no header injected, no exception."""
    monkeypatch.setenv("USE_IMPERSONATION_TOKENS", "true")

    async def _mint_none():
        return None

    monkeypatch.setattr(mcp_client, "mint_service_client_credentials_token", _mint_none)

    server = _kb_server()
    config = build_mcp_connection_config(server)
    current_user_token.set(None)
    resolved = await resolve_mcp_credential_refs(
        server, config, credential_client=FakeCredentialClient()
    )

    assert "X-CAIPE-Provider-Token" not in resolved.get("headers", {})


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
