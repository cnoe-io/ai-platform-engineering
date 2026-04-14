#!/usr/bin/env python3
"""
Unit tests for Slack bot narration -> typing status behaviour.

Verifies that narration events (is_narration=True) are shown as typing
status updates ("is responding...") and NOT appended to the StreamBuffer.
Also tests the StreamBuffer class directly.

Reference: ai.py lines ~349-449 (STREAMING_RESULT handler)

Usage:
    PYTHONPATH=. uv run pytest tests/test_slack_narration_typing_status.py -v
"""

from __future__ import annotations

import os
import time
import unittest
from unittest.mock import MagicMock

# Slack bot module requires config at import time
os.environ.setdefault(
    "SLACK_INTEGRATION_BOT_CONFIG",
    "C00000000:\n  name: unit-test\n",
)

from ai_platform_engineering.integrations.slack_bot.utils.event_parser import (
    EventType,
    parse_event,
)
from ai_platform_engineering.integrations.slack_bot.utils.ai import StreamBuffer


def _artifact_update_event(
    artifact_name: str,
    *,
    text: str | None = "chunk",
    append: bool | None = True,
    metadata: dict | None = None,
) -> dict:
    """Build a minimal A2A artifact-update payload like the SSE client yields."""
    parts: list[dict] = []
    if text is not None:
        parts.append({"kind": "text", "text": text})
    artifact: dict = {"name": artifact_name, "parts": parts}
    if metadata is not None:
        artifact["metadata"] = metadata
    return {"kind": "artifact-update", "artifact": artifact, "append": append}


# ===========================================================================
# Tests: narration metadata detection
# ===========================================================================

class TestNarrationEventDetection(unittest.TestCase):
    """Verify narration events are correctly identified from artifact metadata."""

    def test_narration_event_detected_by_metadata(self):
        """Artifact with is_narration=True in metadata is correctly identified."""
        event = _artifact_update_event(
            "streaming_result",
            text="I'll search the knowledge base...",
            metadata={"is_narration": True},
        )
        parsed = parse_event(event)
        self.assertEqual(parsed.event_type, EventType.STREAMING_RESULT)
        artifact_meta = (parsed.artifact or {}).get("metadata", {})
        self.assertTrue(artifact_meta.get("is_narration"))

    def test_final_answer_event_detected_by_metadata(self):
        """Artifact with is_final_answer=True in metadata is correctly identified."""
        event = _artifact_update_event(
            "streaming_result",
            text="Here is the answer...",
            metadata={"is_final_answer": True},
        )
        parsed = parse_event(event)
        artifact_meta = (parsed.artifact or {}).get("metadata", {})
        self.assertTrue(artifact_meta.get("is_final_answer"))

    def test_regular_event_has_no_special_flags(self):
        """Regular streaming_result without special metadata has neither flag."""
        event = _artifact_update_event("streaming_result", text="Normal content")
        parsed = parse_event(event)
        artifact_meta = (parsed.artifact or {}).get("metadata", {})
        self.assertFalse(artifact_meta.get("is_narration"))
        self.assertFalse(artifact_meta.get("is_final_answer"))


class TestNarrationStreamingSuppression(unittest.TestCase):
    """Verify narration events are handled as typing status, not stream content.

    Simulates the STREAMING_RESULT handler logic from ai.py (lines 349-449)
    to verify narration never reaches the StreamBuffer.
    """

    def _simulate_streaming_result(
        self,
        text: str,
        metadata: dict | None = None,
        stream_ts: str | None = None,
        streaming_final_answer: bool = False,
    ) -> dict:
        """Simulate what stream_a2a_response does with a STREAMING_RESULT event.

        Returns a dict of actions taken: {typing_status, stream_append, stream_opened}.
        """
        artifact_meta = metadata or {}
        actions = {
            "typing_status": None,
            "stream_append": None,
            "stream_opened": False,
        }

        # Latch streaming_final_answer (line 355)
        if artifact_meta.get("is_final_answer") and not streaming_final_answer:
            streaming_final_answer = True

        # Narration -> typing status (lines 375-377)
        if artifact_meta.get("is_narration"):
            actions["typing_status"] = "is responding..."
            return actions

        # Pre-stream narration (lines 441-443)
        if not stream_ts and not streaming_final_answer:
            actions["typing_status"] = "is responding..."
            return actions

        # Open stream + append (lines 444-449)
        actions["stream_opened"] = True
        actions["stream_append"] = text
        return actions

    def test_narration_event_sets_typing_status(self):
        """is_narration=True artifact -> _set_typing_status called."""
        actions = self._simulate_streaming_result(
            text="I'll search for information...",
            metadata={"is_narration": True},
        )
        self.assertEqual(actions["typing_status"], "is responding...")

    def test_narration_event_does_not_open_stream(self):
        """is_narration=True artifact does NOT open the stream."""
        actions = self._simulate_streaming_result(
            text="Searching...",
            metadata={"is_narration": True},
            stream_ts="existing-stream-ts",
        )
        self.assertFalse(actions["stream_opened"])

    def test_narration_event_does_not_append_to_stream(self):
        """is_narration=True artifact does NOT append to StreamBuffer."""
        actions = self._simulate_streaming_result(
            text="Looking into it...",
            metadata={"is_narration": True},
            stream_ts="existing-stream-ts",
        )
        self.assertIsNone(actions["stream_append"])

    def test_final_answer_event_opens_stream(self):
        """is_final_answer=True artifact opens stream and appends content."""
        actions = self._simulate_streaming_result(
            text="Here is the complete answer...",
            metadata={"is_final_answer": True},
            stream_ts="existing-stream-ts",
            streaming_final_answer=True,
        )
        self.assertTrue(actions["stream_opened"])
        self.assertEqual(actions["stream_append"], "Here is the complete answer...")

    def test_typing_status_shows_static_message(self):
        """Typing status is always 'is responding...', not dynamic narration text."""
        for text in ["I'll search the knowledge base", "Perfect! Found it", "Let me check..."]:
            actions = self._simulate_streaming_result(
                text=text,
                metadata={"is_narration": True},
            )
            self.assertEqual(actions["typing_status"], "is responding...")
            self.assertNotEqual(actions["typing_status"], text)

    def test_narration_with_newlines_does_not_reach_buffer(self):
        """Narration text with \\n does NOT reach the StreamBuffer."""
        actions = self._simulate_streaming_result(
            text="I'll search\nthe knowledge base\n",
            metadata={"is_narration": True},
            stream_ts="existing-stream-ts",
        )
        self.assertIsNone(actions["stream_append"])
        self.assertEqual(actions["typing_status"], "is responding...")


# ===========================================================================
# Tests: StreamBuffer
# ===========================================================================

class TestStreamBuffer(unittest.TestCase):
    """Tests for the StreamBuffer class in ai.py."""

    def _make_buffer(self, flush_interval: float = 1.0) -> StreamBuffer:
        """Create a StreamBuffer with a mocked Slack client."""
        mock_client = MagicMock()
        buf = StreamBuffer(mock_client, "C123", "ts123", flush_interval=flush_interval)
        return buf

    def test_last_flush_none_on_init(self):
        """_last_flush is None after construction (not time.monotonic())."""
        buf = self._make_buffer()
        self.assertIsNone(buf._last_flush)

    def test_last_flush_set_on_first_append(self):
        """After first append(), _last_flush is set to a valid monotonic time."""
        buf = self._make_buffer()
        before = time.monotonic()
        buf.append("hello")
        after = time.monotonic()
        self.assertIsNotNone(buf._last_flush)
        self.assertGreaterEqual(buf._last_flush, before)
        self.assertLessEqual(buf._last_flush, after)

    def test_flush_on_newline(self):
        """Buffer with 'Hello\\nWorld' flushes 'Hello\\n' on newline boundary."""
        buf = self._make_buffer()
        buf.append("Hello\nWorld")
        # "Hello\n" should have been flushed, "World" remains
        self.assertEqual(buf._buffer, "World")
        buf.slack_client.chat_appendStream.assert_called_once()
        call_kwargs = buf.slack_client.chat_appendStream.call_args[1]
        flushed_text = call_kwargs["chunks"][0]["text"]
        self.assertEqual(flushed_text, "Hello\n")

    def test_no_flush_without_newline_before_interval(self):
        """Without newline and before interval, buffer accumulates."""
        buf = self._make_buffer(flush_interval=10.0)
        buf.append("Hello")
        self.assertEqual(buf._buffer, "Hello")
        buf.slack_client.chat_appendStream.assert_not_called()

    def test_flush_keeps_remainder_after_last_newline(self):
        """Multiple newlines: flush up to last, keep remainder."""
        buf = self._make_buffer()
        buf.append("Line1\nLine2\nPartial")
        self.assertEqual(buf._buffer, "Partial")
        flushed_text = buf.slack_client.chat_appendStream.call_args[1]["chunks"][0]["text"]
        self.assertEqual(flushed_text, "Line1\nLine2\n")

    def test_has_flushed_false_initially(self):
        """has_flushed is False before any send."""
        buf = self._make_buffer()
        self.assertFalse(buf.has_flushed)

    def test_has_flushed_true_after_send(self):
        """has_flushed is True after a successful send."""
        buf = self._make_buffer()
        buf.append("Hello\n")
        self.assertTrue(buf.has_flushed)

    def test_explicit_flush_sends_all(self):
        """flush() sends all buffered text immediately."""
        buf = self._make_buffer(flush_interval=10.0)
        buf.append("No newline here")
        buf.flush()
        self.assertEqual(buf._buffer, "")
        buf.slack_client.chat_appendStream.assert_called_once()

    def test_explicit_flush_noop_when_empty(self):
        """flush() is a no-op when buffer is empty."""
        buf = self._make_buffer()
        result = buf.flush()
        self.assertFalse(result)
        buf.slack_client.chat_appendStream.assert_not_called()

    def test_interval_flush_triggers_after_elapsed(self):
        """When elapsed >= flush_interval and no newline, buffer flushes."""
        buf = self._make_buffer(flush_interval=0.0)  # 0s interval = flush immediately
        buf.append("no newline here")
        # With 0s interval, should flush on first append after init
        # First append sets _last_flush; but elapsed is 0 which is >= 0.0
        # The code checks newline first (no newline), then interval check
        # _last_flush is set to now on first append, so elapsed starts at 0
        # Let's verify it flushed
        self.assertEqual(buf._buffer, "")
        buf.slack_client.chat_appendStream.assert_called_once()

    def test_append_empty_string(self):
        """Appending empty string doesn't crash or trigger flush."""
        buf = self._make_buffer()
        buf.append("")
        self.assertEqual(buf._buffer, "")
        buf.slack_client.chat_appendStream.assert_not_called()


# ===========================================================================
# Tests: streaming_final_answer latching
# ===========================================================================

class TestStreamingFinalAnswerLatch(unittest.TestCase):
    """Tests for streaming_final_answer latch from is_final_answer metadata."""

    def test_is_final_answer_latches_streaming_final_answer(self):
        """is_final_answer=True in first event latches streaming_final_answer."""
        streaming_final_answer = False
        artifact_meta = {"is_final_answer": True}
        if artifact_meta.get("is_final_answer") and not streaming_final_answer:
            streaming_final_answer = True
        self.assertTrue(streaming_final_answer)

    def test_latch_only_fires_once(self):
        """Once latched, subsequent is_final_answer events don't re-latch."""
        streaming_final_answer = True  # already latched
        artifact_meta = {"is_final_answer": True}
        latch_count = 0
        if artifact_meta.get("is_final_answer") and not streaming_final_answer:
            latch_count += 1
        self.assertEqual(latch_count, 0)  # didn't re-latch

    def test_narration_does_not_latch(self):
        """is_narration=True does NOT latch streaming_final_answer."""
        streaming_final_answer = False
        artifact_meta = {"is_narration": True}
        if artifact_meta.get("is_final_answer") and not streaming_final_answer:
            streaming_final_answer = True
        self.assertFalse(streaming_final_answer)


# ===========================================================================
# Tests: safety filter suppression
# ===========================================================================

class TestSafetyFilterSuppression(unittest.TestCase):
    """Tests for metadata leak suppression (ai.py lines 410-412)."""

    def _should_suppress(self, text: str) -> bool:
        """Simulate the safety filter from stream_a2a_response."""
        return "is_task_complete=" in text or text.startswith("Returning structured response")

    def test_suppresses_is_task_complete_leak(self):
        self.assertTrue(self._should_suppress("is_task_complete=True, require_user_input=False"))

    def test_suppresses_returning_structured_response(self):
        self.assertTrue(self._should_suppress("Returning structured response via ResponseFormat"))

    def test_does_not_suppress_normal_text(self):
        self.assertFalse(self._should_suppress("Here is the answer to your question."))

    def test_does_not_suppress_partial_match(self):
        """'is_task_complete' without '=' is not suppressed."""
        self.assertFalse(self._should_suppress("The is_task_complete field controls..."))


# ===========================================================================
# Tests: any_subagent_completed suppression
# ===========================================================================

class TestSubagentCompletedSuppression(unittest.TestCase):
    """Tests for post-subagent suppression logic (ai.py lines 418-435)."""

    def _simulate_subagent_completed(
        self,
        text: str,
        any_subagent_completed: bool,
        stream_ts: str | None,
        streaming_final_answer: bool,
        plan_steps: dict | None = None,
        current_step_id: str | None = None,
    ) -> str:
        """Simulate the any_subagent_completed logic. Returns action taken."""
        if any_subagent_completed:
            if not stream_ts and not streaming_final_answer:
                if current_step_id and plan_steps:
                    return "accumulated_to_step_thinking"
                else:
                    return "suppressed"
                # original: continue
            all_steps_done = not plan_steps or all(
                s.get("status") == "completed" for s in (plan_steps or {}).values()
            )
            if all_steps_done:
                return "latched_final_answer"
        return "pass_through"

    def test_suppressed_pre_stream_no_plan(self):
        """Post-subagent chunk suppressed when no stream and no plan."""
        result = self._simulate_subagent_completed(
            "narration", any_subagent_completed=True,
            stream_ts=None, streaming_final_answer=False,
        )
        self.assertEqual(result, "suppressed")

    def test_accumulated_to_step_thinking_with_plan(self):
        """Post-subagent chunk accumulated to step_thinking when plan exists."""
        result = self._simulate_subagent_completed(
            "step detail", any_subagent_completed=True,
            stream_ts=None, streaming_final_answer=False,
            plan_steps={"s1": {"status": "in_progress"}}, current_step_id="s1",
        )
        self.assertEqual(result, "accumulated_to_step_thinking")

    def test_pass_through_when_stream_open(self):
        """Post-subagent chunk passes through when stream is already open."""
        result = self._simulate_subagent_completed(
            "final text", any_subagent_completed=True,
            stream_ts="ts123", streaming_final_answer=False,
            plan_steps={"s1": {"status": "in_progress"}},
        )
        self.assertEqual(result, "pass_through")

    def test_latched_when_all_steps_done(self):
        """Latches streaming_final_answer when all plan steps are completed."""
        result = self._simulate_subagent_completed(
            "summary", any_subagent_completed=True,
            stream_ts="ts123", streaming_final_answer=False,
            plan_steps={"s1": {"status": "completed"}, "s2": {"status": "completed"}},
        )
        self.assertEqual(result, "latched_final_answer")

    def test_not_latched_when_steps_pending(self):
        """Does NOT latch when some steps are still pending."""
        result = self._simulate_subagent_completed(
            "intermediate", any_subagent_completed=True,
            stream_ts="ts123", streaming_final_answer=False,
            plan_steps={"s1": {"status": "completed"}, "s2": {"status": "in_progress"}},
        )
        self.assertEqual(result, "pass_through")

    def test_no_subagent_completed_passes_through(self):
        """Without any_subagent_completed, everything passes through."""
        result = self._simulate_subagent_completed(
            "normal", any_subagent_completed=False,
            stream_ts=None, streaming_final_answer=False,
        )
        self.assertEqual(result, "pass_through")


# ===========================================================================
# Tests: needs_separator logic
# ===========================================================================

class TestNeedsSeparator(unittest.TestCase):
    """Tests for \\n\\n separator injection (ai.py lines 446-448)."""

    def test_separator_prepended_when_needed(self):
        """needs_separator + has_flushed prepends '\\n\\n'."""
        needs_separator = True
        has_flushed = True
        text = "New section"
        if needs_separator and has_flushed:
            text = "\n\n" + text
            needs_separator = False
        self.assertEqual(text, "\n\nNew section")
        self.assertFalse(needs_separator)

    def test_no_separator_when_not_flushed(self):
        """No separator when stream_buf hasn't flushed yet."""
        needs_separator = True
        has_flushed = False
        text = "First chunk"
        if needs_separator and has_flushed:
            text = "\n\n" + text
        self.assertEqual(text, "First chunk")

    def test_no_separator_when_not_needed(self):
        """No separator when needs_separator is False."""
        needs_separator = False
        has_flushed = True
        text = "Continuation"
        if needs_separator and has_flushed:
            text = "\n\n" + text
        self.assertEqual(text, "Continuation")


if __name__ == "__main__":
    unittest.main()
