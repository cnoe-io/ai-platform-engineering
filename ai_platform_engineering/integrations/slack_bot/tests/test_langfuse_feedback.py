"""
Tests for Langfuse feedback integration.

Tests the feedback client and scoring utility end-to-end.
"""

from unittest.mock import MagicMock, patch
from ai_platform_engineering.integrations.slack_bot.utils.langfuse_client import FeedbackClient
from ai_platform_engineering.integrations.slack_bot.utils.scoring import submit_feedback_score
from ai_platform_engineering.integrations.slack_bot.utils.session_manager import SessionManager, InMemorySessionStore


class TestFeedbackClient:
    """Tests for FeedbackClient class."""

    @patch("ai_platform_engineering.integrations.slack_bot.utils.langfuse_client.Langfuse")
    def test_initialization(self, mock_langfuse_class, monkeypatch):
        """Test FeedbackClient initialization with environment variables."""
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk_test")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk_test")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.test")

        FeedbackClient()

        mock_langfuse_class.assert_called_once_with(
            public_key="pk_test", secret_key="sk_test", host="https://langfuse.test"
        )

    @patch("ai_platform_engineering.integrations.slack_bot.utils.langfuse_client.Langfuse")
    def test_submit_feedback_success(self, mock_langfuse_class, monkeypatch):
        """Test successful feedback submission."""
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk_test")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk_test")

        mock_langfuse_instance = MagicMock()
        mock_langfuse_class.return_value = mock_langfuse_instance

        client = FeedbackClient()
        result = client.submit_feedback(
            trace_id="trace_123",
            score_name="test_score",
            value="thumbs_up",
            user_id="U123",
            user_email="test@example.com",
            session_id="session_456",
            channel_id="C123",
            channel_name="#test-channel",
            slack_permalink="https://slack.test/archives/C123/p123456",
        )

        assert result is True
        mock_langfuse_instance.create_score.assert_called_once()
        call_args = mock_langfuse_instance.create_score.call_args[1]
        assert call_args["trace_id"] == "trace_123"
        assert call_args["name"] == "test_score"
        assert call_args["value"] == "thumbs_up"
        assert call_args["data_type"] == "CATEGORICAL"
        assert call_args["metadata"]["user_id"] == "U123"
        assert call_args["metadata"]["user_email"] == "test@example.com"
        assert call_args["metadata"]["channel_name"] == "#test-channel"
        mock_langfuse_instance.flush.assert_called_once()

    @patch("ai_platform_engineering.integrations.slack_bot.utils.langfuse_client.Langfuse")
    def test_submit_feedback_with_comment(self, mock_langfuse_class, monkeypatch):
        """Test feedback submission with comment."""
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk_test")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk_test")

        mock_langfuse_instance = MagicMock()
        mock_langfuse_class.return_value = mock_langfuse_instance

        client = FeedbackClient()
        result = client.submit_feedback(
            trace_id="trace_123",
            score_name="test_score",
            value="wrong_answer",
            comment="This answer was incorrect because...",
        )

        assert result is True
        call_args = mock_langfuse_instance.create_score.call_args[1]
        assert call_args["comment"] == "This answer was incorrect because..."

    @patch("ai_platform_engineering.integrations.slack_bot.utils.langfuse_client.Langfuse")
    def test_submit_feedback_handles_exception(self, mock_langfuse_class, monkeypatch):
        """Test feedback submission handles exceptions gracefully."""
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk_test")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk_test")

        mock_langfuse_instance = MagicMock()
        mock_langfuse_instance.create_score.side_effect = Exception("API error")
        mock_langfuse_class.return_value = mock_langfuse_instance

        client = FeedbackClient()
        result = client.submit_feedback(trace_id="trace_123", score_name="test_score", value="test")

        assert result is False


class TestScoringUtility:
    """Tests for submit_feedback_score utility function."""

    def test_submit_dual_scores(self):
        """Test that submit_feedback_score creates two scores."""
        # Setup mocks
        mock_client = MagicMock()
        mock_client.submit_feedback.return_value = True

        mock_slack_client = MagicMock()
        mock_slack_client.users_info.return_value = {
            "user": {"profile": {"email": "test@example.com"}}
        }

        session_manager = SessionManager(InMemorySessionStore())
        session_manager.set_trace_id("thread_123", "trace_456")
        session_manager.set_context_id("thread_123", "context_789")

        mock_channel_config = MagicMock()
        mock_channel_config.name = "#test-channel"
        mock_config = MagicMock()
        mock_config.channels = {"C123": mock_channel_config}

        # Call the function
        result = submit_feedback_score(
            thread_ts="thread_123",
            user_id="U123",
            channel_id="C123",
            feedback_value="thumbs_up",
            slack_client=mock_slack_client,
            session_manager=session_manager,
            config=mock_config,
            feedback_client=mock_client,
        )

        # Verify two scores were submitted
        assert result is True
        assert mock_client.submit_feedback.call_count == 2

        # Check first score (channel-specific)
        first_call = mock_client.submit_feedback.call_args_list[0][1]
        assert first_call["score_name"] == "#test-channel"
        assert first_call["value"] == "thumbs_up"
        assert first_call["trace_id"] == "trace_456"

        # Check second score (aggregate)
        second_call = mock_client.submit_feedback.call_args_list[1][1]
        assert second_call["score_name"] == "all slack channels"
        assert second_call["value"] == "thumbs_up"
        assert second_call["trace_id"] == "trace_456"

    def test_submit_feedback_no_trace_id(self):
        """Test submit_feedback_score returns False when trace_id is missing."""
        mock_client = MagicMock()

        session_manager = SessionManager(InMemorySessionStore())
        # Don't set trace_id

        result = submit_feedback_score(
            thread_ts="thread_123",
            user_id="U123",
            channel_id="C123",
            feedback_value="thumbs_up",
            slack_client=MagicMock(),
            session_manager=session_manager,
            config=MagicMock(),
            feedback_client=mock_client,
        )

        assert result is False
        mock_client.submit_feedback.assert_not_called()
