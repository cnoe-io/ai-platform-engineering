"""BFF client for ``GET /api/user/accessible-agents``.

Phase 2 of spec 2026-05-24-derive-team-from-channel. Used by the
``/{cmd}-list`` slash command (Slack) and the ``list`` text command
(Webex) to show the signed-in user which agents they can dispatch to.

The BFF route is paginated (default 25, max 100 per page). This client
walks every page (at ``_MAX_PAGE_SIZE`` per request) and accumulates
the full accessible-agents list, up to a ``_MAX_PAGES`` safety cap, so
deployments with more than one page of accessible agents still see
everything in ``/list`` rather than only the first page.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

logger = logging.getLogger("caipe.slack_bot.accessible_agents_client")

_MAX_PAGE_SIZE = 100
# Safety cap on pages fetched per /list invocation, independent of whatever
# `total` the BFF reports, so a malfunctioning/inconsistent BFF response
# can't send this client into an unbounded fetch loop.
_MAX_PAGES = 10


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
        self, *, bearer_token: str, page_size: int = _MAX_PAGE_SIZE
    ) -> AccessibleAgentsResult:
        """Fetch all of the user's accessible agents, across BFF pages.

        Returns ``AccessibleAgentsResult(available=False)`` on any
        failure (no base URL, missing token, network, 5xx, malformed
        JSON) encountered on any page. Callers MUST translate that to
        a "temporarily unavailable" reply rather than spinning
        forever.
        """
        if not self._base_url or not bearer_token:
            return _UNAVAILABLE

        size = max(1, min(_MAX_PAGE_SIZE, page_size))
        agents: List[AccessibleAgent] = []
        page = 1
        while page <= _MAX_PAGES:
            fetched = self._fetch_page(
                bearer_token=bearer_token, page=page, page_size=size
            )
            if fetched is None:
                return _UNAVAILABLE
            page_agents, total = fetched
            if not page_agents:
                break
            agents.extend(page_agents)
            if len(agents) >= total:
                break
            page += 1

        return AccessibleAgentsResult(agents=agents, available=True)

    def _fetch_page(
        self, *, bearer_token: str, page: int, page_size: int
    ) -> Optional[Tuple[List[AccessibleAgent], int]]:
        """Fetch a single page. Returns ``None`` on failure."""
        url = (
            f"{self._base_url}/api/user/accessible-agents"
            f"?{urllib.parse.urlencode({'page': page, 'page_size': page_size})}"
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
                    return None
                raw = response.read()
        except urllib.error.HTTPError as exc:
            logger.info("accessible_agents BFF HTTPError status=%s", exc.code)
            return None
        except (OSError, urllib.error.URLError) as exc:
            logger.info(
                "accessible_agents BFF unreachable (%s): %s",
                type(exc).__name__,
                exc,
            )
            return None

        try:
            payload = json.loads(raw)
        except (ValueError, TypeError) as exc:
            logger.info(
                "accessible_agents BFF returned malformed JSON: %s", exc
            )
            return None

        if not isinstance(payload, dict):
            return None
        data = payload.get("data")
        if not isinstance(data, dict):
            return None
        items = data.get("agents")
        if not isinstance(items, list):
            return None
        total = data.get("total")
        if not isinstance(total, int):
            total = len(items)

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
        return agents, total
