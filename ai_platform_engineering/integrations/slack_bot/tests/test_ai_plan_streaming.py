"""Tests for plan-mode streaming in ai.py using the SSE path.

Covers: lazy stream start, setStatus behavior, plan step streaming,
force-complete at finalization, stopStream final answer, and StreamBuffer batching.
"""

import time
from unittest.mock import Mock

from ai_platform_engineering.integrations.slack_bot.utils.ai import stream_sse_response, StreamBuffer
from ai_platform_engineering.integrations.slack_bot.sse_client import SSEEvent, SSEEventType


# ---------------------------------------------------------------------------
# Helpers to build SSE events
# ---------------------------------------------------------------------------

def _content_event(text):
    return SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta=text)


def _plan_event(steps):
    return SSEEvent(type=SSEEventType.STATE_DELTA, steps=steps)


def _tool_start_event(name="search"):
    return SSEEvent(type=SSEEventType.TOOL_CALL_START, tool_call_name=name)


def _tool_end_event(name="search"):
    return SSEEvent(type=SSEEventType.TOOL_CALL_END, tool_call_name=name)


def _done_event(run_id="run-1"):
    return SSEEvent(type=SSEEventType.RUN_FINISHED, run_id=run_id)


def _error_event(message="Something failed"):
    return SSEEvent(type=SSEEventType.RUN_ERROR, message=message)


def _make_step(step_id, title, status="pending", order=0, agent=""):
    return {"step_id": step_id, "title": title, "status": status, "order": order, "agent": agent}


def _mock_slack():
    """Create a mock Slack client with streaming API stubs."""
    mock = Mock()
    mock.chat_startStream.return_value = {"ts": "stream-ts-1"}
    mock.chat_appendStream.return_value = {"ok": True}
    mock.chat_stopStream.return_value = {"ok": True}
    mock.chat_postMessage.return_value = {"ts": "msg-ts-1"}
    mock.chat_delete.return_value = {"ok": True}
    mock.assistant_threads_setStatus.return_value = {"ok": True}
    return mock


def _mock_sse_client(events):
    """Create a mock SSE client that yields the given events."""
    mock = Mock()
    mock.stream_chat.return_value = iter(events)
    return mock


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestLazyStreamAndSetStatus:
    """Verify setStatus is called before startStream, and startStream is deferred."""

    def test_set_status_called_before_start_stream(self):
        """setStatus('is thinking...') fires immediately; startStream fires on first content."""
        events = [
            _plan_event([_make_step("s1", "Search docs", "in_progress", 0)]),
            _content_event("Done"),
            _done_event(),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()

        stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        # setStatus should be called at least once (the initial "is thinking..." call)
        assert mock_slack.assistant_threads_setStatus.call_count >= 1
        first_set_status = mock_slack.assistant_threads_setStatus.call_args_list[0]
        assert first_set_status.kwargs["status"] == "is thinking..."
        assert "loading_messages" in first_set_status.kwargs

        # startStream should have been called
        mock_slack.chat_startStream.assert_called_once()

        # Verify setStatus was called BEFORE startStream
        all_calls = mock_slack.method_calls
        set_status_idx = next(
            i for i, c in enumerate(all_calls) if c[0] == "assistant_threads_setStatus"
        )
        start_stream_idx = next(
            i for i, c in enumerate(all_calls) if c[0] == "chat_startStream"
        )
        assert set_status_idx < start_stream_idx

    def test_start_stream_with_content_only(self):
        """If no plan but content arrives, startStream fires and final text goes via stopStream."""
        events = [
            _content_event("Here is the answer"),
            _done_event(),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()

        stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        # Stream should start because we have content
        mock_slack.chat_startStream.assert_called_once()
        # stopStream should be called to finalize
        mock_slack.chat_stopStream.assert_called_once()


class TestForceCompleteAtFinalization:
    """Steps left in_progress/pending are force-completed before stopStream."""

    def test_pending_steps_force_completed(self):
        """Steps that never reached 'completed' are force-completed at finalization."""
        events = [
            _plan_event([
                _make_step("s1", "Step 1", "completed", 0),
                _make_step("s2", "Step 2", "in_progress", 1),
                _make_step("s3", "Step 3", "pending", 2),
            ]),
            _content_event("All done"),
            _done_event(),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()

        stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        # Collect all task_update chunks sent via appendStream
        all_task_updates = {}
        for c in mock_slack.chat_appendStream.call_args_list:
            chunks = c.kwargs.get("chunks", [])
            for chunk in chunks:
                if chunk.get("type") == "task_update":
                    # Keep the last status sent per step
                    all_task_updates[chunk["id"]] = chunk["status"]

        # s2 and s3 should have been force-completed to "complete"
        assert all_task_updates.get("s2") == "complete", "s2 should be force-completed"
        assert all_task_updates.get("s3") == "complete", "s3 should be force-completed"


class TestStopStreamCarriesFinalAnswer:
    """When content is streamed live, stopStream has no chunks (already in stream)."""

    def test_stop_stream_called_after_streaming(self):
        """Content streamed live; stopStream called to finalize with feedback blocks."""
        events = [
            _content_event("Here is my final answer"),
            _done_event(),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()

        stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        mock_slack.chat_stopStream.assert_called_once()
        stop_call = mock_slack.chat_stopStream.call_args
        # Content was streamed live, so stop chunks should be None or empty
        chunks = stop_call.kwargs.get("chunks")
        assert chunks is None or len(chunks) == 0, (
            "Content was already streamed; stopStream should not duplicate it in chunks"
        )
        # But feedback blocks should be present
        blocks = stop_call.kwargs.get("blocks")
        assert blocks is not None and len(blocks) > 0, "stopStream must have feedback blocks"


class TestToolEvents:
    """Tool start/end events start the stream and flush the buffer."""

    def test_tool_start_initiates_stream(self):
        """TOOL_START calls _start_stream_if_needed, which initiates the Slack stream."""
        events = [
            _tool_start_event("rag_search"),
            _content_event("Result"),
            _done_event(),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()

        stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        # TOOL_START should trigger startStream so plan cards can appear immediately
        mock_slack.chat_startStream.assert_called_once()

    def test_tool_start_typing_status_when_no_stream_yet(self):
        """When stream hasn't started and no team/user ID, tool name appears in typing status."""
        events = [
            _tool_start_event("rag_search"),
            _content_event("Result"),
            _done_event(),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()
        # Make startStream fail so stream_ts stays None — then typing status gets the tool name
        mock_slack.chat_startStream.side_effect = Exception("startStream unavailable")

        stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        status_calls = [
            c.kwargs.get("status", "")
            for c in mock_slack.assistant_threads_setStatus.call_args_list
        ]
        assert any("rag_search" in s for s in status_calls), (
            "Should update typing status with tool name when stream not started"
        )

    def test_tool_end_typing_status_when_no_stream(self):
        """TOOL_END updates typing status to 'is working...' when stream has not started."""
        events = [
            _tool_start_event("my_tool"),
            _tool_end_event("my_tool"),
            _content_event("Done"),
            _done_event(),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()
        # Make startStream fail so stream_ts stays None
        mock_slack.chat_startStream.side_effect = Exception("startStream unavailable")

        stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        status_calls = [
            c.kwargs.get("status", "")
            for c in mock_slack.assistant_threads_setStatus.call_args_list
        ]
        assert any("working" in s for s in status_calls), (
            "Should update typing status to 'is working...' after tool end when stream not started"
        )


class TestStreamBuffer:
    """Tests for the StreamBuffer batching logic."""

    def test_append_buffers_within_interval(self):
        """Multiple appends within the flush interval produce a single API call."""
        mock_slack = Mock()
        mock_slack.chat_appendStream.return_value = {"ok": True}
        buf = StreamBuffer(mock_slack, "C1", "ts1", flush_interval=1.0)

        buf.append("Hello ")
        buf.append("world")
        # Neither append should have triggered a flush (interval=1s, instant calls)
        mock_slack.chat_appendStream.assert_not_called()

        buf.flush()
        mock_slack.chat_appendStream.assert_called_once()
        chunks = mock_slack.chat_appendStream.call_args.kwargs["chunks"]
        assert chunks == [{"type": "markdown_text", "text": "Hello world"}]

    def test_append_auto_flushes_after_interval(self):
        """An append after the flush interval triggers an automatic flush."""
        mock_slack = Mock()
        mock_slack.chat_appendStream.return_value = {"ok": True}
        buf = StreamBuffer(mock_slack, "C1", "ts1", flush_interval=0.05)

        buf.append("first")
        time.sleep(0.06)
        buf.append("second")  # Should trigger flush of "firstsecond"

        assert mock_slack.chat_appendStream.call_count == 1
        chunks = mock_slack.chat_appendStream.call_args.kwargs["chunks"]
        assert chunks[0]["text"] == "firstsecond"

    def test_flush_is_noop_when_empty(self):
        """Flushing an empty buffer does nothing."""
        mock_slack = Mock()
        buf = StreamBuffer(mock_slack, "C1", "ts1")

        result = buf.flush()
        assert result is False
        mock_slack.chat_appendStream.assert_not_called()

    def test_has_flushed_tracks_state(self):
        """has_flushed is False initially and True after a successful flush."""
        mock_slack = Mock()
        mock_slack.chat_appendStream.return_value = {"ok": True}
        buf = StreamBuffer(mock_slack, "C1", "ts1")

        assert buf.has_flushed is False
        buf.append("text")
        buf.flush()
        assert buf.has_flushed is True

    def test_append_flushes_on_newline_boundary(self):
        """Appending text with a newline flushes up to the newline, keeps remainder."""
        mock_slack = Mock()
        mock_slack.chat_appendStream.return_value = {"ok": True}
        buf = StreamBuffer(mock_slack, "C1", "ts1", flush_interval=10.0)

        buf.append("**bold text**\nstart of next")

        mock_slack.chat_appendStream.assert_called_once()
        chunks = mock_slack.chat_appendStream.call_args.kwargs["chunks"]
        assert chunks == [{"type": "markdown_text", "text": "**bold text**\n"}]
        # Remainder stays in buffer
        assert buf._buffer == "start of next"

    def test_no_flush_mid_markdown_without_newline(self):
        """Without a newline or interval, buffer holds — avoids splitting markdown."""
        mock_slack = Mock()
        mock_slack.chat_appendStream.return_value = {"ok": True}
        buf = StreamBuffer(mock_slack, "C1", "ts1", flush_interval=10.0)

        buf.append("**bold")
        buf.append(" text**")
        mock_slack.chat_appendStream.assert_not_called()

        buf.flush()
        chunks = mock_slack.chat_appendStream.call_args.kwargs["chunks"]
        assert chunks == [{"type": "markdown_text", "text": "**bold text**"}]

    def test_flush_handles_api_error(self):
        """If appendStream raises, buffer is cleared and has_flushed stays False."""
        mock_slack = Mock()
        mock_slack.chat_appendStream.side_effect = Exception("rate limited")
        buf = StreamBuffer(mock_slack, "C1", "ts1")

        buf.append("text")
        result = buf.flush()
        assert result is False
        assert buf.has_flushed is False
        # Buffer should be cleared even on error (don't re-send stale content)
        assert buf._buffer == ""
