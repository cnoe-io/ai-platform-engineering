# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for utility functions and AI alert processing.

These are integration tests that require a running CAIPE supervisor.
Run with: pytest -m integration
"""

import os

import pytest

from ai_platform_engineering.integrations.slack_bot.utils import ai


@pytest.mark.integration
class TestOverthinkIntegration:
    """
    Integration tests for overthink mode that call the actual CAIPE API.
    These tests verify that CAIPE returns the expected markers for different message types.
    """

    @staticmethod
    def get_overthink_prompt():
        from ai_platform_engineering.integrations.slack_bot.utils.config_models import GlobalDefaults

        return GlobalDefaults().overthink_qanda_prompt

    def test_overthink_returns_defer_for_mr_approval_request(self, mocker):
        """
        Test that overthink mode returns [DEFER] for MR approval requests.
        This calls the real CAIPE API with a human action request.
        """
        from ai_platform_engineering.integrations.slack_bot.a2a_client import A2AClient
        from ai_platform_engineering.integrations.slack_bot.utils.event_parser import parse_event, EventType

        # Create a real A2A client
        caipe_url = os.getenv("CAIPE_URL", "http://localhost:8000")
        a2a_client = A2AClient(caipe_url, timeout=120)

        # MR approval request - should trigger [DEFER]
        user_message = "Hey! Need approvals/review on mr: https://git.example.com/org/repo/-/merge_requests/8408"
        prompt = self.get_overthink_prompt().format(message_text=user_message)

        # Collect the response
        final_text = None
        for event_data in a2a_client.send_message_stream(
            message_text=prompt,
            context_id=None,
            metadata={},
        ):
            parsed = parse_event(event_data)
            if parsed.event_type == EventType.FINAL_RESULT and parsed.text_content:
                final_text = parsed.text_content
            elif parsed.event_type == EventType.PARTIAL_RESULT and parsed.text_content:
                if not final_text:
                    final_text = parsed.text_content

        print("\n" + "=" * 80)
        print("CAIPE response for MR approval request (expecting [DEFER]):")
        print("=" * 80)
        print(final_text)
        print("=" * 80 + "\n")

        assert final_text is not None, "Should receive a response from CAIPE"
        assert "[DEFER]" in final_text, f"Expected [DEFER] in response but got: {final_text[:200]}"

    def test_overthink_returns_low_confidence_for_obscure_question(self, mocker):
        """
        Test that overthink mode returns [LOW_CONFIDENCE] for questions without good sources.
        This calls the real CAIPE API with an obscure technical question.
        """
        from ai_platform_engineering.integrations.slack_bot.a2a_client import A2AClient
        from ai_platform_engineering.integrations.slack_bot.utils.event_parser import parse_event, EventType

        # Create a real A2A client
        caipe_url = os.getenv("CAIPE_URL", "http://localhost:8000")
        a2a_client = A2AClient(caipe_url, timeout=120)

        # Obscure technical question - unlikely to have direct sources
        user_message = "How do I enable blue-green deployments with automatic rollback for our Kafka consumers in the production cluster? We're seeing issues with consumer lag during deployments."
        prompt = self.get_overthink_prompt().format(message_text=user_message)

        # Collect the response
        final_text = None
        for event_data in a2a_client.send_message_stream(
            message_text=prompt,
            context_id=None,
            metadata={},
        ):
            parsed = parse_event(event_data)
            if parsed.event_type == EventType.FINAL_RESULT and parsed.text_content:
                final_text = parsed.text_content
            elif parsed.event_type == EventType.PARTIAL_RESULT and parsed.text_content:
                if not final_text:
                    final_text = parsed.text_content

        print("\n" + "=" * 80)
        print("CAIPE response for obscure question (expecting [LOW_CONFIDENCE]):")
        print(final_text)

        assert final_text is not None, "Should receive a response from CAIPE"
        assert (
            "[LOW_CONFIDENCE]" in final_text
        ), f"Expected [LOW_CONFIDENCE] in response but got: {final_text[:200]}"

    def test_overthink_returns_high_confidence_for_documented_question(self, mocker):
        """
        Test that overthink mode returns a real answer with [CONFIDENCE: HIGH] for questions with sources.
        This calls the real CAIPE API with a question that has documented answers.
        """
        from ai_platform_engineering.integrations.slack_bot.a2a_client import A2AClient
        from ai_platform_engineering.integrations.slack_bot.utils.event_parser import parse_event, EventType

        # Create a real A2A client
        caipe_url = os.getenv("CAIPE_URL", "http://localhost:8000")
        a2a_client = A2AClient(caipe_url, timeout=120)

        # Question about AWS secrets sync - has documented answers in RAG
        user_message = "Hey folks, is there a mechanism to sync an AWS Secret to a K8s secret? E.g. something similar to https://external-secrets.io/latest/"
        prompt = self.get_overthink_prompt().format(message_text=user_message)

        # Collect the response
        final_text = None
        for event_data in a2a_client.send_message_stream(
            message_text=prompt,
            context_id=None,
            metadata={},
        ):
            parsed = parse_event(event_data)
            if parsed.event_type == EventType.FINAL_RESULT and parsed.text_content:
                final_text = parsed.text_content
            elif parsed.event_type == EventType.PARTIAL_RESULT and parsed.text_content:
                if not final_text:
                    final_text = parsed.text_content

        print("\n" + "=" * 80)
        print("CAIPE response for documented question (expecting [CONFIDENCE: HIGH]):")
        print(final_text)

        assert final_text is not None, "Should receive a response from CAIPE"
        assert "[DEFER]" not in final_text, "Technical question should NOT defer"
        assert "[LOW_CONFIDENCE]" not in final_text, "Should have sources for this question"
        assert (
            "[CONFIDENCE: HIGH]" in final_text
        ), f"Expected [CONFIDENCE: HIGH] marker in response but got: {final_text[:200]}"


@pytest.mark.integration
class TestAIAlertProcessing:
    """
    Tests for AI-powered alert processing.
    These tests use the actual AI client but with controlled inputs to avoid creating tickets.
    """

    def test_informational_alert_no_ticket(self, mocker):
        """
        Test that an informational alert (deployment notification) does NOT create a ticket.
        This uses the real AI but the alert content is designed to be informational only.
        """
        from ai_platform_engineering.integrations.slack_bot.a2a_client import A2AClient

        # Create a real A2A client
        caipe_url = os.getenv("CAIPE_URL", "http://localhost:8000")
        a2a_client = A2AClient(caipe_url, timeout=60)

        # Mock Slack client with streaming API
        mock_slack_client = mocker.Mock()
        mock_slack_client.chat_postMessage.return_value = {"ts": "1234567890.123"}
        mock_slack_client.chat_startStream.return_value = {"ts": "1234567890.124"}
        mock_slack_client.chat_appendStream.return_value = {"ok": True}
        mock_slack_client.chat_stopStream.return_value = {"ok": True}
        mock_slack_client.chat_update.return_value = {"ok": True}

        # Create an informational event (deployment notification - should NOT create ticket)
        informational_event = {
            "text": "Deployment completed successfully to production",
            "blocks": [],
            "attachments": [
                {
                    "color": "good",
                    "text": "Build #123 deployed to production at 2024-01-01 12:00:00 UTC",
                    "fields": [
                        {"title": "Environment", "value": "production"},
                        {"title": "Status", "value": "Success"},
                    ],
                }
            ],
            "ts": "1234567890.123",
        }

        channel_config = {
            "project": "TEST",
            "issuetype": {"name": "Bug"},
            "labels": ["test"],
            "components": [{"name": "Test"}],
        }

        # Mock session manager
        mock_session_manager = mocker.Mock()
        mock_session_manager.get_context_id.return_value = None

        # Call the AI alert processing function
        # This will analyze the alert and determine it's informational (no ticket needed)
        ai.handle_ai_alert_processing(
            a2a_client=a2a_client,
            slack_client=mock_slack_client,
            event=informational_event,
            channel_id="C123456",
            bot_username="TestBot",
            channel_config=channel_config,
            session_manager=mock_session_manager,
        )

        # Verify that a response was posted to Slack
        # Note: Without a valid user_id, streaming falls back to chat_postMessage
        assert mock_slack_client.chat_postMessage.called, "Should post a response to Slack"

        # Get the final response content from chat_postMessage calls
        all_response_text = ""
        for call in mock_slack_client.chat_postMessage.call_args_list:
            kwargs = call.kwargs if call.kwargs else {}
            # Get text from blocks or direct text
            blocks = kwargs.get("blocks", [])
            for block in blocks:
                if block.get("type") == "section":
                    text_obj = block.get("text", {})
                    all_response_text += text_obj.get("text", "")
            all_response_text += kwargs.get("text", "")

        response_text = all_response_text.lower()

        # Print the actual AI response for debugging
        print("\n" + "=" * 80)
        print("AI Response for informational alert:")
        print(all_response_text)

        # Verify the AI recognized this as informational
        # It should NOT have created a ticket
        assert any(
            word in response_text
            for word in [
                "informational",
                "no ticket",
                "no action",
                "notification",
                "resolved",
                "success",
            ]
        ), f"AI should recognize this as informational. Response: {response_text[:500]}"

    def test_alert_analysis_format(self, mocker):
        """
        Test that the AI alert processing formats the prompt correctly and gets a response.
        Uses a mock-friendly alert that won't create a ticket but tests the flow.
        """
        from ai_platform_engineering.integrations.slack_bot.a2a_client import A2AClient

        caipe_url = os.getenv("CAIPE_URL", "http://localhost:8000")
        a2a_client = A2AClient(caipe_url, timeout=60)

        # Mock Slack client with streaming API
        mock_slack_client = mocker.Mock()
        mock_slack_client.chat_postMessage.return_value = {"ts": "1234567890.123"}
        mock_slack_client.chat_startStream.return_value = {"ts": "1234567890.124"}
        mock_slack_client.chat_appendStream.return_value = {"ok": True}
        mock_slack_client.chat_stopStream.return_value = {"ok": True}
        mock_slack_client.chat_update.return_value = {"ok": True}

        # Test event - oncall rotation notification (should NOT create ticket)
        test_event = {
            "text": "Oncall rotation: Alice is now on-call for the week of 2024-01-01",
            "blocks": [],
            "attachments": [],
            "ts": "1234567890.123",
        }

        channel_config = {
            "project": "TEST",
            "issuetype": {"name": "Bug"},
            "labels": ["test"],
            "components": [{"name": "Test"}],
        }

        mock_session_manager = mocker.Mock()
        mock_session_manager.get_context_id.return_value = None

        # This should complete without error and post to Slack
        ai.handle_ai_alert_processing(
            a2a_client=a2a_client,
            slack_client=mock_slack_client,
            event=test_event,
            channel_id="C123456",
            bot_username="TestBot",
            channel_config=channel_config,
            session_manager=mock_session_manager,
        )

        # Verify Slack methods were called
        assert (
            mock_slack_client.chat_postMessage.called or mock_slack_client.chat_update.called
        ), "Should post a response to Slack"

        # Print the AI response for debugging
        if mock_slack_client.chat_update.called:
            call_args = mock_slack_client.chat_update.call_args
            if call_args:
                response_blocks = call_args[1].get("blocks", [])
                response_text = str(response_blocks)
                print("\n" + "=" * 80)
                print("AI Response for oncall rotation alert:")
                print(response_text)
