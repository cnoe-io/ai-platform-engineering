"""
Webex WebSocket Client

Connects to Webex via WDM (Web Device Management) device registration
and WebSocket for real-time event reception. Based on the jarvis-agent
webexwebsocket.py pattern with improvements:
- Exponential backoff on reconnect
- Lifecycle callbacks (on_connect, on_disconnect)
- In-memory device cache (no pickle)
- Structured logging with loguru
- Exception handling per message
"""

import asyncio
import base64
import json
import random
import string
from typing import Any, Callable, Dict, Optional

import requests
import websockets
from loguru import logger
from websockets.exceptions import ConnectionClosed

DEVICES_URL = "https://wdm-a.wbx2.com/wdm/api/v1/devices"
DEFAULT_DEVICE_DATA = {
    "deviceName": "caipe-webex-client",
    "deviceType": "DESKTOP",
    "localizedModel": "python",
    "model": "python",
    "name": None,  # Generated at runtime with random suffix
    "systemName": "caipe-webex-bot",
    "systemVersion": "1.0",
}
MAX_RECONNECT_DELAY = 60
INITIAL_RECONNECT_DELAY = 5


class WebexWebSocketClient:
    """WebSocket client for receiving Webex events via WDM."""

    def __init__(
        self,
        access_token: str,
        on_message: Optional[Callable] = None,
        on_card: Optional[Callable] = None,
        on_connect: Optional[Callable] = None,
        on_disconnect: Optional[Callable] = None,
    ):
        self.access_token = access_token
        self.on_message = on_message
        self.on_card = on_card
        self.on_connect = on_connect
        self.on_disconnect = on_disconnect
        self._device_info: Optional[Dict[str, Any]] = None
        self._webex_api = None
        self._my_emails: set = set()

    def run(self) -> None:
        """Start the WebSocket client (blocking)."""
        asyncio.run(self._run_forever())

    async def _run_forever(self) -> None:
        """Reconnect loop with exponential backoff."""
        from webexteamssdk import WebexTeamsAPI

        self._webex_api = WebexTeamsAPI(access_token=self.access_token)
        me = self._webex_api.people.me()
        self._my_emails = (
            set(me.emails) if hasattr(me, "emails") else {me.email if hasattr(me, "email") else ""}
        )

        delay = INITIAL_RECONNECT_DELAY
        while True:
            try:
                await self._connect_and_listen()
                delay = INITIAL_RECONNECT_DELAY  # Reset on clean disconnect
            except ConnectionClosed as e:
                logger.warning(f"WebSocket connection closed: {e}")
                if self.on_disconnect:
                    self.on_disconnect()
            except TimeoutError:
                logger.warning("WebSocket connection timed out")
                if self.on_disconnect:
                    self.on_disconnect()
            except Exception as e:
                logger.error(f"WebSocket error: {e}")
                if self.on_disconnect:
                    self.on_disconnect()

            logger.info(f"Reconnecting in {delay}s...")
            await asyncio.sleep(delay)
            delay = min(delay * 2, MAX_RECONNECT_DELAY)

    async def _connect_and_listen(self) -> None:
        """Connect to WebSocket and listen for events."""
        device_info = self._get_device_info()
        ws_url = device_info.get("webSocketUrl")
        if not ws_url:
            raise RuntimeError("No webSocketUrl in device info")

        logger.info(f"Connecting to WebSocket: {ws_url[:50]}...")

        async with websockets.connect(ws_url) as ws:
            # Send auth message
            auth_msg = json.dumps(
                {
                    "type": "authorization",
                    "data": {"token": f"Bearer {self.access_token}"},
                }
            )
            await ws.send(auth_msg)
            logger.info("WebSocket authenticated, listening for events...")

            if self.on_connect:
                self.on_connect()

            async for raw_msg in ws:
                try:
                    msg = json.loads(raw_msg)
                    self._process_message(msg)
                except json.JSONDecodeError:
                    logger.warning("Failed to parse WebSocket message")
                except Exception as e:
                    logger.error(f"Error processing WebSocket message: {e}")

    def _process_message(self, msg: dict) -> None:
        """Route incoming WebSocket events."""
        data = msg.get("data", {})
        event_type = data.get("eventType", "")

        if event_type != "conversation.activity":
            return

        activity = data.get("activity", {})
        verb = activity.get("verb", "")

        if verb in ("post", "update"):
            message_id = self._get_base64_message_id(activity)
            if not message_id:
                return
            try:
                webex_msg = self._webex_api.messages.get(message_id)
            except Exception as e:
                logger.error(f"Failed to fetch message {message_id}: {e}")
                return
            if webex_msg.personEmail in self._my_emails:
                logger.debug("Skipping self-message")
                return
            if self.on_message:
                self.on_message(webex_msg)

        elif verb == "cardAction":
            action_id = self._get_base64_message_id(activity)
            if not action_id:
                return
            try:
                action = self._webex_api.attachment_actions.get(action_id)
            except Exception as e:
                logger.error(f"Failed to fetch card action {action_id}: {e}")
                return
            if self.on_card:
                self.on_card(action)

    def _get_base64_message_id(self, activity: dict) -> Optional[str]:
        """Extract base64-encoded message ID for geo-routed API calls."""
        activity_id = activity.get("id", "")
        if not activity_id:
            return None
        verb = activity.get("verb", "")
        target = activity.get("target", {})
        target_url = target.get("url", "")

        # Determine data center from target URL for geo-routing
        cluster = "us"
        if target_url:
            parts = target_url.split("/")
            for i, part in enumerate(parts):
                if part == "conversations" and i > 0:
                    host_part = parts[i - 1] if i > 0 else ""
                    if "." in host_part:
                        cluster = host_part.split(".")[0]
                        break

        if verb == "cardAction":
            uri = f"ciscospark://{cluster}/ATTACHMENT_ACTION/{activity_id}"
        else:
            uri = f"ciscospark://{cluster}/MESSAGE/{activity_id}"

        return base64.b64encode(uri.encode()).decode()

    def _get_device_info(self) -> dict:
        """Get or create WDM device registration (in-memory cache)."""
        if self._device_info:
            return self._device_info

        headers = {"Authorization": f"Bearer {self.access_token}"}

        # Try to find existing device
        try:
            resp = requests.get(DEVICES_URL, headers=headers, timeout=10)
            if resp.ok:
                devices = resp.json().get("devices", [])
                for device in devices:
                    if device.get("systemName") == "caipe-webex-bot":
                        self._device_info = device
                        logger.info(f"Found existing WDM device: {device.get('name')}")
                        return device
        except requests.RequestException as e:
            logger.warning(f"Failed to list WDM devices: {e}")

        # Create new device
        device_data = dict(DEFAULT_DEVICE_DATA)
        suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
        device_data["name"] = f"caipe-webex-client-{suffix}"

        try:
            resp = requests.post(
                DEVICES_URL,
                json=device_data,
                headers={**headers, "Content-Type": "application/json"},
                timeout=10,
            )
            resp.raise_for_status()
            self._device_info = resp.json()
            logger.info(f"Created new WDM device: {device_data['name']}")
            return self._device_info
        except requests.RequestException as e:
            raise RuntimeError(f"Failed to register WDM device: {e}")
