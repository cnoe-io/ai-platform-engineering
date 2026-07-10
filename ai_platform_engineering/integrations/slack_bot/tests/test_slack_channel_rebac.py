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


def test_check_channel_grant_pdp_unavailable_when_no_obo_token() -> None:
    """check_channel_grant fails closed with pdp_unavailable when there's no OBO token.

    Regression test: the fallback branch used to construct
    SlackChannelRebacDecision(..., user_allowed=False), which crashed with a
    TypeError since that field was removed from the dataclass.
    """
    evaluator = SlackChannelRebacEvaluator(base_url="http://caipe-ui")

    decision = evaluator.check_channel_grant(
        workspace_id="T123456789",
        channel_id="C123456789",
        agent_id="incident-agent",
        obo_token=None,
    )

    assert decision.allowed is False
    assert decision.channel_allowed is False
    assert decision.reason == "pdp_unavailable"


def test_post_pdp_unavailable_when_no_base_url_and_no_post_check(monkeypatch) -> None:
    """_post fails closed with pdp_unavailable when no base_url and no post_check are configured.

    Regression test: the fallback branch used to construct
    SlackChannelRebacDecision(..., user_allowed=False), which crashed with a
    TypeError since that field was removed from the dataclass.
    """
    monkeypatch.delenv("SLACK_REBAC_API_URL", raising=False)
    monkeypatch.delenv("CAIPE_UI_URL", raising=False)
    monkeypatch.delenv("CAIPE_API_URL", raising=False)

    evaluator = SlackChannelRebacEvaluator(base_url="")

    decision = evaluator._post(
        "/api/integrations/slack/channels/T123456789/C123456789/access-check",
        {"resource": {"type": "agent", "id": "incident-agent"}, "action": "use"},
        "obo-token",
    )

    assert decision.allowed is False
    assert decision.channel_allowed is False
    assert decision.reason == "pdp_unavailable"
