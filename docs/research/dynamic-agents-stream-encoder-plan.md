# Dynamic Agents: Stream Encoder Abstraction Plan

## Problem

PR #1139 (`refactor/slack-streaming-simplification`) replaced the dynamic agents' internal
event format (plain dicts) with AG-UI Pydantic models at every layer — `stream_events.py`,
`agent_runtime.py`, and `chat.py`. This creates tight coupling:

- `stream_events.py` imports AG-UI types and returns `list[BaseAGUIEvent]` from every function
- `agent_runtime.py` yields `BaseAGUIEvent` models, embeds AG-UI lifecycle
  (RUN_STARTED/RUN_FINISHED, TEXT_MESSAGE_START/END) into business logic
- `chat.py` uses `format_sse_event()` from the AG-UI encoder exclusively
- The `/invoke` endpoint is broken — it does `event.get("type")` on Pydantic models
- The frontend (`da-streaming-client.ts`) still expects the old event vocabulary
  (`content`, `tool_start`, `done`) — event type mismatch with AG-UI names

There is no seam where you could swap, add, or remove protocols without rewriting the core.

## Goal

Support **both** the existing custom SSE format and AG-UI simultaneously, with loose
coupling so that:

- Adding a new protocol = writing one new encoder class that extends the ABC
- Removing a protocol = deleting one file
- No changes to `agent_runtime.py` or LangGraph parsing logic when protocols change
- The existing frontend works unchanged (custom SSE is the default)
- AG-UI can be opted into per-request via `?protocol=agui`

## Architecture

### Data Flow

```
LangGraph astream()
      |
      v  raw chunks (tuples)
      |
agent_runtime.py
      |  owns: cancellation, interrupt check, lifecycle orchestration
      |  calls encoder for all event production
      |
      |  CORE LIFECYCLE (abstract methods on StreamEncoder ABC):
      |-- encoder.on_run_start(run_id, thread_id) -> list[str]
      |-- encoder.on_chunk(chunk) -> list[str]
      |-- encoder.on_stream_end() -> list[str]
      |-- encoder.on_run_finish(run_id, thread_id) -> list[str]
      |-- encoder.on_run_error(message, code) -> list[str]
      |-- encoder.on_warning(message) -> list[str]
      |-- encoder.get_accumulated_content() -> str
      |
      |  BUSINESS EVENTS (generic dispatch, also on ABC):
      |-- encoder.on_event(EVENT_INPUT_REQUIRED, {...}) -> list[str]
      |-- encoder.on_event(EVENT_AGENT_HANDOFF, {...}) -> list[str]   # future
      |
      v  SSE frame strings
chat.py StreamingResponse
```

### Two Types of Encoder Methods

**Core lifecycle methods** — abstract, explicit. These are structural events generated
by `agent_runtime.py` and `chat.py` at fixed points in the stream. Every stream has a
start, chunks, an end, and possibly errors/warnings. These are not derived from agent
behavior — they are properties of the streaming infrastructure itself:

| Method | Called by | Purpose |
|---|---|---|
| `on_run_start(run_id, thread_id)` | agent_runtime — top of stream/resume | Stream begins |
| `on_chunk(chunk)` | agent_runtime — inside astream loop | Raw LangGraph chunk |
| `on_stream_end()` | agent_runtime — after astream loop exits | Flush buffered state |
| `on_run_finish(run_id, thread_id)` | agent_runtime — bottom of stream/resume | Successful completion |
| `on_run_error(message, code)` | chat.py — in except block | Unrecoverable error |
| `on_warning(message)` | agent_runtime — MCP server failures | Non-fatal issue |

**Utility method** — not a lifecycle event, but required on every encoder for content
retrieval (used by `/invoke` and logging):

| Method | Called by | Purpose |
|---|---|---|
| `get_accumulated_content()` | agent_runtime, chat.py /invoke | Return all streamed text |

**Business events** — generic dispatch via `on_event(name, data)`. These are derived from
what the agent actually does and are specific to our agent's capabilities. A future
protocol might not have these concepts or might express them differently:

| Constant | Value | Data | Purpose |
|---|---|---|---|
| `EVENT_INPUT_REQUIRED` | `"input_required"` | `{interrupt_id, prompt, fields, agent}` | HITL form |
| _(future constants)_ | _(varies)_ | _(varies)_ | New business events |

Event name constants are defined in `encoders/__init__.py`. Encoders handle known event
names in `on_event()` and silently ignore unknown ones. Adding a new business event means:

1. Add a new constant in `encoders/__init__.py`
2. Add the `encoder.on_event(NEW_CONSTANT, data)` call in `agent_runtime.py`
3. Handle the new event name in the encoders that care about it

The ABC itself never changes — `on_event(name, data)` is the stable dispatch interface.
`agent_runtime.py` does get a new call site per business event, but the change is a
single line, not a structural change.

### Shared Stateful Helper

Encoders compose a `LangGraphStreamHelper` instance that owns LangGraph-specific state
(namespace correlation, content accumulation). This avoids duplicating the same stateful
logic across every encoder while keeping protocol-specific state (e.g., AG-UI's
`active_message_ids`) inside the encoder itself.

```
LangGraphStreamHelper (one instance per encoder)
      |  owns: namespace_mapping, accumulated_content
      |  provides: parse_chunk(), correlate_namespace(), accumulate_content()
      |  plus static helpers: is_tool_message(), extract_content(), extract_tool_call(), etc.
      |
      v
Encoder (CustomStreamEncoder / AGUIStreamEncoder)
      |  extends: StreamEncoder ABC
      |  owns: protocol-specific state (e.g., active_message_ids for AG-UI)
      |  composes: self._helper = LangGraphStreamHelper()
```

### Key Principles

- **Lean ABC for core lifecycle + utilities** — the `StreamEncoder` ABC defines the
  core lifecycle methods that every stream must have (start, chunk, end, finish, error,
  warning), a generic `on_event` dispatch for business events, and one utility method
  (`get_accumulated_content`) for content retrieval. The lifecycle methods are runtime
  concerns, not protocol-specific. The utility method exists on the ABC because every
  encoder needs it (e.g., `/invoke` uses it to get the final response), but it is not
  a lifecycle event — it's a stateful accessor.
- **No intermediate event type** — no opinion on what events look like between
  LangGraph and the wire.
- **Business events through `on_event()`** — protocol-specific or agent-specific events
  (HITL, handoffs, etc.) go through the generic dispatch so the ABC never grows.
- **Event name constants** — business event names are string constants, not hardcoded
  strings scattered through the codebase.
- **Shared helper is opt-in** — encoders instantiate `LangGraphStreamHelper` for common
  LangGraph parsing but are free to do their own parsing.
- **State ownership is split by concern**:
  - LangGraph-specific state (`namespace_mapping`, `accumulated_content`) →
    `LangGraphStreamHelper`
  - Protocol-specific state (`active_message_ids`, etc.) → encoder class

## File Structure

### New/Changed Files

```
dynamic_agents/services/
  langgraph_stream_helpers.py        # NEW — stateful LangGraph parsing helper class
  encoders/
    __init__.py                      # NEW — StreamEncoder ABC, event constants, factory
    custom_sse.py                    # NEW — old SSE format for existing frontend
    agui_sse.py                      # NEW — AG-UI protocol format
  agent_runtime.py                   # EDIT — accept encoder param, yield strings
  stream_events.py                   # DELETE — contents split into helper + encoders

routes/
  chat.py                            # EDIT — ?protocol= query param, encoder selection
```

### Unchanged Files

| File | Why |
|---|---|
| `utils/agui/*` | Shared library — `agui_sse.py` imports from here |
| `agent_runtime.py` (non-stream parts) | `initialize()`, subagents, tools, cancel, cache — unrelated |
| `services/mcp_client.py` | No protocol involvement |
| Frontend files | No changes — existing frontend uses default `?protocol=custom` |

## Detailed File Plans

### 1. `services/langgraph_stream_helpers.py` (NEW)

A **stateful class** extracted from `stream_events.py`. Owns LangGraph-specific state
(namespace correlation, content accumulation) while also providing stateless static
helpers for message inspection and extraction. No event building, no protocol knowledge.

Encoders instantiate one `LangGraphStreamHelper` per stream and delegate all LangGraph
parsing to it, so namespace mapping and content tracking are never duplicated across
encoders.

```python
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

    def correlate_namespace(self, namespace: tuple[str, ...]) -> tuple[str, ...]:
        """Correlate using internal namespace_mapping.

        Replaces LangGraph internal UUID with the correlated tool_call_id.
        Unknown namespaces return empty tuple (treated as parent agent).
        """

    def accumulate_content(self, content: str) -> None:
        """Track accumulated content for later retrieval."""

    def get_accumulated_content(self) -> str:
        """Return all accumulated content joined as a single string."""

    # ── Static/stateless methods ──────────────────────────

    @staticmethod
    def is_tool_message(msg: Any) -> bool:
        """Check if message is a ToolMessage (tool result, not for display)."""

    @staticmethod
    def has_tool_calls(msg: Any) -> bool:
        """Check if message is invoking tools (not generating content)."""

    @staticmethod
    def extract_content(msg: Any) -> str:
        """Extract and normalize content from a message chunk.

        Handles content as string or list of content blocks.
        """

    @staticmethod
    def extract_tool_call(tc: Any) -> dict[str, Any]:
        """Extract tool call info (name, id, args) from a tool call object or dict."""

    @staticmethod
    def truncate_args(args: dict[str, Any], max_len: int = 100) -> dict[str, Any]:
        """Truncate string values in args dict for display."""
```

All of these already exist in `stream_events.py` (with `_` prefixes for the functions,
plus `_handle_tasks_chunk` / `_correlate_namespace` as free functions with explicit
`namespace_mapping` parameters). We consolidate them into a single class, making the
stateful parts instance methods and the stateless parts `@staticmethod`.

### 2. `services/encoders/__init__.py` (NEW)

Contains the `StreamEncoder` ABC, business event name constants, and the factory function.

```python
from abc import ABC, abstractmethod
from typing import Any


# ═══════════════════════════════════════════════════════════════
# Business Event Constants
#
# These are event names passed to on_event(). They represent business
# logic events (agent behavior, user interaction) — NOT runtime
# lifecycle events.
#
# IMPORTANT FOR FUTURE DEVELOPERS AND CODING AGENTS:
# - Add new constants here ONLY for business/agent-specific events
#   (e.g., HITL forms, agent handoffs, approval requests).
# - Do NOT add runtime lifecycle events here. If something is a
#   fundamental property of every stream (start, chunk, end, error,
#   warning), it belongs as an abstract method on StreamEncoder.
# - The distinction: lifecycle events happen regardless of what the
#   agent does; business events depend on agent behavior/capabilities.
# ═══════════════════════════════════════════════════════════════

EVENT_INPUT_REQUIRED = "input_required"
"""HITL: Agent requests user input via a form. Data contains
interrupt_id, prompt, fields, and agent name."""


# ═══════════════════════════════════════════════════════════════
# StreamEncoder ABC
# ═══════════════════════════════════════════════════════════════


class StreamEncoder(ABC):
    """Abstract base class for stream encoders.

    Defines the core lifecycle methods that every encoder must implement.
    These methods correspond to structural events in the stream that exist
    regardless of protocol — every stream has a start, chunks, an end,
    and possibly errors or warnings.

    IMPORTANT FOR FUTURE DEVELOPERS AND CODING AGENTS:
    Only add new abstract methods here if the event is a RUNTIME LIFECYCLE
    concern — something that happens at a fixed point in every stream,
    regardless of what the agent does. Examples: stream start, stream end,
    error, warning.

    Do NOT add abstract methods for business/agent-specific events like
    HITL forms, agent handoffs, or approval requests. Those should go
    through on_event(name, data) using a constant defined above.
    """

    @abstractmethod
    def on_run_start(self, run_id: str, thread_id: str) -> list[str]:
        """Stream is beginning. Called once at the top of stream/resume."""

    @abstractmethod
    def on_chunk(self, chunk: tuple) -> list[str]:
        """Process a raw LangGraph astream() chunk. Called per chunk."""

    @abstractmethod
    def on_stream_end(self) -> list[str]:
        """All chunks have been processed. Flush any buffered state."""

    @abstractmethod
    def on_run_finish(self, run_id: str, thread_id: str) -> list[str]:
        """Stream completed successfully."""

    @abstractmethod
    def on_run_error(self, message: str, code: str | None = None) -> list[str]:
        """Unrecoverable error terminated the stream."""

    @abstractmethod
    def on_warning(self, message: str) -> list[str]:
        """Non-fatal warning (e.g., MCP server unavailable)."""

    @abstractmethod
    def on_event(self, name: str, data: dict[str, Any]) -> list[str]:
        """Handle a business event by name.

        Encoders should handle known event names (see constants above)
        and silently return [] for unknown ones.
        """

    @abstractmethod
    def get_accumulated_content(self) -> str:
        """Return all accumulated text content from the stream."""


# ═══════════════════════════════════════════════════════════════
# Factory
# ═══════════════════════════════════════════════════════════════


def get_encoder(protocol: str = "custom") -> StreamEncoder:
    """Create an encoder for the given protocol.

    Args:
        protocol: "custom" (old SSE format) or "agui" (AG-UI protocol)
    """
    if protocol == "agui":
        from .agui_sse import AGUIStreamEncoder
        return AGUIStreamEncoder()
    from .custom_sse import CustomStreamEncoder
    return CustomStreamEncoder()
```

### 3. `services/encoders/custom_sse.py` (NEW)

Produces the **old SSE format** that `da-streaming-client.ts` already understands.
Composes a `LangGraphStreamHelper` for chunk parsing and namespace correlation.
No protocol-specific state beyond what the helper provides.

```python
from typing import Any

from dynamic_agents.services.encoders import EVENT_INPUT_REQUIRED, StreamEncoder
from dynamic_agents.services.langgraph_stream_helpers import LangGraphStreamHelper


class CustomStreamEncoder(StreamEncoder):
    """Encodes to the original custom SSE format.

    Wire format examples:
        event: content\ndata: {"text": "hello", "namespace": []}\n\n
        event: tool_start\ndata: {"tool_name": "search", "tool_call_id": "tc-1", ...}\n\n
        event: tool_end\ndata: {"tool_call_id": "tc-1", "namespace": []}\n\n
        event: warning\ndata: {"message": "...", "namespace": []}\n\n
        event: input_required\ndata: {"interrupt_id": "...", ...}\n\n
        event: error\ndata: {"error": "..."}\n\n
        event: done\ndata: {}\n\n
    """

    def __init__(self):
        self._helper = LangGraphStreamHelper()

    # ── Core lifecycle ────────────────────────────────────

    def on_run_start(self, run_id: str, thread_id: str) -> list[str]:
        return []  # Old format has no run_started event

    def on_chunk(self, chunk: tuple) -> list[str]:
        namespace, mode, data = self._helper.parse_chunk(chunk)
        if mode == "tasks":
            return []  # Helper already updated its namespace mapping

        correlated_ns = self._helper.correlate_namespace(namespace)

        if mode == "messages":
            # Filter via static helpers, extract content, accumulate
            # Return ["event: content\ndata: {\"text\": \"...\", ...}\n\n"]
            ...

        if mode == "updates":
            # Extract tool calls via static helpers
            # Return ["event: tool_start\n..." / "event: tool_end\n..."]
            ...

        return []

    def on_stream_end(self) -> list[str]:
        return []  # No state to flush in custom format

    def on_run_finish(self, run_id: str, thread_id: str) -> list[str]:
        return [_sse_frame("done", {})]

    def on_run_error(self, message: str, code: str | None = None) -> list[str]:
        return [_sse_frame("error", {"error": message})]

    def on_warning(self, message: str) -> list[str]:
        return [_sse_frame("warning", {"message": message, "namespace": []})]

    # ── Business events ───────────────────────────────────

    def on_event(self, name: str, data: dict[str, Any]) -> list[str]:
        if name == EVENT_INPUT_REQUIRED:
            return [_sse_frame("input_required", data)]
        return []

    # ── Content retrieval ─────────────────────────────────

    def get_accumulated_content(self) -> str:
        return self._helper.get_accumulated_content()
```

Contains a module-level `_sse_frame(event_type, data)` helper function that produces
a complete SSE frame string from an event type and a data dict. This is the custom
protocol's equivalent of AG-UI's `format_sse_event()`:

```python
import json


def _sse_frame(event_type: str, data: dict[str, Any]) -> str:
    """Build a complete SSE frame string.

    Handles newlines in JSON data by splitting into multiple `data:` lines
    per the SSE spec. Extracted from the old `chat.py::_encode_sse_data()`.

    Returns:
        "event: {type}\\ndata: {json}\\n\\n"
    """
    raw = json.dumps(data)
    if "\n" in raw:
        lines = raw.split("\n")
        sse_data = "\n".join(f"data: {line}" for line in lines)
    else:
        sse_data = f"data: {raw}"
    return f"event: {event_type}\n{sse_data}\n\n"
```

Also contains the SSE encoding logic previously in `chat.py::_generate_sse_events()` (the
`json.dumps` + newline-safe encoding + `event: {type}\ndata: {json}\n\n` formatting).

### 4. `services/encoders/agui_sse.py` (NEW)

Produces **AG-UI protocol format**. Composes a `LangGraphStreamHelper` for chunk parsing
and namespace correlation. Owns AG-UI-specific state (`active_message_ids`) for
TEXT_MESSAGE_START/END pairing. Emits CUSTOM(NAMESPACE_CONTEXT) for subagent events.

```python
from typing import Any

from ai_platform_engineering.utils.agui import (
    emit_custom, emit_run_error, emit_run_finished, emit_run_started,
    emit_text_content, emit_text_end, emit_text_start, emit_tool_end,
    emit_tool_start, format_sse_event,
)
from dynamic_agents.services.encoders import EVENT_INPUT_REQUIRED, StreamEncoder
from dynamic_agents.services.langgraph_stream_helpers import LangGraphStreamHelper


class AGUIStreamEncoder(StreamEncoder):
    """Encodes to AG-UI protocol SSE format.

    Wire format examples:
        event: RUN_STARTED\ndata: {"type":"RUN_STARTED","runId":"...","threadId":"..."}\n\n
        event: TEXT_MESSAGE_START\ndata: {"type":"TEXT_MESSAGE_START","messageId":"..."}\n\n
        event: TEXT_MESSAGE_CONTENT\ndata: {"type":"TEXT_MESSAGE_CONTENT",...}\n\n
        event: TOOL_CALL_START\ndata: {"type":"TOOL_CALL_START","toolCallId":"...",...}\n\n
        event: CUSTOM\ndata: {"type":"CUSTOM","name":"TOOL_ARGS","value":{...}}\n\n
        event: TOOL_CALL_END\ndata: {"type":"TOOL_CALL_END","toolCallId":"..."}\n\n
        event: RUN_FINISHED\ndata: {"type":"RUN_FINISHED","runId":"...","threadId":"..."}\n\n

    Uses the shared utils/agui/ module for Pydantic models and format_sse_event().
    """

    def __init__(self):
        self._helper = LangGraphStreamHelper()
        # AG-UI-specific state: tracks open TEXT_MESSAGE per namespace key
        self._active_message_ids: dict[str, str | None] = {}

    # ── Core lifecycle ────────────────────────────────────

    def on_run_start(self, run_id: str, thread_id: str) -> list[str]:
        event = emit_run_started(run_id=run_id, thread_id=thread_id)
        return [format_sse_event(event)]

    def on_chunk(self, chunk: tuple) -> list[str]:
        namespace, mode, data = self._helper.parse_chunk(chunk)
        if mode == "tasks":
            return []  # Helper already updated its namespace mapping

        correlated_ns = self._helper.correlate_namespace(namespace)

        if mode == "messages":
            # Filter via static helpers, extract content
            # First content per namespace:
            #   -> CUSTOM(NAMESPACE_CONTEXT) if subagent
            #   -> TEXT_MESSAGE_START
            #   -> TEXT_MESSAGE_CONTENT
            # Subsequent content:
            #   -> TEXT_MESSAGE_CONTENT
            # Accumulate content via self._helper.accumulate_content()
            ...

        if mode == "updates":
            # Close open text message for this namespace -> TEXT_MESSAGE_END
            # Tool calls:
            #   -> CUSTOM(NAMESPACE_CONTEXT) if subagent
            #   -> TOOL_CALL_START + CUSTOM(TOOL_ARGS)
            # Tool results:
            #   -> TOOL_CALL_END + optional CUSTOM(TOOL_ERROR)
            ...

        return []

    def on_stream_end(self) -> list[str]:
        frames: list[str] = []
        for ns_key, msg_id in self._active_message_ids.items():
            if msg_id is not None:
                frames.append(format_sse_event(emit_text_end(message_id=msg_id)))
                self._active_message_ids[ns_key] = None
        return frames

    def on_run_finish(self, run_id: str, thread_id: str) -> list[str]:
        event = emit_run_finished(run_id=run_id, thread_id=thread_id)
        return [format_sse_event(event)]

    def on_run_error(self, message: str, code: str | None = None) -> list[str]:
        event = emit_run_error(message=message, code=code)
        return [format_sse_event(event)]

    def on_warning(self, message: str) -> list[str]:
        event = emit_custom(name="WARNING", value={"message": message, "namespace": []})
        return [format_sse_event(event)]

    # ── Business events ───────────────────────────────────

    def on_event(self, name: str, data: dict[str, Any]) -> list[str]:
        if name == EVENT_INPUT_REQUIRED:
            event = emit_custom(name="INPUT_REQUIRED", value=data)
            return [format_sse_event(event)]
        return []

    # ── Content retrieval ─────────────────────────────────

    def get_accumulated_content(self) -> str:
        return self._helper.get_accumulated_content()
```

### 5. `services/agent_runtime.py` (EDIT)

Changes:

- **Remove imports** from `stream_events` and `utils.agui`
- **Add imports** from `encoders` (`StreamEncoder`, `EVENT_INPUT_REQUIRED`)
- **Add** `encoder: StreamEncoder` parameter to `stream()` and `resume()`
- **Generate** `run_id` locally (just `f"run-{uuid4().hex[:12]}"`)
- **Replace** all event yields with encoder method calls
- **Remove** `active_message_ids` tracking (encoder owns protocol-specific state)
- **Remove** `accumulated_content` tracking (helper inside encoder owns this)
- **Remove** `namespace_mapping` tracking (helper inside encoder owns this)
- **Remove** deprecated `event_adapter` parameter
- **Use** `on_event()` with constants for business events

The `stream()` method becomes:

```python
from dynamic_agents.services.encoders import EVENT_INPUT_REQUIRED, StreamEncoder

async def stream(
    self,
    message: str,
    session_id: str,
    user_id: str,
    trace_id: str | None = None,
    encoder: StreamEncoder | None = None,
) -> AsyncGenerator[str, None]:
    """Stream agent response for a user message.

    Yields SSE frame strings produced by the encoder. The encoder handles
    all protocol-specific formatting — this method only orchestrates the
    LangGraph stream lifecycle.
    """
    if not self._initialized:
        await self.initialize()

    self._cancelled = False
    config = self._build_stream_config(session_id, user_id, trace_id)
    run_id = f"run-{uuid4().hex[:12]}"

    logger.info(f"[stream] Starting: agent='{self.config.name}', user={user_id}, conv={session_id}")

    # ── Core lifecycle: run start ──
    yield from encoder.on_run_start(run_id, session_id)

    # ── Core lifecycle: warnings ──
    for server_name in self._failed_servers:
        yield from encoder.on_warning(
            f"MCP server '{server_name}' is unavailable. Tools from this server will not work.",
        )

    # ── Core lifecycle: chunks ──
    async for chunk in self._graph.astream(
        {"messages": [{"role": "user", "content": message}]},
        config=config,
        stream_mode=["messages", "updates", "tasks"],
        subgraphs=True,
    ):
        if self._cancelled:
            logger.info(f"[stream] Cancelled: agent='{self.config.name}', conv={session_id}")
            return
        for frame in encoder.on_chunk(chunk):
            yield frame

    # ── Core lifecycle: stream end (flush) ──
    for frame in encoder.on_stream_end():
        yield frame

    # ── Business event: HITL interrupt check ──
    interrupt_data = await self.has_pending_interrupt(session_id)
    if interrupt_data:
        yield from encoder.on_event(EVENT_INPUT_REQUIRED, interrupt_data)
        return

    # ── Core lifecycle: run finish ──
    logger.info(
        f"[stream] Completed: agent='{self.config.name}', conv={session_id}, "
        f"content_length={len(encoder.get_accumulated_content())}"
    )
    yield from encoder.on_run_finish(run_id, session_id)
```

Same pattern for `resume()`.

### 6. `routes/chat.py` (EDIT)

Changes:

- **Remove** `agui` imports (`format_sse_event`, `emit_run_error`)
- **Remove** manual SSE encoding logic (`_encode_sse_data`, json wrapping)
- **Add** `protocol` query param to `start-stream` and `resume-stream`
- **Import** `get_encoder` from `encoders`
- **Pass** encoder to `runtime.stream()` / `runtime.resume()`
- **Fix** `/invoke` to use `encoder.get_accumulated_content()`

```python
from dynamic_agents.services.encoders import get_encoder

@router.post("/start-stream")
async def chat_start_stream(
    request: ChatRequest,
    protocol: str = Query(default="custom", pattern="^(custom|agui)$"),
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> StreamingResponse:
    ...
    encoder = get_encoder(protocol)
    return StreamingResponse(
        _generate_sse_events(agent, mcp_servers, request.message, ..., encoder),
        media_type="text/event-stream",
        ...
    )

async def _generate_sse_events(
    agent_config, mcp_servers, message, session_id, user, trace_id, mongo, encoder
):
    try:
        runtime = await cache.get_or_create(agent_config, mcp_servers, session_id, user=user)
        async for frame in runtime.stream(message, session_id, user.email, trace_id, encoder):
            yield frame
    except Exception as e:
        for frame in encoder.on_run_error(str(e)):
            yield frame
```

For `/invoke`:

```python
@router.post("/invoke")
async def chat_invoke(request, user, mongo):
    ...
    encoder = get_encoder("custom")  # Always custom for invoke
    async for _frame in runtime.stream(request.message, ..., encoder):
        pass  # Frames are SSE strings, we don't need them
    return {
        "success": True,
        "content": encoder.get_accumulated_content(),
        ...
    }
```

### 7. `services/stream_events.py` (DELETE)

All contents have been split:

- Helper functions → `langgraph_stream_helpers.py` (as a stateful class + static methods)
- Custom event builders + chunk handling → `encoders/custom_sse.py`
- AG-UI event builders + AG-UI-specific chunk handling → `encoders/agui_sse.py`

## Protocol Selection

The protocol is selected per-request via query parameter:

```
POST /chat/start-stream?protocol=custom   # Default — old SSE format
POST /chat/start-stream?protocol=agui     # AG-UI protocol
```

The frontend currently uses the default (`custom`). When ready to migrate:

1. Add `?protocol=agui` to the stream URL in `da-streaming-client.ts`
2. Update `mapToAgentEvent()` to handle AG-UI event type names
3. Eventually flip the default and remove `custom_sse.py`

## Coupling Comparison

### Old Code (main branch)

| Layer | Protocol coupling |
|---|---|
| `stream_events.py` returns `list[dict]` | None — pure dicts |
| `agent_runtime.py` yields `dict` | None — has `event_adapter` hook |
| `chat.py` formats dicts to SSE | Light — custom SSE only |

### PR #1139

| Layer | Protocol coupling |
|---|---|
| `stream_events.py` returns `list[BaseAGUIEvent]` | Heavy — AG-UI Pydantic models everywhere |
| `agent_runtime.py` yields `BaseAGUIEvent` | Heavy — AG-UI lifecycle embedded in business logic |
| `chat.py` uses `format_sse_event()` | Total — AG-UI only |

### This Plan

| Layer | Protocol coupling |
|---|---|
| `langgraph_stream_helpers.py` | None — stateful class with pure parsing utilities |
| `agent_runtime.py` calls `encoder.*()`, yields `str` | Lean — typed via `StreamEncoder` ABC |
| `chat.py` creates encoder via factory | Light — just `get_encoder(protocol)` |
| `encoders/custom_sse.py` | Self-contained custom SSE logic |
| `encoders/agui_sse.py` | Self-contained AG-UI logic, imports `utils/agui/` |

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| AG-UI encoder duplicates some logic from custom encoder | Both compose `LangGraphStreamHelper` — only protocol-specific formatting differs |
| `/invoke` needs content but we yield strings now | `get_accumulated_content()` delegates to helper inside encoder |
| Breaking existing frontend | `protocol=custom` is the default — zero frontend changes |
| Future protocol needs data we stripped | Encoders get raw LangGraph chunks — nothing is stripped |
| New business event added | Add a constant, use `on_event()` — ABC doesn't change |
| ABC grows with protocol-specific methods | Comments on ABC explicitly warn: only add runtime lifecycle, not business events |
