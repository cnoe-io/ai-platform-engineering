"""Tests for Webex Keycloak Admin API helpers."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from ai_platform_engineering.integrations.webex_bot.utils import keycloak_admin as ka


class _Response:
    def __init__(self, body: list[dict[str, Any]]) -> None:
        self._body = body

    def raise_for_status(self) -> None:
        return None

    def json(self) -> list[dict[str, Any]]:
        return self._body


class _AsyncClient:
    def __init__(
        self,
        body: list[dict[str, Any]],
        calls: list[dict[str, Any]],
    ) -> None:
        self._body = body
        self._calls = calls

    async def __aenter__(self) -> "_AsyncClient":
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def get(self, url: str, **kwargs: Any) -> _Response:
        self._calls.append({"url": url, **kwargs})
        return _Response(self._body)


def test_get_user_by_attribute_returns_exact_webex_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    webex_user_id = "person1234"
    expected = {
        "id": "keycloak-user-1",
        "attributes": {ka.WEBEX_USER_ATTRIBUTE: [webex_user_id]},
    }
    calls: list[dict[str, Any]] = []

    async def fake_admin_token(_config: ka.KeycloakAdminConfig) -> str:
        return "admin-token"

    monkeypatch.setattr(ka, "_get_admin_token", fake_admin_token)
    monkeypatch.setattr(
        ka.httpx,
        "AsyncClient",
        lambda **_kwargs: _AsyncClient([expected], calls),
    )

    actual = asyncio.run(
        ka.get_user_by_attribute(ka.WEBEX_USER_ATTRIBUTE, webex_user_id)
    )

    assert actual == expected
    assert calls[0]["params"] == {
        "q": f"{ka.WEBEX_USER_ATTRIBUTE}:{webex_user_id}",
        "max": 5,
    }
    assert calls[0]["headers"] == {"Authorization": "Bearer admin-token"}
