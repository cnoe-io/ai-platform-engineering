"""Unit tests for the PagerDuty API client auth handling."""

import asyncio
import importlib


class FakeResponse:
    """Minimal httpx response stand-in for client unit tests."""

    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"ok": True}
        self.text = text

    def json(self):
        return self._payload


def _fake_async_client(calls, responses=None):
    """Build a FakeAsyncClient class that records request headers/urls into ``calls``.

    ``responses`` is an optional list of :class:`FakeResponse` returned in order, one per
    HTTP call (used to simulate an auth rejection followed by a successful fallback). When
    exhausted or omitted, a default ``200`` response is returned.
    """

    queue = list(responses or [])

    def _next_response():
        if queue:
            return queue.pop(0)
        return FakeResponse()

    class FakeAsyncClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, url, *, headers, params):
            calls.append({"method": "GET", "url": url, "headers": headers, "params": params})
            return _next_response()

        async def post(self, url, *, headers, params, json):
            calls.append({"method": "POST", "url": url, "headers": headers, "params": params, "json": json})
            return _next_response()

        async def put(self, url, *, headers, params, json):
            calls.append({"method": "PUT", "url": url, "headers": headers, "params": params, "json": json})
            return _next_response()

        async def patch(self, url, *, headers, params, json):
            calls.append({"method": "PATCH", "url": url, "headers": headers, "params": params, "json": json})
            return _next_response()

        async def delete(self, url, *, headers, params):
            calls.append({"method": "DELETE", "url": url, "headers": headers, "params": params})
            return _next_response()

    return FakeAsyncClient


def test_provider_header_token_uses_bearer_scheme(monkeypatch):
    """A CAIPE-exchanged provider (OAuth) token must use Bearer auth."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.delenv("PAGERDUTY_API_KEY", raising=False)
    monkeypatch.setattr(client, "get_provider_header_token", lambda: "provider-oauth-token")

    calls = []
    monkeypatch.setattr(client.httpx, "AsyncClient", _fake_async_client(calls))

    success, response = asyncio.run(client.make_api_request("users"))

    assert success is True
    assert response == {"ok": True}
    assert calls[0]["headers"]["Authorization"] == "Bearer provider-oauth-token"


def test_env_api_key_uses_token_scheme(monkeypatch):
    """A static account/user API key (no provider header) keeps PagerDuty's Token scheme."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.setattr(client, "get_provider_header_token", lambda: None)
    monkeypatch.setattr(client, "get_static_api_key", lambda: "static-api-key")

    calls = []
    monkeypatch.setattr(client.httpx, "AsyncClient", _fake_async_client(calls))

    success, response = asyncio.run(client.make_api_request("users"))

    assert success is True
    assert calls[0]["headers"]["Authorization"] == "Token token=static-api-key"


def test_explicit_token_keeps_token_scheme_even_with_provider_header(monkeypatch):
    """An explicitly-passed token is a static key and must use the Token scheme."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.setattr(client, "get_provider_header_token", lambda: "provider-oauth-token")

    calls = []
    monkeypatch.setattr(client.httpx, "AsyncClient", _fake_async_client(calls))

    success, response = asyncio.run(client.make_api_request("users", token="explicit-key"))

    assert success is True
    assert calls[0]["headers"]["Authorization"] == "Token token=explicit-key"


def test_missing_token_returns_error_without_request(monkeypatch):
    """With neither a provider header, explicit token, nor env key, no request is made."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.setattr(client, "get_provider_header_token", lambda: None)
    monkeypatch.setattr(client, "get_static_api_key", lambda: None)

    class ExplodingAsyncClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, *args, **kwargs):
            raise AssertionError("No HTTP request should be made without a token")

        post = put = patch = delete = get

    monkeypatch.setattr(client.httpx, "AsyncClient", ExplodingAsyncClient)

    success, response = asyncio.run(client.make_api_request("users"))

    assert success is False
    assert "error" in response


def test_provider_token_403_falls_back_to_static_key(monkeypatch):
    """A rejected per-user OAuth token (403) retries with the static key using Token scheme."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.setattr(client, "get_provider_header_token", lambda: "provider-oauth-token")
    monkeypatch.setattr(client, "get_static_api_key", lambda: "static-api-key")

    calls = []
    responses = [
        FakeResponse(status_code=403, payload={"error": {"message": "scope missing"}}),
        FakeResponse(status_code=200, payload={"users": []}),
    ]
    monkeypatch.setattr(client.httpx, "AsyncClient", _fake_async_client(calls, responses))

    success, response = asyncio.run(client.make_api_request("users"))

    assert success is True
    assert response == {"users": []}
    # First attempt = per-user OAuth Bearer; fallback = static key Token scheme.
    assert calls[0]["headers"]["Authorization"] == "Bearer provider-oauth-token"
    assert calls[1]["headers"]["Authorization"] == "Token token=static-api-key"


def test_provider_token_401_without_static_key_does_not_retry(monkeypatch):
    """Without a static key, a 401 on the OAuth token surfaces the error and makes no retry."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.setattr(client, "get_provider_header_token", lambda: "provider-oauth-token")
    monkeypatch.setattr(client, "get_static_api_key", lambda: None)

    calls = []
    responses = [FakeResponse(status_code=401, payload={"error": {"message": "unauthorized"}})]
    monkeypatch.setattr(client.httpx, "AsyncClient", _fake_async_client(calls, responses))

    success, response = asyncio.run(client.make_api_request("users"))

    assert success is False
    assert "error" in response
    assert len(calls) == 1


def test_static_key_403_does_not_retry(monkeypatch):
    """A static-key (Token scheme) 403 must not loop into a fallback retry."""
    client = importlib.import_module("api.client")
    importlib.reload(client)
    monkeypatch.setattr(client, "get_provider_header_token", lambda: None)
    monkeypatch.setattr(client, "get_static_api_key", lambda: "static-api-key")

    calls = []
    responses = [FakeResponse(status_code=403, payload={"error": {"message": "forbidden"}})]
    monkeypatch.setattr(client.httpx, "AsyncClient", _fake_async_client(calls, responses))

    success, response = asyncio.run(client.make_api_request("users"))

    assert success is False
    assert "error" in response
    assert len(calls) == 1
