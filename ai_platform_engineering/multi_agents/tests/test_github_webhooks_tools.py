# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for the supervisor-side GitHub webhook management tools.

Spec #099 webhook follow-up. Each tool is a thin wrapper around the
GitHub Repository Webhooks REST API. Tests follow the same pattern
as ``test_autonomous_tasks_tools.py``:

* ``httpx.MockTransport`` intercepts outgoing HTTP so tests never open
  a real socket.
* Happy path AND documented failure modes for each tool -- the tools
  are contractually no-raise, every failure must round-trip back as a
  human-readable string so a regression doesn't manifest as an
  unhelpful stack trace in the chat thread.
* Shape of the outgoing request is asserted (URL, method, headers,
  JSON body) because the GitHub API is strict about payload layout.
"""

from __future__ import annotations

import httpx
import pytest

from ai_platform_engineering.multi_agents.tools import github_webhooks as gw


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _stub_token(monkeypatch):
    """Every test gets a fake PAT so the auth-header path is exercised.

    Individual tests that want the "no token" path unset the env var
    explicitly.
    """
    monkeypatch.setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "ghp_TEST_TOKEN_1234")


def _patch_httpx(monkeypatch, handler):
    """Route every httpx.Client opened by the tools through ``handler``.

    Same shape as the helper in ``test_autonomous_tasks_tools.py`` --
    keeping the pattern consistent makes it obvious what's being
    mocked when adding new tools.
    """
    transport = httpx.MockTransport(handler)
    real_client = httpx.Client

    def _factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return real_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(gw.httpx, "Client", _factory)


def _hook_response(hook_id: int = 42, events=None, url: str = "https://example.com/hooks/t1") -> dict:
    """Representative JSON GitHub returns on POST /hooks."""
    return {
        "type": "Repository",
        "id": hook_id,
        "name": "web",
        "active": True,
        "events": list(events or ["issues"]),
        "config": {
            "url": url,
            "content_type": "json",
            "insecure_ssl": "0",
            "secret": "********",  # GitHub masks it
        },
        "created_at": "2026-04-26T22:30:00Z",
        "updated_at": "2026-04-26T22:30:00Z",
    }


# ---------------------------------------------------------------------------
# _parse_repo (unit, no network)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value,expected",
    [
        ("A-makarim/CAIPE", ("A-makarim", "CAIPE")),
        ("https://github.com/A-makarim/CAIPE", ("A-makarim", "CAIPE")),
        ("https://github.com/A-makarim/CAIPE.git", ("A-makarim", "CAIPE")),
        ("github.com/A-makarim/CAIPE/", ("A-makarim", "CAIPE")),
    ],
)
def test_parse_repo_accepts_common_shapes(value, expected):
    owner, name, err = gw._parse_repo(value)
    assert err is None
    assert (owner, name) == expected


@pytest.mark.parametrize(
    "value",
    ["", None, "no-slash", "a/b/c", "/start-slash", "a/"],
)
def test_parse_repo_rejects_invalid_inputs(value):
    owner, name, err = gw._parse_repo(value)
    assert err is not None
    assert owner is None and name is None


# ---------------------------------------------------------------------------
# register_github_webhook
# ---------------------------------------------------------------------------


def test_register_happy_path_defaults_events_and_generates_secret(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("Authorization")
        captured["api_version"] = request.headers.get("X-GitHub-Api-Version")
        captured["body"] = request.read()
        import json as _json
        captured["json"] = _json.loads(captured["body"])
        return httpx.Response(201, json=_hook_response(hook_id=99))

    _patch_httpx(monkeypatch, handler)
    result = gw.register_github_webhook.invoke(
        {
            "repo": "A-makarim/CAIPE",
            "callback_url": "https://xyz.ngrok.io/hooks/t1",
        }
    )

    # Wire shape -- exactly what GitHub expects.
    assert captured["method"] == "POST"
    assert captured["url"] == "https://api.github.com/repos/A-makarim/CAIPE/hooks"
    assert captured["auth"] == "Bearer ghp_TEST_TOKEN_1234"
    assert captured["api_version"] == "2022-11-28"
    body = captured["json"]
    assert body["name"] == "web"
    assert body["active"] is True
    assert body["events"] == ["issues"]  # default
    assert body["config"]["url"] == "https://xyz.ngrok.io/hooks/t1"
    assert body["config"]["content_type"] == "json"
    assert body["config"]["insecure_ssl"] == "0"
    assert isinstance(body["config"]["secret"], str)
    assert len(body["config"]["secret"]) == 64  # 32 bytes hex

    # LLM-facing response.
    assert "hook_id=99" in result
    assert "A-makarim/CAIPE" in result
    assert "issues" in result
    assert "auto-generated secret" in result  # flag so operator sees the value
    assert "HMAC-SHA256" in result


def test_register_uses_caller_supplied_secret_and_events(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        captured["json"] = _json.loads(request.read())
        return httpx.Response(
            201, json=_hook_response(hook_id=7, events=["issues", "pull_request"])
        )

    _patch_httpx(monkeypatch, handler)
    result = gw.register_github_webhook.invoke(
        {
            "repo": "owner/repo",
            "callback_url": "https://example.com/hooks/t1",
            "events": ["issues", "pull_request"],
            "secret": "caller-provided-secret",
            "active": False,
        }
    )

    body = captured["json"]
    assert body["config"]["secret"] == "caller-provided-secret"
    assert body["events"] == ["issues", "pull_request"]
    assert body["active"] is False

    # Caller-supplied secret MUST NOT be echoed back in the response --
    # that would make it way too easy to leak into logs / chat history.
    assert "caller-provided-secret" not in result
    assert "auto-generated" not in result  # not auto-generated this time


def test_register_accepts_github_url_not_just_owner_name(monkeypatch):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(201, json=_hook_response())

    _patch_httpx(monkeypatch, handler)
    gw.register_github_webhook.invoke(
        {
            "repo": "https://github.com/A-makarim/CAIPE.git",
            "callback_url": "https://example.com/hooks/t1",
        }
    )
    assert captured["url"] == "https://api.github.com/repos/A-makarim/CAIPE/hooks"


def test_register_401_returns_token_hint(monkeypatch):
    def handler(_request):
        return httpx.Response(401, json={"message": "Bad credentials"})

    _patch_httpx(monkeypatch, handler)
    result = gw.register_github_webhook.invoke(
        {"repo": "a/b", "callback_url": "https://example.com/h"}
    )
    assert "HTTP 401" in result
    assert "Bad credentials" in result
    assert "GITHUB_PERSONAL_ACCESS_TOKEN" in result


def test_register_403_returns_scope_hint(monkeypatch):
    def handler(_request):
        return httpx.Response(
            403,
            json={"message": "Resource not accessible by integration"},
        )

    _patch_httpx(monkeypatch, handler)
    result = gw.register_github_webhook.invoke(
        {"repo": "a/b", "callback_url": "https://example.com/h"}
    )
    assert "HTTP 403" in result
    assert "admin:repo_hook" in result


def test_register_404_returns_access_hint(monkeypatch):
    def handler(_request):
        return httpx.Response(404, json={"message": "Not Found"})

    _patch_httpx(monkeypatch, handler)
    result = gw.register_github_webhook.invoke(
        {"repo": "ghost/missing", "callback_url": "https://example.com/h"}
    )
    assert "HTTP 404" in result
    assert "Repo not found" in result


def test_register_422_validation_error_collapses_detail(monkeypatch):
    """GitHub 422 with a nested errors array -- we want the one-liner readable."""

    def handler(_request):
        return httpx.Response(
            422,
            json={
                "message": "Validation Failed",
                "errors": [
                    {
                        "resource": "Hook",
                        "code": "custom",
                        "message": "Hook already exists on this repository",
                    }
                ],
            },
        )

    _patch_httpx(monkeypatch, handler)
    result = gw.register_github_webhook.invoke(
        {"repo": "a/b", "callback_url": "https://example.com/h"}
    )
    assert "HTTP 422" in result
    assert "Validation Failed" in result
    assert "already exists" in result


def test_register_transport_error_returns_connectivity_hint(monkeypatch):
    def handler(_request):
        raise httpx.ConnectError("no route to host")

    _patch_httpx(monkeypatch, handler)
    result = gw.register_github_webhook.invoke(
        {"repo": "a/b", "callback_url": "https://example.com/h"}
    )
    assert "Could not reach GitHub" in result
    assert "ConnectError" in result
    assert "no route to host" in result


def test_register_missing_token_short_circuits_without_network(monkeypatch):
    monkeypatch.delenv("GITHUB_PERSONAL_ACCESS_TOKEN", raising=False)

    called = False

    def handler(_request):
        nonlocal called
        called = True
        return httpx.Response(200)

    _patch_httpx(monkeypatch, handler)
    result = gw.register_github_webhook.invoke(
        {"repo": "a/b", "callback_url": "https://example.com/h"}
    )
    assert called is False  # must not have attempted an HTTP call
    assert "GITHUB_PERSONAL_ACCESS_TOKEN" in result
    assert "admin:repo_hook" in result


def test_register_rejects_bad_repo_without_network(monkeypatch):
    called = False

    def handler(_request):
        nonlocal called
        called = True
        return httpx.Response(200)

    _patch_httpx(monkeypatch, handler)
    result = gw.register_github_webhook.invoke(
        {"repo": "no-slash", "callback_url": "https://example.com/h"}
    )
    assert called is False
    assert "not in 'owner/name' form" in result


def test_register_rejects_callback_url_without_scheme(monkeypatch):
    called = False

    def handler(_request):
        nonlocal called
        called = True
        return httpx.Response(200)

    _patch_httpx(monkeypatch, handler)
    result = gw.register_github_webhook.invoke(
        {"repo": "a/b", "callback_url": "example.com/h"}
    )
    assert called is False
    assert "callback_url must start with http" in result


# ---------------------------------------------------------------------------
# list_github_webhooks
# ---------------------------------------------------------------------------


def test_list_hooks_happy_path_returns_summary(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == "https://api.github.com/repos/a/b/hooks"
        return httpx.Response(
            200,
            json=[
                _hook_response(hook_id=1, url="https://a.com/1"),
                _hook_response(hook_id=2, url="https://b.com/2", events=["push"]),
            ],
        )

    _patch_httpx(monkeypatch, handler)
    result = gw.list_github_webhooks.invoke({"repo": "a/b"})

    assert "2 total" in result
    assert "hook#1" in result
    assert "hook#2" in result
    assert "a.com/1" in result
    assert "push" in result


def test_list_hooks_empty_returns_friendly_message(monkeypatch):
    def handler(_request):
        return httpx.Response(200, json=[])

    _patch_httpx(monkeypatch, handler)
    result = gw.list_github_webhooks.invoke({"repo": "a/b"})
    assert "No webhooks registered" in result
    assert "a/b" in result


def test_list_hooks_404_returns_error(monkeypatch):
    def handler(_request):
        return httpx.Response(404, json={"message": "Not Found"})

    _patch_httpx(monkeypatch, handler)
    result = gw.list_github_webhooks.invoke({"repo": "ghost/missing"})
    assert "HTTP 404" in result


def test_list_hooks_missing_token_short_circuits(monkeypatch):
    monkeypatch.delenv("GITHUB_PERSONAL_ACCESS_TOKEN", raising=False)
    called = False

    def handler(_request):
        nonlocal called
        called = True
        return httpx.Response(200)

    _patch_httpx(monkeypatch, handler)
    result = gw.list_github_webhooks.invoke({"repo": "a/b"})
    assert called is False
    assert "GITHUB_PERSONAL_ACCESS_TOKEN" in result


# ---------------------------------------------------------------------------
# delete_github_webhook
# ---------------------------------------------------------------------------


def test_delete_hook_happy_path_returns_success(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        assert str(request.url) == "https://api.github.com/repos/a/b/hooks/42"
        return httpx.Response(204)

    _patch_httpx(monkeypatch, handler)
    result = gw.delete_github_webhook.invoke({"repo": "a/b", "hook_id": 42})
    assert "42 deleted" in result
    assert "a/b" in result


def test_delete_hook_404_returns_error(monkeypatch):
    def handler(_request):
        return httpx.Response(404, json={"message": "Not Found"})

    _patch_httpx(monkeypatch, handler)
    result = gw.delete_github_webhook.invoke({"repo": "a/b", "hook_id": 99})
    assert "HTTP 404" in result
    assert "99" in result


def test_delete_hook_rejects_bad_hook_id_without_network(monkeypatch):
    called = False

    def handler(_request):
        nonlocal called
        called = True
        return httpx.Response(204)

    _patch_httpx(monkeypatch, handler)
    result = gw.delete_github_webhook.invoke({"repo": "a/b", "hook_id": 0})
    assert called is False
    assert "positive integer" in result


# ---------------------------------------------------------------------------
# test_github_webhook
# ---------------------------------------------------------------------------


def test_test_webhook_happy_path(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://api.github.com/repos/a/b/hooks/42/tests"
        return httpx.Response(204)

    _patch_httpx(monkeypatch, handler)
    result = gw.test_github_webhook.invoke({"repo": "a/b", "hook_id": 42})
    assert "Test delivery requested" in result
    assert "42" in result


def test_test_webhook_404_returns_error(monkeypatch):
    def handler(_request):
        return httpx.Response(404, json={"message": "Not Found"})

    _patch_httpx(monkeypatch, handler)
    result = gw.test_github_webhook.invoke({"repo": "a/b", "hook_id": 42})
    assert "HTTP 404" in result
