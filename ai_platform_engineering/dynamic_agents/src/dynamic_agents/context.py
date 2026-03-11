"""Shared context variables for Dynamic Agents.

This module contains context variables that need to be shared across
multiple modules without causing circular imports.
"""

from contextvars import ContextVar

# Session context for logging - can be imported by other modules
session_id_var: ContextVar[str] = ContextVar("session_id", default="-")
