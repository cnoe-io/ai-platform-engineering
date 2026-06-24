"""Unit tests for the Jira API client."""

import importlib

import pytest


class FakeResponse:
    """Minimal httpx response stand-in for client unit tests."""

    status_code = 200
    text = ""

    def json(self):
        return {"ok": True}


class CapturingResponse(FakeResponse):
    def __init__(self, calls):
        self._calls = calls


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "expects_json"),
    [
        ("GET", False),
        ("POST", True),
        ("PUT", True),
        ("PATCH", True),
        ("DELETE", False),
    ],
)
async def test_make_api_request_dispatches_supported_methods(
    monkeypatch,
    method,
    expects_json,
):
    """Verify each supported HTTP method calls the typed AsyncClient method."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.setattr(client, "MCP_JIRA_MOCK_RESPONSE", False)
    monkeypatch.setenv("ATLASSIAN_TOKEN", "test-token")
    monkeypatch.setenv("ATLASSIAN_EMAIL", "user@example.com")
    monkeypatch.setenv("ATLASSIAN_API_URL", "https://test.atlassian.net")

    calls = []

    class FakeAsyncClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, url, *, headers, params):
            calls.append({"method": "GET", "url": url, "params": params, "json": None})
            return FakeResponse()

        async def post(self, url, *, headers, params, json):
            calls.append({"method": "POST", "url": url, "params": params, "json": json})
            return FakeResponse()

        async def put(self, url, *, headers, params, json):
            calls.append({"method": "PUT", "url": url, "params": params, "json": json})
            return FakeResponse()

        async def patch(self, url, *, headers, params, json):
            calls.append({"method": "PATCH", "url": url, "params": params, "json": json})
            return FakeResponse()

        async def delete(self, url, *, headers, params):
            calls.append({"method": "DELETE", "url": url, "params": params, "json": None})
            return FakeResponse()

    monkeypatch.setattr(client.httpx, "AsyncClient", FakeAsyncClient)

    success, response = await client.make_api_request(
        "rest/api/3/issue/PROJ-123",
        method=method,
        params={"expand": "names"},
        data={"summary": "test"},
    )

    assert success is True
    assert response == {"ok": True}
    assert calls == [
        {
            "method": method,
            "url": "https://test.atlassian.net/rest/api/3/issue/PROJ-123",
            "params": {"expand": "names"},
            "json": {"summary": "test"} if expects_json else None,
        }
    ]


@pytest.mark.asyncio
async def test_make_api_request_rejects_unsupported_method(monkeypatch):
    """Unsupported methods should return a structured error without making a request."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.setattr(client, "MCP_JIRA_MOCK_RESPONSE", False)
    monkeypatch.setenv("ATLASSIAN_TOKEN", "test-token")
    monkeypatch.setenv("ATLASSIAN_EMAIL", "user@example.com")
    monkeypatch.setenv("ATLASSIAN_API_URL", "https://test.atlassian.net")

    class FailingAsyncClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, *args, **kwargs):
            raise AssertionError("No HTTP request should be made")

    monkeypatch.setattr(client.httpx, "AsyncClient", FailingAsyncClient)

    success, response = await client.make_api_request(
        "rest/api/3/issue/PROJ-123",
        method="OPTIONS",
    )

    assert success is False
    assert response == {"error": "Unsupported method: OPTIONS"}


@pytest.mark.asyncio
async def test_make_api_request_uses_provider_header_as_bearer_without_email(monkeypatch):
    """Provider OAuth tokens arrive on a dedicated header; Keycloak Authorization remains MCP auth."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.setattr(client, "MCP_JIRA_MOCK_RESPONSE", False)
    monkeypatch.delenv("ATLASSIAN_EMAIL", raising=False)
    monkeypatch.delenv("JIRA_EMAIL", raising=False)
    monkeypatch.setenv("ATLASSIAN_API_URL", "https://api.atlassian.com/ex/jira/cloud-1")
    monkeypatch.setattr(client, "get_provider_header_token", lambda: "provider-oauth-token")

    calls = []

    class FakeAsyncClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, url, *, headers, params):
            calls.append({"url": url, "headers": headers, "params": params})
            return CapturingResponse(calls)

    monkeypatch.setattr(client.httpx, "AsyncClient", FakeAsyncClient)

    success, response = await client.make_api_request("rest/api/3/myself")

    assert success is True
    assert response == {"ok": True}
    assert calls[0]["url"] == "https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/myself"
    assert calls[0]["headers"]["Authorization"] == "Bearer provider-oauth-token"


@pytest.mark.asyncio
async def test_oauth_request_rewrites_site_url_to_gateway(monkeypatch):
    """A provider OAuth token against a site URL is rerouted to the api.atlassian.com gateway."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.setattr(client, "MCP_JIRA_MOCK_RESPONSE", False)
    monkeypatch.delenv("ATLASSIAN_EMAIL", raising=False)
    monkeypatch.delenv("JIRA_EMAIL", raising=False)
    # Configured as the site URL — the OAuth path must NOT use this directly.
    monkeypatch.setenv("ATLASSIAN_API_URL", "https://my-site.atlassian.net")
    monkeypatch.setattr(client, "get_provider_header_token", lambda: "provider-oauth-token")

    async def fake_resolve(token, timeout=10):
        assert token == "provider-oauth-token"
        return "https://api.atlassian.com/ex/jira/cloud-xyz"

    monkeypatch.setattr(client, "resolve_oauth_base_url", fake_resolve)

    calls = []

    class FakeAsyncClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, url, *, headers, params):
            calls.append({"url": url, "headers": headers, "params": params})
            return CapturingResponse(calls)

    monkeypatch.setattr(client.httpx, "AsyncClient", FakeAsyncClient)

    success, response = await client.make_api_request("rest/api/3/myself")

    assert success is True
    assert calls[0]["url"] == "https://api.atlassian.com/ex/jira/cloud-xyz/rest/api/3/myself"
    assert calls[0]["headers"]["Authorization"] == "Bearer provider-oauth-token"


@pytest.mark.asyncio
async def test_get_env_skips_jwt_shaped_authorization(monkeypatch):
    """Keycloak JWT on Authorization must not be treated as an Atlassian API token."""
    client = importlib.import_module("api.client")
    importlib.reload(client)

    jwt_token = "unit-test.jwt-shaped.not-a-real-token"
    monkeypatch.setattr(client, "get_request_token", lambda _name: jwt_token)
    monkeypatch.setenv("ATLASSIAN_TOKEN", "env-atlassian-token")

    assert client.get_env() == "env-atlassian-token"


def test_get_env_returns_api_token_from_authorization(monkeypatch):
    """Non-JWT Authorization values are still accepted as Atlassian API tokens."""
    client = importlib.import_module("api.client")
    importlib.reload(client)

    monkeypatch.setattr(client, "get_request_token", lambda _name: "plain-api-token")
    monkeypatch.delenv("ATLASSIAN_TOKEN", raising=False)

    assert client.get_env() == "plain-api-token"


@pytest.mark.asyncio
async def test_resolve_oauth_base_url_uses_accessible_resources(monkeypatch):
    """resolve_oauth_base_url queries accessible-resources and builds the gateway URL."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.delenv("ATLASSIAN_OAUTH_CLOUD_ID", raising=False)

    calls = []

    class AccessibleResourcesResponse:
        status_code = 200
        text = ""

        def json(self):
            return [{"id": "cloud-xyz", "name": "my-site", "url": "https://my-site.atlassian.net"}]

    class FakeAsyncClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, url, *, headers):
            calls.append({"url": url, "headers": headers})
            return AccessibleResourcesResponse()

    monkeypatch.setattr(client.httpx, "AsyncClient", FakeAsyncClient)

    base_url = await client.resolve_oauth_base_url("provider-oauth-token")

    assert base_url == "https://api.atlassian.com/ex/jira/cloud-xyz"
    assert calls[0]["url"] == client.ATLASSIAN_ACCESSIBLE_RESOURCES_URL
    assert calls[0]["headers"]["Authorization"] == "Bearer provider-oauth-token"


@pytest.mark.asyncio
async def test_resolve_oauth_base_url_honours_explicit_cloud_id(monkeypatch):
    """An explicit ATLASSIAN_OAUTH_CLOUD_ID short-circuits the accessible-resources call."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.setenv("ATLASSIAN_OAUTH_CLOUD_ID", "pinned-cloud")

    class ExplodingAsyncClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, *args, **kwargs):
            raise AssertionError("accessible-resources must not be called when cloud id is pinned")

    monkeypatch.setattr(client.httpx, "AsyncClient", ExplodingAsyncClient)

    base_url = await client.resolve_oauth_base_url("provider-oauth-token")

    assert base_url == "https://api.atlassian.com/ex/jira/pinned-cloud"


def test_validate_prerequisites_rejects_gateway_caller_without_provider_token(monkeypatch):
    """AgentGateway caller path without provider token must not fall back to env PAT."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.setenv("ATLASSIAN_TOKEN", "shared-env-pat")
    monkeypatch.setenv("ATLASSIAN_API_URL", "https://test.atlassian.net")
    monkeypatch.setattr(client, "get_provider_header_token", lambda: None)
    monkeypatch.setattr(
        client,
        "_request_has_caipe_provider_header",
        lambda: True,
    )

    ok, payload = client.validate_prerequisites()

    assert ok is False
    assert "Atlassian account not connected" in payload["error"]
