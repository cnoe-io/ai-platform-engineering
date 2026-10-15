from __future__ import annotations

import threading
from http.server import ThreadingHTTPServer
from types import SimpleNamespace
from typing import Any

import pytest
import requests

from ai_platform_engineering.integrations.slack_bot.utils.slack_admin_api import (
    SlackAdminAuthError,
    SlackAdminTokenValidator,
    _SlackAdminRequestHandler,
)

from ai_platform_engineering.integrations.slack_bot.utils.slack_directory import (
  SlackDirectoryError,
  SlackDirectoryService,
)


class Response:
  def __init__(self, body: dict[str, Any], status: int = 200, retry: str = "1") -> None:
    self.body = body
    self.status_code = status
    self.headers = {"Retry-After": retry}

  def raise_for_status(self) -> None:
    return None

  def json(self) -> dict[str, Any]:
    return self.body


@pytest.fixture(autouse=True)
def token(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.setenv("SLACK_INTEGRATION_BOT_TOKEN", "example-token")
  monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)


def settled(service: SlackDirectoryService, kind: str = "users") -> None:
  entry = service._entries[service._key(kind, service._token())]
  # Join the refresh thread without advancing fake wall time or allowing a partial snapshot.
  for thread in threading.enumerate():
    if thread.name == f"slack-directory-{kind}":
      thread.join(timeout=2)
  assert not entry.refreshing


def test_users_preserve_complete_snapshot_progress_and_private_search_fields() -> None:
  calls: list[str] = []
  gate = threading.Event()

  def request(url: str, **kwargs: Any) -> Response:
    calls.append(url)
    gate.wait(timeout=2)
    if url.endswith("emoji.list"):
      return Response({"ok": True})
    if kwargs["params"]["cursor"]:
      return Response({"ok": True, "members": [{"id": "U2", "name": "deleted", "deleted": True}]})
    return Response({"ok": True, "members": [{"id": "U1", "name": "example", "profile": {"display_name": "Example User", "first_name": "Example", "last_name": "User", "email": "person@example.com"}}], "response_metadata": {"next_cursor": "next"}})

  service = SlackDirectoryService(request_get=request)
  assert service.users({"q": "exam"})["warming"] is True
  assert service.users({"q": "exam"})["warming"] is True
  gate.set()
  settled(service)
  result = service.users({"q": "ex user"})
  assert result["users"][0]["id"] == "U1"
  assert "search_terms" not in result["users"][0]
  assert "email" not in result["users"][0]
  assert len(calls) == 2
  status = service.status()["users"]
  assert status["pages_scanned"] == 2
  assert status["members_seen"] == 2
  assert status["users_indexed"] == 1
  settled(service, "emoji")


def test_partial_failure_retains_last_complete_snapshot() -> None:
  failing = False

  def request(_url: str, **kwargs: Any) -> Response:
    if failing:
      if kwargs["params"].get("cursor"):
        return Response({"ok": False, "error": "unavailable"})
      return Response({"ok": True, "members": [{"id": "U2", "name": "partial"}], "response_metadata": {"next_cursor": "next"}})
    return Response({"ok": True, "members": [{"id": "U1", "name": "complete"}]})

  service = SlackDirectoryService(request_get=request)
  service.users({"q": "complete"})
  settled(service)
  failing = True
  service.users({"q": "complete", "refresh": "1"})
  settled(service)
  result = service.users({"q": "complete"})
  assert result["users"][0]["id"] == "U1"
  assert service._entries[service._key("users", service._token())].last_error


@pytest.mark.parametrize("query", ["example", "Example", "EXAMPLE"])
def test_user_search_is_case_insensitive(query: str) -> None:
  service = SlackDirectoryService(request_get=lambda *_args, **_kwargs: Response({
    "ok": True, "members": [{"id": "U1", "name": "example"}],
  }))
  service.users({"q": query})
  settled(service)
  result = service.users({"q": query})
  assert [user["id"] for user in result["users"]] == ["U1"]
  assert result["query"]["q"] == query


def test_email_lookup_bot_filter_and_not_found() -> None:
  def request(_url: str, **kwargs: Any) -> Response:
    if kwargs["params"]["email"] == "missing@example.com":
      return Response({"ok": False, "error": "users_not_found"})
    return Response({"ok": True, "user": {"id": "U1", "name": "example", "profile": {"email": "person@example.com"}}})

  service = SlackDirectoryService(request_get=request)
  assert service.users({"q": "person@example.com"})["users"][0]["id"] == "U1"
  assert service.users({"q": "person@example.com", "kind": "bots"})["users"] == []
  assert service.users({"q": "missing@example.com"})["users"] == []


def test_empty_complete_directory_does_not_refresh_forever() -> None:
  calls: list[str] = []

  def request(url: str, **_kwargs: Any) -> Response:
    calls.append(url)
    return Response({"ok": True, "members": []})

  service = SlackDirectoryService(request_get=request)
  service.users({"q": "example"})
  settled(service)
  assert service.users({"q": "example"})["cached"] is True
  assert len(calls) == 1


def test_emoji_alias_and_standard_fallback() -> None:
  service = SlackDirectoryService(request_get=lambda *_args, **_kwargs: Response({"ok": True, "emoji": {"example": "alias:eyes", "custom": "https://example.com/image.png"}}))
  service.emoji({})
  settled(service, "emoji")
  assert any(row["name"] == "eyes" for row in service.emoji({"q": ":eyes:"})["emoji"])
  assert {"name": "example", "alias_for": "eyes"} in service.emoji({"q": "example"})["emoji"]


def test_channels_member_only_pagination_refresh_and_configured_zero_ttl() -> None:
  calls: list[str] = []

  class Collection:
    minutes = 60

    def find_one(self, _query: Any) -> dict[str, int]:
      return {"slack_discovery_cache_ttl_minutes": self.minutes}

  collection = Collection()

  def request(url: str, **_kwargs: Any) -> Response:
    calls.append(url)
    return Response({"ok": True, "channels": [{"id": "C1", "name": "alpha"}, {"id": "C2", "name": "beta"}, {"id": "C3", "is_member": False}, {"id": "C4", "is_archived": True}]})

  service = SlackDirectoryService(request_get=request, collection_factory=lambda _name: collection)
  first = service.channels({"limit": "1", "member_only": "0"})
  assert first["channels"][0]["is_member"] is True
  assert first["next_cursor"] == "alpha"
  assert service.channels({"cursor": "alpha"})["channels"][0]["id"] == "C2"
  assert len(calls) == 1
  service.channels({"refresh": "1"})
  assert len(calls) == 2
  collection.minutes = 0
  service._ttl_memo = None
  assert service.channels({})["cached"] is False
  assert service.channels({})["cached"] is False
  assert len(calls) == 4
  assert all(url.endswith("users.conversations") for url in calls)


def test_rate_limit_respects_full_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
  responses = iter([Response({}, 429, "120"), Response({"ok": True})])
  slept: list[float] = []
  monkeypatch.setattr("ai_platform_engineering.integrations.slack_bot.utils.slack_directory.time.sleep", slept.append)
  service = SlackDirectoryService(request_get=lambda *_args, **_kwargs: next(responses))
  service._call("example-token", "emoji.list", {})
  assert slept[0] > 119


def test_missing_credentials_status_and_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.delenv("SLACK_INTEGRATION_BOT_TOKEN")
  service = SlackDirectoryService()
  assert service.status()["configured"] is False
  with pytest.raises(SlackDirectoryError, match="bot service") as error:
    service.channels({})
  assert error.value.status == 503


def test_directory_http_requires_service_scope_and_rejects_forwarding(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    class Validator:
        def validate(self, token: str, *, required_scope: str | None = None) -> None:
            seen.append(str(required_scope))
            if token != "example-service-token":
                raise SlackAdminAuthError("invalid token")

    class Handler(_SlackAdminRequestHandler):
        pass

    directory = SlackDirectoryService(request_get=lambda *_args, **_kwargs: Response({"ok": True}))
    Handler.service = SimpleNamespace(directory=directory)  # type: ignore[assignment]
    Handler.validator = Validator()  # type: ignore[assignment]
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/admin/slack/directory/users"
    try:
        assert requests.get(url, timeout=2).status_code == 401
        assert requests.get(url, headers={"Authorization": "Bearer wrong"}, timeout=2).status_code == 403
        headers = {"Authorization": "Bearer example-service-token"}
        assert requests.get(url, headers=headers, timeout=2).json()["users"] == []
        assert requests.get(url, params={"url": "https://example.com"}, headers=headers, timeout=2).status_code == 400
        assert requests.get(url + "?" + "&".join(f"q={i}" for i in range(11)), headers=headers, timeout=2).status_code == 400
        assert set(seen) == {"slack:directory:read"}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_jwt_scope_and_client_allowlist(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SLACK_ADMIN_DEV_AUTH_ENABLED", raising=False)
    claims: dict[str, str] = {"azp": "example-ui", "scope": "slack:directory:read", "sub": "example-service"}
    validator = SlackAdminTokenValidator(issuer="https://auth.example.com/realms/example", audience="example-bot-admin", jwks_url="https://auth.example.com/certs", allowed_client_ids=["example-ui"])
    validator._jwks_client = SimpleNamespace(get_signing_key_from_jwt=lambda _token: SimpleNamespace(key="example-key"))

    def decode(_token: str, _key: str, **kwargs: Any) -> dict[str, str]:
        assert kwargs["issuer"] == "https://auth.example.com/realms/example"
        assert kwargs["audience"] == "example-bot-admin"
        assert "HS256" not in kwargs["algorithms"]
        return claims

    monkeypatch.setattr("ai_platform_engineering.integrations.slack_bot.utils.slack_admin_api.jwt.decode", decode)
    assert validator.validate("token", required_scope="slack:directory:read").client_id == "example-ui"
    claims["scope"] = "openid"
    with pytest.raises(SlackAdminAuthError, match="missing scope"):
        validator.validate("token", required_scope="slack:directory:read")
    claims["azp"] = "another-client"
    with pytest.raises(SlackAdminAuthError, match="not allowed"):
        validator.validate("token", required_scope="slack:directory:read")
