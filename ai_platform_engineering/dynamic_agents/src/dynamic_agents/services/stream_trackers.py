"""
Stateless event emitters for SSE stream transformation.

These functions create structured SSE events for the UI.
No state is maintained - the UI matches start/end events by tool_call_id.
"""

import logging
from typing import Any

from dynamic_agents.services.stream_events import (
    make_subagent_end_event,
    make_subagent_start_event,
    make_todo_update_event,
    make_tool_end_event,
    make_tool_start_event,
)

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
# Tool Events
# ═══════════════════════════════════════════════════════════════


def emit_tool_start(
    tool_name: str,
    tool_call_id: str,
    args: dict[str, Any],
    agent: str,
) -> dict[str, Any]:
    """Emit a tool_start event."""
    return make_tool_start_event(
        tool_name=tool_name,
        tool_call_id=tool_call_id,
        args=args,
        agent=agent,
    )


def emit_tool_end(
    tool_call_id: str,
    agent: str,
) -> dict[str, Any]:
    """Emit a tool_end event."""
    return make_tool_end_event(
        tool_call_id=tool_call_id,
        agent=agent,
    )


# ═══════════════════════════════════════════════════════════════
# Todo Events
# ═══════════════════════════════════════════════════════════════


def emit_todo_update(
    tool_name: str,
    args: dict[str, Any],
    agent: str,
) -> dict[str, Any] | None:
    """Emit a todo_update event if this is a write_todos call.

    Returns None if this is not a write_todos call or has no todos.
    """
    if tool_name != "write_todos":
        return None

    todos_arg = args.get("todos", [])
    if not todos_arg or not isinstance(todos_arg, list):
        return None

    # Convert to our format (ensure content and status keys)
    todos = []
    for item in todos_arg:
        if isinstance(item, dict) and "content" in item:
            todos.append(
                {
                    "content": item.get("content", ""),
                    "status": item.get("status", "pending"),
                }
            )

    if not todos:
        return None

    logger.info(f"Emitting todo_update with {len(todos)} todos")
    return make_todo_update_event(todos=todos, agent=agent)


# ═══════════════════════════════════════════════════════════════
# Subagent Events
# ═══════════════════════════════════════════════════════════════


def is_task_tool(tool_name: str) -> bool:
    """Check if this is the task tool (subagent invocation)."""
    return tool_name == "task"


def emit_subagent_start(
    tool_call_id: str,
    subagent_type: str,
    purpose: str,
    parent_agent: str,
) -> dict[str, Any]:
    """Emit a subagent_start event."""
    return make_subagent_start_event(
        tool_call_id=tool_call_id,
        subagent_name=subagent_type,
        purpose=purpose,
        parent_agent=parent_agent,
    )


def emit_subagent_end(
    tool_call_id: str,
    parent_agent: str,
) -> dict[str, Any]:
    """Emit a subagent_end event."""
    return make_subagent_end_event(
        tool_call_id=tool_call_id,
        parent_agent=parent_agent,
    )
