"""Authorization functions for Dynamic Agents.

This module provides access control checks for conversations.
Agent visibility checks have been moved to the Next.js gateway.
"""

import logging

from dynamic_agents.models import DynamicAgentConfig, UserContext, VisibilityType

logger = logging.getLogger(__name__)


def can_view_agent(agent: DynamicAgentConfig, user: UserContext) -> bool:
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
