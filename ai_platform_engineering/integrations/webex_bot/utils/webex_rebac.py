"""Webex space ReBAC helpers — calls the CAIPE UI BFF access-check route."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Literal, Optional

logger = logging.getLogger("caipe.webex_bot.webex_rebac")

WebexSpaceRebacReason = Literal[
    "allowed",
    "missing_space_grant",
    "unsupported_resource",
    "unsupported_action",
    "pdp_unavailable",
]

PostCheck = Callable[[str, dict[str, object], str], "WebexSpaceRebacDecision"]


@dataclass(frozen=True)
class WebexSpaceRebacDecision:
    allowed: bool
    space_allowed: bool
    reason: WebexSpaceRebacReason


def _default_base_url() -> str:
    return (
        os.environ.get("WEBEX_REBAC_API_URL")
        or os.environ.get("CAIPE_UI_URL")
        or os.environ.get("CAIPE_API_URL")
        or ""
    ).rstrip("/")


def _http_post_check(
    base_url: str, path: str, payload: dict[str, object], token: str
) -> WebexSpaceRebacDecision:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}{path}",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "caipe-webex-rebac/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        logger.warning("Webex ReBAC check failed: %s", exc)
        return WebexSpaceRebacDecision(
            allowed=False,
            space_allowed=False,
            reason="pdp_unavailable",
        )

    result = data.get("data", data) if isinstance(data, dict) else {}
    reason = str(result.get("reason") or "pdp_unavailable")
    valid_reasons = {
        "allowed",
        "missing_space_grant",
        "unsupported_resource",
        "unsupported_action",
        "pdp_unavailable",
    }
    rebac_reason: WebexSpaceRebacReason = (
        reason if reason in valid_reasons else "pdp_unavailable"  # type: ignore[assignment]
    )
    return WebexSpaceRebacDecision(
        allowed=bool(result.get("allowed")),
        space_allowed=bool(result.get("space_allowed")),
        reason=rebac_reason,
    )


class WebexRebacEvaluator:
    """Client for CAIPE Webex space ReBAC decisions via the UI BFF."""

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        post_check: Optional[PostCheck] = None,
    ) -> None:
        self.base_url = (base_url or _default_base_url()).rstrip("/")
        self._post_check = post_check

    def _post(self, path: str, payload: dict[str, object], token: str) -> WebexSpaceRebacDecision:
        if self._post_check is not None:
            return self._post_check(path, payload, token)
        if not self.base_url:
            return WebexSpaceRebacDecision(
                allowed=False,
                space_allowed=False,
                reason="pdp_unavailable",
            )
        return _http_post_check(self.base_url, path, payload, token)

    def check_space_grant(
        self,
        *,
        workspace_id: str,
        space_id: str,
        agent_id: str,
        obo_token: Optional[str],
    ) -> WebexSpaceRebacDecision:
        """Check whether a Webex space has this agent explicitly assigned.

        User-level ``can_use`` is enforced downstream by ``POST /api/chat/conversations``.
        """
        if not obo_token:
            return WebexSpaceRebacDecision(
                allowed=False,
                space_allowed=False,
                reason="pdp_unavailable",
            )
        path = (
            "/api/integrations/webex/spaces/"
            f"{urllib.parse.quote(workspace_id, safe='')}/"
            f"{urllib.parse.quote(space_id, safe='')}/access-check"
        )
        payload: dict[str, object] = {
            "resource": {"type": "agent", "id": agent_id},
            "action": "use",
        }
        return self._post(path, payload, obo_token)


_default_evaluator: Optional[WebexRebacEvaluator] = None


def get_webex_rebac_evaluator() -> WebexRebacEvaluator:
    global _default_evaluator
    if _default_evaluator is None:
        _default_evaluator = WebexRebacEvaluator()
    return _default_evaluator
