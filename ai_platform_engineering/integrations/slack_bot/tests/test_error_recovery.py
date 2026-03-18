"""Tests for error recovery functionality."""

from unittest.mock import Mock

from ai_platform_engineering.integrations.slack_bot.utils.ai import stream_a2a_response


class TestErrorRecovery:
    """Test error recovery with fresh context retry."""

    def test_retry_triggered_on_error_with_no_content(self, mocker):
        """When stream returns error + no content, should return retry_needed and clean up."""
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(
            [
                {
                    "kind": "status-update",
                    "status": {"state": "failed", "message": "Agent execution failed"},
                    "taskId": "t1",
                    "contextId": "c1",
                }
            ]
        )
        mock_slack = Mock()
        mock_slack.chat_postMessage.return_value = {"ts": "progress-123"}
        mock_slack.chat_delete.return_value = {}

        # Use bot user_id (B prefix) so fallback progress message is posted and cleaned up.
        # Streaming users (U prefix) use lazy stream start which is never initiated
        # on error-only flows, so there's nothing to clean up.
        result = stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C123",
            thread_ts="123.456",
            message_text="test",
            team_id="T123",
            user_id="B123",
        )

        # Should return retry marker
        assert isinstance(result, dict)
        assert result.get("retry_needed") is True
        assert "error" in result
        # Progress message should be deleted (bot user posts a progress message)
        mock_slack.chat_delete.assert_called_once()

    def test_no_retry_when_content_exists(self, mocker):
        """When stream has content (final_result or partial_result), show it even if error occurred."""
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(
            [
                {"kind": "task", "id": "t1", "contextId": "ctx-123"},
                {
                    "kind": "artifact-update",
                    "artifact": {
                        "name": "final_result",
                        "parts": [{"kind": "text", "text": "Here is my answer"}],
                    },
                },
                {"kind": "status-update", "status": {"state": "failed"}},
            ]
        )
        mock_slack = Mock()
        mock_slack.chat_postMessage.return_value = {"ts": "123"}
        mock_slack.chat_delete.return_value = {}
        mock_session = Mock()

        result = stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C123",
            thread_ts="123.456",
            message_text="test",
            team_id="T123",
            user_id="B123",  # Bot ID forces posting instead of streaming
            context_id=None,
            session_manager=mock_session,
        )

        # Should NOT return retry_needed - we got content
        assert not isinstance(result, dict) or not result.get("retry_needed")
        # Context should still be stored for new conversation
        mock_session.set_context_id.assert_called_once_with("123.456", "ctx-123")

    def test_footer_includes_attribution_and_additional_text(self, mocker):
        """Footer should include user attribution and additional text when provided."""
        mock_a2a = Mock()
        mock_a2a.send_message_stream.return_value = iter(
            [
                {"kind": "task", "id": "t1", "contextId": "ctx-123"},
                {
                    "kind": "artifact-update",
                    "artifact": {
                        "name": "final_result",
                        "parts": [{"kind": "text", "text": "Response text"}],
                    },
                },
            ]
        )
        mock_slack = Mock()
        mock_slack.chat_postMessage.return_value = {"ts": "123"}
        mock_slack.chat_delete.return_value = {}

        result = stream_a2a_response(
            a2a_client=mock_a2a,
            slack_client=mock_slack,
            channel_id="C123",
            thread_ts="123.456",
            message_text="test",
            team_id="T123",
            user_id="B123",  # Bot ID forces posting instead of streaming
            triggered_by_user_id="U67890",
            additional_footer="Retried after error",
        )

        # Check footer in returned blocks
        footer_block = result[-1]
        assert footer_block.get("type") == "context"
        footer_text = footer_block["elements"][0]["text"]
        assert "<@U67890>" in footer_text
        assert "Requested by" in footer_text
        assert "Retried after error" in footer_text
        assert "Mention @" in footer_text  # Mention @{APP_NAME} to continue
