# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for threaded Webex replies and Dynamic Agent streaming dispatch."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pytest

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
    messages_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    thread_messages: list[dict[str, Any]] = field(default_factory=list)
    get_calls: list[str] = field(default_factory=list)
    list_calls: list[dict[str, Any]] = field(default_factory=list)

    def create_message(
        self,
        *,
        markdown: str,
        room_id: str | None = None,
        parent_id: str | None = None,
        person_id: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> str:
        record: dict[str, Any] = {"markdown": markdown}
        if room_id is not None:
            record["room_id"] = room_id
        if parent_id is not None:
            record["parent_id"] = parent_id
        if person_id is not None:
            record["person_id"] = person_id
        if attachments is not None:
            record["attachments"] = attachments
        self.created.append(record)
        return f"created-{len(self.created)}"

    def update_message(self, *, message_id: str, room_id: str, markdown: str) -> None:
        self.updated.append({"message_id": message_id, "room_id": room_id, "markdown": markdown})

    def get_message(self, *, message_id: str) -> dict[str, Any] | None:
        self.get_calls.append(message_id)
        return self.messages_by_id.get(message_id)

    def list_messages(
        self,
        *,
        room_id: str,
        parent_id: str | None = None,
        before_message_id: str | None = None,
        max_messages: int = 10,
    ) -> list[dict[str, Any]]:
        self.list_calls.append(
            {
                "room_id": room_id,
                "parent_id": parent_id,
                "before_message_id": before_message_id,
                "max_messages": max_messages,
            }
        )
        return self.thread_messages[:max_messages]


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


class FailingThreadContextWebexApi(FakeWebexApi):
    def get_message(self, *, message_id: str) -> dict[str, Any] | None:
        raise RuntimeError("webex unavailable")


def test_unlinked_user_gets_private_card_and_generic_thread_notice(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_NAME", "Grid")
    api = FakeWebexApi()
    responder = WebexResponder(webex_api=api)
    event = {
        "data": {
            "id": "message-public-id",
            "webexRoomId": "room-public-id",
            "personId": "person-public-id",
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

    assert len(api.created) == 2
    direct_message = api.created[0]
    assert direct_message["person_id"] == "person-public-id"
    assert direct_message["markdown"] == "Link your Grid account to Webex to continue."
    card = direct_message["attachments"][0]["content"]
    assert card["type"] == "AdaptiveCard"
    assert card["actions"][0] == {
        "type": "Action.OpenUrl",
        "title": "Link with SSO",
        "url": "http://localhost:3000/api/auth/webex-link?x=1",
    }

    group_notice = api.created[1]
    assert group_notice == {
        "room_id": "room-public-id",
        "parent_id": "message-public-id",
        "markdown": (
            "I sent you a 1:1 Webex message to link your Grid account. "
            "Complete linking there, then retry your request."
        ),
    }
    assert "webex-link" not in group_notice["markdown"]


def test_unlinked_user_does_not_get_duplicate_linking_cards_within_cooldown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ai_platform_engineering.integrations.webex_bot import webex_responder as responder_module

    monkeypatch.setenv("APP_NAME", "Grid")
    responder_module._recent_linking_cards_sent.clear()
    api = FakeWebexApi()
    responder = WebexResponder(webex_api=api)
    event = {
        "data": {
            "id": "message-public-id",
            "webexRoomId": "room-public-id",
            "personId": "person-public-id",
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
    asyncio.run(responder.reply_to_result(event, result))

    direct_messages = [msg for msg in api.created if msg.get("person_id")]
    thread_messages = [msg for msg in api.created if msg.get("room_id")]
    assert len(direct_messages) == 1
    assert len(thread_messages) == 2
    assert "card I sent earlier" in thread_messages[1]["markdown"]


def test_unlinked_user_dm_failure_does_not_post_signed_link_publicly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ai_platform_engineering.integrations.webex_bot import webex_responder as responder_module

    monkeypatch.setenv("APP_NAME", "Grid")
    responder_module._recent_linking_cards_sent.clear()

    class FailingDirectMessageApi(FakeWebexApi):
        def create_message(self, **kwargs: Any) -> str:
            if kwargs.get("person_id"):
                raise RuntimeError("dm failed")
            return super().create_message(**kwargs)

    api = FailingDirectMessageApi()
    responder = WebexResponder(webex_api=api)
    event = {
        "data": {
            "id": "message-public-id",
            "webexRoomId": "room-public-id",
            "personId": "person-public-id",
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
                "I could not send you a 1:1 Webex linking message. Open Grid and "
                "try account linking, then retry your request."
            ),
        }
    ]
    assert "webex-link" not in api.created[0]["markdown"]


def test_reason_code_fallback_is_user_friendly() -> None:
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
        reason_code="WEBEX_OBO_FAILED",
    )

    asyncio.run(responder.reply_to_result(event, result))

    assert api.created == [
        {
            "room_id": "room-public-id",
            "parent_id": "message-public-id",
            "markdown": (
                "I couldn't start your CAIPE session for this Webex space. "
                "Ask an admin to refresh this space's team setup in CAIPE."
            ),
        }
    ]
    assert "WEBEX_OBO_FAILED" not in api.created[0]["markdown"]


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
            "markdown": (
                "**Agent:** `incident-agent`\n\n"
                "Working on it...\n\n"
                "_Reply in this Webex thread to continue with this agent. If the route only "
                "listens to mentions, mention the bot in your reply._"
            ),
        }
    ]
    assert api.updated[-1] == {
        "message_id": "created-1",
        "room_id": "room-public-id",
        "markdown": (
            "**Agent:** `incident-agent`\n\n"
            "hello world\n\n"
            "_Reply in this Webex thread to continue with this agent. If the route only "
            "listens to mentions, mention the bot in your reply._"
        ),
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
        # Phase 1 channel-derived team binding (spec FR-016/FR-017):
        "channel_id": "6f91b070-531a-11f1-926d-6fd3c20dfdc4",
        "surface_kind": "channel",
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
        "markdown": (
            "**Agent:** `incident-agent`\n\n"
            "Working on it...\n\n"
            "_Reply in this Webex thread to continue with this agent. If the route only "
            "listens to mentions, mention the bot in your reply._"
        ),
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
        # Phase 1 channel-derived team binding (spec FR-016/FR-017):
        "channel_id": "6f91b070-531a-11f1-926d-6fd3c20dfdc4",
        "surface_kind": "channel",
        "thread_ts": "root-message-public-id",
    }


def test_threaded_stream_dispatcher_includes_bounded_thread_context_in_agent_prompt() -> None:
    api = FakeWebexApi(
        messages_by_id={
            "root-message-public-id": {
                "id": "root-message-public-id",
                "text": "original incident details",
                "personEmail": "alice@example.com",
            }
        },
        thread_messages=[
            {
                "id": "newer-reply-public-id",
                "parentId": "root-message-public-id",
                "text": "second follow-up",
                "personEmail": "carol@example.com",
            },
            {
                "id": "older-reply-public-id",
                "parentId": "root-message-public-id",
                "text": "first follow-up",
                "personEmail": "bob@example.com",
            },
            {
                "id": "bot-reply-public-id",
                "parentId": "root-message-public-id",
                "markdown": (
                    "**Agent:** `incident-agent`\n\n"
                    "prior bot answer\n\n"
                    "_Reply in this Webex thread to continue with this agent._"
                ),
                "personEmail": "bot@example.com",
            },
        ],
    )
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
                "message_id": "current-reply-public-id",
                "thread_parent_id": "root-message-public-id",
                "text": "what changed?",
                "agent_id": "incident-agent",
                "obo_token": "obo-access-token",
            }
        )
    )

    assert api.get_calls == ["root-message-public-id"]
    assert api.list_calls == [
        {
            "room_id": "room-public-id",
            "parent_id": "root-message-public-id",
            "before_message_id": "current-reply-public-id",
            "max_messages": 9,
        }
    ]
    assert sse.calls[0]["message"] == (
        "Webex thread context (oldest to newest, excluding the current request):\n"
        "- alice@example.com: original incident details\n"
        "- bob@example.com: first follow-up\n"
        "- carol@example.com: second follow-up\n\n"
        "Current Webex request:\n"
        "what changed?"
    )
    assert "prior bot answer" not in sse.calls[0]["message"]


def test_thread_context_can_be_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEBEX_THREAD_CONTEXT_ENABLED", "false")
    api = FakeWebexApi(
        messages_by_id={
            "root-message-public-id": {
                "id": "root-message-public-id",
                "text": "original incident details",
            }
        }
    )
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
                "message_id": "current-reply-public-id",
                "thread_parent_id": "root-message-public-id",
                "text": "use only this message",
                "agent_id": "incident-agent",
                "obo_token": "obo-access-token",
            }
        )
    )

    assert api.get_calls == []
    assert api.list_calls == []
    assert sse.calls[0]["message"] == "use only this message"


def test_thread_context_fetch_failure_falls_back_to_current_message() -> None:
    api = FailingThreadContextWebexApi()
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
                "message_id": "current-reply-public-id",
                "thread_parent_id": "root-message-public-id",
                "text": "continue without history",
                "agent_id": "incident-agent",
                "obo_token": "obo-access-token",
            }
        )
    )

    assert sse.calls[0]["message"] == "continue without history"
