# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Context variables for GitHub Agent.

The GitHub agent now uses only the GitHub MCP server for all GitHub operations.
This module provides the self_service_mode context variable used by
DeterministicTaskMiddleware for privileged operations.
"""

import contextvars

# Context variable for self-service mode - set by DeterministicTaskMiddleware
# This allows tools to check if they're being invoked in a self-service workflow
# without modifying tool signatures or using thread-unsafe global state
self_service_mode_ctx: contextvars.ContextVar[bool] = contextvars.ContextVar(
    'self_service_mode', default=False
)

__all__ = [
    # Context variable for self-service mode (set by DeterministicTaskMiddleware)
    'self_service_mode_ctx',
]
