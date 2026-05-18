"""Unit tests for the Jira API client."""

import importlib

import pytest


class FakeResponse:
    """Minimal httpx response stand-in for client unit tests."""

    status_code = 200
    text = ""

    def json(self):
        return {"ok": True}


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
    client = importlib.import_module("mcp_jira.api.client")
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
    client = importlib.import_module("mcp_jira.api.client")
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
