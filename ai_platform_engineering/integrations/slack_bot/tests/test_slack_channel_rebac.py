"""Tests for Slack channel ReBAC enforcement (channel grant only)."""

from __future__ import annotations

from ai_platform_engineering.integrations.slack_bot.utils.slack_rebac import (
    SlackChannelRebacDecision,
    SlackChannelRebacEvaluator,
)


def test_channel_grant_check_posts_correct_payload(monkeypatch) -> None:
    """check_channel_grant posts to the right BFF path with the agent resource and OBO token."""
    calls: list[tuple[str, dict[str, object], str]] = []

    def fake_post(path: str, payload: dict[str, object], token: str) -> SlackChannelRebacDecision:
        calls.append((path, payload, token))
        return SlackChannelRebacDecision(
            allowed=True,
            channel_allowed=True,
            reason="allowed",
        )

    evaluator = SlackChannelRebacEvaluator(base_url="http://caipe-ui", post_check=fake_post)

    decision = evaluator.check_channel_grant(
        workspace_id="T123456789",
        channel_id="C123456789",
        agent_id="incident-agent",
        obo_token="obo-token",
    )

    assert decision.channel_allowed is True
    assert calls == [
        (
            "/api/integrations/slack/channels/T123456789/C123456789/access-check",
            {
                "resource": {"type": "agent", "id": "incident-agent"},
                "action": "use",
            },
            "obo-token",
        )
    ]


def test_channel_grant_check_denies_when_channel_grant_missing() -> None:
    def fake_post(_path: str, _payload: dict[str, object], _token: str) -> SlackChannelRebacDecision:
        return SlackChannelRebacDecision(
            allowed=False,
            channel_allowed=False,
            reason="missing_channel_grant",
        )

    evaluator = SlackChannelRebacEvaluator(base_url="http://caipe-ui", post_check=fake_post)

    decision = evaluator.check_channel_grant(
        workspace_id="T123456789",
        channel_id="C123456789",
        agent_id="incident-agent",
        obo_token="obo-token",
    )

    assert decision.channel_allowed is False
    assert decision.reason == "missing_channel_grant"


def test_channel_grant_check_allows_when_channel_grant_exists() -> None:
    def fake_post(_path: str, _payload: dict[str, object], _token: str) -> SlackChannelRebacDecision:
        return SlackChannelRebacDecision(
            allowed=True,
            channel_allowed=True,
            reason="allowed",
        )

    evaluator = SlackChannelRebacEvaluator(base_url="http://caipe-ui", post_check=fake_post)

    decision = evaluator.check_channel_grant(
        workspace_id="T123456789",
        channel_id="C123456789",
        agent_id="incident-agent",
        obo_token="obo-token",
    )

    assert decision.channel_allowed is True
    assert decision.reason == "allowed"
