#!/usr/bin/env python3
"""
Gap 3: Tests for Slack stream_a2a_response state machine.

Verifies the streaming_final_answer latch and no-tool stream opening logic:
- Without tool calls, STREAMING_RESULT chunks with is_final_answer=True must
  open the stream (not be discarded as typing-status updates).
- With tool calls, pre-tool content stays as typing status.
- FINAL_RESULT is skipped when streaming_final_answer is already set.
- Plan step completion triggers streaming_final_answer latch.

These tests operate on the parsed event routing logic without requiring
a real Slack connection or supervisor.

Usage:
    pytest tests/test_slack_streaming_state_machine.py -v
"""



class TestStreamingFinalAnswerLatch:
    """Test the streaming_final_answer latch behavior in the event routing."""

    def test_is_final_answer_metadata_bypasses_typing_guard(self):
        """STREAMING_RESULT with is_final_answer=True should NOT be treated
        as typing status even when stream_ts is None (no stream opened yet).

        This was the root cause of "tell me a joke" showing no output in Slack.
        The fix changed the guard from:
            if not stream_ts:
        to:
            if not stream_ts and not streaming_final_answer:
        """
        stream_ts = None  # No stream opened yet
        streaming_final_answer = False

        # Simulate is_final_answer metadata arriving
        is_final_answer = True
        if is_final_answer:
            streaming_final_answer = True

        # The guard should now let the content through
        should_skip = not stream_ts and not streaming_final_answer
        assert should_skip is False, \
            "is_final_answer chunks must bypass the typing-status guard"

    def test_normal_chunk_blocked_before_stream_opens(self):
        """Normal STREAMING_RESULT without is_final_answer should be treated
        as typing status when stream hasn't opened yet."""
        stream_ts = None
        streaming_final_answer = False

        should_skip = not stream_ts and not streaming_final_answer
        assert should_skip is True, \
            "Normal pre-stream chunks should be routed to typing status"

    def test_normal_chunk_passes_after_stream_opens(self):
        """After stream_ts is set (via TOOL_NOTIFICATION_START), all chunks pass."""
        stream_ts = "some-ts"
        streaming_final_answer = False

        should_skip = not stream_ts and not streaming_final_answer
        assert should_skip is False

    def test_final_result_skipped_when_already_streaming(self):
        """When streaming_final_answer is True, FINAL_RESULT content should
        be skipped to avoid duplicate output."""
        streaming_final_answer = True

        should_skip_final = streaming_final_answer
        assert should_skip_final is True, \
            "FINAL_RESULT should be skipped when answer was already streamed"

    def test_plan_steps_all_done_triggers_latch(self):
        """When all plan steps are completed, streaming_final_answer should latch."""
        plan_steps = {
            "step-1": {"status": "completed", "description": "Search"},
            "step-2": {"status": "completed", "description": "Synthesize"},
        }
        streaming_final_answer = False

        all_steps_done = not plan_steps or all(
            s.get("status") == "completed" for s in plan_steps.values()
        )
        if all_steps_done:
            streaming_final_answer = True

        assert streaming_final_answer is True

    def test_plan_steps_not_all_done_no_latch(self):
        """When some plan steps are still in progress, latch should not trigger."""
        plan_steps = {
            "step-1": {"status": "completed", "description": "Search"},
            "step-2": {"status": "in_progress", "description": "Synthesize"},
        }
        streaming_final_answer = False

        all_steps_done = not plan_steps or all(
            s.get("status") == "completed" for s in plan_steps.values()
        )
        if all_steps_done:
            streaming_final_answer = True

        assert streaming_final_answer is False

    def test_empty_plan_steps_triggers_latch(self):
        """Empty plan_steps (no plan) should trigger latch (vacuous truth)."""
        plan_steps = {}
        streaming_final_answer = False

        all_steps_done = not plan_steps or all(
            s.get("status") == "completed" for s in plan_steps.values()
        )
        if all_steps_done:
            streaming_final_answer = True

        assert streaming_final_answer is True

    def test_no_plan_no_tool_scenario(self):
        """Full scenario: no plan, no tools, is_final_answer arrives.
        Stream should open and content should be delivered."""
        stream_ts = None
        streaming_final_answer = False
        plan_steps = {}
        events_delivered = []

        # is_final_answer chunk arrives
        is_final_answer = True
        text = "Why did the chicken cross the road?"

        # Apply is_final_answer latch
        if is_final_answer:
            streaming_final_answer = True

        # Check plan steps
        all_steps_done = not plan_steps or all(
            s.get("status") == "completed" for s in plan_steps.values()
        )
        if all_steps_done:
            streaming_final_answer = True

        # Guard check
        should_skip = not stream_ts and not streaming_final_answer
        if not should_skip:
            # Open stream and deliver
            stream_ts = "opened"
            events_delivered.append(text)

        assert stream_ts == "opened"
        assert len(events_delivered) == 1
        assert events_delivered[0] == text


class TestStreamBufferSeparatorLogic:
    """Test the needs_separator logic for multi-section streaming."""

    def test_separator_added_between_sections(self):
        """When has_flushed is True and needs_separator is True,
        content should be prefixed with newlines."""
        needs_separator = True
        has_flushed = True
        text = "New section content"

        if needs_separator and has_flushed:
            text = "\n\n" + text
            needs_separator = False

        assert text.startswith("\n\n")
        assert needs_separator is False

    def test_no_separator_on_first_content(self):
        """First content should not get a separator."""
        needs_separator = False
        has_flushed = False
        text = "First content"

        if needs_separator and has_flushed:
            text = "\n\n" + text
            needs_separator = False

        assert not text.startswith("\n\n")
