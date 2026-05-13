"""Slack channel ReBAC helpers.

The Slack runtime must satisfy two authorization layers before invoking a
resource: the channel must be allowed to expose the resource, and the user must
also have access to that resource. The BFF owns the policy decision endpoint; the
bot keeps this module small and transport-focused.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Literal, Optional

logger = logging.getLogger("caipe.slack_bot.slack_rebac")

SlackChannelRebacReason = Literal[
    "allowed",
    "missing_channel_grant",
    "missing_user_grant",
    "unsupported_action",
    "pdp_unavailable",
]


@dataclass(frozen=True)
class SlackChannelRebacDecision:
    """Decision returned by the Slack channel ReBAC check."""

    allowed: bool
    channel_allowed: bool
    user_allowed: bool
    reason: SlackChannelRebacReason


PostCheck = Callable[[str, dict[str, object], str], SlackChannelRebacDecision]


def build_team_member_subject(active_team: Optional[str]) -> Optional[str]:
    """Build a Universal ReBAC subject for the active CAIPE team."""

    if not active_team or active_team == "__personal__":
        return None
    return f"team:{active_team}#member"


def _default_base_url() -> str:
    return (
        os.environ.get("SLACK_REBAC_API_URL")
        or os.environ.get("CAIPE_UI_URL")
        or os.environ.get("CAIPE_API_URL")
        or ""
    ).rstrip("/")


def _http_post_check(base_url: str, path: str, payload: dict[str, object], token: str) -> SlackChannelRebacDecision:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}{path}",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "caipe-slack-rebac/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        logger.warning("Slack ReBAC check failed: %s", exc)
        return SlackChannelRebacDecision(
            allowed=False,
            channel_allowed=False,
            user_allowed=False,
            reason="pdp_unavailable",
        )

    result = data.get("data", data) if isinstance(data, dict) else {}
    return SlackChannelRebacDecision(
        allowed=bool(result.get("allowed")),
        channel_allowed=bool(result.get("channel_allowed")),
        user_allowed=bool(result.get("user_allowed")),
        reason=str(result.get("reason") or "pdp_unavailable"),  # type: ignore[arg-type]
    )


class SlackChannelRebacEvaluator:
    """Client for CAIPE Slack channel ReBAC decisions."""

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        post_check: Optional[PostCheck] = None,
    ) -> None:
        self.base_url = (base_url or _default_base_url()).rstrip("/")
        self._post_check = post_check

    def _post(self, path: str, payload: dict[str, object], token: str) -> SlackChannelRebacDecision:
        if self._post_check is not None:
            return self._post_check(path, payload, token)
        if not self.base_url:
            return SlackChannelRebacDecision(
                allowed=False,
                channel_allowed=False,
                user_allowed=False,
                reason="pdp_unavailable",
            )
        return _http_post_check(self.base_url, path, payload, token)

    def check_agent_access(
        self,
        *,
        workspace_id: str,
        channel_id: str,
        agent_id: str,
        active_team: Optional[str],
        obo_token: str,
    ) -> SlackChannelRebacDecision:
        """Check whether a Slack channel and user can use an agent."""

        path = (
            "/api/admin/slack/channels/"
            f"{urllib.parse.quote(workspace_id, safe='')}/"
            f"{urllib.parse.quote(channel_id, safe='')}/access-check"
        )
        payload: dict[str, object] = {
            "resource": {"type": "agent", "id": agent_id},
            "action": "use",
        }
        subject = build_team_member_subject(active_team)
        if subject:
            payload["user_subject"] = subject
        return self._post(path, payload, obo_token)


_default_evaluator: Optional[SlackChannelRebacEvaluator] = None


def get_slack_channel_rebac_evaluator() -> SlackChannelRebacEvaluator:
    """Return the process-wide Slack ReBAC evaluator."""

    global _default_evaluator
    if _default_evaluator is None:
        _default_evaluator = SlackChannelRebacEvaluator()
    return _default_evaluator
