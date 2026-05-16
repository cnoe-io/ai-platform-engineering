"""Tests for Slack channel many-resource ReBAC enforcement."""

from __future__ import annotations

from ai_platform_engineering.integrations.slack_bot.utils.slack_rebac import (
    SlackChannelRebacDecision,
    SlackChannelRebacEvaluator,
    build_team_member_subject,
)


def test_build_team_member_subject_uses_active_team_slug() -> None:
    assert build_team_member_subject("platform-engineering") == "team:platform-engineering#member"
    assert build_team_member_subject("__personal__") is None
    assert build_team_member_subject(None) is None


def test_channel_agent_check_posts_resource_and_subject(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object], str]] = []

    def fake_post(path: str, payload: dict[str, object], token: str) -> SlackChannelRebacDecision:
        calls.append((path, payload, token))
        return SlackChannelRebacDecision(
            allowed=True,
            channel_allowed=True,
            user_allowed=True,
            reason="allowed",
        )

    evaluator = SlackChannelRebacEvaluator(base_url="http://caipe-ui", post_check=fake_post)

    decision = evaluator.check_agent_access(
        workspace_id="T123456789",
        channel_id="C123456789",
        agent_id="incident-agent",
        active_team="platform-engineering",
        obo_token="obo-token",
    )

    assert decision.allowed is True
    assert calls == [
        (
            "/api/admin/slack/channels/T123456789/C123456789/access-check",
            {
                "user_subject": "team:platform-engineering#member",
                "resource": {"type": "agent", "id": "incident-agent"},
                "action": "use",
            },
            "obo-token",
        )
    ]


def test_channel_agent_check_denies_when_channel_grant_missing() -> None:
    def fake_post(_path: str, _payload: dict[str, object], _token: str) -> SlackChannelRebacDecision:
        return SlackChannelRebacDecision(
            allowed=False,
            channel_allowed=False,
            user_allowed=False,
            reason="missing_channel_grant",
        )

    evaluator = SlackChannelRebacEvaluator(base_url="http://caipe-ui", post_check=fake_post)

    decision = evaluator.check_agent_access(
        workspace_id="T123456789",
        channel_id="C123456789",
        agent_id="incident-agent",
        active_team="platform-engineering",
        obo_token="obo-token",
    )

    assert decision.allowed is False
    assert decision.reason == "missing_channel_grant"
