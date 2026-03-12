"""
SSE Event Types for Dynamic Agents.

Clean, structured events for the UI - no text parsing needed.
"""

import uuid
from typing import Any

# ═══════════════════════════════════════════════════════════════
# Event Type Constants
# ═══════════════════════════════════════════════════════════════

CONTENT = "content"
TOOL_START = "tool_start"
TOOL_END = "tool_end"
TODO_UPDATE = "todo_update"
SUBAGENT_START = "subagent_start"
SUBAGENT_END = "subagent_end"
FINAL_RESULT = "final_result"
INPUT_REQUIRED = "input_required"

# Deepagents built-in tools (render compactly in UI)
BUILTIN_TOOLS = frozenset(
    {
        "write_todos",
        "read_file",
        "write_file",
        "edit_file",
        "ls",
        "fetch_url",  # Dynamic agents built-in with domain ACL
    }
)


# ═══════════════════════════════════════════════════════════════
# Helper Functions
# ═══════════════════════════════════════════════════════════════


def _make_event_id() -> str:
    """Generate a unique event ID."""
    return f"evt-{uuid.uuid4().hex[:12]}"


def _truncate(value: str, max_len: int = 100) -> str:
    """Truncate string to max length with ellipsis."""
    if len(value) > max_len:
        return value[:max_len] + "..."
    return value


def _truncate_args(args: dict[str, Any], max_len: int = 100) -> dict[str, Any]:
    """Truncate string values in args dict."""
    result = {}
    for k, v in args.items():
        if isinstance(v, str):
            result[k] = _truncate(v, max_len)
        else:
            result[k] = v
    return result


# ═══════════════════════════════════════════════════════════════
# Event Builder Functions
# ═══════════════════════════════════════════════════════════════


def make_content_event(content: str) -> dict[str, Any]:
    """LLM token streaming content."""
    return {"type": CONTENT, "data": content}


def make_tool_start_event(
    tool_name: str,
    tool_call_id: str,
    args: dict[str, Any],
    agent: str,
) -> dict[str, Any]:
    """Tool call started."""
    return {
        "type": TOOL_START,
        "data": {
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "args": _truncate_args(args),
            "agent": agent,
            "is_builtin": tool_name in BUILTIN_TOOLS,
        },
    }


def make_tool_end_event(
    tool_name: str,
    tool_call_id: str,
    agent: str,
) -> dict[str, Any]:
    """Tool call completed."""
    return {
        "type": TOOL_END,
        "data": {
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "agent": agent,
            "is_builtin": tool_name in BUILTIN_TOOLS,
        },
    }


def make_todo_update_event(
    todos: list[dict[str, str]],
    agent: str,
) -> dict[str, Any]:
    """Todo list updated (from write_todos tool)."""
    return {
        "type": TODO_UPDATE,
        "data": {
            "todos": todos,  # [{content, status}, ...]
            "agent": agent,
        },
    }


def make_subagent_start_event(
    subagent_name: str,
    purpose: str,
    parent_agent: str,
) -> dict[str, Any]:
    """Subagent invocation started (task tool called)."""
    return {
        "type": SUBAGENT_START,
        "data": {
            "subagent_name": subagent_name,
            "purpose": _truncate(purpose),
            "parent_agent": parent_agent,
        },
    }


def make_subagent_end_event(
    subagent_name: str,
    parent_agent: str,
) -> dict[str, Any]:
    """Subagent invocation completed (task tool result received)."""
    return {
        "type": SUBAGENT_END,
        "data": {
            "subagent_name": subagent_name,
            "parent_agent": parent_agent,
        },
    }


def make_final_result_event(
    content: str,
    agent: str,
    trace_id: str | None = None,
    failed_servers: list[str] | None = None,
    missing_tools: list[str] | None = None,
) -> dict[str, Any]:
    """Final result from agent.

    Args:
        content: The final text content from the agent.
        agent: The agent name.
        trace_id: Optional trace ID for observability.
        failed_servers: List of MCP server IDs that failed to connect.
        missing_tools: List of tool names that were configured but unavailable.
    """
    return {
        "type": FINAL_RESULT,
        "data": {
            "artifact": {
                "artifactId": _make_event_id(),
                "name": "final_result",
                "description": "Final result from dynamic agent",
                "parts": [{"kind": "text", "text": content}],
                "metadata": {
                    "trace_id": trace_id,
                    "agent_name": agent,
                    "failed_servers": failed_servers or [],
                    "missing_tools": missing_tools or [],
                },
            },
        },
    }


def make_input_required_event(
    interrupt_id: str,
    prompt: str,
    fields: list[dict[str, Any]],
    agent: str,
) -> dict[str, Any]:
    """Input required from user (HITL form).

    Sent when the agent calls request_user_input and execution is paused.
    The UI should render a form and call resume-stream with the result.

    Args:
        interrupt_id: Unique ID for this interrupt (used to resume).
        prompt: Message explaining what information is needed.
        fields: List of field definitions for the form.
        agent: The agent name that requested input.
    """
    return {
        "type": INPUT_REQUIRED,
        "data": {
            "interrupt_id": interrupt_id,
            "prompt": prompt,
            "fields": fields,
            "agent": agent,
        },
    }
