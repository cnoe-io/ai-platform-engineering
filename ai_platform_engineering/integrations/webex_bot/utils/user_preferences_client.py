"""BFF client for the user-preference (DM default agent) lookup.

Parallel of slack_bot.utils.user_preferences_client. Two copies — one per
bot — because the bots are deployed independently and have independent
dependency trees. The shape is intentionally identical so tests, metrics,
and logs stay aligned across surfaces.

See ``slack_bot/utils/user_preferences_client.py`` for full design notes.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Literal, Optional

logger = logging.getLogger("caipe.webex_bot.user_preferences_client")

UserPreferenceSource = Literal["saved", "not_set", "unavailable"]


@dataclass(frozen=True)
class UserPreferenceResult:
    agent_id: Optional[str]
    source: UserPreferenceSource


def _default_base_url() -> str:
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
    def _open(request: urllib.request.Request, *, timeout: float):
        return urllib.request.urlopen(request, timeout=timeout)  # noqa: S310

    def get_dm_default_agent(self, *, bearer_token: str) -> UserPreferenceResult:
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

    def clear_dm_default_agent(self, *, bearer_token: str) -> bool:
        """Clear the user's saved DM-default preference (FR-029a).

        Used by the ``use default`` text command to wipe the user's
        preference in the same round-trip that clears the room override.
        Returns ``True`` on success, ``False`` on any failure.
        """
        if not self._base_url or not bearer_token:
            return False

        url = f"{self._base_url}/api/user/preferences"
        body = json.dumps({"dm_default_agent_id": None}).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            method="PUT",
            headers={
                "Authorization": f"Bearer {bearer_token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

        try:
            with self._open(request, timeout=self._timeout) as response:  # noqa: S310
                status = (
                    getattr(response, "status", None)
                    or getattr(response, "code", 0)
                )
                return 200 <= status < 300
        except urllib.error.HTTPError as exc:
            logger.info("clear_dm_default_agent BFF HTTPError status=%s", exc.code)
            return False
        except (OSError, urllib.error.URLError) as exc:
            logger.info(
                "clear_dm_default_agent BFF unreachable (%s): %s",
                type(exc).__name__,
                exc,
            )
            return False
