"""
SSE Event Types for Dynamic Agents.

This module handles the transformation of LangGraph stream chunks into
AG-UI events for the UI. It contains:

1. LangGraph message helpers (detection/extraction)
2. Stream transformation (transform_stream_chunk)
3. Namespace correlation (tasks stream mode handling)
4. AG-UI event builders (wrapping the agui emitter module)

To add a new event type:
1. Add a builder function using the AG-UI emitter helpers
2. Add detection logic in _handle_messages_chunk or _handle_updates_chunk

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

## AG-UI Event Format

All events are now standard AG-UI events (Pydantic models) rather than plain
dicts.  Namespace metadata is carried in CUSTOM events (type="NAMESPACE_CONTEXT")
so consumers can correlate subagent output with its parent tool invocation.
"""

import logging
from typing import Any

from ai_platform_engineering.utils.agui import (
    BaseAGUIEvent,
    emit_custom,
    emit_run_error,
    emit_run_finished,
    emit_run_started,
    emit_text_content,
    emit_text_end,
    emit_text_start,
    emit_tool_end,
    emit_tool_start,
)

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
# Event Type Constants
# ═══════════════════════════════════════════════════════════════

CONTENT = "content"
TOOL_START = "tool_start"
TOOL_END = "tool_end"
INPUT_REQUIRED = "input_required"
WARNING = "warning"


# ═══════════════════════════════════════════════════════════════
# Helper Functions
# ═══════════════════════════════════════════════════════════════


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
            logger.debug(f"[sse:tasks] Mapped {namespace_key} → {tool_call_id}")


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
# AG-UI Event Builders
# ═══════════════════════════════════════════════════════════════


def make_run_started_event(
    run_id: str | None = None,
    thread_id: str | None = None,
) -> BaseAGUIEvent:
    """Emit a RUN_STARTED event at the beginning of a stream.

    Args:
        run_id: Optional run identifier (auto-generated if not provided)
        thread_id: Optional thread/session identifier
    """
    return emit_run_started(run_id=run_id, thread_id=thread_id)


def make_run_finished_event(run_id: str, thread_id: str) -> BaseAGUIEvent:
    """Emit a RUN_FINISHED event at the end of a successful stream.

    Args:
        run_id: Run identifier (must match the RUN_STARTED event)
        thread_id: Thread/session identifier
    """
    return emit_run_finished(run_id=run_id, thread_id=thread_id)


def make_run_error_event(message: str, code: str | None = None) -> BaseAGUIEvent:
    """Emit a RUN_ERROR event when an unrecoverable error terminates the stream.

    Args:
        message: Human-readable description of the error
        code: Optional machine-readable error code
    """
    return emit_run_error(message=message, code=code)


def make_text_start_event(message_id: str | None = None) -> BaseAGUIEvent:
    """Emit a TEXT_MESSAGE_START event before streaming text content.

    Args:
        message_id: Optional message identifier (auto-generated if not provided)
    """
    return emit_text_start(message_id=message_id)


def make_content_event(
    content: str,
    message_id: str,
) -> BaseAGUIEvent:
    """LLM token streaming content.

    Emits a single TEXT_MESSAGE_CONTENT event.  Namespace context is sent
    once at TEXT_MESSAGE_START time (see _handle_messages_chunk).

    Args:
        content: The content text
        message_id: The message identifier to attach content to
    """
    return emit_text_content(message_id=message_id, delta=content)


def make_text_end_event(message_id: str) -> BaseAGUIEvent:
    """Emit a TEXT_MESSAGE_END event after all content chunks have been sent.

    Args:
        message_id: The message identifier (must match the TEXT_MESSAGE_START event)
    """
    return emit_text_end(message_id=message_id)


def make_tool_start_event(
    tool_name: str,
    tool_call_id: str,
    args: dict[str, Any],
    namespace: tuple[str, ...] = (),
) -> list[BaseAGUIEvent]:
    """Tool call started.

    Emits a TOOL_CALL_START event carrying the tool name and a CUSTOM
    TOOL_ARGS event with the (truncated) arguments.

    Args:
        tool_name: Name of the tool being called
        tool_call_id: Unique ID for this tool call
        args: Tool arguments (will be truncated)
        namespace: LangGraph namespace tuple. Empty = parent agent.
    """
    logger.debug(f"[sse:TOOL_CALL_START] {tool_name} id={tool_call_id[:8]}... ns={namespace}")
    events: list[BaseAGUIEvent] = []
    if namespace:
        events.append(
            emit_custom(
                name="NAMESPACE_CONTEXT",
                value={"namespace": list(namespace)},
            )
        )
    events.append(emit_tool_start(tool_call_id=tool_call_id, tool_call_name=tool_name))
    # Emit tool args as a CUSTOM event so clients can display them without
    # streaming the full JSON delta (args are available all at once here)
    events.append(
        emit_custom(
            name="TOOL_ARGS",
            value={
                "tool_call_id": tool_call_id,
                "args": _truncate_args(args),
            },
        )
    )
    return events


def make_tool_end_event(
    tool_call_id: str,
    namespace: tuple[str, ...] = (),
    error: str | None = None,
) -> list[BaseAGUIEvent]:
    """Tool call completed.

    Kept minimal - UI tracks state from tool_start and matches by tool_call_id.
    When error is set, the UI renders the tool as failed with the error message
    via a CUSTOM TOOL_ERROR event emitted before the TOOL_CALL_END.

    Args:
        tool_call_id: The tool call ID to match against tool_start
        namespace: LangGraph namespace tuple. Empty = parent agent.
        error: Optional error message if the tool failed.
    """
    logger.debug(f"[sse:TOOL_CALL_END] id={tool_call_id[:8]}... ns={namespace} error={bool(error)}")
    events: list[BaseAGUIEvent] = []
    if namespace:
        events.append(
            emit_custom(
                name="NAMESPACE_CONTEXT",
                value={"namespace": list(namespace)},
            )
        )
    if error:
        events.append(
            emit_custom(
                name="TOOL_ERROR",
                value={
                    "tool_call_id": tool_call_id,
                    "error": error,
                },
            )
        )
    events.append(emit_tool_end(tool_call_id=tool_call_id))
    return events


def make_warning_event(
    message: str,
    namespace: tuple[str, ...] = (),
) -> BaseAGUIEvent:
    """Non-fatal warning to display in the timeline.

    Used for issues like failed MCP server connections that don't stop the
    agent but should be visible to the user.

    Emits a CUSTOM event with name="WARNING" containing the message.

    Args:
        message: Human-readable warning message.
        namespace: LangGraph namespace tuple. Empty = parent agent.
    """
    logger.debug(f"[sse:{WARNING}] {message[:80]}")
    return emit_custom(
        name="WARNING",
        value={
            "message": message,
            "namespace": list(namespace),
        },
    )


def make_input_required_event(
    interrupt_id: str,
    prompt: str,
    fields: list[dict[str, Any]],
    agent: str,
    namespace: tuple[str, ...] = (),
) -> BaseAGUIEvent:
    """Input required from user (HITL form).

    Sent when the agent calls request_user_input and execution is paused.
    The UI should render a form and call resume-stream with the result.

    Emits a CUSTOM event with name="INPUT_REQUIRED" containing all form metadata.

    Args:
        interrupt_id: Unique ID for this interrupt (used to resume).
        prompt: Message explaining what information is needed.
        fields: List of field definitions for the form.
        agent: The agent name that requested input.
        namespace: LangGraph namespace tuple. Empty = parent agent.
    """
    logger.debug(f"[sse:INPUT_REQUIRED] agent={agent} fields={len(fields)} ns={namespace}")
    return emit_custom(
        name="INPUT_REQUIRED",
        value={
            "interrupt_id": interrupt_id,
            "prompt": prompt,
            "fields": fields,
            "agent": agent,
            "namespace": list(namespace),
        },
    )


# ═══════════════════════════════════════════════════════════════
# Stream Transformation (LangGraph → AG-UI Events)
# ═══════════════════════════════════════════════════════════════


def transform_stream_chunk(
    chunk: tuple,
    accumulated_content: list[str],
    namespace_mapping: dict[str, str],
    active_message_ids: dict[str, str | None],
) -> list[BaseAGUIEvent]:
    """Transform a LangGraph astream() chunk into AG-UI events.

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
        active_message_ids: Mutable dict tracking the active TEXT_MESSAGE message_id
            per namespace key.  Key "" is used for the parent agent; subagent
            namespaces use their correlated tool_call_id as key.

    Returns:
        List of AG-UI event models
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
        return _handle_messages_chunk(data, accumulated_content, correlated_namespace, active_message_ids)
    elif mode == "updates":
        return _handle_updates_chunk(data, correlated_namespace, active_message_ids)

    return []


def _namespace_key(namespace: tuple[str, ...]) -> str:
    """Return a stable dict key for a namespace tuple."""
    return namespace[0] if namespace else ""


def _handle_messages_chunk(
    data: Any,
    accumulated_content: list[str],
    namespace: tuple[str, ...],
    active_message_ids: dict[str, str | None],
) -> list[BaseAGUIEvent]:
    """Handle 'messages' mode chunks → AG-UI text content events.

    Emits TEXT_MESSAGE_START on the first content chunk for each namespace,
    TEXT_MESSAGE_CONTENT for each subsequent token, and TEXT_MESSAGE_END
    when the message ends.  In streaming mode the end signal is not directly
    available here, so callers are expected to emit TEXT_MESSAGE_END once the
    stream loop finishes (see agent_runtime.py).

    Args:
        data: The data portion of the chunk (message, metadata) tuple
        accumulated_content: List to accumulate content tokens (mutated)
        namespace: LangGraph namespace tuple
        active_message_ids: Mutable dict tracking active message_id per namespace key

    Returns:
        List of AG-UI events (0 or more items)
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
    if not content:
        return []

    accumulated_content.append(content)

    ns_key = _namespace_key(namespace)
    events: list[BaseAGUIEvent] = []

    # Emit TEXT_MESSAGE_START the first time we see content for this namespace
    if active_message_ids.get(ns_key) is None:
        start_event = make_text_start_event()
        # Retrieve the auto-generated message_id from the emitted event
        message_id: str = start_event.message_id  # type: ignore[attr-defined]
        active_message_ids[ns_key] = message_id
        if namespace:
            events.append(
                emit_custom(
                    name="NAMESPACE_CONTEXT",
                    value={"namespace": list(namespace)},
                )
            )
        events.append(start_event)

    message_id = active_message_ids[ns_key]  # type: ignore[assignment]
    events.append(make_content_event(content, message_id=message_id))
    return events


def _handle_updates_chunk(
    data: Any,
    namespace: tuple[str, ...],
    active_message_ids: dict[str, str | None],
) -> list[BaseAGUIEvent]:
    """Handle 'updates' mode chunks → AG-UI tool events.

    Also closes any open TEXT_MESSAGE for this namespace when an updates chunk
    arrives (tool invocations interrupt the text stream).

    Args:
        data: The data portion of the chunk (dict of node updates)
        namespace: LangGraph namespace tuple
        active_message_ids: Mutable dict tracking active message_id per namespace key

    Returns:
        List of AG-UI events
    """
    results: list[BaseAGUIEvent] = []

    if not isinstance(data, dict):
        return results

    ns_key = _namespace_key(namespace)

    # Close any open text message for this namespace before tool events
    if active_message_ids.get(ns_key) is not None:
        results.append(make_text_end_event(active_message_ids[ns_key]))  # type: ignore[arg-type]
        active_message_ids[ns_key] = None

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

                    results.extend(make_tool_start_event(tool_name, tool_call_id, args, namespace))

            # Handle ToolMessage (tool results)
            tool_call_id = getattr(msg, "tool_call_id", None)
            if tool_call_id:
                # Detect tool errors: our wrap_tools_with_error_handling() returns
                # "ERROR: ..." strings instead of raising exceptions.
                content = getattr(msg, "content", "")
                error = None
                if isinstance(content, str) and content.startswith("ERROR: "):
                    error = content
                results.extend(make_tool_end_event(tool_call_id, namespace, error=error))

    return results
