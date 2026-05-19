# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Webex WDM/Mercury websocket transport for bot message ingestion."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import uuid
from typing import Any

from .utils.webex_ids import canonicalize_webex_space_id, public_webex_room_id_from_uuid
from .app import handle_webex_message
from .webex_responder import WebexResponder, WebexThreadedStreamDispatcher
from .webex_websocket import WebexWebSocketRuntime

logger = logging.getLogger("caipe.webex_bot.webex_wdm")

WEBEX_API_BASE_URL = "https://webexapis.com/v1"
WEBEX_WDM_DEVICES_URL = "https://wdm-a.wbx2.com/wdm/api/v1/devices"


def base64_encode_webex_id(raw_id: str | None, resource_type: str) -> str | None:
    """Encode a WDM raw resource id into Webex public API id format."""

    if not raw_id:
        return None
    if resource_type == "ROOM":
        return public_webex_room_id_from_uuid(raw_id)
    import base64

    payload = f"ciscospark://us/{resource_type}/{raw_id}".encode("utf-8")
    return base64.b64encode(payload).decode("ascii").rstrip("=")


def webex_event_from_wdm_activity(
    activity: dict[str, Any],
    *,
    message_detail: dict[str, Any],
    bot_person_id: str | None,
) -> dict[str, Any]:
    """Build the existing Webex gate payload from a WDM activity and message detail."""

    raw_message_id = _raw_message_id(activity)
    raw_room_id = _raw_room_id(activity)
    person_id = message_detail.get("personId")
    public_room_id = str(message_detail.get("roomId") or base64_encode_webex_id(raw_room_id, "ROOM"))
    canonical_space_id = canonicalize_webex_space_id(public_room_id or str(raw_room_id or ""))

    return {
        "event": "message",
        "data": {
            "id": message_detail.get("id") or base64_encode_webex_id(raw_message_id, "MESSAGE"),
            "parentId": message_detail.get("parentId"),
            "roomId": canonical_space_id,
            "webexRoomId": public_room_id,
            "personId": person_id,
            "personEmail": message_detail.get("personEmail"),
            "text": message_detail.get("text") or message_detail.get("markdown") or "",
            "mentionedPeople": message_detail.get("mentionedPeople") or [],
            "isSelf": bool(bot_person_id and person_id == bot_person_id),
        },
    }


class WebexWdmRuntime:
    """Maintain a Webex WDM websocket connection and dispatch message events."""

    def __init__(
        self,
        *,
        access_token: str,
        runtime: WebexWebSocketRuntime | None = None,
        responder: WebexResponder | None = None,
        device_name: str = "CAIPE-Webex-Bot",
    ) -> None:
        self._access_token = access_token
        dispatcher = WebexThreadedStreamDispatcher()
        self._runtime = runtime or WebexWebSocketRuntime(
            message_handler=lambda event, **kwargs: handle_webex_message(
                event,
                dispatcher=dispatcher,
                **kwargs,
            )
        )
        self._responder = responder or WebexResponder()
        self._device_name = device_name
        self._bot_email: str | None = None
        self._bot_person_id: str | None = None

    async def run_forever(self) -> None:
        """Connect to Webex WDM and reconnect with capped exponential backoff."""

        import aiohttp
        import websockets

        headers = {
            "Authorization": f"Bearer {self._access_token}",
            "Content-Type": "application/json",
        }
        retry_delay = 1
        async with aiohttp.ClientSession(headers=headers) as session:
            await self._load_bot_identity(session)
            while True:
                try:
                    websocket_url = await self._get_websocket_url(session)
                    if not websocket_url:
                        logger.error("Webex WDM did not return a websocket URL")
                        return
                    logger.info("Connecting to Webex WDM websocket")
                    async with websockets.connect(websocket_url, ping_interval=20) as websocket:
                        retry_delay = 1
                        await websocket.send(
                            json.dumps(
                                {
                                    "id": str(uuid.uuid4()),
                                    "type": "authorization",
                                    "data": {"token": f"Bearer {self._access_token}"},
                                }
                            )
                        )
                        logger.info("Webex WDM websocket listener is live")
                        async for message in websocket:
                            await self._handle_websocket_message(session, message)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 - reconnect on transport failures
                    logger.warning(
                        "Webex WDM websocket connection lost (type=%s); retrying in %ss",
                        type(exc).__name__,
                        retry_delay,
                    )
                    await asyncio.sleep(retry_delay)
                    retry_delay = min(retry_delay * 2, 60)

    async def _load_bot_identity(self, session: Any) -> None:
        async with session.get(f"{WEBEX_API_BASE_URL}/people/me") as response:
            if response.status != 200:
                logger.warning("Unable to load Webex bot identity status=%s", response.status)
                return
            payload = await response.json()
            self._bot_email = (payload.get("emails") or [None])[0]
            self._bot_person_id = payload.get("id")
            logger.info(
                "Loaded Webex bot identity display=%s id_present=%s",
                payload.get("displayName"),
                bool(self._bot_person_id),
            )

    async def _get_websocket_url(self, session: Any) -> str | None:
        device_data = {
            "name": self._device_name,
            "deviceName": self._device_name,
            "deviceType": "DESKTOP",
            "model": "caipe-webex-bot",
            "localizedModel": "caipe-webex-bot",
            "systemName": "linux",
            "systemVersion": "1.0.0",
        }
        async with session.post(WEBEX_WDM_DEVICES_URL, json=device_data) as response:
            if response.status in (200, 201):
                payload = await response.json()
                return payload.get("webSocketUrl")
            logger.warning("Webex WDM device registration returned status=%s", response.status)

        async with session.get(WEBEX_WDM_DEVICES_URL) as response:
            if response.status != 200:
                logger.warning("Webex WDM device listing returned status=%s", response.status)
                return None
            payload = await response.json()
            devices = payload.get("devices") or []
            if not devices:
                return None
            return devices[0].get("webSocketUrl")

    async def _handle_websocket_message(self, session: Any, message: str | bytes) -> None:
        try:
            payload = json.loads(message)
        except json.JSONDecodeError:
            logger.warning("Ignoring malformed Webex WDM websocket frame")
            return

        activity = payload.get("data", {}).get("activity", {})
        if activity.get("verb") != "post":
            return

        actor_email = activity.get("actor", {}).get("emailAddress")
        if actor_email and self._bot_email and actor_email == self._bot_email:
            return

        message_id = base64_encode_webex_id(_raw_message_id(activity), "MESSAGE")
        if not message_id:
            logger.warning("Ignoring Webex WDM activity without message id")
            return

        message_detail = await self._fetch_message_detail(session, message_id)
        if message_detail is None:
            return

        event = webex_event_from_wdm_activity(
            activity,
            message_detail=message_detail,
            bot_person_id=self._bot_person_id,
        )
        result = await self._runtime.handle_payload(event)
        await self._responder.reply_to_result(event, result)
        logger.info(
            "Webex WDM event processed allowed=%s dispatched=%s ignored=%s reason=%s",
            result.allowed,
            result.dispatched,
            result.ignored,
            result.reason_code,
        )

    async def _fetch_message_detail(self, session: Any, message_id: str) -> dict[str, Any] | None:
        async with session.get(f"{WEBEX_API_BASE_URL}/messages/{message_id}") as response:
            if response.status != 200:
                logger.warning("Unable to fetch Webex message detail status=%s", response.status)
                return None
            return await response.json()


def start_webex_wdm_listener(access_token: str | None = None) -> threading.Thread | None:
    """Start the Webex WDM listener in a daemon thread when a bot token is configured."""

    token = (access_token or os.environ.get("WEBEX_INTEGRATION_BOT_ACCESS_TOKEN") or "").strip()
    if not token:
        logger.info("WEBEX_INTEGRATION_BOT_ACCESS_TOKEN is not configured; WDM listener disabled")
        return None

    runtime = WebexWdmRuntime(access_token=token)
    thread = threading.Thread(target=lambda: asyncio.run(runtime.run_forever()), daemon=True)
    thread.start()
    return thread


def _raw_message_id(activity: dict[str, Any]) -> str | None:
    raw = activity.get("object", {}).get("id") or activity.get("id")
    return str(raw) if raw else None


def _raw_room_id(activity: dict[str, Any]) -> str | None:
    raw = activity.get("target", {}).get("id")
    return str(raw) if raw else None
