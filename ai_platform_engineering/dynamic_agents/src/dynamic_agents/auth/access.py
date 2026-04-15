"""Authorization functions for Dynamic Agents.

This module provides access control checks for conversations.
Agent visibility checks have been moved to the Next.js gateway.
"""

from .auth import UserContext


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
