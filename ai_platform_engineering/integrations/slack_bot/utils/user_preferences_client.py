"""BFF client for the user-preference (DM default agent) lookup.

Phase 1 of spec 2026-05-24-derive-team-from-channel adds a saved per-user
"default DM agent" picker to the CAIPE UI. The Slack bot reads that
preference *before* dispatching a DM, so the agent the user picked in the
UI is the one their next DM lands on.

Design constraints (FR-019, FR-027, A4):

- The bot does NOT cache preferences across users — it asks the BFF on
  every DM. The cost is one cheap HTTP call against the BFF that already
  enforces tenant scoping and OBO authorization.
- Transient BFF errors MUST NOT break DM dispatch. The bot interprets any
  failure as "no preference, use deployment default."
- The client is intentionally stdlib-only (``urllib``) so we don't add a
  new transitive dependency. The bot already uses ``urllib`` in several
  other utility modules.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Literal, Optional

logger = logging.getLogger("caipe.slack_bot.user_preferences_client")

UserPreferenceSource = Literal["saved", "not_set", "unavailable"]


@dataclass(frozen=True)
class UserPreferenceResult:
    """Outcome of a single BFF lookup.

    ``agent_id`` is the saved DM-default agent (or ``None`` when the user
    has not set one, or when the BFF was unreachable / returned a bad
    response). ``source`` distinguishes the three cases so callers can
    log / metric them separately:

    - ``"saved"``       → BFF returned a valid response; ``agent_id`` may
                          be a string or ``None`` (user explicitly cleared).
    - ``"not_set"``     → BFF returned 404; no preference document exists.
    - ``"unavailable"`` → Network / 5xx / malformed JSON. The caller MUST
                          fall back to the deployment default.
    """

    agent_id: Optional[str]
    source: UserPreferenceSource


def _default_base_url() -> str:
    """Resolve the BFF base URL from the standard CAIPE env vars."""
    return (
        os.environ.get("CAIPE_UI_URL")
        or os.environ.get("CAIPE_API_URL")
        or ""
    ).rstrip("/")


class UserPreferencesClient:
    """Thin wrapper around the BFF ``/api/user/preferences`` endpoint."""

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        timeout_seconds: float = 3.0,
    ) -> None:
        self._base_url = (base_url if base_url is not None else _default_base_url()).rstrip("/")
        self._timeout = max(0.5, timeout_seconds)

    @staticmethod
    def _open(request: urllib.request.Request, *, timeout: float):  # noqa: D401
        """urllib.urlopen wrapper that exists solely as a patch point for tests."""
        return urllib.request.urlopen(request, timeout=timeout)  # noqa: S310 — internal HTTPS endpoint

    def get_dm_default_agent(self, *, bearer_token: str) -> UserPreferenceResult:
        """Fetch the user's saved DM-default agent.

        Returns ``UserPreferenceResult(source="unavailable")`` for any
        failure mode (no base URL, missing token, network error, non-2xx
        / non-404 status, malformed JSON). Callers MUST treat that as
        "fall back to deployment default."
        """
        if not self._base_url or not bearer_token:
            return UserPreferenceResult(agent_id=None, source="unavailable")

        url = f"{self._base_url}/api/user/preferences"
        request = urllib.request.Request(
            url,
            method="GET",
            headers={
                "Authorization": f"Bearer {bearer_token}",
                "Accept": "application/json",
            },
        )

        try:
            with self._open(request, timeout=self._timeout) as response:  # noqa: S310
                status = getattr(response, "status", None) or getattr(response, "code", 0)
                if status == 404:
                    return UserPreferenceResult(agent_id=None, source="not_set")
                if status < 200 or status >= 300:
                    logger.info(
                        "user_preferences BFF returned non-2xx (status=%s)", status
                    )
                    return UserPreferenceResult(agent_id=None, source="unavailable")
                raw = response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return UserPreferenceResult(agent_id=None, source="not_set")
            logger.info("user_preferences BFF HTTPError (status=%s)", exc.code)
            return UserPreferenceResult(agent_id=None, source="unavailable")
        except (OSError, urllib.error.URLError) as exc:
            logger.info(
                "user_preferences BFF unreachable (%s): %s", type(exc).__name__, exc
            )
            return UserPreferenceResult(agent_id=None, source="unavailable")

        try:
            payload = json.loads(raw)
        except (ValueError, TypeError) as exc:
            logger.info("user_preferences BFF returned malformed JSON: %s", exc)
            return UserPreferenceResult(agent_id=None, source="unavailable")

        if not isinstance(payload, dict):
            return UserPreferenceResult(agent_id=None, source="unavailable")

        agent_id = payload.get("dm_default_agent_id")
        if agent_id is not None and not isinstance(agent_id, str):
            return UserPreferenceResult(agent_id=None, source="unavailable")
        agent_id = agent_id.strip() if isinstance(agent_id, str) and agent_id.strip() else None
        return UserPreferenceResult(agent_id=agent_id, source="saved")
