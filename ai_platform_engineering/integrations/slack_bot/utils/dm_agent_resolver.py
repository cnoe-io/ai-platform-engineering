"""DM agent dispatch resolver (Slack).

Phase 2.3 of spec 2026-05-24-derive-team-from-channel. FR-023 chain:

  1. thread override (OverrideStore)
  2. saved per-user preference (BFF /api/user/preferences)
  3. deployment ``dm_agent_id``
  4. deployment ``default_agent_id``

Every candidate is re-checked against the BFF PDP
(``/api/user/check_agent_access``) before being returned, so a user
who was once granted access to ``agent-X`` but had their team removed
won't keep hitting ``agent-X`` from a stale override / preference.

Failure modes:

* override fails PDP → auto-clear + emit "your override is no longer
  authorized" notice + fall through.
* saved pref fails PDP → emit "your preference is no longer authorized"
  notice + fall through. We do NOT auto-clear the preference: the user
  may have been temporarily off-team and we don't want to silently
  destroy their setting. Clearing happens via ``/use default``.
* deployment fallback fails PDP → silent fall through; we never tell
  the user that the org default is broken.
* PDP itself unavailable → return ``pdp_unavailable`` immediately; the
  bot translates to a "service temporarily unavailable" reply.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Literal, Optional, Protocol

from .dm_authz_client import DmAgentAccessDecision
from .dm_thread_overrides import OverrideKey, OverrideStore
from .user_preferences_client import UserPreferenceResult

logger = logging.getLogger("caipe.slack_bot.dm_agent_resolver")


DmAgentSource = Literal[
    "thread_override",
    "saved_preference",
    "dm_agent_id",
    "default_agent_id",
    "denied",  # candidates exist but none authorized
    "no_candidates",  # nothing configured at all
    "pdp_unavailable",
]


@dataclass(frozen=True)
class DmAgentResolution:
    agent_id: Optional[str]
    source: DmAgentSource
    notices: List[str] = field(default_factory=list)
    """Ephemeral notices the bot should surface to the user before
    dispatching. Each string is a complete user-facing sentence."""


class _AuthzClientProtocol(Protocol):
    def check_agent_access(
        self, *, agent_id: str, bearer_token: str
    ) -> DmAgentAccessDecision:
        raise NotImplementedError


class _PrefsClientProtocol(Protocol):
    def get_dm_default_agent(self, *, bearer_token: str) -> UserPreferenceResult:
        raise NotImplementedError


def _normalize_agent(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def resolve_dm_agent(
    *,
    override_key: OverrideKey,
    overrides: OverrideStore,
    prefs_client: _PrefsClientProtocol,
    authz_client: _AuthzClientProtocol,
    dm_agent_id: Optional[str],
    default_agent_id: Optional[str],
    bearer_token: str,
) -> DmAgentResolution:
    """Resolve the DM agent for ``override_key`` using the FR-023 chain.

    See module docstring for failure semantics.
    """
    notices: List[str] = []

    # ---- 1. thread override ------------------------------------------------
    override_agent = _normalize_agent(overrides.get(override_key))
    if override_agent:
        decision = authz_client.check_agent_access(
            agent_id=override_agent, bearer_token=bearer_token
        )
        if not decision.available:
            return DmAgentResolution(
                agent_id=None,
                source="pdp_unavailable",
                notices=notices,
            )
        if decision.allowed:
            return DmAgentResolution(
                agent_id=override_agent,
                source="thread_override",
                notices=notices,
            )
        # Auto-clear stale override and notify.
        overrides.clear(override_key)
        notices.append(
            f"Your `/use {override_agent}` thread override is no longer "
            "authorized — clearing it and falling back."
        )
        logger.info(
            "DM override agent_id=%s denied for user; auto-cleared",
            override_agent,
        )

    # ---- 2. saved per-user preference --------------------------------------
    pref_result = prefs_client.get_dm_default_agent(bearer_token=bearer_token)
    if pref_result.source == "saved" and pref_result.agent_id:
        pref_agent = _normalize_agent(pref_result.agent_id)
        if pref_agent:
            decision = authz_client.check_agent_access(
                agent_id=pref_agent, bearer_token=bearer_token
            )
            if not decision.available:
                return DmAgentResolution(
                    agent_id=None,
                    source="pdp_unavailable",
                    notices=notices,
                )
            if decision.allowed:
                return DmAgentResolution(
                    agent_id=pref_agent,
                    source="saved_preference",
                    notices=notices,
                )
            notices.append(
                f"Your saved DM-default preference (`{pref_agent}`) is no "
                "longer authorized — falling back to the deployment default."
            )
            logger.info(
                "DM saved-pref agent_id=%s denied for user; falling through",
                pref_agent,
            )

    # ---- 3. deployment dm_agent_id (silent fall-through on deny) -----------
    dm_default = _normalize_agent(dm_agent_id)
    if dm_default:
        decision = authz_client.check_agent_access(
            agent_id=dm_default, bearer_token=bearer_token
        )
        if not decision.available:
            return DmAgentResolution(
                agent_id=None,
                source="pdp_unavailable",
                notices=notices,
            )
        if decision.allowed:
            return DmAgentResolution(
                agent_id=dm_default,
                source="dm_agent_id",
                notices=notices,
            )
        # Silent fall-through — org default-failure is an ops issue,
        # not something to spam the user about.
        logger.info(
            "DM deployment dm_agent_id=%s denied; falling through to default",
            dm_default,
        )

    # ---- 4. deployment default_agent_id (silent on deny) -------------------
    deployment_default = _normalize_agent(default_agent_id)
    if deployment_default:
        decision = authz_client.check_agent_access(
            agent_id=deployment_default, bearer_token=bearer_token
        )
        if not decision.available:
            return DmAgentResolution(
                agent_id=None,
                source="pdp_unavailable",
                notices=notices,
            )
        if decision.allowed:
            return DmAgentResolution(
                agent_id=deployment_default,
                source="default_agent_id",
                notices=notices,
            )
        logger.info(
            "DM deployment default_agent_id=%s denied",
            deployment_default,
        )

    # ---- 5. nothing left ---------------------------------------------------
    if not dm_default and not deployment_default and not override_agent and (
        pref_result.source != "saved" or not pref_result.agent_id
    ):
        return DmAgentResolution(
            agent_id=None, source="no_candidates", notices=notices
        )

    return DmAgentResolution(agent_id=None, source="denied", notices=notices)
