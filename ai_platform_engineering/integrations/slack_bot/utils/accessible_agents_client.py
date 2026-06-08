"""BFF client for ``GET /api/user/accessible-agents``.

Phase 2 of spec 2026-05-24-derive-team-from-channel. Used by the
``/{cmd}-list`` slash command (Slack) and the ``list`` text command
(Webex) to show the signed-in user which agents they can dispatch to.

The BFF route is paginated (default 25, max 100); the bot only ever
asks for one page (default 25) per ``/list`` invocation to keep the
ephemeral reply small. Larger lists are paginated client-side via
follow-up ``/list page=N`` arg parsing (not implemented in Phase 2;
left as a Phase 3 follow-up if anyone actually has >25 accessible
agents).
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger("caipe.slack_bot.accessible_agents_client")


@dataclass(frozen=True)
class AccessibleAgent:
    id: str
    name: str
    description: str


@dataclass(frozen=True)
class AccessibleAgentsResult:
    agents: List[AccessibleAgent] = field(default_factory=list)
    available: bool = True


_UNAVAILABLE = AccessibleAgentsResult(agents=[], available=False)


def _default_base_url() -> str:
    return (
        os.environ.get("CAIPE_UI_URL")
        or os.environ.get("CAIPE_API_URL")
        or ""
    ).rstrip("/")


class AccessibleAgentsClient:
    """Thin wrapper around the BFF ``/api/user/accessible-agents`` route."""

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        timeout_seconds: float = 5.0,
    ) -> None:
        self._base_url = (
            base_url if base_url is not None else _default_base_url()
        ).rstrip("/")
        self._timeout = max(0.5, timeout_seconds)

    @staticmethod
    def _open(request: urllib.request.Request, *, timeout: float):  # noqa: D401
        """urllib.urlopen wrapper that exists solely as a patch point for tests."""
        return urllib.request.urlopen(request, timeout=timeout)  # noqa: S310

    def list_agents(
        self, *, bearer_token: str, page_size: int = 25
    ) -> AccessibleAgentsResult:
        """Fetch the user's accessible agents.

        Returns ``AccessibleAgentsResult(available=False)`` on any
        failure (no base URL, missing token, network, 5xx, malformed
        JSON). Callers MUST translate that to a "temporarily
        unavailable" reply rather than spinning forever.
        """
        if not self._base_url or not bearer_token:
            return _UNAVAILABLE

        size = max(1, min(100, page_size))
        url = (
            f"{self._base_url}/api/user/accessible-agents"
            f"?{urllib.parse.urlencode({'page_size': size})}"
        )
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
                status = (
                    getattr(response, "status", None)
                    or getattr(response, "code", 0)
                )
                if status < 200 or status >= 300:
                    logger.info(
                        "accessible_agents BFF non-2xx (status=%s)", status
                    )
                    return _UNAVAILABLE
                raw = response.read()
        except urllib.error.HTTPError as exc:
            logger.info("accessible_agents BFF HTTPError status=%s", exc.code)
            return _UNAVAILABLE
        except (OSError, urllib.error.URLError) as exc:
            logger.info(
                "accessible_agents BFF unreachable (%s): %s",
                type(exc).__name__,
                exc,
            )
            return _UNAVAILABLE

        try:
            payload = json.loads(raw)
        except (ValueError, TypeError) as exc:
            logger.info(
                "accessible_agents BFF returned malformed JSON: %s", exc
            )
            return _UNAVAILABLE

        if not isinstance(payload, dict):
            return _UNAVAILABLE
        data = payload.get("data")
        if not isinstance(data, dict):
            return _UNAVAILABLE
        items = data.get("agents")
        if not isinstance(items, list):
            return _UNAVAILABLE

        agents: List[AccessibleAgent] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            agent_id = item.get("id")
            name = item.get("name")
            description = item.get("description")
            if not isinstance(agent_id, str) or not agent_id.strip():
                continue
            agents.append(
                AccessibleAgent(
                    id=agent_id.strip(),
                    name=name.strip() if isinstance(name, str) and name.strip() else agent_id.strip(),
                    description=(
                        description.strip()
                        if isinstance(description, str)
                        else ""
                    ),
                )
            )
        return AccessibleAgentsResult(agents=agents, available=True)
