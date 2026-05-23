# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for Webex WDM websocket event normalization."""

from __future__ import annotations

from ai_platform_engineering.integrations.webex_bot.webex_wdm import (
    webex_event_from_wdm_activity,
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
