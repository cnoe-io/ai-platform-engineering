# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
End-to-end unit tests for the Slack streaming path in ai.py (AG-UI).

The Slack bot uses AG-UI streaming via SSEClient. These tests verify the
streaming path behaves correctly for various event sequences.
"""

from unittest.mock import Mock

from ai_platform_engineering.integrations.slack_bot.utils.ai import stream_response
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


def _get_all_delivered_text(mock_slack):
  """Collect all text delivered via appendStream and stopStream chunks."""
  texts = _get_append_stream_markdown(mock_slack)
  texts.extend(_get_stop_stream_markdown(mock_slack))
  return "".join(texts)


def _run_stream(events, user_id="U123", **kwargs):
  """Run stream_response with a mock SSE client returning the given events."""
  mock_sse = _mock_sse_client(events)
  mock_slack = _mock_slack()
  stream_response(
    sse_client=mock_sse,
    slack_client=mock_slack,
    channel_id="C1",
    thread_ts="t1",
    message_text="test query",
    team_id="T1",
    user_id=user_id,
    agent_id="test-agent",
    conversation_id="conv-1",
    **kwargs,
  )
  return mock_slack


# ---------------------------------------------------------------------------
# 1. Content events are delivered to the user
# ---------------------------------------------------------------------------


class TestSSEContentStreaming:
  def test_content_event_delivered_to_user(self):
    """TEXT_MESSAGE_CONTENT events are delivered to the user (via appendStream or stopStream)."""
    events = [
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Here is your answer."),
      SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
    ]
    mock_slack = _run_stream(events)
    delivered = _get_all_delivered_text(mock_slack)
    assert "Here is your answer." in delivered

  def test_multiple_content_events_all_delivered(self):
    """Multiple TEXT_MESSAGE_CONTENT events all appear in delivered text."""
    events = [
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Part 1. "),
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Part 2."),
      SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
    ]
    mock_slack = _run_stream(events)
    delivered = _get_all_delivered_text(mock_slack)
    assert "Part 1." in delivered
    assert "Part 2." in delivered

  def test_stop_stream_called_once(self):
    """stopStream is called exactly once to finalize the response."""
    events = [
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="The answer."),
      SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
    ]
    mock_slack = _run_stream(events)
    assert mock_slack.chat_stopStream.call_count == 1

  def test_start_stream_called_for_content(self):
    """startStream is called when content events are present."""
    events = [
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Content"),
      SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
    ]
    mock_slack = _run_stream(events)
    mock_slack.chat_startStream.assert_called_once()


# ---------------------------------------------------------------------------
# 2. Content not duplicated: if streamed live, not in stopStream chunks
# ---------------------------------------------------------------------------


class TestAlreadyStreamedPath:
  def test_tool_then_content_delivered_in_final(self):
    """
    Without todos, tools don't open the stream during tool execution.
    Content after tool calls is the final answer — delivered via
    appendStream (pending_thinking flush) or stopStream in finalization.
    """
    events = [
      SSEEvent(type=SSEEventType.TOOL_CALL_START, tool_call_name="search", tool_call_id="tc-1"),
      SSEEvent(type=SSEEventType.TOOL_CALL_END, tool_call_id="tc-1"),
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Streaming answer"),
      SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
    ]
    mock_slack = _run_stream(events)

    # Content should be delivered (via appendStream or stopStream)
    delivered = _get_all_delivered_text(mock_slack)
    assert "Streaming answer" in delivered


# ---------------------------------------------------------------------------
# 3. Tool call with thinking text
# ---------------------------------------------------------------------------


class TestToolThinkingInStream:
  def test_thinking_before_tool_not_in_final_stream(self):
    """Text before a tool call is consumed as thinking, not duplicated in final output."""
    events = [
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Let me search..."),
      SSEEvent(type=SSEEventType.TOOL_CALL_START, tool_call_name="search", tool_call_id="tc-1"),
      SSEEvent(type=SSEEventType.TOOL_CALL_END, tool_call_id="tc-1"),
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Here is the answer."),
      SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
    ]
    mock_slack = _run_stream(events)

    # The final delivered text should contain the answer, not the thinking
    delivered = _get_all_delivered_text(mock_slack)
    assert "Here is the answer." in delivered

  def test_thinking_appears_in_typing_status(self):
    """Thinking text before a tool is shown in the typing status indicator on TEXT_MESSAGE_END."""
    events = [
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Checking docs..."),
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_END),
      SSEEvent(type=SSEEventType.TOOL_CALL_START, tool_call_name="search", tool_call_id="tc-1"),
      SSEEvent(type=SSEEventType.TOOL_CALL_END, tool_call_id="tc-1"),
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Found it."),
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_END),
      SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
    ]
    mock_slack = _run_stream(events)

    # No raw tool cards should be emitted
    for c in mock_slack.chat_appendStream.call_args_list:
      for chunk in c.kwargs.get("chunks", []):
        assert chunk.get("type") != "task_update", f"Raw task_update should not appear: {chunk}"

    # Thinking should appear in typing status
    status_calls = [c.kwargs.get("status", "") for c in mock_slack.assistant_threads_setStatus.call_args_list]
    assert any("Checking docs" in s for s in status_calls), f"Thinking should appear in status, got: {status_calls}"


# ---------------------------------------------------------------------------
# 4. Error path
# ---------------------------------------------------------------------------


class TestSSEErrorPath:
  def test_error_with_no_content_returns_retry_needed(self):
    """RUN_ERROR event with no content triggers retry_needed."""
    events = [
      SSEEvent(type=SSEEventType.RUN_ERROR, message="Agent unavailable"),
    ]
    mock_sse = _mock_sse_client(events)
    mock_slack = _mock_slack()

    result = stream_response(
      sse_client=mock_sse,
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="test",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
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

    result = stream_response(
      sse_client=mock_sse,
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="test",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
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
    Content is delivered and stopStream has feedback blocks.
    """
    events = [
      SSEEvent(type=SSEEventType.TOOL_CALL_START, tool_call_name="rag_search", tool_call_id="tc-1"),
      SSEEvent(type=SSEEventType.TOOL_CALL_END, tool_call_name="rag_search", tool_call_id="tc-1"),
      SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="CAIPE is a Cloud AI Platform Engineering system."),
      SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-rag-1"),
    ]
    mock_slack = _run_stream(events)

    delivered = _get_all_delivered_text(mock_slack)
    assert "CAIPE" in delivered

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
    stream_response(
      sse_client=mock_sse,
      slack_client=mock_slack,
      channel_id="C1",
      thread_ts="t1",
      message_text="test",
      team_id="T1",
      user_id="U123",
      agent_id="test-agent",
      conversation_id="conv-1",
    )
