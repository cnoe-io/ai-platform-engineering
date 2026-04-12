"""
Tests for feedback scoring via the unified /api/feedback endpoint.
"""

from unittest.mock import MagicMock, patch
from ai_platform_engineering.integrations.slack_bot.utils.scoring import submit_feedback_score
from ai_platform_engineering.integrations.slack_bot.utils.session_manager import SessionManager, InMemorySessionStore


class TestScoringUtility:
    """Tests for submit_feedback_score calling the unified /api/feedback endpoint."""

    def _make_session_manager(self, thread_ts="thread_123", trace_id="trace_456", context_id="context_789"):
        sm = SessionManager(InMemorySessionStore())
        sm.set_trace_id(thread_ts, trace_id)
        sm.set_context_id(thread_ts, context_id)
        return sm

    def _make_slack_client(self, email="test@example.com"):
        mock = MagicMock()
        mock.users_info.return_value = {"user": {"profile": {"email": email}}}
        return mock

    def _make_config(self, channel_id="C123", channel_name="#test-channel"):
        mock_channel_config = MagicMock()
        mock_channel_config.name = channel_name
        mock_config = MagicMock()
        mock_config.channels = {channel_id: mock_channel_config}
        return mock_config

    @patch("ai_platform_engineering.integrations.slack_bot.utils.scoring.requests.post")
    def test_calls_feedback_api(self, mock_post, monkeypatch):
        """Test that submit_feedback_score calls POST /api/feedback."""
        monkeypatch.setenv("CAIPE_UI_URL", "http://ui:3000")
        monkeypatch.setenv("SLACK_WORKSPACE_URL", "https://slack.test")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"success": True}
        mock_post.return_value = mock_response

        result = submit_feedback_score(
            thread_ts="thread_123",
            user_id="U123",
            channel_id="C123",
            feedback_value="thumbs_up",
            slack_client=self._make_slack_client(),
            session_manager=self._make_session_manager(),
            config=self._make_config(),
        )

        assert result is True
        mock_post.assert_called_once()
        url, kwargs = mock_post.call_args[0][0], mock_post.call_args[1]
        assert url == "http://ui:3000/api/feedback"

        payload = kwargs["json"]
        assert payload["source"] == "slack"
        assert payload["feedbackType"] == "like"
        assert payload["value"] == "thumbs_up"
        assert payload["traceId"] == "trace_456"
        assert payload["conversationId"] == "context_789"
        assert payload["channelId"] == "C123"
        assert payload["channelName"] == "#test-channel"
        assert payload["threadTs"] == "thread_123"
        assert payload["userId"] == "U123"

    @patch("ai_platform_engineering.integrations.slack_bot.utils.scoring.requests.post")
    def test_permalink_links_to_message(self, mock_post, monkeypatch):
        """Test that permalink deep-links to the bot reply, not the thread."""
        monkeypatch.setenv("CAIPE_UI_URL", "http://ui:3000")
        monkeypatch.setenv("SLACK_WORKSPACE_URL", "https://slack.test")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"success": True}
        mock_post.return_value = mock_response

        submit_feedback_score(
            thread_ts="1775145001.897279",
            user_id="U123",
            channel_id="C02AVQ61E3H",
            feedback_value="thumbs_down",
            slack_client=self._make_slack_client(),
            session_manager=self._make_session_manager(thread_ts="1775145001.897279"),
            config=self._make_config(channel_id="C02AVQ61E3H"),
            message_ts="1775145010.565959",
        )

        payload = mock_post.call_args[1]["json"]
        assert payload["slackPermalink"] == (
            "https://slack.test/archives/C02AVQ61E3H"
            "/p1775145010565959?thread_ts=1775145001.897279&cid=C02AVQ61E3H"
        )
        assert payload["messageId"] == "1775145010.565959"

    @patch("ai_platform_engineering.integrations.slack_bot.utils.scoring.requests.post")
    def test_invalid_message_ts_falls_back_to_thread(self, mock_post, monkeypatch):
        """Test that non-timestamp message_ts (e.g. 'wrong_answer') is ignored."""
        monkeypatch.setenv("CAIPE_UI_URL", "http://ui:3000")
        monkeypatch.setenv("SLACK_WORKSPACE_URL", "https://slack.test")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"success": True}
        mock_post.return_value = mock_response

        submit_feedback_score(
            thread_ts="1775145001.897279",
            user_id="U123",
            channel_id="C02AVQ61E3H",
            feedback_value="wrong_answer",
            slack_client=self._make_slack_client(),
            session_manager=self._make_session_manager(thread_ts="1775145001.897279"),
            config=self._make_config(channel_id="C02AVQ61E3H"),
            message_ts="wrong_answer",  # invalid — from old button format
        )

        payload = mock_post.call_args[1]["json"]
        # Should fall back to thread-level permalink
        assert payload["slackPermalink"] == (
            "https://slack.test/archives/C02AVQ61E3H/p1775145001897279"
        )
        assert payload["messageId"] is None

    @patch("ai_platform_engineering.integrations.slack_bot.utils.scoring.requests.post")
    def test_api_failure_returns_false(self, mock_post, monkeypatch):
        """Test that API errors are handled gracefully."""
        monkeypatch.setenv("CAIPE_UI_URL", "http://ui:3000")
        monkeypatch.setenv("SLACK_WORKSPACE_URL", "")

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        mock_post.return_value = mock_response

        result = submit_feedback_score(
            thread_ts="thread_123",
            user_id="U123",
            channel_id="C123",
            feedback_value="thumbs_up",
            slack_client=self._make_slack_client(),
            session_manager=self._make_session_manager(),
            config=self._make_config(),
        )

        assert result is False

    @patch("ai_platform_engineering.integrations.slack_bot.utils.scoring.requests.post")
    def test_network_error_returns_false(self, mock_post, monkeypatch):
        """Test that network failures are handled gracefully."""
        monkeypatch.setenv("CAIPE_UI_URL", "http://ui:3000")

        mock_post.side_effect = Exception("Connection refused")

        result = submit_feedback_score(
            thread_ts="thread_123",
            user_id="U123",
            channel_id="C123",
            feedback_value="thumbs_up",
            slack_client=self._make_slack_client(),
            session_manager=self._make_session_manager(),
            config=self._make_config(),
        )

        assert result is False

    @patch("ai_platform_engineering.integrations.slack_bot.utils.scoring.requests.post")
    def test_dislike_feedback_type(self, mock_post, monkeypatch):
        """Test that non-thumbs_up values map to feedbackType='dislike'."""
        monkeypatch.setenv("CAIPE_UI_URL", "http://ui:3000")
        monkeypatch.setenv("SLACK_WORKSPACE_URL", "")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"success": True}
        mock_post.return_value = mock_response

        submit_feedback_score(
            thread_ts="thread_123",
            user_id="U123",
            channel_id="C123",
            feedback_value="wrong_answer",
            slack_client=self._make_slack_client(),
            session_manager=self._make_session_manager(),
            config=self._make_config(),
            comment="The endpoint doesn't exist",
        )

        payload = mock_post.call_args[1]["json"]
        assert payload["feedbackType"] == "dislike"
        assert payload["value"] == "wrong_answer"
        assert payload["reason"] == "The endpoint doesn't exist"

    @patch("ai_platform_engineering.integrations.slack_bot.utils.scoring.requests.post")
    def test_dm_channel_name(self, mock_post, monkeypatch):
        """Test that DM channels get channelName='DM'."""
        monkeypatch.setenv("CAIPE_UI_URL", "http://ui:3000")
        monkeypatch.setenv("SLACK_WORKSPACE_URL", "")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"success": True}
        mock_post.return_value = mock_response

        mock_config = MagicMock()
        mock_config.channels = {}  # DM channels are not in config

        submit_feedback_score(
            thread_ts="thread_123",
            user_id="U123",
            channel_id="D123456",
            feedback_value="thumbs_up",
            slack_client=self._make_slack_client(),
            session_manager=self._make_session_manager(),
            config=mock_config,
        )

        payload = mock_post.call_args[1]["json"]
        assert payload["channelName"] == "DM"
