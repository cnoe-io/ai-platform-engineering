# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for a2a_client.py"""

import pytest
from unittest.mock import patch, MagicMock
from ai_platform_engineering.integrations.slack_bot.a2a_client import A2AClient


class TestA2AClient:
    def test_init(self):
        client = A2AClient("http://localhost:8000")
        assert client.base_url == "http://localhost:8000"
        assert client.timeout == 300

    def test_init_strips_trailing_slash(self):
        client = A2AClient("http://localhost:8000/")
        assert client.base_url == "http://localhost:8000"

    def test_headers_include_client_source(self):
        client = A2AClient("http://localhost:8000")
        headers = client._get_headers()
        assert headers["X-Client-Source"] == "slack-bot"

    def test_headers_include_channel_id(self):
        client = A2AClient("http://localhost:8000", channel_id="C12345")
        headers = client._get_headers()
        assert headers["X-Client-Channel"] == "C12345"

    def test_headers_no_channel_when_none(self):
        client = A2AClient("http://localhost:8000")
        headers = client._get_headers()
        assert "X-Client-Channel" not in headers

    @patch("ai_platform_engineering.integrations.slack_bot.a2a_client.requests.get")
    def test_get_agent_card(self, mock_get):
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.json.return_value = {"name": "CAIPE", "version": "1.0"}
        mock_get.return_value = mock_response

        client = A2AClient("http://localhost:8000")
        card = client.get_agent_card()

        assert card["name"] == "CAIPE"
        mock_get.assert_called_once()
        call_kwargs = mock_get.call_args
        assert "X-Client-Source" in call_kwargs.kwargs["headers"]

    @patch("ai_platform_engineering.integrations.slack_bot.a2a_client.requests.get")
    def test_get_agent_card_failure(self, mock_get):
        mock_response = MagicMock()
        mock_response.ok = False
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        mock_get.return_value = mock_response

        client = A2AClient("http://localhost:8000")
        with pytest.raises(Exception, match="Failed to fetch agent card"):
            client.get_agent_card()
