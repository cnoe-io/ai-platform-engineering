# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
End-to-end unit tests for the Slack streaming path in ai.py (SSE).

The Slack bot now uses SSE exclusively. Unlike the old A2A path, the SSE
endpoint emits only clean CONTENT events — no raw tool-call JSON or
ResponseFormat metadata ever appears. These tests verify the SSE streaming
path behaves correctly for various event sequences.
"""

from unittest.mock import Mock

from ai_platform_engineering.integrations.slack_bot.utils.ai import stream_sse_response
from ai_platform_engineering.integrations.slack_bot.sse_client import SSEEvent, SSEEventType


def _mock_slack():
    mock = Mock()
    mock.chat_startStream.return_value = {"ts": "stream-ts-1"}
    mock.chat_appendStream.return_value = {"ok": True}
    mock.chat_stopStream.return_value = {"ok": True}
    mock.chat_postMessage.return_value = {"ts": "msg-ts-1"}
    mock.chat_delete.return_value = {"ok": True}
    mock.assistant_threads_setStatus.return_value = {"ok": True}
    return mock


def _mock_sse_client(events):
    mock = Mock()
    mock.stream_chat.return_value = iter(events)
    return mock


def _get_append_stream_markdown(mock_slack):
    """Collect all markdown_text chunks sent via appendStream."""
    texts = []
    for c in mock_slack.chat_appendStream.call_args_list:
        for chunk in c.kwargs.get("chunks", []):
            if chunk.get("type") == "markdown_text":
                texts.append(chunk["text"])
    return texts


def _get_stop_stream_markdown(mock_slack):
    """Collect all markdown_text chunks sent via stopStream."""
    stop_call = mock_slack.chat_stopStream.call_args
    if not stop_call:
        return []
    chunks = stop_call.kwargs.get("chunks") or []
    return [c.get("text", "") for c in chunks if c.get("type") == "markdown_text"]


def _run_stream(events, user_id="U123", **kwargs):
    """Run stream_sse_response with a mock SSE client returning the given events."""
    mock_sse = _mock_sse_client(events)
    mock_slack = _mock_slack()
    stream_sse_response(
        sse_client=mock_sse,
        slack_client=mock_slack,
        channel_id="C1",
        thread_ts="t1",
        message_text="test query",
        team_id="T1",
        user_id=user_id,
        **kwargs,
    )
    return mock_slack


# ---------------------------------------------------------------------------
# 1. SSE CONTENT events are streamed live via appendStream
# ---------------------------------------------------------------------------

class TestSSEContentStreaming:

    def test_content_event_goes_to_append_stream(self):
        """SSE TEXT_MESSAGE_CONTENT events are streamed live as markdown_text via appendStream."""
        events = [
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Here is your answer."),
            SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
        ]
        mock_slack = _run_stream(events)
        appended = _get_append_stream_markdown(mock_slack)
        combined = "".join(appended)
        assert "Here is your answer." in combined

    def test_multiple_content_events_all_streamed(self):
        """Multiple TEXT_MESSAGE_CONTENT events all appear in appendStream."""
        events = [
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Part 1. "),
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Part 2."),
            SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
        ]
        mock_slack = _run_stream(events)
        appended = _get_append_stream_markdown(mock_slack)
        combined = "".join(appended)
        assert "Part 1." in combined
        assert "Part 2." in combined

    def test_stop_stream_called_once(self):
        """stopStream is called exactly once to finalize the response."""
        events = [
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="The answer."),
            SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
        ]
        mock_slack = _run_stream(events)
        assert mock_slack.chat_stopStream.call_count == 1

    def test_start_stream_called_on_first_content(self):
        """startStream is initiated when the first TEXT_MESSAGE_CONTENT event arrives."""
        events = [
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Content"),
            SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
        ]
        mock_slack = _run_stream(events)
        mock_slack.chat_startStream.assert_called_once()


# ---------------------------------------------------------------------------
# 2. Already-streamed: stopStream carries no duplicate content
# ---------------------------------------------------------------------------

class TestAlreadyStreamedPath:

    def test_content_streamed_live_not_duplicated_in_stop_stream(self):
        """
        When content is streamed live via appendStream, stopStream must not
        duplicate it as a markdown_text chunk.
        """
        events = [
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Streaming answer"),
            SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
        ]
        mock_slack = _run_stream(events)

        # Content was streamed live via appendStream
        appended = _get_append_stream_markdown(mock_slack)
        assert any("Streaming answer" in t for t in appended)

        # stopStream should NOT carry the content again
        stop_texts = _get_stop_stream_markdown(mock_slack)
        combined = "".join(stop_texts)
        assert "Streaming answer" not in combined, (
            "Streamed content must not be duplicated in stopStream chunks"
        )


# ---------------------------------------------------------------------------
# 3. Plan + SSE streaming
# ---------------------------------------------------------------------------

def _plan_step(step_id, title, status="pending", order=0):
    return {"step_id": step_id, "title": title, "status": status, "order": order}


class TestPlanAndSSEStreaming:

    def test_plan_update_then_content_streams_correctly(self):
        """Plan update followed by content — both are handled and stop stream called."""
        events = [
            SSEEvent(type=SSEEventType.STATE_DELTA, steps=[
                _plan_step("s1", "Search docs", "in_progress"),
            ]),
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Here are the docs."),
            SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
        ]
        mock_slack = _run_stream(events)
        mock_slack.chat_stopStream.assert_called_once()

    def test_plan_steps_force_completed_at_finalization(self):
        """Steps still in_progress at finalization are force-completed."""
        events = [
            SSEEvent(type=SSEEventType.STATE_DELTA, steps=[
                _plan_step("s1", "Step 1", "completed"),
                _plan_step("s2", "Step 2", "in_progress"),
                _plan_step("s3", "Step 3", "pending"),
            ]),
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Done"),
            SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
        ]
        mock_slack = _run_stream(events)

        # Gather all task_update chunks from appendStream
        all_task_updates = {}
        for c in mock_slack.chat_appendStream.call_args_list:
            for chunk in c.kwargs.get("chunks", []):
                if chunk.get("type") == "task_update":
                    all_task_updates[chunk["id"]] = chunk["status"]

        # s2 and s3 should be force-completed
        assert all_task_updates.get("s2") == "complete", "s2 should be force-completed"
        assert all_task_updates.get("s3") == "complete", "s3 should be force-completed"


# ---------------------------------------------------------------------------
# 4. Error path
# ---------------------------------------------------------------------------

class TestSSEErrorPath:

    def test_error_with_no_content_returns_retry_needed(self):
        """RUN_ERROR event with no content triggers retry_needed."""
        events = [
            SSEEvent(type=SSEEventType.RUN_ERROR, message="Supervisor unavailable"),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()

        result = stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="test",
            team_id="T1",
            user_id="U123",
        )
        assert isinstance(result, dict)
        assert result.get("retry_needed") is True

    def test_content_then_error_does_not_trigger_retry(self):
        """Content followed by a non-fatal error still delivers the content."""
        events = [
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Partial answer"),
            SSEEvent(type=SSEEventType.RUN_ERROR, message="non-fatal"),
            SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()

        result = stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="test",
            team_id="T1",
            user_id="U123",
        )
        # Should NOT be retry_needed since we got content
        assert not isinstance(result, dict) or not result.get("retry_needed")


# ---------------------------------------------------------------------------
# 5. Full realistic scenario
# ---------------------------------------------------------------------------

class TestFullRealisticScenario:

    def test_realistic_rag_query(self):
        """
        Realistic SSE flow: streaming content from a RAG query.
        Content appears in appendStream and stopStream has feedback blocks.
        """
        events = [
            SSEEvent(type=SSEEventType.TOOL_CALL_START, tool_call_name="rag_search"),
            SSEEvent(type=SSEEventType.TOOL_CALL_END, tool_call_name="rag_search"),
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="CAIPE is a Cloud AI Platform Engineering system."),
            SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-rag-1"),
        ]
        mock_slack = _run_stream(events)

        appended = _get_append_stream_markdown(mock_slack)
        combined = "".join(appended)
        assert "CAIPE" in combined

        # stopStream must have feedback blocks
        stop_call = mock_slack.chat_stopStream.call_args
        blocks = stop_call.kwargs.get("blocks")
        assert blocks is not None and len(blocks) > 0

    def test_empty_content_no_crash(self):
        """Empty TEXT_MESSAGE_CONTENT events must not crash and produce nothing."""
        events = [
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta=""),
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta=None),
            SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()

        # Should not raise
        stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C1",
            thread_ts="t1",
            message_text="test",
            team_id="T1",
            user_id="U123",
        )
