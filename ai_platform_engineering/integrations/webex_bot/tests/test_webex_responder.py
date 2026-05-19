# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for threaded Webex replies and Dynamic Agent streaming dispatch."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from ai_platform_engineering.integrations.webex_bot.app import WebexMessageResult
from ai_platform_engineering.integrations.webex_bot.a2a_client import SSEEvent, SSEEventType
from ai_platform_engineering.integrations.webex_bot.webex_responder import (
    WebexResponder,
    WebexThreadedStreamDispatcher,
)


@dataclass
class FakeWebexApi:
    created: list[dict[str, Any]] = field(default_factory=list)
    updated: list[dict[str, Any]] = field(default_factory=list)

    def create_message(self, *, room_id: str, markdown: str, parent_id: str | None = None) -> str:
        self.created.append({"room_id": room_id, "markdown": markdown, "parent_id": parent_id})
        return f"created-{len(self.created)}"

    def update_message(self, *, message_id: str, room_id: str, markdown: str) -> None:
        self.updated.append({"message_id": message_id, "room_id": room_id, "markdown": markdown})


@dataclass
class FakeSseClient:
    events: list[SSEEvent]
    calls: list[dict[str, Any]] = field(default_factory=list)
    conversations: list[dict[str, Any]] = field(default_factory=list)

    def create_conversation(self, **kwargs: Any) -> dict[str, Any]:
        self.conversations.append(kwargs)
        return {"conversation_id": "server-conversation-id", "created": True}

    def stream_chat(self, **kwargs: Any):
        self.calls.append(kwargs)
        yield from self.events


def test_denial_reply_is_sent_in_original_webex_thread() -> None:
    api = FakeWebexApi()
    responder = WebexResponder(webex_api=api)
    event = {
        "data": {
            "id": "message-public-id",
            "webexRoomId": "room-public-id",
        }
    }
    result = WebexMessageResult(
        allowed=False,
        dispatched=False,
        ignored=False,
        reason_code="WEBEX_USER_NOT_LINKED",
        deny_message="Your Webex account is not linked.",
        linking_url="http://localhost:3000/api/auth/webex-link?x=1",
    )

    asyncio.run(responder.reply_to_result(event, result))

    assert api.created == [
        {
            "room_id": "room-public-id",
            "parent_id": "message-public-id",
            "markdown": (
                "Your Webex account is not linked.\n\n"
                "Link your account: http://localhost:3000/api/auth/webex-link?x=1"
            ),
        }
    ]


def test_threaded_stream_dispatcher_updates_reply_from_sse_events() -> None:
    api = FakeWebexApi()
    sse = FakeSseClient(
        events=[
            SSEEvent(SSEEventType.TEXT_MESSAGE_CONTENT, delta="hello "),
            SSEEvent(SSEEventType.TEXT_MESSAGE_CONTENT, delta="world"),
            SSEEvent(SSEEventType.RUN_FINISHED),
        ]
    )
    dispatcher = WebexThreadedStreamDispatcher(
        webex_api=api,
        sse_client=sse,
        update_every_chars=1,
    )

    asyncio.run(
        dispatcher(
            {
                "space_id": "6f91b070-531a-11f1-926d-6fd3c20dfdc4",
                "webex_room_id": "room-public-id",
                "message_id": "message-public-id",
                "text": "neo-coder hello",
                "agent_id": "incident-agent",
                "obo_token": "obo-access-token",
            }
        )
    )

    assert api.created == [
        {
            "room_id": "room-public-id",
            "parent_id": "message-public-id",
            "markdown": "Working on it...",
        }
    ]
    assert api.updated[-1] == {
        "message_id": "created-1",
        "room_id": "room-public-id",
        "markdown": "hello world",
    }
    assert sse.conversations == [
        {
            "title": "neo-coder hello",
            "agent_id": "incident-agent",
            "idempotency_key": "webex:6f91b070-531a-11f1-926d-6fd3c20dfdc4:message-public-id",
            "metadata": {
                "surface": "webex",
                "webex_space_id": "6f91b070-531a-11f1-926d-6fd3c20dfdc4",
                "webex_message_id": "message-public-id",
                "webex_room_id": "room-public-id",
            },
            "bearer_token": "obo-access-token",
        }
    ]
    assert sse.calls[0]["conversation_id"] == "server-conversation-id"
    assert sse.calls[0]["agent_id"] == "incident-agent"
    assert sse.calls[0]["bearer_token"] == "obo-access-token"
    assert sse.calls[0]["client_context"] == {
        "source": "webex",
        "surface": "webex",
        "webex_space_id": "6f91b070-531a-11f1-926d-6fd3c20dfdc4",
        "webex_message_id": "message-public-id",
    }


def test_threaded_stream_dispatcher_reuses_root_parent_for_thread_replies() -> None:
    api = FakeWebexApi()
    sse = FakeSseClient(events=[SSEEvent(SSEEventType.RUN_FINISHED)])
    dispatcher = WebexThreadedStreamDispatcher(
        webex_api=api,
        sse_client=sse,
    )

    asyncio.run(
        dispatcher(
            {
                "space_id": "6f91b070-531a-11f1-926d-6fd3c20dfdc4",
                "webex_room_id": "room-public-id",
                "message_id": "reply-message-public-id",
                "thread_parent_id": "root-message-public-id",
                "text": "neo-coder show my jira profile",
                "agent_id": "incident-agent",
                "obo_token": "obo-access-token",
            }
        )
    )

    assert api.created[0] == {
        "room_id": "room-public-id",
        "parent_id": "root-message-public-id",
        "markdown": "Working on it...",
    }
    assert sse.conversations[0]["idempotency_key"] == (
        "webex:6f91b070-531a-11f1-926d-6fd3c20dfdc4:root-message-public-id"
    )
    assert sse.calls[0]["client_context"] == {
        "source": "webex",
        "surface": "webex",
        "webex_space_id": "6f91b070-531a-11f1-926d-6fd3c20dfdc4",
        "webex_message_id": "reply-message-public-id",
        "webex_thread_parent_id": "root-message-public-id",
    }
