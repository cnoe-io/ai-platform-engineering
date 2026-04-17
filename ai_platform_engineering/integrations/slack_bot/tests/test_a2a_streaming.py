"""
Tests for A2A streaming response collection using real captured A2A event streams.

These tests replay raw A2A events through the event parser and content extraction
logic to verify we correctly handle real server responses.
"""

import json
import os

from ai_platform_engineering.integrations.slack_bot.utils.event_parser import parse_event, EventType
from ai_platform_engineering.integrations.slack_bot.utils.ai import _get_final_text

TEST_DATA_DIR = os.path.join(os.path.dirname(__file__), "test_data")


def load_raw_events(name):
    with open(os.path.join(TEST_DATA_DIR, name)) as f:
        data = json.load(f)
    return [e["raw"] for e in data["events"]]


def collect_content_from_events(raw_events):
    """
    Replay raw A2A events through the same collection logic as stream_a2a_response.
    Returns the same state variables that get passed to _get_final_text.
    """
    final_message_text = None
    final_result_text = None
    partial_result_text = None
    last_artifacts = []

    for event_data in raw_events:
        parsed = parse_event(event_data)

        if parsed.event_type == EventType.MESSAGE:
            if parsed.text_content:
                final_message_text = parsed.text_content

        elif parsed.event_type == EventType.FINAL_RESULT:
            if parsed.text_content:
                final_result_text = parsed.text_content

        elif parsed.event_type == EventType.PARTIAL_RESULT:
            if parsed.text_content:
                partial_result_text = parsed.text_content

        elif parsed.event_type == EventType.OTHER_ARTIFACT:
            if parsed.artifact:
                artifact_name = parsed.artifact.get("name", "").lower()
                skip_patterns = [
                    "tool_notification_start",
                    "tool_notification_end",
                    "execution_plan_update",
                    "execution_plan_status_update",
                ]
                should_skip = any(p in artifact_name for p in skip_patterns)
                if not should_skip:
                    last_artifacts.append(parsed.artifact)

    return final_result_text, partial_result_text, final_message_text, last_artifacts


class TestA2AStreamingCollection:
    """Tests that replay real A2A event streams to verify content extraction."""

    def test_heavy_search_extracts_final_result(self):
        """
        Normal flow with multiple tool calls should extract final_result as the response.
        """
        raw_events = load_raw_events("a2a_heavy_search.json")

        final_result_text, partial_result_text, final_message_text, last_artifacts = (
            collect_content_from_events(raw_events)
        )

        final_text = _get_final_text(
            final_result_text,
            partial_result_text,
            final_message_text,
            last_artifacts,
            "test-thread",
        )

        assert final_result_text is not None, "Should have captured final_result_text"
        assert "Vault" in final_text, "Response should contain expected content about Vault"
        assert final_text != "Oops, something went wrong :(."

    def test_jira_ticket_creation_extracts_complete_result(self):
        """
        When CAIPE returns complete_result without final_result (supervisor bug),
        the bot should still extract the subagent response via artifact fallback.
        """
        raw_events = load_raw_events("a2a_jira_ticket_creation.json")

        final_result_text, partial_result_text, final_message_text, last_artifacts = (
            collect_content_from_events(raw_events)
        )

        final_text = _get_final_text(
            final_result_text,
            partial_result_text,
            final_message_text,
            last_artifacts,
            "test-thread",
        )

        assert final_result_text is None, "This fixture should not have a final_result"
        assert len(last_artifacts) > 0, "Should have collected complete_result as an artifact"
        assert "TEST-1234" in final_text, "Response should contain the Jira ticket ID"
        assert final_text != "Oops, something went wrong :(."
