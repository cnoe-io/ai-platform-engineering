"""Tests for error recovery functionality using the SSE path."""

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


class TestErrorRecovery:
    """Test error recovery with SSE streaming."""

    def test_retry_triggered_on_error_with_no_content(self, mocker):
        """When SSE stream returns only an error event (no content), should return retry_needed."""
        events = [
            SSEEvent(type=SSEEventType.RUN_ERROR, message="Agent execution failed"),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()

        result = stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C123",
            thread_ts="123.456",
            message_text="test",
            team_id="T123",
            user_id="U123",
        )

        # Should return retry marker
        assert isinstance(result, dict)
        assert result.get("retry_needed") is True
        assert "error" in result

    def test_no_retry_when_content_exists(self, mocker):
        """When stream has content, return blocks even if an error also occurred."""
        events = [
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Here is my answer"),
            SSEEvent(type=SSEEventType.RUN_ERROR, message="non-fatal warning"),
            SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()
        mock_session = Mock()
        mock_session.get_trace_id = Mock(return_value=None)

        result = stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C123",
            thread_ts="123.456",
            message_text="test",
            team_id="T123",
            user_id="U123",
            session_manager=mock_session,
        )

        # Should NOT return retry_needed — we got content
        assert not isinstance(result, dict) or not result.get("retry_needed")

    def test_footer_includes_attribution_and_additional_text(self, mocker):
        """Footer should include user attribution and additional text when provided."""
        events = [
            SSEEvent(type=SSEEventType.TEXT_MESSAGE_CONTENT, delta="Response text"),
            SSEEvent(type=SSEEventType.RUN_FINISHED, run_id="run-1"),
        ]
        mock_sse = _mock_sse_client(events)
        mock_slack = _mock_slack()

        result = stream_sse_response(
            sse_client=mock_sse,
            slack_client=mock_slack,
            channel_id="C123",
            thread_ts="123.456",
            message_text="test",
            team_id="T123",
            user_id="U123",
            triggered_by_user_id="U67890",
            additional_footer="Retried after error",
        )

        # result is the list of blocks passed to stopStream
        assert result is not None
        # Find the context block (footer)
        footer_block = next(
            (b for b in result if b.get("type") == "context"), None
        )
        assert footer_block is not None
        footer_text = footer_block["elements"][0]["text"]
        assert "<@U67890>" in footer_text
        assert "Requested by" in footer_text
        assert "Retried after error" in footer_text
        assert "Mention @" in footer_text  # "Mention @{APP_NAME} to continue"
