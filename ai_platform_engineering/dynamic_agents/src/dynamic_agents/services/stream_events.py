"""
SSE Event Types for Dynamic Agents.

This module handles the transformation of LangGraph stream chunks into
structured SSE events for the UI. It contains:

1. Event type constants
2. Event builder functions (make_*_event)
3. LangGraph message helpers (detection/extraction)
4. Stream transformation (transform_stream_chunk)
5. Namespace correlation (tasks stream mode handling)

To add a new event type:
1. Add a constant (e.g., MY_EVENT = "my_event")
2. Add a builder function (make_my_event)
3. Add detection logic in _handle_messages_chunk or _handle_updates_chunk

## Namespace Correlation

When using subagents (via the `task` tool), LangGraph assigns each subagent
invocation an internal UUID used in the namespace (e.g., `tools:e3b034a3-...`).
However, clients need to correlate subagent events to the `tool_start` event
they already received, which contains the `tool_call_id`.

By streaming with `tasks` mode enabled, LangGraph emits task metadata containing
both the internal task UUID and the original `tool_call_id`. We build a mapping
`{namespace_uuid: tool_call_id}` and use it to replace the LangGraph namespace
with the correlated `tool_call_id` before emitting SSE events.

This correlation is done server-side so all clients (Web UI, Slack, Webex,
Backstage) receive pre-correlated events without duplicating logic.
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
# Namespace Correlation (Tasks Stream Mode)
# ═══════════════════════════════════════════════════════════════


def _handle_tasks_chunk(
    data: Any,
    namespace_mapping: dict[str, str],
) -> None:
    """Extract namespace UUID → tool_call_id mapping from tasks events.

    LangGraph's `tasks` stream mode emits task metadata when a tool is invoked.
    For the `task` tool (subagent invocation), this contains:
    - id: The task UUID (used in namespace as "tools:{id}")
    - input.tool_call.id: The tool_call_id from the original invocation

    We build this mapping so subagent events can be correlated to their
    `tool_start` events, which clients already have.

    Args:
        data: The data portion of the tasks chunk (single task dict)
        namespace_mapping: Dict to update with new mappings (mutated)
    """
    # Tasks data comes as a single dict per event, not a list
    if not isinstance(data, dict):
        return

    task_id = data.get("id")
    task_name = data.get("name")
    task_input = data.get("input", {})

    # The tool_call info is nested under input.tool_call for tool executions
    tool_call = task_input.get("tool_call", {}) if isinstance(task_input, dict) else {}
    tool_call_id = tool_call.get("id")
    tool_name = tool_call.get("name")

    # Only create mapping for "task" tool calls (subagent invocations)
    # Other tools don't spawn subgraphs with their own namespace
    if task_id and tool_call_id and tool_name == "task":
        namespace_key = f"tools:{task_id}"
        if namespace_key not in namespace_mapping:
            namespace_mapping[namespace_key] = tool_call_id
            logger.info(f"[sse:tasks] Mapped {namespace_key} → {tool_call_id}")


def _correlate_namespace(
    namespace: tuple[str, ...],
    namespace_mapping: dict[str, str],
) -> tuple[str, ...]:
    """Correlate LangGraph namespace to tool_call_id using the mapping.

    Args:
        namespace: Original LangGraph namespace tuple (e.g., ("tools:abc-123",))
        namespace_mapping: Mapping from namespace UUID to tool_call_id

    Returns:
        Correlated namespace tuple. If the first element is found in the mapping,
        it's replaced with the tool_call_id. If not found, returns empty tuple
        (treated as parent agent) and logs a warning.
    """
    if not namespace:
        return namespace

    first = namespace[0]
    if first in namespace_mapping:
        # Replace with correlated tool_call_id
        correlated = (namespace_mapping[first],) + namespace[1:]
        logger.debug(f"[sse:correlate] {first} → {namespace_mapping[first]}")
        return correlated
    else:
        # Unknown namespace - treat as parent agent
        logger.warning(f"[sse:correlate] Unknown namespace {first}, mapping has {list(namespace_mapping.keys())}")
        return ()


# ═══════════════════════════════════════════════════════════════
# Event Builder Functions
# ═══════════════════════════════════════════════════════════════


def make_content_event(content: str, namespace: tuple[str, ...] = ()) -> dict[str, Any]:
    """LLM token streaming content.

    Args:
        content: The content text
        namespace: LangGraph namespace tuple. Empty = parent agent.
    """
    # No debug log for content - too noisy
    return {"type": CONTENT, "data": content, "namespace": list(namespace)}


def make_tool_start_event(
    tool_name: str,
    tool_call_id: str,
    args: dict[str, Any],
    namespace: tuple[str, ...] = (),
) -> dict[str, Any]:
    """Tool call started.

    Args:
        tool_name: Name of the tool being called
        tool_call_id: Unique ID for this tool call
        args: Tool arguments (will be truncated)
        namespace: LangGraph namespace tuple. Empty = parent agent.
    """
    logger.debug(f"[sse:{TOOL_START}] {tool_name} id={tool_call_id[:8]}... ns={namespace}")
    return {
        "type": TOOL_START,
        "data": {
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "args": _truncate_args(args),
        },
        "namespace": list(namespace),
    }


def make_tool_end_event(tool_call_id: str, namespace: tuple[str, ...] = ()) -> dict[str, Any]:
    """Tool call completed.

    Kept minimal - UI tracks state from tool_start and matches by tool_call_id.

    Args:
        tool_call_id: The tool call ID to match against tool_start
        namespace: LangGraph namespace tuple. Empty = parent agent.
    """
    logger.debug(f"[sse:{TOOL_END}] id={tool_call_id[:8]}... ns={namespace}")
    return {
        "type": TOOL_END,
        "data": {
            "tool_call_id": tool_call_id,
        },
        "namespace": list(namespace),
    }


def make_input_required_event(
    interrupt_id: str,
    prompt: str,
    fields: list[dict[str, Any]],
    agent: str,
    namespace: tuple[str, ...] = (),
) -> dict[str, Any]:
    """Input required from user (HITL form).

    Sent when the agent calls request_user_input and execution is paused.
    The UI should render a form and call resume-stream with the result.

    Args:
        interrupt_id: Unique ID for this interrupt (used to resume).
        prompt: Message explaining what information is needed.
        fields: List of field definitions for the form.
        agent: The agent name that requested input.
        namespace: LangGraph namespace tuple. Empty = parent agent.
    """
    logger.debug(f"[sse:{INPUT_REQUIRED}] agent={agent} fields={len(fields)} ns={namespace}")
    return {
        "type": INPUT_REQUIRED,
        "data": {
            "interrupt_id": interrupt_id,
            "prompt": prompt,
            "fields": fields,
            "agent": agent,
        },
        "namespace": list(namespace),
    }


# ═══════════════════════════════════════════════════════════════
# Stream Transformation (LangGraph → SSE)
# ═══════════════════════════════════════════════════════════════


def transform_stream_chunk(
    chunk: tuple,
    accumulated_content: list[str],
    namespace_mapping: dict[str, str],
) -> list[dict[str, Any]]:
    """Transform a LangGraph astream() chunk into SSE events.

    Handles the multi-mode streaming format from astream() with subgraphs=True.
    Chunks come as tuples: (namespace, mode, data) or (mode, data).

    For subagent events, the namespace is correlated using namespace_mapping
    to replace LangGraph's internal task UUID with the tool_call_id from the
    original `task` tool invocation. This allows clients to match subagent
    events to their `tool_start` events.

    Args:
        chunk: Raw chunk from graph.astream()
        accumulated_content: List to accumulate content tokens (mutated)
        namespace_mapping: Mapping from LangGraph namespace to tool_call_id (mutated by tasks mode)

    Returns:
        List of SSE event dicts, each containing a 'namespace' field
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

    # Log non-empty namespaces for debugging subagent events
    if namespace:
        logger.debug(f"[sse:chunk] mode={mode} namespace={namespace}")

    # Handle tasks mode - update namespace mapping, no events emitted
    if mode == "tasks":
        _handle_tasks_chunk(data, namespace_mapping)
        return []

    # Correlate namespace for subagent events
    correlated_namespace = _correlate_namespace(namespace, namespace_mapping)

    # Process events with correlated namespace
    if mode == "messages":
        return _handle_messages_chunk(data, accumulated_content, correlated_namespace)
    elif mode == "updates":
        return _handle_updates_chunk(data, correlated_namespace)

    return []


def _handle_messages_chunk(
    data: Any,
    accumulated_content: list[str],
    namespace: tuple[str, ...],
) -> list[dict[str, Any]]:
    """Handle 'messages' mode chunks → content events.

    Args:
        data: The data portion of the chunk (message, metadata) tuple
        accumulated_content: List to accumulate content tokens (mutated)
        namespace: LangGraph namespace tuple

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
        return [make_content_event(content, namespace)]

    return []


def _handle_updates_chunk(
    data: Any,
    namespace: tuple[str, ...],
) -> list[dict[str, Any]]:
    """Handle 'updates' mode chunks → tool events.

    Args:
        data: The data portion of the chunk (dict of node updates)
        namespace: LangGraph namespace tuple

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

                    results.append(make_tool_start_event(tool_name, tool_call_id, args, namespace))

            # Handle ToolMessage (tool results)
            tool_call_id = getattr(msg, "tool_call_id", None)
            if tool_call_id:
                results.append(make_tool_end_event(tool_call_id, namespace))

    return results
