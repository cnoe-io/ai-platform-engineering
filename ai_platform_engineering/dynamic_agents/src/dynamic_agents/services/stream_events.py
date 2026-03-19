"""
SSE Event Types for Dynamic Agents.

This module handles the transformation of LangGraph stream chunks into
structured SSE events for the UI. It contains:

1. Event type constants
2. Event builder functions (make_*_event)
3. LangGraph message helpers (detection/extraction)
4. Stream transformation (transform_stream_chunk)

To add a new event type:
1. Add a constant (e.g., MY_EVENT = "my_event")
2. Add a builder function (make_my_event)
3. Add detection logic in _handle_messages_chunk or _handle_updates_chunk
"""

import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
# Event Type Constants
# ═══════════════════════════════════════════════════════════════

CONTENT = "content"
TOOL_START = "tool_start"
TOOL_END = "tool_end"
SUBAGENT_START = "subagent_start"
SUBAGENT_END = "subagent_end"
FINAL_RESULT = "final_result"
INPUT_REQUIRED = "input_required"


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
# LangGraph Message Helpers
# ═══════════════════════════════════════════════════════════════


def is_task_tool(tool_name: str) -> bool:
    """Check if this is the task tool (subagent invocation)."""
    return tool_name == "task"


def _is_tool_message(msg: Any) -> bool:
    """Check if message is a ToolMessage (tool result, not for display)."""
    return "ToolMessage" in type(msg).__name__


def _has_tool_calls(msg: Any) -> bool:
    """Check if message is invoking tools (not generating content)."""
    return bool(getattr(msg, "tool_calls", None))


def _extract_content(msg: Any) -> str:
    """Extract and normalize content from a message chunk."""
    raw_content = getattr(msg, "content", "")
    if isinstance(raw_content, list):
        return "".join(block.get("text", "") if isinstance(block, dict) else str(block) for block in raw_content)
    return raw_content if isinstance(raw_content, str) else ""


def _extract_tool_call(tc: Any) -> dict[str, Any]:
    """Extract tool call info from a tool call object or dict."""
    if isinstance(tc, dict):
        return {
            "name": tc.get("name", "unknown"),
            "id": tc.get("id", ""),
            "args": tc.get("args", {}),
        }
    return {
        "name": getattr(tc, "name", "unknown"),
        "id": getattr(tc, "id", ""),
        "args": getattr(tc, "args", {}),
    }


# ═══════════════════════════════════════════════════════════════
# Event Builder Functions
# ═══════════════════════════════════════════════════════════════


def make_content_event(content: str) -> dict[str, Any]:
    """LLM token streaming content."""
    # No debug log for content - too noisy
    return {"type": CONTENT, "data": content}


def make_tool_start_event(
    tool_name: str,
    tool_call_id: str,
    args: dict[str, Any],
    agent: str,
) -> dict[str, Any]:
    """Tool call started."""
    logger.debug(f"[sse:{TOOL_START}] {tool_name} id={tool_call_id[:8]}...")
    return {
        "type": TOOL_START,
        "data": {
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "args": _truncate_args(args),
            "agent": agent,
        },
    }


def make_tool_end_event(
    tool_call_id: str,
    agent: str,
) -> dict[str, Any]:
    """Tool call completed."""
    logger.debug(f"[sse:{TOOL_END}] id={tool_call_id[:8]}...")
    return {
        "type": TOOL_END,
        "data": {
            "tool_call_id": tool_call_id,
            "agent": agent,
        },
    }


def make_subagent_start_event(
    tool_call_id: str,
    subagent_name: str,
    purpose: str,
    parent_agent: str,
) -> dict[str, Any]:
    """Subagent invocation started (task tool called)."""
    logger.debug(f"[sse:{SUBAGENT_START}] {subagent_name} id={tool_call_id[:8]}...")
    return {
        "type": SUBAGENT_START,
        "data": {
            "tool_call_id": tool_call_id,
            "subagent_name": subagent_name,
            "purpose": _truncate(purpose),
            "parent_agent": parent_agent,
        },
    }


def make_subagent_end_event(
    tool_call_id: str,
    parent_agent: str,
) -> dict[str, Any]:
    """Subagent invocation completed (task tool result received)."""
    logger.debug(f"[sse:{SUBAGENT_END}] id={tool_call_id[:8]}...")
    return {
        "type": SUBAGENT_END,
        "data": {
            "tool_call_id": tool_call_id,
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
    logger.debug(f"[sse:{FINAL_RESULT}] agent={agent} len={len(content)}")
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
    logger.debug(f"[sse:{INPUT_REQUIRED}] agent={agent} fields={len(fields)}")
    return {
        "type": INPUT_REQUIRED,
        "data": {
            "interrupt_id": interrupt_id,
            "prompt": prompt,
            "fields": fields,
            "agent": agent,
        },
    }


# ═══════════════════════════════════════════════════════════════
# Stream Transformation (LangGraph → SSE)
# ═══════════════════════════════════════════════════════════════


def transform_stream_chunk(
    chunk: tuple,
    agent_name: str,
    active_task_calls: set[str],
    accumulated_content: list[str],
) -> list[dict[str, Any]]:
    """Transform a LangGraph astream() chunk into SSE events.

    Handles the multi-mode streaming format from astream() with subgraphs=True.
    Chunks come as tuples: (namespace, mode, data) or (mode, data).

    Args:
        chunk: Raw chunk from graph.astream()
        agent_name: Name of the agent (for event metadata)
        active_task_calls: Set of tool_call_ids for active subagent calls (mutated)
        accumulated_content: List to accumulate content tokens (mutated)

    Returns:
        List of SSE event dicts
    """
    # Parse chunk format: (namespace, mode, data) or (mode, data)
    if len(chunk) == 3:
        namespace, mode, data = chunk
    elif len(chunk) == 2:
        mode, data = chunk
        namespace = ()
    else:
        logger.warning(f"[sse] Unexpected chunk format: {chunk}")
        return []

    # Only process parent agent events (namespace = empty tuple)
    # Subagent events from task tool are handled via tool_call tracking
    if len(namespace) > 0:
        return []

    if mode == "messages":
        return _handle_messages_chunk(data, accumulated_content)
    elif mode == "updates":
        return _handle_updates_chunk(data, agent_name, active_task_calls)

    return []


def _handle_messages_chunk(
    data: Any,
    accumulated_content: list[str],
) -> list[dict[str, Any]]:
    """Handle 'messages' mode chunks → content events.

    Args:
        data: The data portion of the chunk (message, metadata) tuple
        accumulated_content: List to accumulate content tokens (mutated)

    Returns:
        List of content events (0 or 1 items)
    """
    if not isinstance(data, tuple) or len(data) != 2:
        return []

    msg_chunk, _metadata = data

    # Skip ToolMessage content - these are tool results (e.g., RAG search JSON)
    # that should NOT be shown in chat
    if _is_tool_message(msg_chunk):
        return []

    # Skip if the chunk has tool_calls - this is an AIMessageChunk
    # that's invoking tools, not generating content for the user
    if _has_tool_calls(msg_chunk):
        return []

    content = _extract_content(msg_chunk)
    if content:
        accumulated_content.append(content)
        return [make_content_event(content)]

    return []


def _handle_updates_chunk(
    data: Any,
    agent_name: str,
    active_task_calls: set[str],
) -> list[dict[str, Any]]:
    """Handle 'updates' mode chunks → tool/subagent events.

    Args:
        data: The data portion of the chunk (dict of node updates)
        agent_name: Name of the agent (for event metadata)
        active_task_calls: Set of tool_call_ids for active subagent calls (mutated)

    Returns:
        List of SSE events
    """
    results: list[dict[str, Any]] = []

    if not isinstance(data, dict):
        return results

    for _node_name, node_data in data.items():
        if not isinstance(node_data, dict):
            continue

        messages = node_data.get("messages", [])
        if not isinstance(messages, list):
            continue

        for msg in messages:
            # Handle AIMessage with tool_calls
            tool_calls = getattr(msg, "tool_calls", None)
            if tool_calls:
                for tc in tool_calls:
                    tc_info = _extract_tool_call(tc)
                    tool_name = tc_info["name"]
                    tool_call_id = tc_info["id"]
                    args = tc_info["args"]

                    # Check if this is a subagent invocation (task tool)
                    if is_task_tool(tool_name):
                        active_task_calls.add(tool_call_id)
                        subagent_type = args.get("subagent_type", "unknown")
                        purpose = args.get("description", "")
                        results.append(make_subagent_start_event(tool_call_id, subagent_type, purpose, agent_name))
                    else:
                        # Regular tool call (including write_todos)
                        results.append(make_tool_start_event(tool_name, tool_call_id, args, agent_name))

            # Handle ToolMessage (tool results)
            tool_call_id = getattr(msg, "tool_call_id", None)
            if tool_call_id:
                # Check if this is a subagent result
                if tool_call_id in active_task_calls:
                    active_task_calls.discard(tool_call_id)
                    results.append(make_subagent_end_event(tool_call_id, agent_name))
                else:
                    # Regular tool result
                    results.append(make_tool_end_event(tool_call_id, agent_name))

    return results
