# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for Webex WDM websocket event normalization."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from ai_platform_engineering.integrations.webex_bot.webex_wdm import (
    MAX_WDM_HANDSHAKE_REFRESH_ATTEMPTS,
    WebexWdmRuntime,
    should_refresh_wdm_device_on_handshake,
    webex_event_from_wdm_activity,
    websocket_connect_header_kwargs,
    websocket_handshake_status,
)
from ai_platform_engineering.integrations.webex_bot.utils.webex_ids import (
    canonicalize_webex_space_id,
    public_webex_room_id_from_uuid,
)

RAW_ROOM_ID = "6f91b070-531a-11f1-926d-6fd3c20dfdc4"
PUBLIC_ROOM_ID = "Y2lzY29zcGFyazovL3VzL1JPT00vNmY5MWIwNzAtNTMxYS0xMWYxLTkyNmQtNmZkM2MyMGRmZGM0"


def test_public_webex_room_id_from_uuid_matches_api_shape() -> None:
    encoded = public_webex_room_id_from_uuid(RAW_ROOM_ID)

    assert encoded == PUBLIC_ROOM_ID


def test_canonicalize_webex_space_id_decodes_public_room_id() -> None:
    assert canonicalize_webex_space_id(PUBLIC_ROOM_ID) == RAW_ROOM_ID
    assert canonicalize_webex_space_id(RAW_ROOM_ID) == RAW_ROOM_ID


def test_wdm_activity_uses_fetched_message_detail_for_gate_payload() -> None:
    activity = {
        "verb": "post",
        "object": {"id": "raw-message-id"},
        "target": {"id": RAW_ROOM_ID},
    }
    message_detail = {
        "id": "message-public-id",
        "parentId": "root-message-public-id",
        "roomId": PUBLIC_ROOM_ID,
        "personId": "person-public-id",
        "personEmail": "user@example.com",
        "text": "neo-coder hello",
        "mentionedPeople": ["bot-person-id"],
    }

    event = webex_event_from_wdm_activity(
        activity,
        message_detail=message_detail,
        bot_person_id="bot-person-id",
    )

    assert event == {
        "event": "message",
        "data": {
            "id": "message-public-id",
            "parentId": "root-message-public-id",
            "roomId": RAW_ROOM_ID,
            "webexRoomId": PUBLIC_ROOM_ID,
            "personId": "person-public-id",
            "personEmail": "user@example.com",
            "text": "neo-coder hello",
            "mentionedPeople": ["bot-person-id"],
            "isSelf": False,
        },
    }


# ── WDM device reuse + message dedup ───────────────────────────────────────


class _FakeResponse:
    def __init__(self, status: int = 200, payload: dict[str, Any] | None = None) -> None:
        self.status = status
        self._payload = payload or {}

    async def __aenter__(self) -> "_FakeResponse":
        return self

    async def __aexit__(self, *_exc: Any) -> bool:
        return False

    async def json(self) -> dict[str, Any]:
        return self._payload


class _FakeSession:
    """Minimal aiohttp-style session recording posts/deletes for assertions."""

    def __init__(
        self,
        *,
        devices: list[dict[str, Any]] | None = None,
        new_device: dict[str, Any] | None = None,
        message_detail: dict[str, Any] | None = None,
    ) -> None:
        self._devices = devices or []
        self._new_device = new_device or {}
        self._message_detail = message_detail or {}
        self.posted = 0
        self.deleted: list[str] = []

    def get(self, url: str) -> _FakeResponse:
        if "/messages/" in url:
            return _FakeResponse(200, self._message_detail)
        if url.endswith("/people/me"):
            return _FakeResponse(200, {"id": "bot-person-id", "emails": ["bot@example.com"]})
        return _FakeResponse(200, {"devices": self._devices})

    def post(self, url: str, json: dict[str, Any] | None = None) -> _FakeResponse:
        self.posted += 1
        return _FakeResponse(200, self._new_device)

    def delete(self, url: str) -> _FakeResponse:
        self.deleted.append(url)
        return _FakeResponse(204, {})


@pytest.fixture(autouse=True)
def _bot_token(monkeypatch: pytest.MonkeyPatch) -> None:
    # WebexWdmRuntime constructs a WebexThreadedStreamDispatcher/WebexRestApi
    # which requires a bot token to be present in the environment.
    monkeypatch.setenv("WEBEX_INTEGRATION_BOT_ACCESS_TOKEN", "test-token")


def _runtime() -> WebexWdmRuntime:
    return WebexWdmRuntime(access_token="test-token", device_name="CAIPE-Webex-Bot")


def test_get_websocket_url_reuses_existing_device_and_prunes_extras() -> None:
    session = _FakeSession(
        devices=[
            {
                "name": "CAIPE-Webex-Bot",
                "url": "https://wdm/devices/new",
                "webSocketUrl": "wss://mercury/new",
                "modificationTime": "2026-06-03T10:00:00.000Z",
            },
            {
                "name": "CAIPE-Webex-Bot",
                "url": "https://wdm/devices/old",
                "webSocketUrl": "wss://mercury/old",
                "modificationTime": "2026-06-01T09:00:00.000Z",
            },
            {
                # A device belonging to some other integration must be ignored.
                "name": "Some-Other-Bot",
                "url": "https://wdm/devices/other",
                "webSocketUrl": "wss://mercury/other",
                "modificationTime": "2026-06-03T11:00:00.000Z",
            },
        ]
    )

    url = asyncio.run(_runtime()._get_websocket_url(session))

    assert url == "wss://mercury/new"  # newest of our own devices
    assert session.posted == 0  # reused, no new device registered
    assert session.deleted == ["https://wdm/devices/old"]  # pruned the leaked extra


def test_get_websocket_url_registers_when_no_device_exists() -> None:
    session = _FakeSession(
        devices=[],
        new_device={"url": "https://wdm/devices/fresh", "webSocketUrl": "wss://mercury/fresh"},
    )

    url = asyncio.run(_runtime()._get_websocket_url(session))

    assert url == "wss://mercury/fresh"
    assert session.posted == 1
    assert session.deleted == []


def test_handle_websocket_message_dedupes_redelivered_activity() -> None:
    runtime = _runtime()
    calls: list[dict[str, Any]] = []

    class _Result:
        allowed = False
        dispatched = False
        ignored = True
        reason_code = None

    async def _handle_payload(event: dict[str, Any]) -> _Result:
        calls.append(event)
        return _Result()

    async def _reply(_event: dict[str, Any], _result: _Result) -> None:
        return None

    runtime._runtime.handle_payload = _handle_payload  # type: ignore[assignment]
    runtime._responder.reply_to_result = _reply  # type: ignore[assignment]
    runtime._bot_person_id = "bot-person-id"

    activity = {
        "data": {
            "activity": {
                "verb": "post",
                "object": {"id": "raw-message-id"},
                "target": {"id": RAW_ROOM_ID},
                "actor": {"emailAddress": "user@example.com"},
            }
        }
    }
    frame = json.dumps(activity)
    session = _FakeSession(message_detail={"id": "message-public-id", "roomId": PUBLIC_ROOM_ID, "text": "hi"})

    asyncio.run(runtime._handle_websocket_message(session, frame))
    asyncio.run(runtime._handle_websocket_message(session, frame))

    # The same Webex message id is processed exactly once despite redelivery.
    assert len(calls) == 1


def test_should_refresh_wdm_device_on_handshake_for_stale_or_throttled_codes() -> None:
    assert should_refresh_wdm_device_on_handshake(404) is True
    assert should_refresh_wdm_device_on_handshake(429) is True
    assert should_refresh_wdm_device_on_handshake(401) is True
    assert should_refresh_wdm_device_on_handshake(500) is False
    assert should_refresh_wdm_device_on_handshake(None) is False


def test_websocket_connect_header_kwargs_prefers_additional_headers() -> None:
    headers = {"Authorization": "Bearer test-token"}
    kwargs = websocket_connect_header_kwargs(headers)

    assert "additional_headers" in kwargs or "extra_headers" in kwargs
    assert kwargs.get("additional_headers") == headers or kwargs.get("extra_headers") == headers


def test_websocket_handshake_status_reads_invalid_status_response() -> None:
    try:
        from websockets.exceptions import InvalidStatus
    except ImportError:
        from websockets import InvalidStatus  # type: ignore[attr-defined]

    class _Response:
        status_code = 429

    assert websocket_handshake_status(InvalidStatus(_Response())) == 429
    assert websocket_handshake_status(RuntimeError("boom")) is None


def test_refresh_wdm_device_deletes_cached_and_extra_devices() -> None:
    runtime = _runtime()
    runtime._device_url = "https://wdm/devices/tracked"
    session = _FakeSession(
        devices=[
            {
                "name": "CAIPE-Webex-Bot",
                "url": "https://wdm/devices/extra",
                "webSocketUrl": "wss://mercury/extra",
            }
        ]
    )

    asyncio.run(runtime._refresh_wdm_device(session))

    assert runtime._device_url is None
    assert session.deleted == ["https://wdm/devices/tracked", "https://wdm/devices/extra"]


def test_handle_connection_failure_refreshes_device_on_invalid_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    try:
        from websockets.exceptions import InvalidStatus
    except ImportError:
        from websockets import InvalidStatus  # type: ignore[attr-defined]

    class _Response:
        status_code = 404

    async def _instant_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", _instant_sleep)

    runtime = _runtime()
    runtime._device_url = "https://wdm/devices/stale"
    session = _FakeSession(
        devices=[
            {
                "name": "CAIPE-Webex-Bot",
                "url": "https://wdm/devices/stale",
                "webSocketUrl": "wss://mercury/stale",
            }
        ],
        new_device={"url": "https://wdm/devices/fresh", "webSocketUrl": "wss://mercury/fresh"},
    )

    async def _run() -> int:
        return await runtime._handle_connection_failure(session, InvalidStatus(_Response()), 1)

    retry_delay = asyncio.run(_run())

    assert session.deleted == ["https://wdm/devices/stale"]
    assert runtime._handshake_refresh_attempts == 1
    assert retry_delay == 2


def test_handle_connection_failure_stops_refreshing_after_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    try:
        from websockets.exceptions import InvalidStatus
    except ImportError:
        from websockets import InvalidStatus  # type: ignore[attr-defined]

    class _Response:
        status_code = 429

    async def _instant_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", _instant_sleep)

    runtime = _runtime()
    runtime._handshake_refresh_attempts = MAX_WDM_HANDSHAKE_REFRESH_ATTEMPTS
    runtime._device_url = "https://wdm/devices/stale"
    session = _FakeSession(
        devices=[
            {
                "name": "CAIPE-Webex-Bot",
                "url": "https://wdm/devices/stale",
                "webSocketUrl": "wss://mercury/stale",
            }
        ]
    )

    async def _run() -> None:
        await runtime._handle_connection_failure(session, InvalidStatus(_Response()), 4)

    asyncio.run(_run())

    assert session.deleted == []
    assert runtime._handshake_refresh_attempts == MAX_WDM_HANDSHAKE_REFRESH_ATTEMPTS
