"""Tests for Slack channel ReBAC enforcement (channel grant only)."""

from __future__ import annotations

from ai_platform_engineering.integrations.slack_bot.utils.slack_rebac import (
    SlackChannelRebacDecision,
    SlackChannelRebacEvaluator,
    is_missing_channel_grant,
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


def test_channel_grant_check_without_obo_token_returns_pdp_unavailable() -> None:
    """No OBO token must yield a clean pdp_unavailable decision, not a crash.

    Regression: the no-token branch constructed SlackChannelRebacDecision with a
    ``user_allowed`` kwarg the dataclass does not define, raising TypeError and
    taking down the whole mention handler when the OBO exchange had failed.
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
    # Transient/unknown — NOT missing_channel_grant, so callers won't render the
    # misleading "not assigned — ask an admin" message.
    assert decision.reason == "pdp_unavailable"


def test_channel_grant_check_without_base_url_returns_pdp_unavailable() -> None:
    """No configured base URL must yield pdp_unavailable, not a crash.

    Regression for the same removed ``user_allowed`` kwarg on the no-base-url path.
    """
    evaluator = SlackChannelRebacEvaluator(base_url="")

    decision = evaluator.check_channel_grant(
        workspace_id="T123456789",
        channel_id="C123456789",
        agent_id="incident-agent",
        obo_token="obo-token",
    )

    assert decision.allowed is False
    assert decision.channel_allowed is False
    assert decision.reason == "pdp_unavailable"


def test_is_missing_channel_grant_only_true_for_genuine_grant_miss() -> None:
    """Only a channel_allowed=False + missing_channel_grant decision is admin-actionable.

    This is the guard that stops transient PDP failures from being rendered as
    the "agent not assigned to this channel — ask an admin" message.
    """
    genuine_miss = SlackChannelRebacDecision(
        allowed=False, channel_allowed=False, reason="missing_channel_grant"
    )
    assert is_missing_channel_grant(genuine_miss) is True

    # Transient / non-actionable denials must NOT be treated as a grant miss.
    for reason in ("pdp_unavailable", "unsupported_action"):
        transient = SlackChannelRebacDecision(
            allowed=False, channel_allowed=False, reason=reason  # type: ignore[arg-type]
        )
        assert is_missing_channel_grant(transient) is False, reason

    # An allowed decision is never a grant miss.
    allowed = SlackChannelRebacDecision(allowed=True, channel_allowed=True, reason="allowed")
    assert is_missing_channel_grant(allowed) is False
