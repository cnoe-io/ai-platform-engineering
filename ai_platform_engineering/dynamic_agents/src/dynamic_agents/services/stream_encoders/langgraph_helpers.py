"""Stateful helper for parsing LangGraph stream chunks.

Extracted from stream_events.py. Owns LangGraph-specific state (namespace
correlation, content accumulation) while also providing stateless static
helpers for message inspection and extraction. No event building, no
protocol knowledge.

Encoders instantiate one LangGraphStreamHelper per stream and delegate all
LangGraph parsing to it, so namespace mapping and content tracking are
never duplicated across encoders.

## Namespace Correlation

When using subagents (via the ``task`` tool), LangGraph assigns each subagent
invocation an internal UUID used in the namespace (e.g., ``tools:e3b034a3-...``).
However, clients need to correlate subagent events to the ``tool_start`` event
they already received, which contains the ``tool_call_id``.

By streaming with ``tasks`` mode enabled, LangGraph emits task metadata
containing both the internal task UUID and the original ``tool_call_id``. We
build a mapping ``{namespace_uuid: tool_call_id}`` and use it to replace the
LangGraph namespace with the correlated ``tool_call_id`` before emitting SSE
events.

This correlation is done server-side so all clients (Web UI, Slack, Webex,
Backstage) receive pre-correlated events without duplicating logic.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)


class LangGraphStreamHelper:
    """Stateful helper for parsing LangGraph stream chunks.

    Owns state that is LangGraph-specific (not protocol-specific):
    - namespace_mapping: correlates subagent task UUIDs to tool_call_ids
    - accumulated_content: tracks total streamed content

    Encoders instantiate one per stream and call its methods.
    """

    def __init__(self) -> None:
        self._namespace_mapping: dict[str, str] = {}
        self._accumulated_content: list[str] = []

    # ── Stateful methods ──────────────────────────────────

    def parse_chunk(self, chunk: tuple) -> tuple[tuple[str, ...], str, Any]:
        """Parse (namespace, mode, data) or (mode, data) from astream().

        For tasks-mode chunks, updates internal namespace_mapping automatically
        and returns mode="tasks" so the caller knows no events are needed.
        Returns (namespace, mode, data) normalized to always include namespace.
        """
        if len(chunk) == 3:
            namespace, mode, data = chunk
        elif len(chunk) == 2:
            mode, data = chunk
            namespace = ()
        else:
            logger.warning(f"[sse] Unexpected chunk format: {chunk}")
            return ((), "", None)

        # Log non-empty namespaces for debugging subagent events
        if namespace:
            logger.debug(f"[sse:chunk] mode={mode} namespace={namespace}")

        # Handle tasks mode — update namespace mapping, no events emitted
        if mode == "tasks":
            self._handle_tasks_chunk(data)

        return (namespace, mode, data)

    def _handle_tasks_chunk(self, data: Any) -> None:
        """Extract namespace UUID -> tool_call_id mapping from tasks events.

        LangGraph's ``tasks`` stream mode emits task metadata when a tool is
        invoked. For the ``task`` tool (subagent invocation), this contains:
        - id: The task UUID (used in namespace as "tools:{id}")
        - input.tool_call.id: The tool_call_id from the original invocation

        We build this mapping so subagent events can be correlated to their
        ``tool_start`` events, which clients already have.
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
            if namespace_key not in self._namespace_mapping:
                self._namespace_mapping[namespace_key] = tool_call_id
                logger.debug(f"[sse:tasks] Mapped {namespace_key} → {tool_call_id}")

    def correlate_namespace(self, namespace: tuple[str, ...]) -> tuple[str, ...]:
        """Correlate using internal namespace_mapping.

        Replaces LangGraph internal UUID with the correlated tool_call_id.
        Unknown namespaces return empty tuple (treated as parent agent).
        """
        if not namespace:
            return namespace

        first = namespace[0]
        if first in self._namespace_mapping:
            # Replace with correlated tool_call_id
            correlated = (self._namespace_mapping[first],) + namespace[1:]
            logger.debug(f"[sse:correlate] {first} → {self._namespace_mapping[first]}")
            return correlated
        else:
            # Unknown namespace — treat as parent agent
            logger.warning(
                f"[sse:correlate] Unknown namespace {first}, mapping has {list(self._namespace_mapping.keys())}"
            )
            return ()

    def accumulate_content(self, content: str) -> None:
        """Track accumulated content for later retrieval."""
        self._accumulated_content.append(content)

    def get_accumulated_content(self) -> str:
        """Return all accumulated content joined as a single string."""
        return "".join(self._accumulated_content)

    # ── Static/stateless methods ──────────────────────────

    @staticmethod
    def is_tool_message(msg: Any) -> bool:
        """Check if message is a ToolMessage (tool result, not for display)."""
        return "ToolMessage" in type(msg).__name__

    @staticmethod
    def has_tool_calls(msg: Any) -> bool:
        """Check if message is invoking tools (not generating content)."""
        return bool(getattr(msg, "tool_calls", None))

    @staticmethod
    def extract_content(msg: Any) -> str:
        """Extract and normalize content from a message chunk.

        Handles content as string or list of content blocks.
        """
        raw_content = getattr(msg, "content", "")
        if isinstance(raw_content, list):
            return "".join(block.get("text", "") if isinstance(block, dict) else str(block) for block in raw_content)
        return raw_content if isinstance(raw_content, str) else ""

    @staticmethod
    def extract_tool_call(tc: Any) -> dict[str, Any]:
        """Extract tool call info (name, id, args) from a tool call object or dict."""
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

    @staticmethod
    def truncate_args(args: dict[str, Any], max_len: int = 100) -> dict[str, Any]:
        """Truncate string values in args dict for display."""
        result = {}
        for k, v in args.items():
            if isinstance(v, str) and len(v) > max_len:
                result[k] = v[:max_len] + "..."
            else:
                result[k] = v
        return result
