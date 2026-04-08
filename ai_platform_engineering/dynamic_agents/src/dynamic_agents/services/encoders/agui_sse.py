"""AG-UI protocol stream encoder for dynamic agents.

Produces **AG-UI protocol format** SSE frames. Composes a
``LangGraphStreamHelper`` for chunk parsing and namespace correlation.
Owns AG-UI-specific state (``active_message_ids``) for
TEXT_MESSAGE_START/END pairing. Emits CUSTOM(NAMESPACE_CONTEXT) for
subagent events.

Wire format examples::

    event: RUN_STARTED\\ndata: {"type":"RUN_STARTED","runId":"...","threadId":"..."}\\n\\n
    event: TEXT_MESSAGE_START\\ndata: {"type":"TEXT_MESSAGE_START","messageId":"..."}\\n\\n
    event: TEXT_MESSAGE_CONTENT\\ndata: {"type":"TEXT_MESSAGE_CONTENT",...}\\n\\n
    event: TOOL_CALL_START\\ndata: {"type":"TOOL_CALL_START","toolCallId":"...",...}\\n\\n
    event: TOOL_CALL_ARGS\\ndata: {"type":"TOOL_CALL_ARGS","toolCallId":"...","delta":"..."}\\n\\n
    event: TOOL_CALL_END\\ndata: {"type":"TOOL_CALL_END","toolCallId":"..."}\\n\\n
    event: RUN_FINISHED\\ndata: {"type":"RUN_FINISHED","runId":"...","threadId":"..."}\\n\\n

Self-contained — builds AG-UI SSE frames directly with plain dicts.
No dependency on ``ai_platform_engineering.utils.agui``.
"""

import json
import logging
import time
from typing import Any
from uuid import uuid4

from dynamic_agents.services.encoders import StreamEncoder
from dynamic_agents.services.langgraph_stream_helpers import LangGraphStreamHelper

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
# AG-UI SSE helpers
# ═══════════════════════════════════════════════════════════════


def _ts() -> float:
    """Current Unix timestamp."""
    return time.time()


def _new_id(prefix: str = "") -> str:
    """Generate a prefixed UUID4."""
    return f"{prefix}{uuid4()}"


def _sse_frame(event_type: str, data: dict[str, Any]) -> str:
    """Build an AG-UI SSE frame from event type and payload dict.

    The ``type`` field in data must already be set to the AG-UI event type.
    """
    raw = json.dumps(data, ensure_ascii=False)
    if "\n" in raw:
        data_lines = "\n".join(f"data: {line}" for line in raw.split("\n"))
    else:
        data_lines = f"data: {raw}"
    return f"event: {event_type}\n{data_lines}\n\n"


def _namespace_key(namespace: tuple[str, ...]) -> str:
    """Return a stable dict key for a namespace tuple."""
    return namespace[0] if namespace else ""


# ═══════════════════════════════════════════════════════════════
# AGUIStreamEncoder
# ═══════════════════════════════════════════════════════════════


class AGUIStreamEncoder(StreamEncoder):
    """Encodes LangGraph stream chunks to AG-UI protocol SSE format.

    Builds AG-UI events as plain dicts and serializes them directly.

    AG-UI-specific state:
    - ``_active_message_ids``: tracks open TEXT_MESSAGE per namespace key
      for proper START/END pairing.
    """

    def __init__(self) -> None:
        self._helper = LangGraphStreamHelper()
        self._active_message_ids: dict[str, str | None] = {}
        self._run_id: str = ""
        self._thread_id: str = ""

    # ── Core lifecycle ────────────────────────────────────

    def on_run_start(self, run_id: str, thread_id: str) -> list[str]:
        self._run_id = run_id
        self._thread_id = thread_id
        return [
            _sse_frame(
                "RUN_STARTED",
                {
                    "type": "RUN_STARTED",
                    "runId": run_id,
                    "threadId": thread_id,
                    "timestamp": _ts(),
                },
            )
        ]

    def on_chunk(self, chunk: tuple) -> list[str]:
        namespace, mode, data = self._helper.parse_chunk(chunk)
        if mode == "tasks":
            return []

        correlated_ns = self._helper.correlate_namespace(namespace)

        if mode == "messages":
            return self._handle_messages(data, correlated_ns)
        if mode == "updates":
            return self._handle_updates(data, correlated_ns)
        return []

    def on_stream_end(self) -> list[str]:
        """Close any still-open text messages."""
        frames: list[str] = []
        for ns_key, msg_id in self._active_message_ids.items():
            if msg_id is not None:
                frames.append(
                    _sse_frame(
                        "TEXT_MESSAGE_END",
                        {
                            "type": "TEXT_MESSAGE_END",
                            "messageId": msg_id,
                            "timestamp": _ts(),
                        },
                    )
                )
                self._active_message_ids[ns_key] = None
        return frames

    def on_run_finish(self, run_id: str, thread_id: str) -> list[str]:
        return [
            _sse_frame(
                "RUN_FINISHED",
                {
                    "type": "RUN_FINISHED",
                    "runId": run_id,
                    "threadId": thread_id,
                    "outcome": "success",
                    "timestamp": _ts(),
                },
            )
        ]

    def on_run_error(self, message: str, code: str | None = None) -> list[str]:
        data: dict[str, Any] = {
            "type": "RUN_ERROR",
            "message": message,
            "timestamp": _ts(),
        }
        if code is not None:
            data["code"] = code
        return [_sse_frame("RUN_ERROR", data)]

    def on_warning(self, message: str) -> list[str]:
        return [
            _sse_frame(
                "CUSTOM",
                {
                    "type": "CUSTOM",
                    "name": "WARNING",
                    "value": {"message": message, "namespace": []},
                    "timestamp": _ts(),
                },
            )
        ]

    def on_input_required(
        self,
        interrupt_id: str,
        prompt: str,
        fields: list[dict[str, Any]],
        agent: str,
    ) -> list[str]:
        """Emit RUN_FINISHED with outcome ``"interrupt"`` per the AG-UI spec.

        The interrupt payload carries form metadata so the UI can render a
        HITL form.  Because this *is* the RUN_FINISHED frame, the caller
        must **not** call ``on_run_finish`` afterwards.

        See https://docs.ag-ui.com/drafts/interrupts
        """
        return [
            _sse_frame(
                "RUN_FINISHED",
                {
                    "type": "RUN_FINISHED",
                    "runId": self._run_id,
                    "threadId": self._thread_id,
                    "outcome": "interrupt",
                    "interrupt": {
                        "id": interrupt_id,
                        "reason": "human_input",
                        "payload": {
                            "prompt": prompt,
                            "fields": fields,
                            "agent": agent,
                        },
                    },
                    "timestamp": _ts(),
                },
            )
        ]

    # ── Content retrieval ─────────────────────────────────

    def get_accumulated_content(self) -> str:
        return self._helper.get_accumulated_content()

    # ── Private: messages mode ────────────────────────────

    def _handle_messages(
        self,
        data: Any,
        namespace: tuple[str, ...],
    ) -> list[str]:
        """Handle 'messages' mode chunks -> AG-UI text content events.

        Emits TEXT_MESSAGE_START on the first content chunk for each
        namespace, TEXT_MESSAGE_CONTENT for each subsequent token.
        TEXT_MESSAGE_END is emitted in ``on_stream_end()`` or when an
        updates chunk arrives (see ``_handle_updates``).
        """
        if not isinstance(data, tuple) or len(data) != 2:
            return []

        msg_chunk, _metadata = data

        if LangGraphStreamHelper.is_tool_message(msg_chunk):
            return []
        if LangGraphStreamHelper.has_tool_calls(msg_chunk):
            return []

        content = LangGraphStreamHelper.extract_content(msg_chunk)
        if not content:
            return []

        self._helper.accumulate_content(content)

        ns_key = _namespace_key(namespace)
        frames: list[str] = []

        # Emit TEXT_MESSAGE_START the first time we see content for this namespace
        if self._active_message_ids.get(ns_key) is None:
            message_id = _new_id("msg-")
            self._active_message_ids[ns_key] = message_id
            if namespace:
                frames.append(
                    _sse_frame(
                        "CUSTOM",
                        {
                            "type": "CUSTOM",
                            "name": "NAMESPACE_CONTEXT",
                            "value": {"namespace": list(namespace)},
                            "timestamp": _ts(),
                        },
                    )
                )
            frames.append(
                _sse_frame(
                    "TEXT_MESSAGE_START",
                    {
                        "type": "TEXT_MESSAGE_START",
                        "messageId": message_id,
                        "role": "assistant",
                        "timestamp": _ts(),
                    },
                )
            )

        message_id = self._active_message_ids[ns_key]  # type: ignore[assignment]
        frames.append(
            _sse_frame(
                "TEXT_MESSAGE_CONTENT",
                {
                    "type": "TEXT_MESSAGE_CONTENT",
                    "messageId": message_id,
                    "delta": content,
                    "timestamp": _ts(),
                },
            )
        )
        return frames

    # ── Private: updates mode ─────────────────────────────

    def _handle_updates(
        self,
        data: Any,
        namespace: tuple[str, ...],
    ) -> list[str]:
        """Handle 'updates' mode chunks -> AG-UI tool events.

        Also closes any open TEXT_MESSAGE for this namespace when an
        updates chunk arrives (tool invocations interrupt the text stream).
        """
        results: list[str] = []

        if not isinstance(data, dict):
            return results

        ns_key = _namespace_key(namespace)

        # Close any open text message for this namespace before tool events
        if self._active_message_ids.get(ns_key) is not None:
            results.append(
                _sse_frame(
                    "TEXT_MESSAGE_END",
                    {
                        "type": "TEXT_MESSAGE_END",
                        "messageId": self._active_message_ids[ns_key],
                        "timestamp": _ts(),
                    },
                )
            )
            self._active_message_ids[ns_key] = None

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
                        tc_info = LangGraphStreamHelper.extract_tool_call(tc)
                        tool_name = tc_info["name"]
                        tool_call_id = tc_info["id"]
                        args = tc_info["args"]

                        logger.debug(f"[sse:TOOL_CALL_START] {tool_name} id={tool_call_id[:8]}... ns={namespace}")
                        if namespace:
                            results.append(
                                _sse_frame(
                                    "CUSTOM",
                                    {
                                        "type": "CUSTOM",
                                        "name": "NAMESPACE_CONTEXT",
                                        "value": {"namespace": list(namespace)},
                                        "timestamp": _ts(),
                                    },
                                )
                            )
                        results.append(
                            _sse_frame(
                                "TOOL_CALL_START",
                                {
                                    "type": "TOOL_CALL_START",
                                    "toolCallId": tool_call_id,
                                    "toolCallName": tool_name,
                                    "timestamp": _ts(),
                                },
                            )
                        )
                        results.append(
                            _sse_frame(
                                "TOOL_CALL_ARGS",
                                {
                                    "type": "TOOL_CALL_ARGS",
                                    "toolCallId": tool_call_id,
                                    "delta": json.dumps(LangGraphStreamHelper.truncate_args(args)),
                                    "timestamp": _ts(),
                                },
                            )
                        )

                # Handle ToolMessage (tool results)
                tool_call_id = getattr(msg, "tool_call_id", None)
                if tool_call_id:
                    content = getattr(msg, "content", "")
                    error = None
                    if isinstance(content, str) and content.startswith("ERROR: "):
                        error = content

                    logger.debug(f"[sse:TOOL_CALL_END] id={tool_call_id[:8]}... ns={namespace} error={bool(error)}")
                    if namespace:
                        results.append(
                            _sse_frame(
                                "CUSTOM",
                                {
                                    "type": "CUSTOM",
                                    "name": "NAMESPACE_CONTEXT",
                                    "value": {"namespace": list(namespace)},
                                    "timestamp": _ts(),
                                },
                            )
                        )
                    if error:
                        results.append(
                            _sse_frame(
                                "CUSTOM",
                                {
                                    "type": "CUSTOM",
                                    "name": "TOOL_ERROR",
                                    "value": {
                                        "tool_call_id": tool_call_id,
                                        "error": error,
                                    },
                                    "timestamp": _ts(),
                                },
                            )
                        )
                    results.append(
                        _sse_frame(
                            "TOOL_CALL_END",
                            {
                                "type": "TOOL_CALL_END",
                                "toolCallId": tool_call_id,
                                "timestamp": _ts(),
                            },
                        )
                    )

        return results
