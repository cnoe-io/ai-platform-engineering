"""DM (1:1) agent dispatch resolver (Webex).

Phase 2.3 of spec 2026-05-24-derive-team-from-channel. Mirror of the
Slack-bot ``dm_agent_resolver``. Imports the Webex-side override store
and authz client so the two bots can be released independently.

See the Slack module for the FR-023 chain and failure-mode rationale.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Literal, Optional, Protocol

from .dm_authz_client import DmAgentAccessDecision
from .dm_thread_overrides import OverrideKey, OverrideStore
from .user_preferences_client import UserPreferenceResult

logger = logging.getLogger("caipe.webex_bot.dm_agent_resolver")


DmAgentSource = Literal[
    "thread_override",
    "saved_preference",
    "dm_agent_id",
    "default_agent_id",
    "denied",
    "no_candidates",
    "pdp_unavailable",
]


@dataclass(frozen=True)
class DmAgentResolution:
    agent_id: Optional[str]
    source: DmAgentSource
    notices: List[str] = field(default_factory=list)


class _AuthzClientProtocol(Protocol):
    def check_agent_access(
        self, *, agent_id: str, bearer_token: str
    ) -> DmAgentAccessDecision: ...


class _PrefsClientProtocol(Protocol):
    def get_dm_default_agent(self, *, bearer_token: str) -> UserPreferenceResult: ...


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
    notices: List[str] = []

    override_agent = _normalize_agent(overrides.get(override_key))
    if override_agent:
        decision = authz_client.check_agent_access(
            agent_id=override_agent, bearer_token=bearer_token
        )
        if not decision.available:
            return DmAgentResolution(
                agent_id=None, source="pdp_unavailable", notices=notices
            )
        if decision.allowed:
            return DmAgentResolution(
                agent_id=override_agent,
                source="thread_override",
                notices=notices,
            )
        overrides.clear(override_key)
        notices.append(
            f"Your `use {override_agent}` override is no longer authorized — "
            "clearing it and falling back."
        )
        logger.info(
            "1:1 override agent_id=%s denied; auto-cleared", override_agent
        )

    pref_result = prefs_client.get_dm_default_agent(bearer_token=bearer_token)
    if pref_result.source == "saved" and pref_result.agent_id:
        pref_agent = _normalize_agent(pref_result.agent_id)
        if pref_agent:
            decision = authz_client.check_agent_access(
                agent_id=pref_agent, bearer_token=bearer_token
            )
            if not decision.available:
                return DmAgentResolution(
                    agent_id=None, source="pdp_unavailable", notices=notices
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

    dm_default = _normalize_agent(dm_agent_id)
    if dm_default:
        decision = authz_client.check_agent_access(
            agent_id=dm_default, bearer_token=bearer_token
        )
        if not decision.available:
            return DmAgentResolution(
                agent_id=None, source="pdp_unavailable", notices=notices
            )
        if decision.allowed:
            return DmAgentResolution(
                agent_id=dm_default, source="dm_agent_id", notices=notices
            )

    deployment_default = _normalize_agent(default_agent_id)
    if deployment_default:
        decision = authz_client.check_agent_access(
            agent_id=deployment_default, bearer_token=bearer_token
        )
        if not decision.available:
            return DmAgentResolution(
                agent_id=None, source="pdp_unavailable", notices=notices
            )
        if decision.allowed:
            return DmAgentResolution(
                agent_id=deployment_default,
                source="default_agent_id",
                notices=notices,
            )

    if not dm_default and not deployment_default and not override_agent and (
        pref_result.source != "saved" or not pref_result.agent_id
    ):
        return DmAgentResolution(
            agent_id=None, source="no_candidates", notices=notices
        )
    return DmAgentResolution(agent_id=None, source="denied", notices=notices)
