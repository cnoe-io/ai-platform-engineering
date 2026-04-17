# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for Slack bot narrative streaming and echo-suppression-related parsing.

Focuses on ``parse_event``, RAG tool identification (must match ``ai.stream_a2a_response``),
and ``_get_final_text`` — not the full async SSE / WebClient loop.
"""

from __future__ import annotations

import os
import unittest

# ``utils.ai`` pulls in Slack bot config at import time; provide minimal YAML for unit tests.
os.environ.setdefault(
    "SLACK_INTEGRATION_BOT_CONFIG",
    "C00000000:\n  name: unit-test\n",
)

from ai_platform_engineering.integrations.slack_bot.utils.ai import _get_final_text
from ai_platform_engineering.integrations.slack_bot.utils.event_parser import EventType, parse_event


def _artifact_update_event(
    artifact_name: str,
    *,
    text: str | None = "chunk",
    append: bool | None = True,
    metadata: dict | None = None,
) -> dict:
    """Build a minimal A2A ``artifact-update`` payload like the SSE client yields."""
    parts: list[dict] = []
    if text is not None:
        parts.append({"kind": "text", "text": text})
    artifact: dict = {"name": artifact_name, "parts": parts}
    if metadata is not None:
        artifact["metadata"] = metadata
    return {"kind": "artifact-update", "artifact": artifact, "append": append}


class TestEventTypeParsing(unittest.TestCase):
    """``parse_event`` classification for streaming / tool artifact names."""

    def test_streaming_result_event_parsed(self) -> None:
        event = _artifact_update_event("streaming_result", text="narration")
        parsed = parse_event(event)
        self.assertEqual(parsed.event_type, EventType.STREAMING_RESULT)
        self.assertEqual(parsed.text_content, "narration")

    def test_final_result_event_parsed(self) -> None:
        event = _artifact_update_event("final_result", text="Done.")
        parsed = parse_event(event)
        self.assertEqual(parsed.event_type, EventType.FINAL_RESULT)
        self.assertEqual(parsed.text_content, "Done.")
        self.assertFalse(parsed.should_append)
        self.assertTrue(parsed.is_final)

    def test_tool_notification_start_parsed(self) -> None:
        event = _artifact_update_event(
            "tool_notification_start",
            text=None,
            metadata={"tool_name": "github"},
        )
        parsed = parse_event(event)
        self.assertEqual(parsed.event_type, EventType.TOOL_NOTIFICATION_START)
        self.assertIsNotNone(parsed.tool_notification)

    def test_tool_notification_end_parsed(self) -> None:
        event = _artifact_update_event(
            "tool_notification_end",
            text=None,
            metadata={"tool_name": "github"},
        )
        parsed = parse_event(event)
        self.assertEqual(parsed.event_type, EventType.TOOL_NOTIFICATION_END)
        self.assertIsNotNone(parsed.tool_notification)


class TestGetFinalText(unittest.TestCase):
    """Priority order for final Slack text (FINAL_RESULT > PARTIAL_RESULT > MESSAGE > artifacts)."""

    def test_final_result_text_preferred(self) -> None:
        out = _get_final_text("Answer", None, None, [], "ts1")
        self.assertEqual(out, "Answer")

    def test_partial_result_fallback(self) -> None:
        out = _get_final_text(None, "Partial", None, [], "ts1")
        self.assertEqual(out, "Partial")

    def test_message_fallback(self) -> None:
        out = _get_final_text(None, None, "Message", [], "ts1")
        self.assertEqual(out, "Message")

    def test_empty_returns_none(self) -> None:
        # No extractable user content: implementation uses the default placeholder string.
        out = _get_final_text(None, None, None, [], "ts1")
        self.assertEqual(out, "I've completed your request.")


if __name__ == "__main__":
    unittest.main()
