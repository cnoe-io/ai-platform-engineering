"""Tests for plan-mode streaming in ai.py.

Covers: lazy stream start, setStatus behavior, plan step streaming,
force-complete at finalization, no markdown streaming with plan,
should_append=False replaces thinking, bot user guard, stopStream final answer,
and StreamBuffer batching.
"""

import time
from unittest.mock import Mock

from ai_platform_engineering.integrations.slack_bot.utils.ai import stream_a2a_response, StreamBuffer


# ---------------------------------------------------------------------------
# Helpers to build A2A events
# ---------------------------------------------------------------------------

def _task_event(context_id="ctx-1"):
    return {"kind": "task", "id": "t1", "contextId": context_id}


def _plan_event(steps):
    """Build an execution_plan artifact-update with structured DataPart."""
    return {
        "kind": "artifact-update",
        "artifact": {
            "name": "execution_plan_update",
            "parts": [{"kind": "data", "data": {"steps": steps}}],
        },
    }


def _streaming_result(text, append=True):
    return {
        "kind": "artifact-update",
        "append": append,
        "artifact": {
            "name": "streaming_result",
            "parts": [{"kind": "text", "text": text}],
        },
    }


def _final_result(text):
    return {
        "kind": "artifact-update",
        "artifact": {
            "name": "final_result",
            "parts": [{"kind": "text", "text": text}],
        },
    }


def _tool_start(name="search"):
    return {
        "kind": "artifact-update",
        "artifact": {
            "name": "tool_notification_start",
            "metadata": {"tool_name": name},
            "parts": [],
        },
    }


def _tool_end(name="search"):
    return {
        "kind": "artifact-update",
        "artifact": {
            "name": "tool_notification_end",
            "metadata": {"tool_name": name},
            "parts": [],
        },
    }


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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestLazyStreamAndSetStatus:
    """Verify setStatus is called before startStream, and startStream is deferred."""

    def test_set_status_called_before_start_stream(self):
        """setStatus('is thinking...') fires immediately; startStream fires on first plan."""
        events = [
            _task_event(),
            _plan_event([_make_step("s1", "Search docs", "in_progress", 0)]),
            _final_result("Done"),
        ]
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(events)
        mock_slack = _mock_slack()

        stream_a2a_response(
            a2a_client=mock_a2a,
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

        # startStream should have been called (lazily, when plan arrived)
        mock_slack.chat_startStream.assert_called_once()

        # Verify setStatus was called BEFORE startStream by checking call order
        all_calls = mock_slack.method_calls
        set_status_idx = next(
            i for i, c in enumerate(all_calls) if c[0] == "assistant_threads_setStatus"
        )
        start_stream_idx = next(
            i for i, c in enumerate(all_calls) if c[0] == "chat_startStream"
        )
        assert set_status_idx < start_stream_idx

    def test_start_stream_not_called_without_content(self):
        """If only a task event + final_result (no plan, no streaming_result), stream still starts for final."""
        events = [
            _task_event(),
            _final_result("Here is the answer"),
        ]
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(events)
        mock_slack = _mock_slack()

        stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        # Stream should still start at finalization for the final answer
        mock_slack.chat_startStream.assert_called_once()
        # stopStream should carry the final text since nothing was streamed
        stop_call = mock_slack.chat_stopStream.call_args
        chunks = stop_call.kwargs.get("chunks") or (stop_call[1].get("chunks") if len(stop_call) > 1 else None)
        assert chunks is not None
        assert any("Here is the answer" in c.get("text", "") for c in chunks)


class TestBotUserNoSetStatus:
    """Bot users (user_id starts with 'B') should never get setStatus calls."""

    def test_no_set_status_for_bot_user(self):
        events = [
            _task_event(),
            _plan_event([_make_step("s1", "Search", "in_progress", 0)]),
            _final_result("answer"),
        ]
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(events)
        mock_slack = _mock_slack()

        stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="B123",
        )

        mock_slack.assistant_threads_setStatus.assert_not_called()
        # Bot users don't use streaming API
        mock_slack.chat_startStream.assert_not_called()


class TestLastStepStreamedAsMarkdown:
    """When plan_steps exist, the last step's STREAMING_RESULT is streamed live as markdown."""

    def test_last_step_streaming_result_sent_as_markdown(self):
        """When a plan is active, streaming_result for the last step IS streamed as markdown_text in real-time."""
        events = [
            _task_event(),
            # Plan with one step (which is both first and last)
            _plan_event([_make_step("s1", "Analyze", "in_progress", 0)]),
            # Streaming result for the last step — should be streamed live
            _streaming_result("Some streaming text"),
            _final_result("Final answer"),
        ]
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(events)
        mock_slack = _mock_slack()

        stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        # The last step's streaming_result should produce a markdown_text chunk
        markdown_chunks = []
        for c in mock_slack.chat_appendStream.call_args_list:
            chunks = c.kwargs.get("chunks", [])
            for chunk in chunks:
                if chunk.get("type") == "markdown_text":
                    markdown_chunks.append(chunk)
        assert len(markdown_chunks) > 0, (
            "Last step streaming_result should be streamed as markdown_text"
        )
        assert any("Some streaming text" in c["text"] for c in markdown_chunks)


class TestShouldAppendFalseReplacesThinking:
    """When streaming_result has append=False, step_thinking is replaced not concatenated."""

    def test_append_false_replaces_step_thinking(self):
        """Intermediate step thinking with append=False should replace previous thinking."""
        events = [
            _task_event(),
            # Two-step plan: s1 is intermediate (not last), s2 is last
            _plan_event([
                _make_step("s1", "Research", "in_progress", 0, agent="DocSearch"),
                _make_step("s2", "Summarize", "pending", 1),
            ]),
            # Stream some thinking for s1 (append=True by default)
            _streaming_result("thinking part 1"),
            # Replace with new thinking (append=False)
            _streaming_result("replaced thinking", append=False),
            # Complete s1, start s2
            _plan_event([
                _make_step("s1", "Research", "completed", 0, agent="DocSearch"),
                _make_step("s2", "Summarize", "in_progress", 1),
            ]),
            _final_result("Summary done"),
        ]
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(events)
        mock_slack = _mock_slack()

        stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        # Find the appendStream call that sent the step completion for s1
        # It should contain "replaced thinking" not "thinking part 1"
        found_details = None
        for c in mock_slack.chat_appendStream.call_args_list:
            chunks = c.kwargs.get("chunks", [])
            for chunk in chunks:
                if chunk.get("type") == "task_update" and chunk.get("id") == "s1":
                    if "details" in chunk:
                        found_details = chunk["details"]

        assert found_details is not None, "s1 completion should include details"
        assert "replaced thinking" in found_details
        assert "thinking part 1" not in found_details


class TestForceCompleteAtFinalization:
    """Steps left in_progress/pending are force-completed before stopStream."""

    def test_pending_steps_force_completed(self):
        """Steps that never reached 'completed' are force-completed at finalization."""
        events = [
            _task_event(),
            _plan_event([
                _make_step("s1", "Step 1", "completed", 0),
                _make_step("s2", "Step 2", "in_progress", 1),
                _make_step("s3", "Step 3", "pending", 2),
            ]),
            _final_result("All done"),
        ]
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(events)
        mock_slack = _mock_slack()

        stream_a2a_response(
            a2a_client=mock_a2a,
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
    """When plan_steps exist, stopStream is called with chunks containing the final answer."""

    def test_stop_stream_has_final_text_with_plan(self):
        events = [
            _task_event(),
            _plan_event([_make_step("s1", "Search", "in_progress", 0)]),
            _plan_event([_make_step("s1", "Search", "completed", 0)]),
            _final_result("Here is my final answer"),
        ]
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(events)
        mock_slack = _mock_slack()

        stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        mock_slack.chat_stopStream.assert_called_once()
        stop_call = mock_slack.chat_stopStream.call_args
        chunks = stop_call.kwargs.get("chunks")
        assert chunks is not None, "stopStream should have chunks"
        assert len(chunks) == 1
        assert chunks[0]["type"] == "markdown_text"
        assert chunks[0]["text"] == "Here is my final answer"

    def test_stop_stream_has_final_text_when_nothing_streamed(self):
        """Even without a plan, if no text was streamed, final text goes in stopStream."""
        events = [
            _task_event(),
            _final_result("Quick answer"),
        ]
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(events)
        mock_slack = _mock_slack()

        stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        stop_call = mock_slack.chat_stopStream.call_args
        chunks = stop_call.kwargs.get("chunks")
        assert chunks is not None
        assert any(c["text"] == "Quick answer" for c in chunks)


class TestToolEndNoTaskUpdate:
    """TOOL_NOTIFICATION_END no longer sends task_update thinking via appendStream."""

    def test_tool_end_does_not_send_thinking(self):
        """tool_end should not trigger an appendStream with task_update details."""
        events = [
            _task_event(),
            _plan_event([
                _make_step("s1", "Search", "in_progress", 0),
                _make_step("s2", "Analyze", "pending", 1),
            ]),
            _streaming_result("some thinking for s1"),
            _tool_start("rag_search"),
            _tool_end("rag_search"),
            # Step completes via plan update (this is where thinking is sent)
            _plan_event([
                _make_step("s1", "Search", "completed", 0),
                _make_step("s2", "Analyze", "in_progress", 1),
            ]),
            _final_result("Result"),
        ]
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(events)
        mock_slack = _mock_slack()

        stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        # Find appendStream calls. The first should be from the initial plan,
        # then from the step completion plan update, then force-complete.
        # None should be triggered directly by tool_end.
        # We verify indirectly: all appendStream calls should come with
        # task_update chunks (plan updates), not markdown_text from tool_end.
        for c in mock_slack.chat_appendStream.call_args_list:
            chunks = c.kwargs.get("chunks", [])
            for chunk in chunks:
                assert chunk.get("type") == "task_update", (
                    f"Only task_update chunks expected in appendStream, got: {chunk.get('type')}"
                )


class TestStreamWithoutPlanStreamsMarkdown:
    """When no plan exists, STREAMING_RESULT streams markdown_text normally."""

    def test_markdown_streamed_without_plan(self):
        events = [
            _task_event(),
            _streaming_result("Hello "),
            _streaming_result("world"),
            _final_result("Hello world"),
        ]
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(events)
        mock_slack = _mock_slack()

        stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="hi",
            team_id="T1",
            user_id="U123",
        )

        # appendStream should have been called with markdown_text chunks
        # (StreamBuffer may batch multiple tokens into fewer API calls)
        markdown_texts = []
        for c in mock_slack.chat_appendStream.call_args_list:
            chunks = c.kwargs.get("chunks", [])
            for chunk in chunks:
                if chunk.get("type") == "markdown_text":
                    markdown_texts.append(chunk["text"])

        combined = "".join(markdown_texts)
        assert "Hello " in combined
        assert "world" in combined
        assert len(markdown_texts) >= 1

        # stopStream should NOT carry final text since text was already streamed
        stop_call = mock_slack.chat_stopStream.call_args
        chunks = stop_call.kwargs.get("chunks")
        assert chunks is None, "stopStream should not duplicate already-streamed text"


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
