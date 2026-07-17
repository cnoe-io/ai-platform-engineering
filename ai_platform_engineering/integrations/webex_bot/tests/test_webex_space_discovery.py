from __future__ import annotations

from typing import Any

from ai_platform_engineering.integrations.webex_bot.utils.webex_space_discovery import (
    WebexSpaceDiscovery,
)


class _Response:
    def __init__(
        self,
        payload: dict[str, Any],
        *,
        next_url: str | None = None,
    ) -> None:
        self._payload = payload
        self.links = {"next": {"url": next_url}} if next_url else {}

    def raise_for_status(self) -> None:
        return

    def json(self) -> dict[str, Any]:
        return self._payload


def test_discovery_uses_selected_bot_token_and_filters_direct_rooms(monkeypatch) -> None:
    monkeypatch.setenv("PRIMARY_TOKEN", "secret-token")
    calls: list[dict[str, object]] = []

    def request_get(url: str, **kwargs: object) -> _Response:
        calls.append({"url": url, **kwargs})
        return _Response(
            {
                "items": [
                    {"id": "space-2", "title": "Second", "type": "group"},
                    {"id": "direct-1", "title": "Direct", "type": "direct"},
                    {"id": "space-1", "title": "First", "type": "group"},
                ]
            }
        )

    discovery = WebexSpaceDiscovery(request_get=request_get)  # type: ignore[arg-type]
    result = discovery.list_spaces(bot_id="primary")

    assert [space["name"] for space in result.spaces] == ["First", "Second"]
    assert calls[0]["headers"] == {"Authorization": "Bearer secret-token"}


def test_discovery_cache_is_scoped_by_bot_and_can_be_refreshed(monkeypatch) -> None:
    monkeypatch.setenv("PRIMARY_TOKEN", "secret-token")
    calls = 0

    def request_get(_url: str, **_kwargs: object) -> _Response:
        nonlocal calls
        calls += 1
        return _Response({"items": [{"id": "space-1", "title": "First"}]})

    discovery = WebexSpaceDiscovery(request_get=request_get)  # type: ignore[arg-type]

    first = discovery.list_spaces(bot_id="primary")
    cached = discovery.list_spaces(bot_id="primary")
    refreshed = discovery.list_spaces(bot_id="primary", refresh=True)

    assert first.cache_hit is False
    assert cached.cache_hit is True
    assert refreshed.cache_hit is False
    assert calls == 2
