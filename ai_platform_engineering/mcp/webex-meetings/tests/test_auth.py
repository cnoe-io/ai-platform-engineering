from __future__ import annotations

import pytest
from mcp.shared.exceptions import McpError

from mcp_webex_meetings import mcp_server


def test_bearer_from_request_prefers_authorization(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        mcp_server,
        "get_http_headers",
        lambda **_kwargs: {
            "authorization": "Bearer webex-oauth",
            "x-caipe-provider-token": "fallback-token",
        },
    )

    assert mcp_server._bearer_from_request() == "Bearer webex-oauth"


def test_bearer_from_request_wraps_provider_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        mcp_server,
        "get_http_headers",
        lambda **_kwargs: {"x-caipe-provider-token": "webex-oauth"},
    )

    assert mcp_server._bearer_from_request() == "Bearer webex-oauth"


def test_bearer_from_request_fails_without_user_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(mcp_server, "get_http_headers", lambda **_kwargs: {})

    with pytest.raises(McpError):
        mcp_server._bearer_from_request()
