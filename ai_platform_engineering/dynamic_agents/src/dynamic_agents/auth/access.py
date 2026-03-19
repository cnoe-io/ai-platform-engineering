"""Authorization functions for Dynamic Agents.

This module provides access control checks for agents and conversations.
"""

from dynamic_agents.models import DynamicAgentConfig, VisibilityType

from .auth import UserContext


def can_view_agent(agent: DynamicAgentConfig, user: UserContext) -> bool:
    """Check if user can view the agent.

    Returns True if:
    - User is admin
    - User owns the agent
    - Agent has global visibility
    - Agent has team visibility and user is in a shared team
    """
    if user.is_admin:
        return True

    if agent.owner_id == user.email:
        return True

    if agent.visibility == VisibilityType.GLOBAL:
        return True

    if agent.visibility == VisibilityType.TEAM:
        if agent.shared_with_teams:
            return any(team in user.groups for team in agent.shared_with_teams)

    return False


def can_use_agent(agent: DynamicAgentConfig, user: UserContext) -> bool:
    """Check if user can use the agent (chat with it).

    Returns True if user can view the agent AND the agent is enabled.
    """
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
