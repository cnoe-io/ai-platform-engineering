"""Tests for plan-mode streaming in ai.py using the SSE path.

Covers: lazy stream start, setStatus behavior, tool call streaming with
thinking text and thought extraction, stopStream final answer, and StreamBuffer batching.
"""

import time
from unittest.mock import Mock

from ai_platform_engineering.integrations.slack_bot.utils.ai import (
  stream_response,
  StreamBuffer,
  _extract_tool_thought,
)
from ai_platform_engineering.integrations.slack_bot.sse_client import SSEEvent, SSEEventType


# ---------------------------------------------------------------------------
# Helpers to build SSE events
# ---------------------------------------------------------------------------


def _content_event(text):
  return SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta=text)


def _tool_start_event(name="search", tool_call_id="tc-1"):
  return SSEEvent(type=SSEEventType.TOOL_CALL_START, tool_call_name=name, tool_call_id=tool_call_id)


def _tool_args_event(tool_call_id="tc-1", delta='{"thought": "Looking for docs"}'):
  return SSEEvent(type=SSEEventType.TOOL_CALL_ARGS, tool_call_id=tool_call_id, delta=delta)


def _tool_end_event(tool_call_id="tc-1"):
  return SSEEvent(type=SSEEventType.TOOL_CALL_END, tool_call_id=tool_call_id)


def _done_event(run_id="run-1"):
  return SSEEvent(type=SSEEventType.RUN_FINISHED, run_id=run_id)


def _error_event(message="Something failed"):
  return SSEEvent(type=SSEEventType.RUN_ERROR, message=message)


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


def _get_task_updates(mock_slack):
  """Collect all task_update chunks from appendStream calls."""
  updates = []
  for c in mock_slack.chat_appendStream.call_args_list:
    for chunk in c.kwargs.get("chunks", []):
      if chunk.get("type") == "task_update":
        updates.append(chunk)
  return updates


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestLazyStreamAndSetStatus:
  """Verify setStatus is called before startStream, and startStream is deferred."""

  def test_set_status_called_before_start_stream(self):
    """setStatus('is thinking...') fires immediately; startStream fires on first tool call."""
    events = [
      _tool_start_event("search", "tc-1"),
      _tool_end_event("tc-1"),
      _content_event("Done"),
      _done_event(),
    ]
    mock_sse = _mock_sse_client(events)
    mock_slack = _mock_slack()

    stream_response(
      sse_client=mock_sse,
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="hi",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
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
    set_status_idx = next(i for i, c in enumerate(all_calls) if c[0] == "assistant_threads_setStatus")
    start_stream_idx = next(i for i, c in enumerate(all_calls) if c[0] == "chat_startStream")
    assert set_status_idx < start_stream_idx

  def test_start_stream_with_content_only(self):
    """If no tool calls but content arrives, startStream fires and final text goes via stopStream."""
    events = [
      _content_event("Here is the answer"),
      _done_event(),
    ]
    mock_sse = _mock_sse_client(events)
    mock_slack = _mock_slack()

    stream_response(
      sse_client=mock_sse,
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="hi",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
    )

    # Stream should start because we have content
    mock_slack.chat_startStream.assert_called_once()
    # stopStream should be called to finalize
    mock_slack.chat_stopStream.assert_called_once()


class TestStopStreamCarriesFinalAnswer:
  """When content is streamed live, stopStream has no chunks (already in stream)."""

  def test_stop_stream_called_after_streaming(self):
    """stopStream called to finalize; feedback blocks are always present."""
    events = [
      _content_event("Here is my final answer"),
      _done_event(),
    ]
    mock_sse = _mock_sse_client(events)
    mock_slack = _mock_slack()

    stream_response(
      sse_client=mock_sse,
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="hi",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
    )

    mock_slack.chat_stopStream.assert_called_once()
    stop_call = mock_slack.chat_stopStream.call_args
    # Feedback blocks should always be present
    blocks = stop_call.kwargs.get("blocks")
    assert blocks is not None and len(blocks) > 0, "stopStream must have feedback blocks"


class TestToolEvents:
  """Tool start/end events start the stream and flush the buffer."""

  def test_tool_start_initiates_stream(self):
    """TOOL_START calls _start_stream_if_needed, which initiates the Slack stream."""
    events = [
      _tool_start_event("rag_search", "tc-1"),
      _tool_end_event("tc-1"),
      _content_event("Result"),
      _done_event(),
    ]
    mock_sse = _mock_sse_client(events)
    mock_slack = _mock_slack()

    stream_response(
      sse_client=mock_sse,
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="hi",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
    )

    # TOOL_START should trigger startStream so plan cards can appear immediately
    mock_slack.chat_startStream.assert_called_once()

  def test_tool_start_tries_to_start_stream(self):
    """When stream fails, TOOL_START still tries to start it (graceful degradation)."""
    events = [
      _tool_start_event("rag_search", "tc-1"),
      _tool_end_event("tc-1"),
      _content_event("Result"),
      _done_event(),
    ]
    mock_sse = _mock_sse_client(events)
    mock_slack = _mock_slack()
    # Make startStream fail
    mock_slack.chat_startStream.side_effect = Exception("startStream unavailable")

    stream_response(
      sse_client=mock_sse,
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="hi",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
    )

    # startStream should have been attempted
    assert mock_slack.chat_startStream.called, "Should attempt to start stream on TOOL_START"

  def test_tool_end_typing_status_when_no_stream(self):
    """TOOL_END updates typing status to 'is working...' when stream has not started."""
    events = [
      _tool_start_event("my_tool", "tc-1"),
      _tool_end_event("tc-1"),
      _content_event("Done"),
      _done_event(),
    ]
    mock_sse = _mock_sse_client(events)
    mock_slack = _mock_slack()
    # Make startStream fail so stream_ts stays None
    mock_slack.chat_startStream.side_effect = Exception("startStream unavailable")

    stream_response(
      sse_client=mock_sse,
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="hi",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
    )

    status_calls = [c.kwargs.get("status", "") for c in mock_slack.assistant_threads_setStatus.call_args_list]
    assert any("working" in s for s in status_calls), "Should update typing status to 'is working...' after tool end when stream not started"


class TestThinkingBuffer:
  """Text between tool calls is buffered as 'thinking' and shown as details on tools."""

  def test_thinking_text_shown_as_tool_start_details(self):
    """Text before a tool call appears as details on the tool's in_progress checklist item."""
    events = [
      _content_event("Let me search for that..."),
      _tool_start_event("rag_search", "tc-1"),
      _tool_end_event("tc-1"),
      _content_event("Here is the answer."),
      _done_event(),
    ]
    mock_slack = Mock()
    mock_slack.chat_startStream.return_value = {"ts": "stream-ts-1"}
    mock_slack.chat_appendStream.return_value = {"ok": True}
    mock_slack.chat_stopStream.return_value = {"ok": True}
    mock_slack.assistant_threads_setStatus.return_value = {"ok": True}

    stream_response(
      sse_client=_mock_sse_client(events),
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="hi",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
    )

    updates = _get_task_updates(mock_slack)
    in_progress = [u for u in updates if u["status"] == "in_progress"]
    assert len(in_progress) == 1
    assert in_progress[0]["details"] == "Let me search for that..."

  def test_thinking_between_tools_shown_on_second_tool(self):
    """Text between two tool calls is shown as details on the second tool."""
    events = [
      _tool_start_event("rag_search", "tc-1"),
      _tool_end_event("tc-1"),
      _content_event("Now let me check Jira..."),
      _tool_start_event("jira_search", "tc-2"),
      _tool_end_event("tc-2"),
      _content_event("Final answer."),
      _done_event(),
    ]
    mock_slack = Mock()
    mock_slack.chat_startStream.return_value = {"ts": "stream-ts-1"}
    mock_slack.chat_appendStream.return_value = {"ok": True}
    mock_slack.chat_stopStream.return_value = {"ok": True}
    mock_slack.assistant_threads_setStatus.return_value = {"ok": True}

    stream_response(
      sse_client=_mock_sse_client(events),
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="hi",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
    )

    updates = _get_task_updates(mock_slack)
    # First tool should have no thinking details (no text before it)
    first_in_progress = [u for u in updates if u["status"] == "in_progress" and u["id"] == "tc-1"]
    assert len(first_in_progress) == 1
    assert first_in_progress[0].get("details") is None

    # Second tool should have the thinking text
    second_in_progress = [u for u in updates if u["status"] == "in_progress" and u["id"] == "tc-2"]
    assert len(second_in_progress) == 1
    assert second_in_progress[0]["details"] == "Now let me check Jira..."

  def test_thinking_truncated_to_200_chars(self):
    """Thinking text longer than 200 chars is truncated."""
    long_text = "A" * 250
    events = [
      _content_event(long_text),
      _tool_start_event("search", "tc-1"),
      _tool_end_event("tc-1"),
      _content_event("Done."),
      _done_event(),
    ]
    mock_slack = Mock()
    mock_slack.chat_startStream.return_value = {"ts": "stream-ts-1"}
    mock_slack.chat_appendStream.return_value = {"ok": True}
    mock_slack.chat_stopStream.return_value = {"ok": True}
    mock_slack.assistant_threads_setStatus.return_value = {"ok": True}

    stream_response(
      sse_client=_mock_sse_client(events),
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="hi",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
    )

    updates = _get_task_updates(mock_slack)
    in_progress = [u for u in updates if u["status"] == "in_progress"]
    assert len(in_progress) == 1
    assert len(in_progress[0]["details"]) == 200

  def test_final_text_after_tools_streamed_normally(self):
    """Text after the last tool call is the final answer, streamed via appendStream."""
    events = [
      _tool_start_event("search", "tc-1"),
      _tool_end_event("tc-1"),
      _content_event("Here is the final answer."),
      _done_event(),
    ]
    mock_slack = Mock()
    mock_slack.chat_startStream.return_value = {"ts": "stream-ts-1"}
    mock_slack.chat_appendStream.return_value = {"ok": True}
    mock_slack.chat_stopStream.return_value = {"ok": True}
    mock_slack.assistant_threads_setStatus.return_value = {"ok": True}

    stream_response(
      sse_client=_mock_sse_client(events),
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="hi",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
    )

    # Final answer text should appear somewhere (appendStream or stopStream)
    all_text = []
    for c in mock_slack.chat_appendStream.call_args_list:
      for chunk in c.kwargs.get("chunks", []):
        if chunk.get("type") == "markdown_text":
          all_text.append(chunk["text"])
    stop_call = mock_slack.chat_stopStream.call_args
    for chunk in stop_call.kwargs.get("chunks") or []:
      if chunk.get("type") == "markdown_text":
        all_text.append(chunk["text"])
    combined = "".join(all_text)
    assert "Here is the final answer." in combined


class TestToolThoughtExtraction:
  """Tests for _extract_tool_thought and TOOL_CALL_ARGS thought display."""

  def test_extract_thought_basic(self):
    assert _extract_tool_thought('{"thought": "Looking for docs"}') == "Looking for docs"

  def test_extract_reason(self):
    assert _extract_tool_thought('{"reason": "Need to check"}') == "Need to check"

  def test_extract_first_matching_key(self):
    """Returns the first matching key in priority order."""
    result = _extract_tool_thought('{"reason": "R", "thought": "T"}')
    assert result == "T"  # thought comes before reason in _THOUGHT_KEYS

  def test_extract_skips_empty(self):
    assert _extract_tool_thought('{"thought": "", "reason": "Actual reason"}') == "Actual reason"

  def test_extract_truncates_long_text(self):
    long = "X" * 300
    result = _extract_tool_thought(f'{{"thought": "{long}"}}')
    assert result.endswith("...")
    assert len(result) == 203  # 200 + "..."

  def test_extract_returns_none_for_no_thought(self):
    assert _extract_tool_thought('{"query": "kubernetes"}') is None

  def test_extract_returns_none_for_invalid_json(self):
    assert _extract_tool_thought("not json") is None

  def test_extract_returns_none_for_empty(self):
    assert _extract_tool_thought("") is None
    assert _extract_tool_thought(None) is None

  def test_tool_args_thought_shown_on_completed(self):
    """Thought extracted from TOOL_CALL_ARGS is shown as details on the completed checklist item."""
    events = [
      _tool_start_event("rag_search", "tc-1"),
      _tool_args_event("tc-1", '{"thought": "Searching for k8s docs", "query": "kubernetes"}'),
      _tool_end_event("tc-1"),
      _content_event("Here is the answer."),
      _done_event(),
    ]
    mock_slack = Mock()
    mock_slack.chat_startStream.return_value = {"ts": "stream-ts-1"}
    mock_slack.chat_appendStream.return_value = {"ok": True}
    mock_slack.chat_stopStream.return_value = {"ok": True}
    mock_slack.assistant_threads_setStatus.return_value = {"ok": True}

    stream_response(
      sse_client=_mock_sse_client(events),
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="hi",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
    )

    updates = _get_task_updates(mock_slack)
    completed = [u for u in updates if u["status"] == "complete"]
    assert len(completed) == 1
    assert completed[0]["details"] == "Searching for k8s docs"


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
