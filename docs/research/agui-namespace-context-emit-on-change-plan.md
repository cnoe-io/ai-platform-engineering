# AG-UI: Emit NAMESPACE_CONTEXT on Change Plan

## Problem

The AG-UI encoder (`agui_sse.py`) emits `CUSTOM(NAMESPACE_CONTEXT)` events to tell the
client which agent (root or subagent) produced the subsequent SSE events. Today this
emission has two bugs:

### Bug 1: Concurrent subagent content interleaving

`NAMESPACE_CONTEXT` is only emitted before `TEXT_MESSAGE_START`, not before individual
`TEXT_MESSAGE_CONTENT` deltas. When two subagents stream content simultaneously, their
deltas interleave on the single SSE connection. The client maintains a single
`currentNamespace` variable (`agui-adapter.ts:62`), so after agent B's
`NAMESPACE_CONTEXT` arrives, subsequent content deltas from agent A are misattributed
to agent B:

```
NAMESPACE_CONTEXT → ["agent-A"]       ← currentNamespace = ["agent-A"]
TEXT_MESSAGE_START                     ← OK
TEXT_MESSAGE_CONTENT "hello"          ← attributed to ["agent-A"] ✓
NAMESPACE_CONTEXT → ["agent-B"]       ← currentNamespace = ["agent-B"]
TEXT_MESSAGE_START                     ← OK
TEXT_MESSAGE_CONTENT "world"          ← attributed to ["agent-B"] ✓
TEXT_MESSAGE_CONTENT " from A"        ← attributed to ["agent-B"] ✗ WRONG
```

### Bug 2: Root namespace blind spot

The emission guard is `if namespace:`, which skips empty tuples. When execution returns
from a subagent to the root agent, no `NAMESPACE_CONTEXT` is emitted.  The client's
`currentNamespace` stays set to the subagent's namespace, so root agent events are
misattributed to the last active subagent.

### Why the custom encoder doesn't have this problem

The custom encoder (`custom_sse.py`) embeds `namespace` inline in every event's JSON
payload. Each event is self-identifying — no client-side state needed.

## Context: How Namespace Works Today

### Backend (encoder side)

AG-UI spec events (`TEXT_MESSAGE_*`, `TOOL_CALL_*`) don't have a `namespace` field.
The encoder works around this by emitting a `CUSTOM` event with
`name: "NAMESPACE_CONTEXT"` before events that belong to a subagent:

```
event: CUSTOM
data: {"type":"CUSTOM","name":"NAMESPACE_CONTEXT","value":{"namespace":["tool_call_123"]}}

event: TEXT_MESSAGE_START
data: {"type":"TEXT_MESSAGE_START","messageId":"msg-abc","role":"assistant"}
```

Currently, `NAMESPACE_CONTEXT` is emitted at 3 locations in `agui_sse.py`:
- Before `TEXT_MESSAGE_START` (line 253-264) — only on first content for a namespace
- Before `TOOL_CALL_START` (line 343-354) — per tool call
- Before `TOOL_CALL_END` (line 387-398) — per tool result

All 3 have the guard `if namespace:` (non-empty tuple only), duplicating ~12 lines each.

### Frontend (adapter side)

`AGUIStreamAdapter` (`agui-adapter.ts`) maintains stateful tracking:

```typescript
private currentNamespace: string[] = [];  // line 62
```

Updated when `NAMESPACE_CONTEXT` arrives (line 309-311):

```typescript
case CUSTOM_NAMESPACE_CONTEXT:
    this.currentNamespace = (value?.namespace as string[]) || [];
    return false;
```

All subsequent events inherit `this.currentNamespace` when invoking callbacks
(lines 222, 239, 256).

## Solution: `_emit_namespace_if_changed`

Replace all 3 scattered `if namespace:` + inline `_sse_frame(NAMESPACE_CONTEXT)` blocks
with a single `_emit_namespace_if_changed` method that:

1. Tracks `_last_emitted_namespace` (initialized to `()`)
2. Compares current namespace to the last emitted one
3. Only emits `NAMESPACE_CONTEXT` when they differ
4. Also add a call before `TEXT_MESSAGE_CONTENT` to handle mid-stream namespace switches

### Key properties

- **Root events are handled correctly**: switching from `("agent-A",)` back to `()` emits
  `NAMESPACE_CONTEXT(namespace=[])` because `() != ("agent-A",)`
- **No redundant emissions**: consecutive events in the same namespace produce zero
  `NAMESPACE_CONTEXT` frames (short-circuits on equality check)
- **Concurrent interleaving is fixed**: every actual context switch, including mid-stream
  content deltas, gets a `NAMESPACE_CONTEXT` event

## Changes

### File: `agui_sse.py` (only file modified)

#### Change 1: Update module docstring (lines 4-7)

```python
# OLD:
Owns AG-UI-specific state (``active_message_ids``) for
TEXT_MESSAGE_START/END pairing. Emits CUSTOM(NAMESPACE_CONTEXT) for
subagent events.

# NEW:
Owns AG-UI-specific state (``_active_message_ids`` for
TEXT_MESSAGE_START/END pairing, ``_last_emitted_namespace`` for
change-based NAMESPACE_CONTEXT emission).
```

#### Change 2: Update class docstring (lines 78-81)

```python
# OLD:
    AG-UI-specific state:
    - ``_active_message_ids``: tracks open TEXT_MESSAGE per namespace key
      for proper START/END pairing.

# NEW:
    AG-UI-specific state:
    - ``_active_message_ids``: tracks open TEXT_MESSAGE per namespace key
      for proper START/END pairing.
    - ``_last_emitted_namespace``: tracks the most recently emitted
      NAMESPACE_CONTEXT to avoid redundant emissions and ensure correct
      attribution when concurrent subagent events interleave.
```

#### Change 3: Add `_last_emitted_namespace` field to `__init__` (after line 85)

```python
# OLD:
    def __init__(self) -> None:
        self._helper = LangGraphStreamHelper()
        self._active_message_ids: dict[str, str | None] = {}
        self._run_id: str = ""
        self._thread_id: str = ""

# NEW:
    def __init__(self) -> None:
        self._helper = LangGraphStreamHelper()
        self._active_message_ids: dict[str, str | None] = {}
        self._last_emitted_namespace: tuple[str, ...] = ()
        self._run_id: str = ""
        self._thread_id: str = ""
```

#### Change 4: Add `_emit_namespace_if_changed` method (after `get_accumulated_content`, before `_handle_messages`)

Insert between the `# ── Content retrieval` section and `# ── Private: messages mode`:

```python
    # ── Namespace tracking ────────────────────────────────

    def _emit_namespace_if_changed(self, namespace: tuple[str, ...]) -> list[str]:
        """Emit NAMESPACE_CONTEXT only when the namespace has changed.

        Tracks ``_last_emitted_namespace`` to avoid redundant emissions.
        This ensures correct attribution when concurrent subagent events
        interleave on a single SSE connection — the client updates its
        ``currentNamespace`` state from these events.
        """
        if namespace == self._last_emitted_namespace:
            return []
        self._last_emitted_namespace = namespace
        return [
            _sse_frame(
                "CUSTOM",
                {
                    "type": "CUSTOM",
                    "name": "NAMESPACE_CONTEXT",
                    "value": {"namespace": list(namespace)},
                    "timestamp": _ts(),
                },
            )
        ]
```

#### Change 5: Replace inline NAMESPACE_CONTEXT before `TEXT_MESSAGE_START` (lines 249-275)

```python
# OLD:
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

# NEW:
        # Emit TEXT_MESSAGE_START the first time we see content for this namespace
        if self._active_message_ids.get(ns_key) is None:
            message_id = _new_id("msg-")
            self._active_message_ids[ns_key] = message_id
            frames.extend(self._emit_namespace_if_changed(namespace))
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
```

#### Change 6: Add namespace sync before `TEXT_MESSAGE_CONTENT` (line 277)

This is the **key bug fix** for concurrent interleaving.

```python
# OLD:
        message_id = self._active_message_ids[ns_key]  # type: ignore[assignment]
        frames.append(
            _sse_frame(
                "TEXT_MESSAGE_CONTENT",
                ...
            )
        )

# NEW:
        message_id = self._active_message_ids[ns_key]  # type: ignore[assignment]
        frames.extend(self._emit_namespace_if_changed(namespace))
        frames.append(
            _sse_frame(
                "TEXT_MESSAGE_CONTENT",
                ...
            )
        )
```

#### Change 7: Replace inline NAMESPACE_CONTEXT before `TOOL_CALL_START` (lines 342-354)

```python
# OLD:
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

# NEW:
                        logger.debug(f"[sse:TOOL_CALL_START] {tool_name} id={tool_call_id[:8]}... ns={namespace}")
                        results.extend(self._emit_namespace_if_changed(namespace))
```

#### Change 8: Replace inline NAMESPACE_CONTEXT before `TOOL_CALL_END` (lines 386-398)

```python
# OLD:
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

# NEW:
                    logger.debug(f"[sse:TOOL_CALL_END] id={tool_call_id[:8]}... ns={namespace} error={bool(error)}")
                    results.extend(self._emit_namespace_if_changed(namespace))
```

## Files NOT changed (and why)

| File | Why no change |
|---|---|
| `ui/src/lib/streaming/agui-adapter.ts` | Already handles `NAMESPACE_CONTEXT` correctly at line 309-311. Will receive more accurate context switches. |
| `custom_sse.py` | Custom encoder embeds namespace inline per-event. Unaffected. |
| `langgraph_stream_helpers.py` | Namespace correlation logic is unchanged. |
| `ui/src/lib/streaming/callbacks.ts` | Protocol-agnostic callback interface. Unchanged. |
| `ui/src/lib/timeline-manager.ts` | Consumes namespace from `StreamEvent`. Unchanged. |
| `ui/src/store/chat-store.ts` | Stores/collapses events by namespace. Unchanged. |

## Behavioral Impact

| Scenario | Before | After |
|---|---|---|
| Single agent (root only) | No `NAMESPACE_CONTEXT` emitted | No `NAMESPACE_CONTEXT` emitted (initial `_last_emitted_namespace = ()` matches `namespace = ()`) |
| Single subagent | `NAMESPACE_CONTEXT` before `TEXT_MESSAGE_START`, `TOOL_CALL_START`, `TOOL_CALL_END` only | Same, plus switching back to root emits `NAMESPACE_CONTEXT(namespace=[])` |
| Concurrent subagents, interleaved content | Content deltas misattributed after namespace switch | `NAMESPACE_CONTEXT` emitted at every actual context switch, content correctly attributed |
| Same namespace, many content deltas | No redundant emits | No redundant emits (`namespace == _last_emitted_namespace` short-circuits) |

## Net Code Impact

- **Removed:** ~36 lines of duplicated inline `if namespace: results.append(_sse_frame(...))` blocks (3 locations)
- **Added:** ~20 lines for `_emit_namespace_if_changed` method + 3 one-line call sites + 1 new call site before `TEXT_MESSAGE_CONTENT`
- **Net:** ~16 fewer lines, less duplication, one bug fixed

## Wire Format Example: Concurrent Subagents (After Fix)

```
NAMESPACE_CONTEXT → ["agent-A"]       ← emitted (changed from [])
TEXT_MESSAGE_START
TEXT_MESSAGE_CONTENT "hello"          ← attributed to ["agent-A"] ✓

NAMESPACE_CONTEXT → ["agent-B"]       ← emitted (changed from ["agent-A"])
TEXT_MESSAGE_START
TEXT_MESSAGE_CONTENT "world"          ← attributed to ["agent-B"] ✓

NAMESPACE_CONTEXT → ["agent-A"]       ← emitted (changed from ["agent-B"]) ← BUG FIX
TEXT_MESSAGE_CONTENT " from A"        ← attributed to ["agent-A"] ✓

TEXT_MESSAGE_CONTENT " still A"       ← no NAMESPACE_CONTEXT needed, same ns ✓
```
