"""Slack channel ReBAC helpers.

The Slack bot enforces one authorization layer before invoking an agent:
  Channel grant: the channel must have the agent explicitly assigned in
  OpenFGA. User-level ``can_use`` is enforced downstream by the API when
  the conversation is created — the bot delegates that gate to avoid
  duplicating policy logic.

The BFF owns the policy decision endpoint. The bot calls the BFF's
``/api/integrations/slack/channels/{workspace}/{channel}/access-check``
endpoint without a ``user_subject`` so only the channel grant is evaluated.
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
    "unsupported_action",
    "pdp_unavailable",
]


@dataclass(frozen=True)
class SlackChannelRebacDecision:
    """Decision returned by the Slack channel ReBAC check."""

    allowed: bool
    channel_allowed: bool
    reason: SlackChannelRebacReason


PostCheck = Callable[[str, dict[str, object], str], SlackChannelRebacDecision]


def is_missing_channel_grant(decision: SlackChannelRebacDecision) -> bool:
    """Return True only when the channel genuinely lacks the agent grant.

    A denied decision (``channel_allowed=False``) can mean either:
      - ``missing_channel_grant`` — an admin-actionable misconfiguration; the
        agent really isn't assigned to this channel.
      - anything else (``pdp_unavailable``, ``unsupported_action``) — a transient
        or non-actionable condition where we could not obtain a real grant answer.

    Callers use this to decide whether to surface the "not assigned — ask an
    admin" message. On a non-actionable denial they should fail open for this
    pre-check: the API's independent gates (``agent#can_use`` at conversation
    creation and ``conversation#write``) still apply downstream, so nothing is
    actually bypassed — we just avoid telling users to chase a config problem
    that may not exist.
    """
    return not decision.channel_allowed and decision.reason == "missing_channel_grant"


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
            reason="pdp_unavailable",
        )

    result = data.get("data", data) if isinstance(data, dict) else {}
    return SlackChannelRebacDecision(
        allowed=bool(result.get("allowed")),
        channel_allowed=bool(result.get("channel_allowed")),
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
                reason="pdp_unavailable",
            )
        return _http_post_check(self.base_url, path, payload, token)

    def check_channel_grant(
        self,
        *,
        workspace_id: str,
        channel_id: str,
        agent_id: str,
        obo_token: Optional[str],
    ) -> SlackChannelRebacDecision:
        """Check whether a channel has this agent explicitly assigned.

        Does not evaluate user-level ``can_use`` — that gate is enforced by
        the API when the conversation is created.
        """
        if not obo_token:
            logger.warning(
                "check_channel_grant: no OBO token available for channel=%s agent=%s",
                channel_id,
                agent_id,
            )
            return SlackChannelRebacDecision(
                allowed=False,
                channel_allowed=False,
                reason="pdp_unavailable",
            )

        path = (
            "/api/integrations/slack/channels/"
            f"{urllib.parse.quote(workspace_id, safe='')}/"
            f"{urllib.parse.quote(channel_id, safe='')}/access-check"
        )
        payload: dict[str, object] = {
            "resource": {"type": "agent", "id": agent_id},
            "action": "use",
        }
        return self._post(path, payload, obo_token)


_default_evaluator: Optional[SlackChannelRebacEvaluator] = None


def get_slack_channel_rebac_evaluator() -> SlackChannelRebacEvaluator:
    """Return the process-wide Slack ReBAC evaluator."""

    global _default_evaluator
    if _default_evaluator is None:
        _default_evaluator = SlackChannelRebacEvaluator()
    return _default_evaluator
