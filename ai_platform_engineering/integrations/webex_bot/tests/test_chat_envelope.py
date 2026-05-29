"""Tests for webex_bot.utils.chat_envelope.

Mirrors slack_bot/tests/test_chat_envelope.py. The Webex envelope maps
webex_space_id → channel_id and the (Webex-org-less) workspace_id stays
None for now (Webex has no analogous "workspace" concept in the chat
envelope). Spec FR-016/FR-017.
"""

import pytest

from ai_platform_engineering.integrations.webex_bot.utils.chat_envelope import (
    augment_webex_client_context,
)


class TestAugmentWebexClientContext:
    def test_adds_space_and_surface_for_space_message(self):
        base = {"source": "webex", "surface": "webex"}
        result = augment_webex_client_context(
            base,
            space_id="room123",
            thread_parent_id="msg-abc",
            surface_kind="channel",
        )
        assert result["channel_id"] == "room123"
        assert result["surface_kind"] == "channel"
        assert result["thread_ts"] == "msg-abc"

    def test_1to1_surface_kind(self):
        base = {"source": "webex"}
        result = augment_webex_client_context(
            base,
            space_id="room-1to1",
            thread_parent_id=None,
            surface_kind="dm",
        )
        assert result["surface_kind"] == "dm"
        assert result["channel_id"] == "room-1to1"
        assert "thread_ts" not in result

    def test_does_not_mutate_input(self):
        base = {"source": "webex"}
        augment_webex_client_context(
            base,
            space_id="r",
            thread_parent_id="t",
            surface_kind="channel",
        )
        assert "channel_id" not in base
        assert "surface_kind" not in base

    def test_no_op_when_space_id_missing(self):
        base = {"source": "webex"}
        result = augment_webex_client_context(
            base,
            space_id=None,
            thread_parent_id="t",
            surface_kind="channel",
        )
        assert "channel_id" not in result

    def test_rejects_invalid_surface_kind(self):
        base = {"source": "webex"}
        with pytest.raises(ValueError, match="surface_kind"):
            augment_webex_client_context(
                base,
                space_id="r",
                thread_parent_id=None,
                surface_kind="bad",  # type: ignore[arg-type]
            )
