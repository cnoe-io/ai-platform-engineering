from types import SimpleNamespace

import pytest

from mcp_scheduler import mcp_server


def test_caller_token_reads_gateway_forwarded_header(monkeypatch: pytest.MonkeyPatch) -> None:
  request = SimpleNamespace(headers={"x-caipe-caller-token": "caller-jwt"})
  monkeypatch.setattr(mcp_server, "get_http_request", lambda: request)
  monkeypatch.setenv("SCHEDULER_SERVICE_TOKEN", "scheduler-token")

  assert mcp_server._caller_token() == "caller-jwt"
  assert mcp_server._headers()["Authorization"] == "Bearer caller-jwt"


def test_caller_token_accepts_bearer_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
  request = SimpleNamespace(headers={"x-caipe-caller-token": "Bearer caller-jwt"})
  monkeypatch.setattr(mcp_server, "get_http_request", lambda: request)

  assert mcp_server._caller_token() == "caller-jwt"


def test_caller_token_fails_closed_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
  request = SimpleNamespace(headers={})
  monkeypatch.setattr(mcp_server, "get_http_request", lambda: request)

  with pytest.raises(ValueError, match="authenticated caller token"):
    mcp_server._caller_token()
