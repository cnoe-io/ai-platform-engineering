# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Context variables for GitHub Agent.

The GitHub agent now uses only the GitHub MCP server for all GitHub operations.
This module provides the self_service_mode context variable used by
DeterministicTaskMiddleware for privileged operations.
"""

import contextvars
import threading

# Context variable for self-service mode - set by DeterministicTaskMiddleware
# This allows tools to check if they're being invoked in a self-service workflow
# without modifying tool signatures or using thread-unsafe global state
self_service_mode_ctx: contextvars.ContextVar[bool] = contextvars.ContextVar(
    'self_service_mode', default=False
)

# Thread-local storage for self-service mode (per-thread isolation)
# Used as fallback when context variable doesn't propagate across async boundaries
_thread_local = threading.local()


def set_self_service_mode(value: bool) -> None:
    """Set self-service mode flag for current thread/context.
    
    Called by DeterministicTaskMiddleware when executing self-service workflows.
    Both the context variable and thread-local are set to ensure propagation.
    """
    # Set context variable
    self_service_mode_ctx.set(value)
    # Set thread-local fallback
    _thread_local.self_service_mode = value


def is_self_service_mode() -> bool:
    """Check if we're running in self-service mode.
    
    Checks both context variable and thread-local fallback.
    
    Returns:
        True if self-service mode is active
    """
    # Check context variable first
    try:
        if self_service_mode_ctx.get():
            return True
    except LookupError:
        pass
    
    # Fallback to thread-local
    return getattr(_thread_local, 'self_service_mode', False)


__all__ = [
    # Context variable for self-service mode (set by DeterministicTaskMiddleware)
    'self_service_mode_ctx',
    # Helper functions for self-service mode
    'set_self_service_mode',
    'is_self_service_mode',
]
