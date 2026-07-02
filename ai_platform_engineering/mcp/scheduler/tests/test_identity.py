import jwt
import pytest

from mcp_scheduler import mcp_server


def _token(**claims: str) -> str:
  return jwt.encode(claims, "test-only-key-with-at-least-32-bytes", algorithm="HS256")


def test_effective_owner_uses_authenticated_email(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.setattr(
    mcp_server,
    "get_request_token",
    lambda _env: _token(email="owner@example.com"),
  )
  monkeypatch.setenv("SCHEDULER_REQUIRE_CALLER_IDENTITY", "true")

  assert mcp_server._effective_owner("someone-else@example.com") == "owner@example.com"


def test_effective_owner_fails_closed_without_caller(monkeypatch: pytest.MonkeyPatch) -> None:
  monkeypatch.setattr(mcp_server, "get_request_token", lambda _env: None)
  monkeypatch.setenv("SCHEDULER_REQUIRE_CALLER_IDENTITY", "true")

  with pytest.raises(ValueError, match="authenticated caller"):
    mcp_server._effective_owner("untrusted@example.com")


def test_effective_owner_allows_explicit_local_dev_fallback(
  monkeypatch: pytest.MonkeyPatch,
) -> None:
  monkeypatch.setattr(mcp_server, "get_request_token", lambda _env: None)
  monkeypatch.setenv("SCHEDULER_REQUIRE_CALLER_IDENTITY", "false")

  assert mcp_server._effective_owner("local@example.com") == "local@example.com"
