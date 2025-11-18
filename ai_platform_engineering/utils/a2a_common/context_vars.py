# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Context variables for sharing event queue and task between executor and tools.

This module defines context variables that allow tools to access the event queue
and task directly, bypassing LangGraph's stream for status-update events.
"""

import contextvars
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from a2a.server.events.event_queue import EventQueue
    from a2a.types import Task

# Context variables for direct event queue access (bypassing LangGraph stream)
# These will be set by the executor before tool execution
_event_queue_ctx: contextvars.ContextVar["EventQueue | None"] = contextvars.ContextVar(
    "event_queue", default=None
)
_task_ctx: contextvars.ContextVar["Task | None"] = contextvars.ContextVar(
    "task", default=None
)

__all__ = ["_event_queue_ctx", "_task_ctx"]

