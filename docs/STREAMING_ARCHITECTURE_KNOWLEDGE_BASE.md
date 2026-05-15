# Streaming Architecture Knowledge Base: v0.2.41 vs v0.3.0

> **Date**: 2026-04-13 to 2026-04-14
> **Authors**: Sri Aradhyula, Claude (Opus 4.6)
> **Purpose**: Preserve institutional knowledge from the streaming regression investigation and remediation between CAIPE v0.2.41 ("golden") and v0.3.0.
>
> **See also**: [Streaming Comparison](./streaming-comparison.md) for the side-by-side event timeline and raw artifact dumps.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture: Two Response Modes](#2-architecture-two-response-modes)
3. [Root Cause Analysis: Why 0.3.0 Felt Worse](#3-root-cause-analysis-why-030-felt-worse)
4. [Measured Streaming Timelines](#4-measured-streaming-timelines)
5. [What We Fixed (0.3.0 Streaming Restoration)](#5-what-we-fixed-030-streaming-restoration)
6. [Streaming Pipeline: Component-by-Component](#6-streaming-pipeline-component-by-component)
7. [Metadata Flags: is_narration vs is_final_answer](#7-metadata-flags-is_narration-vs-is_final_answer)
8. [StreamBuffer: Flush Strategy Deep Dive](#8-streambuffer-flush-strategy-deep-dive)
9. [Middleware Toggle System](#9-middleware-toggle-system)
10. [Client Handling: Slack vs UI](#10-client-handling-slack-vs-ui)
11. [Comparison Data and Tooling](#11-comparison-data-and-tooling)
12. [Lessons Learned](#12-lessons-learned)
13. [Decision Log](#13-decision-log)
14. [File Reference](#14-file-reference)

---

## 1. Executive Summary

CAIPE v0.2.41 used **marker mode** (`[FINAL ANSWER]`) for streaming — the LLM wrote a marker token, and everything after it was streamed token-by-token to clients. v0.3.0 switched to **ResponseFormat structured mode** (a separate LLM call producing JSON with `PlatformEngineerResponse` schema). This caused a **UX regression**: users saw 15-18 seconds of dead silence followed by a burst of text, instead of the gradual word-by-word build-up they experienced in 0.2.41.

**Resolution**: We kept both response modes but defaulted back to marker mode (`USE_STRUCTURED_RESPONSE=false`). We also fixed several streaming bugs in the marker path that had accumulated, added `is_narration` metadata propagation for proper client handling, fixed a StreamBuffer regression, and added middleware toggles to reduce latency.

**Key metrics** (simple query "what can you do?"):

| Metric | v0.2.41 | v0.3.0 (structured) | v0.3.0 (fixed marker) |
|--------|---------|----------------------|----------------------|
| Time to first visible content | 2.0s | 17.8s | ~2.0s (restored) |
| Streaming duration (gradual) | 10.5s | 0.4s (burst) | ~10s (restored) |
| Total response time | 12.5s | 18.2s | ~12s (restored) |

---

## 2. Architecture: Two Response Modes

### Marker Mode (`USE_STRUCTURED_RESPONSE=false`) — Default

```
User query
  → LangGraph supervisor (single LLM call)
    → LLM writes thinking text: "Let me search..."
    → LLM calls tools (RAG search, fetch_document, etc.)
    → LLM writes: "[FINAL ANSWER]\n# Here's the answer..."
                    ↑ marker gate opens
    → Everything after marker streams token-by-token to client
    → Pre-marker text is tagged is_narration (typing status)
```

**Key code**: `agent.py` lines 1290-1351 (marker gate logic)

The `_pre_marker_buffer` accumulates all LLM output. A tail holdback of `_MARKER_MAX_LEN` (16 chars) prevents partial marker text like `[FINAL` from leaking. When `[FINAL ANSWER]` (or `[FINAL_ANSWER]`) is found:
- Everything before the marker is discarded (already yielded as `is_narration`)
- Everything after is yielded with `is_final_answer: True`
- `_strip_post_marker_newlines` strips leading `\n\r` from the first post-marker chunk

### Structured Response Mode (`USE_STRUCTURED_RESPONSE=true`)

```
User query
  → LangGraph supervisor (first LLM call — planning/tools)
    → LLM calls tools, writes thinking text (not streamed)
  → generate_structured_response node (second LLM call)
    → LLM writes JSON: {"is_task_complete": true, "content": "..."}
    → Incremental JSON parser extracts content field
    → Word-boundary buffer (_rf_word_buffer) aligns on _BOUNDARY_CHARS
    → Parsed tokens yield with is_final_answer: True
```

**Key code**: `agent.py` lines 1161-1186 (ResponseFormat capture), word-boundary logic for incremental JSON parsing

**Why structured mode exists**: It provides machine-readable fields (`is_task_complete`, `require_user_input`, `input_fields`) needed for HITL (Human-in-the-Loop) forms in the web UI. Marker mode cannot provide these structured fields.

---

## 3. Root Cause Analysis: Why 0.3.0 Felt Worse

### Primary cause: Two-phase LLM architecture

The `generate_structured_response` node is a **separate LLM call** after the supervisor finishes. It must write the full JSON schema preamble (`{"is_task_complete": true, "require_user_input": false, "content": "`) before any content character appears. This adds ~15s of dead time.

### Secondary causes

1. **No narration in structured mode.** The first LLM call (supervisor) goes directly to tool calls without writing visible text. In marker mode, the same LLM writes thinking text that becomes `is_narration` events.

2. **Network buffering collapses streaming.** Even with incremental JSON parsing, tokens arrive in HTTP-chunk-aligned bursts, not one-by-one like direct LLM streaming. The effective streaming window shrinks from ~10s to ~0.4s.

3. **RAG adds 60-100s of tool time** before the final answer. During this time, only typing status indicators are visible.

4. **StreamBuffer regression.** 0.3.0 changed the flush trigger from `\n` (line) to `\n\n` (paragraph), which meant tokens accumulated longer before flushing, making the burst effect worse.

5. **`_last_flush` initialization bug.** `StreamBuffer.__init__` set `_last_flush = time.monotonic()`, so the first interval flush calculation included LLM think time (~15s). By the time tokens arrived, the interval had long expired and everything flushed at once.

---

## 4. Measured Streaming Timelines

### Simple Query: "what can you do?"

**v0.2.41 (marker mode, 12.5s total)**:
```
0.0s  HTTP POST message/stream → connection opened
2.0s  streaming_result: "I'm an" (6 chars) → StreamBuffer opens, first content visible
2.0-12.3s  ~216 token chunks, gradual streaming → user sees text building word-by-word
12.5s  final_result (2098 chars) → stream stops, complete
```

**v0.3.0 (structured mode, 18.2s total)**:
```
0.0s  HTTP POST → connection opened
0.0-17.8s  SILENCE (LLM building JSON preamble) → typing indicator only
17.8s  "Composing answer..." notification → typing status update
17.8s  streaming_result: "\n# " (3 chars) → stream opens
17.8-18.2s  ~290 chunks in 0.4s BURST → entire answer appears at once
18.2s  final_result → done
```

### RAG Query: "what is caipe?" (0.3.0 only, ~115s)

```
0.0s    HTTP POST
17.9s   tool_notification_start: "Calling [RAG] Search..."
17.9s   streaming_result: "Workflow: Calling [RAG]..." (is_narration)
19.1-27.6s  Tool calls: search, list_datasources, fetch_document
63.3-65.0s  More fetch_document calls
65.0-104.9s  Narration: "Synthesize findings..." (is_narration → typing status)
114.6s  "Composing answer..." notification
114.6s  streaming_result: "# What is CAIPE?" (is_final_answer) → stream opens
114.6-114.9s  ~300 chunks in 0.3s burst
114.9s  final_result → done
```

### A2A Artifact Comparison: Same Query ("show caipe setup options")

| Metric | v0.3.0 | v0.2.41 |
|--------|--------|---------|
| Total artifacts | 18 | 4 |
| Unique artifact types | 5 | 4 |
| Tool notifications (start/end) | 7/7 | 1/1 |
| streaming_result count | 1 | 1 |
| Total streaming parts | 288 | 268 |
| Total streaming text | 3225 chars | 11583 chars |
| has `is_final_answer` | True | False |
| has `is_narration` | False | False |
| has `execution_plan` | True | False |
| Final artifact name | `final_result` | `partial_result` |

**Key finding**: 0.2.41 leaked LLM narration ("Excellent! I now have comprehensive information...") directly into the `streaming_result`. This is visible to users. In 0.3.0, pre-answer narration is properly suppressed (or tagged `is_narration`).

---

## 5. What We Fixed (0.3.0 Streaming Restoration)

### Fix 1: Marker gate buffer flush at tool-call boundaries

**File**: `agent.py` lines 1126-1141

**Problem**: When the LLM wrote narration text ("I'll search the knowledge base...") followed by a tool call, the narration got trapped in `_pre_marker_buffer` because the tool-call `continue` statement skipped the marker gate logic. The buffer wouldn't flush until the next content token, which might not arrive for 30-60s during RAG tool execution.

**Fix**: Flush `_pre_marker_buffer` at every tool-call boundary, before the per-tool `continue` guards. The flushed content is tagged `is_narration: True`.

```python
# agent.py line 1132
if not USE_STRUCTURED_RESPONSE and _pre_marker_buffer and not _final_answer_seen:
    yield {
        "content": _pre_marker_buffer,
        "is_narration": True,
    }
    _pre_marker_buffer = ""
```

### Fix 2: Narration extraction from tool-call AIMessageChunks

**File**: `agent.py` lines 1202-1230

**Problem**: The LLM often writes narration text *in the same message* as a tool call (e.g., "I'll search the knowledge base" + `search()` tool_call). The old code had a `USE_STRUCTURED_RESPONSE` guard that prevented narration extraction in marker mode. This meant narration was lost when using marker mode.

**Fix**: Removed the `USE_STRUCTURED_RESPONSE` guard. Narration from tool-call chunks now always yields with `is_narration: True`, regardless of response mode.

```python
# agent.py line 1212 — no mode guard
if hasattr(message, "content") and message.content:
    _narration = message.content
    # ... extract text, filter out tool_use blocks ...
    if isinstance(_narration, str) and _narration.strip():
        yield {"content": _narration, "is_narration": True}
```

### Fix 3: `is_narration` metadata propagation through A2A

**File**: `agent_executor.py` lines 840-842

**Problem**: `agent.py` yields `is_narration: True` on events, but `agent_executor.py` (which wraps events into A2A artifacts) wasn't copying this flag to artifact metadata. Clients couldn't distinguish narration from final answer content.

**Fix**: 3-line addition that propagates `is_narration` to artifact metadata.

```python
# agent_executor.py line 840
if event.get('is_narration'):
    artifact.metadata = artifact.metadata or {}
    artifact.metadata['is_narration'] = True
```

### Fix 4: Slack bot — narration as typing status, not stream content

**File**: `ai.py` lines 370-376

**Problem**: Without `is_narration` handling, narration text would be streamed to the user as if it were the answer, or open the stream prematurely.

**Fix**: When `is_narration` is detected, show a static typing status message instead of streaming the text.

```python
# ai.py line 374
if artifact_meta.get("is_narration"):
    _set_typing_status("is responding...")
    continue  # skip streaming this to the user
```

### Fix 5: StreamBuffer reverted to 0.2.41 line-flush logic

**File**: `ai.py` lines 33-102

**Problem**: 0.3.0 changed the flush trigger from `\n` to `\n\n` (paragraph boundaries). This was a regression — tokens accumulated much longer before flushing, making streaming feel like a dump rather than gradual build-up.

**Fix**: Reverted to `\n` (newline boundary) flush. Verified by diffing against `git show 0.2.41:ai_platform_engineering/integrations/slack_bot/utils/ai.py` — the restored code is identical to production 0.2.41.

**Also fixed**: `_last_flush` initialization. Changed from `time.monotonic()` (set at init, stale from LLM think time) to `None` (set on first `append()` call). This prevents the interval safety net from triggering a premature mega-flush.

```python
# ai.py line 49
self._last_flush = None  # set on first append, not init

# ai.py line 61-62 (in append())
if self._last_flush is None:
    self._last_flush = now  # start interval from first token
```

### Fix 6: Thread-safe debug counter

**File**: `ai.py` (module level)

**Problem**: `_token_seq` used `global _token_seq; _token_seq += 1` which is not thread-safe under concurrent Slack event threads. Python's GIL doesn't protect `+= 1` (it's LOAD + ADD + STORE, which can interleave).

**Fix**: Replaced with `itertools.count(1)` and `next(_token_seq)`, which is atomic at the Python level.

```python
# Old (thread-unsafe):
_token_seq = 0
# ... inside function:
global _token_seq
_token_seq += 1

# New (thread-safe):
_token_seq = __import__("itertools").count(1)
# ... inside function:
seq = next(_token_seq)
```

### Fix 7: Middleware toggles for latency reduction

**File**: `deep_agent.py` lines 113-121

**Problem**: Optional middleware (DeterministicTaskMiddleware, SelfServiceMiddleware, PolicyMiddleware, SkillsMiddleware, FileArgMiddleware) added latency for every request. No way to disable them without code changes.

**Fix**: Added `ENABLE_MIDDLEWARE` master switch + 5 individual toggles. All default to `true` for backwards compatibility.

```python
ENABLE_MIDDLEWARE = os.getenv("ENABLE_MIDDLEWARE", "true").lower() == "true"
ENABLE_DETERMINISTIC_MIDDLEWARE = ENABLE_MIDDLEWARE and os.getenv("ENABLE_DETERMINISTIC_MIDDLEWARE", "true").lower() == "true"
# ... etc for SELF_SERVICE, POLICY, SKILLS, FILE_ARG
```

---

## 6. Streaming Pipeline: Component-by-Component

### Full pipeline (marker mode, A2A → Slack):

```
LangGraph supervisor LLM
  │
  ▼ (AIMessageChunk with content or tool_calls)
agent.py stream() generator
  │
  ├─ Tool call detected?
  │    ├─ Flush _pre_marker_buffer (is_narration: True)
  │    ├─ Extract narration from message.content (is_narration: True)
  │    └─ Yield tool_notification_start event
  │
  ├─ Content token (no tool call)?
  │    ├─ _pre_marker_buffer += content
  │    ├─ Check buffer for [FINAL ANSWER] or [FINAL_ANSWER]
  │    │    ├─ Found → _final_answer_seen = True, yield post-marker with is_final_answer: True
  │    │    └─ Not found → yield safe prefix (buffer - _MARKER_MAX_LEN) with is_narration: True
  │    └─ Post-marker tokens → yield with is_final_answer: True
  │
  └─ ToolMessage (tool result)?
       └─ Yield tool_notification_end event
  │
  ▼ (yield dicts with content, is_narration, is_final_answer, tool_call)
agent_executor.py _handle_streaming_chunk()
  │
  ├─ Wraps yield dict into A2A Artifact
  ├─ Copies is_final_answer → artifact.metadata.is_final_answer
  ├─ Copies is_narration → artifact.metadata.is_narration
  ├─ Copies plan_step_id → artifact.metadata.plan_step_id
  └─ Sends artifact via SSE event_queue
  │
  ▼ (A2A SSE events: data: {result: {artifact: {...}}})
Slack bot stream_a2a_response()
  │
  ├─ STREAMING_RESULT:
  │    ├─ is_narration? → _set_typing_status("is responding..."), skip
  │    ├─ is_final_answer? → latch streaming_final_answer = True
  │    ├─ No stream_ts yet? → _set_typing_status("is responding..."), skip
  │    └─ Stream open? → StreamBuffer.append(text)
  │         ├─ \n found? → flush up to last \n
  │         ├─ 1s interval? → flush all
  │         └─ else → keep buffering
  │
  ├─ FINAL_RESULT:
  │    ├─ streaming_final_answer? → SKIP (already streamed)
  │    └─ Not streamed? → StreamBuffer.append + flush
  │
  ├─ TOOL_NOTIFICATION_START:
  │    └─ _start_stream_if_needed(), show tool indicator
  │
  └─ EXECUTION_PLAN_STATUS_UPDATE:
       └─ Update plan_steps dict, track current_step_id
```

### Full pipeline (marker mode, A2A → Web UI):

```
A2A SSE events
  │
  ▼
ChatPanel.tsx (lines 605-609)
  │
  ├─ is_final_answer? → appendMessage(text) — main chat bubble
  └─ else → pushThinking(text) — collapsible "thinking" section
       │
       ▼
  timeline-manager.ts pushThinking()
    → AgentTimeline.tsx renders with variant="thinking"
    → Collapsible machinery section (expand to see narration)
```

---

## 7. Metadata Flags: is_narration vs is_final_answer

### Flag semantics

| Flag | Set when | Meaning | Slack behavior | UI behavior |
|------|----------|---------|----------------|-------------|
| `is_narration: True` | Pre-marker thinking text, buffer flush at tool boundary | LLM is thinking/planning, not answering | `_set_typing_status("is responding...")` | `pushThinking()` → collapsible section |
| `is_final_answer: True` | Post-`[FINAL ANSWER]` marker content | This is the real answer | Latch `streaming_final_answer`, open stream, `StreamBuffer.append()` | `appendMessage()` → chat bubble |
| Neither flag | Tool notifications, plan updates | System events | Handled by specific event type handlers | Handled by specific event type handlers |

### Mutual exclusivity

Pre-marker content is **always** `is_narration: True`, never `is_final_answer: True`.
Post-marker content is **always** `is_final_answer: True`, never `is_narration: True`.
These paths are mutually exclusive in `agent.py` — the `_final_answer_seen` flag gates the transition.

### Edge case: both flags

If a coding error or future change somehow sets both flags, clients should treat `is_final_answer` as dominant (the content is the real answer, even if tagged as narration). The current code makes this impossible, but the principle is documented for safety.

---

## 8. StreamBuffer: Flush Strategy Deep Dive

### Flush triggers (in priority order)

1. **Newline boundary** (`\n` in buffer): Flush up to and including the last `\n`, keep the remainder. This prevents split markdown (e.g., `**bold` in one flush and ` text**` in the next).

2. **Interval safety net** (1.0s since last flush): If no newline has appeared for 1 second, flush everything. Prevents content from stalling.

### Why `\n` and not `\n\n`

The 0.3.0 codebase briefly used `\n\n` (paragraph boundary) flushes. This was a regression:

- **Markdown tables** use `\n` between rows. With `\n\n` flush, an entire table accumulates before any row is visible.
- **Bullet lists** use single `\n` between items. With `\n\n`, the entire list buffers.
- **The 0.2.41 production code used `\n`** and ran without issues for months. We verified by diffing: `git show 0.2.41:ai_platform_engineering/integrations/slack_bot/utils/ai.py`.

### Slack rate limit analysis

Concern: more frequent flushing from `\n` vs `\n\n` could hit Slack rate limits on `chat_appendStream`.

Findings:
- 0.2.41 used `\n` flush in production for months without rate limit issues
- `chat_appendStream` is a low-tier endpoint (not the rate-limited `chat.postMessage`)
- Typical answer has 20-40 `\n` characters → 20-40 flushes over 10-12s → ~3 flushes/second
- Slack's streaming API is designed for this exact use case

### `_last_flush = None` fix

The bug: `StreamBuffer.__init__` set `_last_flush = time.monotonic()`. If the LLM took 15 seconds to think before producing tokens, the first `append()` call would see `elapsed = 15.0s` which is `>= flush_interval (1.0s)`, triggering an immediate interval flush of whatever partial content was in the buffer. This could flush a single token like `"#"` before enough context accumulated for markdown to render correctly.

The fix: Set `_last_flush = None` in `__init__`. On the first `append()`, if `_last_flush is None`, set it to `now`. This starts the interval clock from the first real token, not from object creation.

---

## 9. Middleware Toggle System

### Architecture

```python
# deep_agent.py lines 116-121
ENABLE_MIDDLEWARE = os.getenv("ENABLE_MIDDLEWARE", "true").lower() == "true"  # master switch
ENABLE_DETERMINISTIC_MIDDLEWARE = ENABLE_MIDDLEWARE and os.getenv("...", "true").lower() == "true"
ENABLE_SELF_SERVICE_MIDDLEWARE  = ENABLE_MIDDLEWARE and os.getenv("...", "true").lower() == "true"
ENABLE_POLICY_MIDDLEWARE        = ENABLE_MIDDLEWARE and os.getenv("...", "true").lower() == "true"
ENABLE_SKILLS_MIDDLEWARE        = ENABLE_MIDDLEWARE and os.getenv("...", "true").lower() == "true"
ENABLE_FILE_ARG_MIDDLEWARE      = ENABLE_MIDDLEWARE and os.getenv("...", "true").lower() == "true"
```

### Behavior

| Env var | Effect |
|---------|--------|
| `ENABLE_MIDDLEWARE=false` | Disables ALL 5 optional middleware. Only `ModelRetryMiddleware` remains. |
| `ENABLE_MIDDLEWARE=true` (default) + individual=false | Disables only that specific middleware |
| `ENABLE_MIDDLEWARE=false` + individual=true | Individual **stays disabled** (master switch wins) |

### Why this exists

Middleware (especially `SelfServiceMiddleware` and `DeterministicTaskMiddleware`) adds latency by injecting extra tool calls (`write_todos`, `invoke_self_service_task`). For simple queries, this overhead is wasted. The toggle lets deployments disable middleware globally for faster responses, or selectively disable specific middleware.

---

## 10. Client Handling: Slack vs UI

### Slack bot (`ai.py`)

```
is_narration=True  → _set_typing_status("is responding...") → NOT streamed
is_final_answer=True → latch streaming_final_answer → StreamBuffer.append()
Neither → depends on context (plan step, tool notification, etc.)
```

Static typing message ("is responding...") rather than dynamic narration text. Reason: dynamic text ("I'll search the knowledge base...") changes too fast and creates flickering in the typing indicator.

### Web UI (`ChatPanel.tsx`)

```
is_final_answer=True → appendMessage(text) → main chat bubble (visible)
Everything else → pushThinking(text) → collapsible "thinking" section
```

The UI doesn't check `is_narration` explicitly — it checks `is_final_answer` and routes everything else to thinking. This means narration naturally goes to the collapsible section without special handling.

---

## 11. Comparison Data and Tooling

### Scripts created for this investigation

| Script | Purpose |
|--------|---------|
| `scripts/capture_a2a_events.py` | Captures all A2A SSE events from a supervisor into JSON. Supports both SSE and JSON-RPC response modes. |
| `scripts/trace_a2a_streaming.py` | Traces streaming timeline with timing, chunk sizes, and summary stats. Uses raw `http.client` for minimal dependencies. |
| `docker-compose.compare-041.yaml` | Runs 0.2.41 Slack bot pointing to a 0.2.41 supervisor for side-by-side comparison in real Slack channels. |

### Comparison reports

| File | Content |
|------|---------|
| `docs/streaming-comparison-030-vs-041.md` | Side-by-side artifact dump: 18 artifacts (0.3.0) vs 4 artifacts (0.2.41) for "show caipe setup options" |
| `docs/docs/STREAMING_COMPARISON_041_vs_030.md` | Detailed event-flow timelines, token streaming analysis, Slack bot processing pipeline, root cause analysis |

### How to reproduce the comparison

```bash
# Terminal 1: Run 0.2.41 supervisor on port 8041
docker compose -f docker-compose.compare-041.yaml up -d

# Terminal 2: Capture 0.2.41 events
python scripts/capture_a2a_events.py http://localhost:8041/ "what can you do?" /tmp/events-041.json

# Terminal 3: Capture 0.3.0 events
python scripts/capture_a2a_events.py http://localhost:8000/ "what can you do?" /tmp/events-030.json

# Terminal 4: Trace timeline
python scripts/trace_a2a_streaming.py 8041 "what can you do?"
python scripts/trace_a2a_streaming.py 8000 "what can you do?"
```

---

## 12. Lessons Learned

### 1. Streaming UX is not about throughput, it's about time-to-first-token

0.3.0's structured mode delivered the same total content as 0.2.41 marker mode, but **15.8 seconds later** with no gradual progression. Users perceive waiting 18 seconds then seeing everything at once as much worse than waiting 2 seconds then watching text build up over 10 seconds — even though the total wait is similar.

### 2. Two-phase LLM architectures kill streaming

Any architecture where a second LLM call generates the final response (e.g., `generate_structured_response`) introduces a dead gap between the first call ending and the second call's content appearing. The JSON preamble in structured responses makes this worse.

### 3. Separate response format concerns from streaming concerns

The decision to use `PlatformEngineerResponse` schema (for `is_task_complete`, `require_user_input`, HITL forms) is orthogonal to how tokens are streamed. A hybrid approach — marker-mode streaming with post-hoc structured wrapping — gives both the streaming UX and the structured metadata.

### 4. Test against production, not against mocks

The StreamBuffer `\n\n` regression was only caught by comparing against the actual 0.2.41 code (`git show 0.2.41:...`). Mock-based tests wouldn't have caught this because the mock itself encoded the wrong assumption.

### 5. Metadata flags need end-to-end testing

`is_narration` was set correctly in `agent.py`, but wasn't propagated through `agent_executor.py` to A2A artifacts. Unit testing each component in isolation wouldn't catch this — you need integration tests that verify the full pipeline from agent yield to client consumption.

### 6. The `_last_flush` initialization bug is a class of problem

Any time you initialize a timer/counter at object creation but the object isn't used until much later, you risk stale calculations. The pattern `_last_X = None; if _last_X is None: _last_X = now` is the standard fix.

### 7. Thread safety in Python requires explicit attention

Even with the GIL, `+= 1` is not atomic (it's `LOAD_FAST` + `BINARY_ADD` + `STORE_FAST`, which can interleave between threads at bytecode boundaries). Use `itertools.count()` for lock-free incrementing or `threading.Lock` for general mutual exclusion.

### 8. Middleware latency adds up

Five middleware layers, each potentially adding tool calls (write_todos, invoke_self_service_task, etc.), can add seconds to every request. Toggles let deployments trade features for speed.

---

## 13. Decision Log

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-04-13 | Default to marker mode (`USE_STRUCTURED_RESPONSE=false`) | Structured mode's streaming UX is fundamentally limited by two-phase architecture |
| 2026-04-13 | Keep structured mode code in place | Web UI HITL features need `PlatformEngineerResponse` fields; can be re-enabled per-deployment |
| 2026-04-13 | Use static "is responding..." for narration typing status | Dynamic narration text causes flickering; static message is calmer UX |
| 2026-04-13 | Revert StreamBuffer to `\n` flush (matching 0.2.41) | `\n\n` was a regression; 0.2.41 production proved `\n` is safe for Slack rate limits |
| 2026-04-14 | Add middleware toggles as env vars | Lets deployments reduce latency without code changes; defaults preserve backwards compatibility |
| 2026-04-14 | Tag pre-marker content as `is_narration` not `is_final_answer` | Narration is "thinking" text, not the answer; clients need to distinguish for proper UX |

---

## 14. File Reference

### Modified files (in this PR)

| File | What changed |
|------|-------------|
| `protocol_bindings/a2a/agent.py` | Marker gate buffer flush, narration extraction, stale comment fix |
| `protocol_bindings/a2a/agent_executor.py` | `is_narration` metadata propagation (3 lines) |
| `integrations/slack_bot/utils/ai.py` | Narration handler, StreamBuffer revert, thread-safe counter, debug logging |
| `multi_agents/platform_engineer/deep_agent.py` | Middleware toggle env vars |

### Test files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/test_marker_gate_buffer_flush.py` | 45 | Marker gate logic, buffer flush, tail holdback, ResponseFormat word buffer, JSON extraction, narration extraction |
| `tests/test_narration_metadata_propagation.py` | 12 | is_narration/is_final_answer metadata in A2A artifacts |
| `tests/test_slack_narration_typing_status.py` | 37 | Narration→typing, StreamBuffer, final answer latch, safety filters |
| `tests/test_middleware_toggles.py` | 23 | Master switch, individual toggles, case sensitivity, RAG toggle |
| `tests/test_streaming_e2e.py` | 12 | Full A2A SSE streaming (integration, requires running supervisor) |

### Comparison artifacts

| File | Purpose |
|------|---------|
| `docs/streaming-comparison-030-vs-041.md` | Raw artifact comparison data |
| `docs/docs/STREAMING_COMPARISON_041_vs_030.md` | Detailed timeline analysis and recommendations |
| `docs/STREAMING_ARCHITECTURE_KNOWLEDGE_BASE.md` | This document |
| `scripts/capture_a2a_events.py` | A2A event capture tool |
| `scripts/trace_a2a_streaming.py` | Streaming timeline tracer |
| `docker-compose.compare-041.yaml` | Side-by-side 0.2.41 comparison stack |
