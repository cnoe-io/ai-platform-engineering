# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for Webex space ReBAC enforcement."""

from __future__ import annotations

import urllib.error
from unittest.mock import patch

from ai_platform_engineering.integrations.webex_bot.utils.webex_rebac import (
    WebexRebacEvaluator,
    WebexSpaceRebacDecision,
    build_team_member_subject,
)


def test_build_team_member_subject_uses_team_slug() -> None:
    assert build_team_member_subject("platform-engineering") == (
        "team:platform-engineering#member"
    )
    # Empty string and None both mean "no team scope" — DM / unmapped space.
    assert build_team_member_subject("") is None
    assert build_team_member_subject(None) is None


def test_space_agent_check_posts_resource_and_subject() -> None:
    calls: list[tuple[str, dict[str, object], str]] = []

    def fake_post(path: str, payload: dict[str, object], token: str) -> WebexSpaceRebacDecision:
        calls.append((path, payload, token))
        return WebexSpaceRebacDecision(
            allowed=True,
            space_allowed=True,
            user_allowed=True,
            reason="allowed",
        )

    evaluator = WebexRebacEvaluator(base_url="http://caipe-ui", post_check=fake_post)
    decision = evaluator.check_agent_access(
        workspace_id="CAIPE-WEBEX",
        space_id="space-abc",
        agent_id="incident-agent",
        team_slug="platform-engineering",
        obo_token="obo-token",
    )

    assert decision.allowed is True
    assert calls == [
        (
            "/api/integrations/webex/spaces/CAIPE-WEBEX/space-abc/access-check",
            {
                "user_subject": "team:platform-engineering#member",
                "resource": {"type": "agent", "id": "incident-agent"},
                "action": "use",
            },
            "obo-token",
        )
    ]


def test_space_agent_check_denies_when_space_grant_missing() -> None:
    def fake_post(_path: str, _payload: dict[str, object], _token: str) -> WebexSpaceRebacDecision:
        return WebexSpaceRebacDecision(
            allowed=False,
            space_allowed=False,
            user_allowed=False,
            reason="missing_space_grant",
        )

    evaluator = WebexRebacEvaluator(base_url="http://caipe-ui", post_check=fake_post)
    decision = evaluator.check_agent_access(
        workspace_id="CAIPE-WEBEX",
        space_id="space-abc",
        agent_id="incident-agent",
        team_slug="platform-engineering",
        obo_token="obo-token",
    )

    assert decision.allowed is False
    assert decision.reason == "missing_space_grant"


def test_space_agent_check_fail_closed_on_http_failure() -> None:
    evaluator = WebexRebacEvaluator(base_url="http://caipe-ui")

    with patch(
        "ai_platform_engineering.integrations.webex_bot.utils.webex_rebac.urllib.request.urlopen",
        side_effect=urllib.error.URLError("connection refused"),
    ):
        decision = evaluator.check_agent_access(
            workspace_id="CAIPE-WEBEX",
            space_id="space-abc",
            agent_id="incident-agent",
            team_slug="platform-engineering",
            obo_token="obo-token",
        )

    assert decision.allowed is False
    assert decision.space_allowed is False
    assert decision.user_allowed is False
    assert decision.reason == "pdp_unavailable"


def test_space_agent_check_fail_closed_when_bff_url_unconfigured() -> None:
    evaluator = WebexRebacEvaluator(base_url="")
    decision = evaluator.check_agent_access(
        workspace_id="CAIPE-WEBEX",
        space_id="space-abc",
        agent_id="incident-agent",
        team_slug="platform-engineering",
        obo_token="obo-token",
    )
    assert decision.allowed is False
    assert decision.reason == "pdp_unavailable"
