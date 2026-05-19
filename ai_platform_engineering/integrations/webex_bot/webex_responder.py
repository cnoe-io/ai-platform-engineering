# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Threaded Webex responses for denials and Dynamic Agent streaming."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Protocol

import httpx

from .a2a_client import SSEEventType, WebexSSEClient, space_message_to_conversation_id
from .app import WebexMessageResult

logger = logging.getLogger("caipe.webex_bot.webex_responder")

WEBEX_API_BASE_URL = "https://webexapis.com/v1"


class WebexApiProtocol(Protocol):
    def create_message(self, *, room_id: str, markdown: str, parent_id: str | None = None) -> str: ...

    def update_message(self, *, message_id: str, room_id: str, markdown: str) -> None: ...


class WebexRestApi:
    """Minimal Webex messages API client."""

    def __init__(
        self,
        *,
        access_token: str | None = None,
        base_url: str = WEBEX_API_BASE_URL,
        http_client: httpx.Client | None = None,
    ) -> None:
        token = access_token or os.environ.get("WEBEX_INTEGRATION_BOT_ACCESS_TOKEN", "")
        if not token.strip():
            raise ValueError("WEBEX_INTEGRATION_BOT_ACCESS_TOKEN is required for Webex replies")
        self._token = token.strip()
        self._base_url = base_url.rstrip("/")
        self._http_client = http_client

    def create_message(self, *, room_id: str, markdown: str, parent_id: str | None = None) -> str:
        payload: dict[str, str] = {"roomId": room_id, "markdown": markdown}
        if parent_id:
            payload["parentId"] = parent_id
        data = self._request("POST", "/messages", json=payload)
        message_id = data.get("id")
        return str(message_id) if message_id else ""

    def update_message(self, *, message_id: str, room_id: str, markdown: str) -> None:
        self._request("PUT", f"/messages/{message_id}", json={"roomId": room_id, "markdown": markdown})

    def _request(self, method: str, path: str, *, json: dict[str, str]) -> dict[str, Any]:
        client = self._http_client
        owns_client = client is None
        if owns_client:
            client = httpx.Client(timeout=30)
        assert client is not None
        try:
            response = client.request(
                method,
                f"{self._base_url}{path}",
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": "caipe-webex-bot/0.5.0",
                },
                json=json,
            )
            response.raise_for_status()
            if not response.content:
                return {}
            return response.json()
        finally:
            if owns_client:
                client.close()


class WebexResponder:
    """Reply to the original Webex message thread."""

    def __init__(self, *, webex_api: WebexApiProtocol | None = None) -> None:
        self._webex_api = webex_api or WebexRestApi()

    async def reply_to_result(self, event: dict[str, Any], result: WebexMessageResult) -> None:
        """Send a threaded denial/error reply for non-ignored non-dispatched results."""

        if result.ignored or result.dispatched:
            return
        room_id, parent_id = _thread_refs(event)
        if not room_id or not parent_id:
            logger.warning("Cannot send Webex reply without room_id and parent_id")
            return
        markdown = _markdown_for_result(result)
        if not markdown:
            return
        await asyncio.to_thread(
            self._webex_api.create_message,
            room_id=room_id,
            parent_id=parent_id,
            markdown=markdown,
        )


class WebexThreadedStreamDispatcher:
    """Dispatch allowed messages to Dynamic Agents and stream results into a Webex thread."""

    def __init__(
        self,
        *,
        webex_api: WebexApiProtocol | None = None,
        sse_client: WebexSSEClient | None = None,
        update_every_chars: int = 240,
    ) -> None:
        self._webex_api = webex_api or WebexRestApi()
        self._sse_client = sse_client or WebexSSEClient(
            os.environ.get("CAIPE_API_URL", "http://caipe-ui:3000")
        )
        self._update_every_chars = max(1, update_every_chars)

    async def __call__(self, payload: dict[str, Any]) -> None:
        await asyncio.to_thread(self._dispatch_sync, payload)

    def _dispatch_sync(self, payload: dict[str, Any]) -> None:
        room_id = str(payload.get("webex_room_id") or "")
        message_id = str(payload.get("message_id") or "")
        thread_parent_id = str(payload.get("thread_parent_id") or "")
        parent_id = thread_parent_id or message_id
        space_id = str(payload.get("space_id") or "")
        agent_id = str(payload.get("agent_id") or "")
        text = str(payload.get("text") or "")
        obo_token = str(payload.get("obo_token") or "")
        if not all((room_id, message_id, parent_id, space_id, agent_id, text, obo_token)):
            raise ValueError("Webex threaded stream dispatch payload is missing required fields")

        reply_id = self._webex_api.create_message(
            room_id=room_id,
            parent_id=parent_id,
            markdown="Working on it...",
        )
        accumulated = ""
        last_sent_len = 0

        try:
            conversation = self._sse_client.create_conversation(
                title=text[:50].strip() or "Webex Thread",
                agent_id=agent_id,
                idempotency_key=f"webex:{space_id}:{parent_id}",
                metadata={
                    "surface": "webex",
                    "webex_space_id": space_id,
                    "webex_message_id": parent_id,
                    "webex_room_id": room_id,
                },
                bearer_token=obo_token,
            )
            conversation_id = str(
                conversation.get("conversation_id")
                or space_message_to_conversation_id(space_id, parent_id)
            )
            for event in self._sse_client.stream_chat(
                message=text,
                conversation_id=conversation_id,
                agent_id=agent_id,
                bearer_token=obo_token,
                client_context={
                    "source": "webex",
                    "surface": "webex",
                    "webex_space_id": space_id,
                    "webex_message_id": message_id,
                    **({"webex_thread_parent_id": parent_id} if thread_parent_id else {}),
                },
            ):
                if event.type == SSEEventType.TEXT_MESSAGE_CONTENT and event.delta:
                    accumulated += event.delta
                    if len(accumulated) - last_sent_len >= self._update_every_chars:
                        self._webex_api.update_message(
                            message_id=reply_id,
                            room_id=room_id,
                            markdown=accumulated,
                        )
                        last_sent_len = len(accumulated)
                elif event.type == SSEEventType.RUN_ERROR:
                    message = event.message or "The agent run failed."
                    self._webex_api.update_message(
                        message_id=reply_id,
                        room_id=room_id,
                        markdown=message,
                    )
                    return
        except Exception as exc:
            logger.warning("Webex threaded stream dispatch failed (type=%s)", type(exc).__name__)
            self._webex_api.update_message(
                message_id=reply_id,
                room_id=room_id,
                markdown="I could not complete the request. Please try again.",
            )
            return

        final_markdown = accumulated.strip() or "Done."
        self._webex_api.update_message(
            message_id=reply_id,
            room_id=room_id,
            markdown=final_markdown,
        )


def _thread_refs(event: dict[str, Any]) -> tuple[str | None, str | None]:
    data = event.get("data") if isinstance(event.get("data"), dict) else event
    room_id = data.get("webexRoomId") or data.get("publicRoomId")
    parent_id = data.get("id") or data.get("messageId")
    return (
        str(room_id).strip() if isinstance(room_id, str) and room_id.strip() else None,
        str(parent_id).strip() if isinstance(parent_id, str) and parent_id.strip() else None,
    )


def _markdown_for_result(result: WebexMessageResult) -> str | None:
    parts: list[str] = []
    if result.deny_message:
        parts.append(result.deny_message)
    elif result.reason_code:
        parts.append(f"Request denied: `{result.reason_code}`")
    if result.linking_url:
        parts.append(f"Link your account: {result.linking_url}")
    return "\n\n".join(parts) if parts else None
