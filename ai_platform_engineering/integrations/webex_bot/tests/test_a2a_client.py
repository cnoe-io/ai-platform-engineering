"""Unit tests for A2A client."""

from unittest.mock import MagicMock, patch

import pytest

from a2a_client import A2AClient


class TestA2AClientGetHeaders:
    """Tests for A2AClient._get_headers()."""

    def test_returns_x_client_source_webex_bot_by_default(self):
        client = A2AClient(base_url="https://agent.example.com")
        headers = client._get_headers()
        assert headers["X-Client-Source"] == "webex-bot"

    def test_custom_client_source(self):
        client = A2AClient(
            base_url="https://agent.example.com",
            client_source="custom-client",
        )
        headers = client._get_headers()
        assert headers["X-Client-Source"] == "custom-client"

    def test_includes_channel_id_when_provided(self):
        client = A2AClient(
            base_url="https://agent.example.com",
            channel_id="channel-123",
        )
        headers = client._get_headers()
        assert headers["X-Client-Channel"] == "channel-123"

    def test_includes_bearer_token_when_auth_client_provided(self):
        auth_client = MagicMock()
        auth_client.get_access_token.return_value = "token-abc"

        client = A2AClient(
            base_url="https://agent.example.com",
            auth_client=auth_client,
        )
        headers = client._get_headers()
        assert headers["Authorization"] == "Bearer token-abc"
        auth_client.get_access_token.assert_called_once()

    def test_accept_header_default_json(self):
        client = A2AClient(base_url="https://agent.example.com")
        headers = client._get_headers()
        assert headers["Accept"] == "application/json"

    def test_accept_header_can_be_overridden(self):
        client = A2AClient(base_url="https://agent.example.com")
        headers = client._get_headers(accept="text/event-stream")
        assert headers["Accept"] == "text/event-stream"


class TestA2AClientSendMessageStream:
    """Tests for A2AClient.send_message_stream()."""

    @patch("a2a_client.requests.post")
    def test_send_message_stream_basic_sse_parsing(self, mock_post):
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.iter_content = lambda **kwargs: iter([
            'data: {"result": {"kind": "task", "id": "t1"}}\n\n',
        ])
        mock_post.return_value = mock_response

        client = A2AClient(base_url="https://agent.example.com")
        events = list(client.send_message_stream("Hello"))

        assert len(events) == 1
        assert events[0]["kind"] == "task"
        assert events[0]["id"] == "t1"

    @patch("a2a_client.requests.post")
    def test_send_message_stream_yields_multiple_events(self, mock_post):
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.iter_content = lambda **kwargs: iter([
            'data: {"result": {"kind": "task"}}\n\n',
            'data: {"result": {"kind": "artifact-update"}}\n\n',
        ])
        mock_post.return_value = mock_response

        client = A2AClient(base_url="https://agent.example.com")
        events = list(client.send_message_stream("Hello"))

        assert len(events) == 2
        assert events[0]["kind"] == "task"
        assert events[1]["kind"] == "artifact-update"

    @patch("a2a_client.requests.post")
    def test_send_message_stream_uses_headers(self, mock_post):
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.iter_content = lambda **kwargs: iter([])
        mock_post.return_value = mock_response

        client = A2AClient(base_url="https://agent.example.com")
        list(client.send_message_stream("Hello"))

        call_kwargs = mock_post.call_args
        assert call_kwargs.kwargs["headers"]["X-Client-Source"] == "webex-bot"
        assert call_kwargs.kwargs["headers"]["Accept"] == "text/event-stream"

    @patch("a2a_client.requests.post")
    def test_send_message_stream_raises_on_http_error(self, mock_post):
        mock_response = MagicMock()
        mock_response.ok = False
        mock_response.status_code = 500
        mock_response.text = "Internal error"
        mock_response.iter_content = lambda **kwargs: iter([])
        mock_post.return_value = mock_response

        client = A2AClient(base_url="https://agent.example.com")

        with pytest.raises(Exception) as exc_info:
            list(client.send_message_stream("Hello"))

        assert "500" in str(exc_info.value)
