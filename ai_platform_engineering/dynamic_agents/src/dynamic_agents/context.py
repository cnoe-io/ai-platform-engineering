"""Shared context variables for Dynamic Agents.

This module contains context variables that need to be shared across
multiple modules without causing circular imports.
"""

from contextvars import ContextVar

# Conversation context for logging - can be imported by other modules
conversation_id_var: ContextVar[str] = ContextVar("conversation_id", default="-")
