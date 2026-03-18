"""
Stateful trackers for SSE event stream transformation.

These trackers maintain state during a streaming session and emit
structured events for the UI. They replace the verbose, emoji-based
text events with clean JSON events.
"""

import logging
import re
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
# ToolTracker - Tracks tool calls, emits tool_start/tool_end
# ═══════════════════════════════════════════════════════════════


class ToolTracker:
    """Tracks tool calls and emits structured tool events.

    Replaces the old _ToolTracker that emitted emoji-formatted text.
    Now emits tool_start/tool_end events with structured data.
    """

    def __init__(self, agent_name: str):
        self.agent_name = agent_name
        # Map tool_call_id -> {name, args, started}
        self._active_tools: dict[str, dict[str, Any]] = {}

    def start_tool(
        self,
        tool_name: str,
        tool_call_id: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        """Register a tool call starting.

        Returns the tool_start event to emit.
        """
        self._active_tools[tool_call_id] = {
            "name": tool_name,
            "args": args,
            "started": True,
        }

        return make_tool_start_event(
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            args=args,
            agent=self.agent_name,
        )

    def end_tool(self, tool_call_id: str) -> dict[str, Any] | None:
        """Mark a tool call as completed.

        Returns the tool_end event to emit, or None if tool wasn't tracked.
        """
        tool_info = self._active_tools.pop(tool_call_id, None)
        if not tool_info:
            return None

        return make_tool_end_event(
            tool_name=tool_info["name"],
            tool_call_id=tool_call_id,
            agent=self.agent_name,
        )


# ═══════════════════════════════════════════════════════════════
# TodoTracker - Parses write_todos output, emits todo_update
# ═══════════════════════════════════════════════════════════════


# Status icons used by write_todos tool (from deepagents/tools.py)
STATUS_ICONS = {
    "⏳": "pending",
    "🔄": "in_progress",
    "✅": "completed",
    "❌": "cancelled",  # Also used for error/failed
}


def _parse_todo_markdown(content: str) -> list[dict[str, str]] | None:
    """Parse the markdown output from write_todos tool.

    The write_todos tool outputs:
        📋 **Task Progress:**

        - ⏳ Task description 1
        - 🔄 Task description 2
        - ✅ Task description 3

    Returns list of {content, status} dicts, or None if not parseable.
    """
    if "📋" not in content and "Task Progress" not in content:
        return None

    todos = []
    # Match lines like "- ⏳ Task description" or "- 🔄 Task description"
    # The regex captures the emoji and the task content
    pattern = re.compile(r"^-\s*([⏳🔄✅❌])\s*(.+)$", re.MULTILINE)

    for match in pattern.finditer(content):
        icon, task_content = match.groups()
        status = STATUS_ICONS.get(icon, "pending")
        todos.append(
            {
                "content": task_content.strip(),
                "status": status,
            }
        )

    return todos if todos else None


class TodoTracker:
    """Tracks write_todos tool calls and emits structured todo events.

    Can extract todos from:
    1. Tool call args (write_todos receives {todos: [...]} as args)
    2. ToolMessage content (fallback: parse markdown output)
    """

    def __init__(self, agent_name: str):
        self.agent_name = agent_name
        self._last_todos: list[dict[str, str]] = []

    def process_tool_call(
        self,
        tool_name: str,
        args: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Process a write_todos tool call and emit todo_update from args.

        The write_todos tool receives todos as structured args:
            {"todos": [{"content": "...", "status": "pending"}, ...]}

        This is more reliable than parsing the markdown output.

        Args:
            tool_name: Name of the tool being called
            args: The tool call arguments

        Returns:
            todo_update event if this is write_todos, None otherwise
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

        self._last_todos = todos
        logger.info(f"[TodoTracker] Emitting todo_update from args with {len(todos)} todos")
        return make_todo_update_event(todos=todos, agent=self.agent_name)


# ═══════════════════════════════════════════════════════════════
# SubagentTracker - Tracks task tool calls → subagent events
# ═══════════════════════════════════════════════════════════════


class SubagentTracker:
    """Tracks subagent invocations via the 'task' tool.

    Since deepagents uses ainvoke() for subagents (not subgraphs),
    we can't see streaming events from subagents. Instead, we:
    1. Detect 'task' tool calls → emit subagent_start
    2. Detect 'task' tool results → emit subagent_end

    This is simpler than the old _SubagentTracker which tried to
    track namespace-based subgraphs (which don't work with ainvoke).
    """

    def __init__(self, parent_agent_name: str):
        self.parent_agent_name = parent_agent_name
        # Map tool_call_id -> {subagent_type, purpose, started}
        self._active_subagents: dict[str, dict[str, Any]] = {}

    def start_subagent(
        self,
        tool_call_id: str,
        subagent_type: str,
        purpose: str,
    ) -> dict[str, Any]:
        """Register a subagent invocation starting (task tool called).

        Args:
            tool_call_id: The task tool call ID
            subagent_type: The subagent type being invoked
            purpose: The prompt/description for the subagent

        Returns:
            subagent_start event to emit
        """
        self._active_subagents[tool_call_id] = {
            "subagent_type": subagent_type,
            "purpose": purpose,
            "started": True,
        }

        return make_subagent_start_event(
            subagent_name=subagent_type,
            purpose=purpose,
            parent_agent=self.parent_agent_name,
        )

    def end_subagent(self, tool_call_id: str) -> dict[str, Any] | None:
        """Mark a subagent invocation as completed (task tool result received).

        Returns:
            subagent_end event to emit, or None if subagent wasn't tracked
        """
        subagent_info = self._active_subagents.pop(tool_call_id, None)
        if not subagent_info:
            return None

        return make_subagent_end_event(
            subagent_name=subagent_info["subagent_type"],
            parent_agent=self.parent_agent_name,
        )

    def is_task_tool(self, tool_name: str) -> bool:
        """Check if this is the task tool (subagent invocation)."""
        return tool_name == "task"

    def get_active_subagent(self, tool_call_id: str) -> dict[str, Any] | None:
        """Get info about an active subagent."""
        return self._active_subagents.get(tool_call_id)
