"""Authorization functions for Dynamic Agents.

This module provides access control checks for conversations.
Agent visibility checks have been moved to the Next.js gateway.
"""

import logging
import re
from typing import Any

from dynamic_agents.cel_evaluator import evaluate as cel_evaluate
from dynamic_agents.config import get_settings
from dynamic_agents.models import DynamicAgentConfig, UserContext, VisibilityType

logger = logging.getLogger(__name__)


def _realm_roles_from_claims(claims: dict[str, Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()

    def add(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                s = str(item).strip()
                if s and s not in seen:
                    seen.add(s)
                    out.append(s)
        elif isinstance(value, str) and value.strip():
            for part in re.split(r"[,\s]+", value):
                p = part.strip()
                if p and p not in seen:
                    seen.add(p)
                    out.append(p)

    r = claims.get("roles")
    if r is not None:
        add(r)
    realm_access = claims.get("realm_access")
    if isinstance(realm_access, dict) and realm_access.get("roles"):
        add(realm_access["roles"])
    return out


def _agent_cel_context(agent: DynamicAgentConfig, user: UserContext, action: str) -> dict[str, Any]:
    teams = list(user.groups or [])
    shared = list(agent.shared_with_teams or [])
    return {
        "user": {
            "email": user.email,
            "teams": teams,
            "roles": _realm_roles_from_claims(user.raw_claims or {}),
        },
        "resource": {
            "id": agent.id,
            "type": "dynamic_agent",
            "visibility": agent.visibility.value,
            "owner_id": agent.owner_id,
            "shared_with_teams": shared,
        },
        "action": action,
    }


def _cel_expression() -> str:
    return (get_settings().cel_dynamic_agent_access_expression or "").strip()


def can_view_agent(agent: DynamicAgentConfig, user: UserContext) -> bool:
    expr = _cel_expression()
    if expr:
        return bool(cel_evaluate(expr, _agent_cel_context(agent, user, "view")))

    if user.is_admin:
        return True
    if agent.owner_id == user.email:
        return True
    if agent.visibility == VisibilityType.GLOBAL:
        return True
    if agent.visibility == VisibilityType.TEAM:
        if agent.shared_with_teams:
            return any(team in (user.groups or []) for team in agent.shared_with_teams)
    return False


def can_use_agent(agent: DynamicAgentConfig, user: UserContext) -> bool:
    if not agent.enabled:
        return False

    expr = _cel_expression()
    if expr:
        return bool(cel_evaluate(expr, _agent_cel_context(agent, user, "invoke")))

    return can_view_agent(agent, user)


def can_access_conversation(conversation: dict, user: UserContext) -> bool:
    """Check if user can access the conversation.

    Returns True if:
    - User is admin
    - User owns the conversation
    - TODO: Conversation is shared with user
    """

    if user.is_admin:
        return True

    if conversation.get("owner_id") == user.email:
        return True

    # TODO: Check sharing (shared_with, shared_with_teams, is_public)

    return False
