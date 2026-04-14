# Streaming Comparison: v0.2.41 (Golden) vs v0.3.0

> Captured 2026-04-13 using `scripts/trace_a2a_streaming.py`.
> 0.2.41 runs with `USE_STRUCTURED_RESPONSE=false` (marker mode).
> 0.3.0 runs with `USE_STRUCTURED_RESPONSE=true` (ResponseFormat tool mode).

---

## Architecture Differences

| Aspect | v0.2.41 (Golden) | v0.3.0 |
|--------|-------------------|--------|
| Response mode | **Marker mode** (`[FINAL ANSWER]`) | **ResponseFormat tool** (`ToolStrategy(PlatformEngineerResponse)`) |
| Graph structure | Single LLM call, writes `[FINAL ANSWER]` then answer | Two-phase: supervisor LLM + `generate_structured_response` node (separate LLM call) |
| Streaming mechanism | Token-by-token from LLM after marker detected | Incremental JSON parsing of `PlatformEngineerResponse.content` field via `tool_call_chunks` |
| RAG enabled | No | Yes (adds 10-60s for search + fetch) |
| System prompt | Includes `[FINAL ANSWER]` section | Includes narration instructions (but LLM writes nothing before ResponseFormat) |

---

## Event Flow: Simple Query (`"what can you do?"`)

### v0.2.41 (Golden) - Total: 12.5s

| Time | A2A Event | Content | Slack Bot Sees |
|-----:|-----------|---------|----------------|
| 0.0s | HTTP POST `message/stream` | | Connection opened |
| 2.0s | `artifact` (streaming_result) | `"I'm an"` (6 chars) | **EventType.STREAMING_RESULT** - first content arrives. Opens stream (`startStream`). StreamBuffer begins accumulating. |
| 2.0-2.6s | `artifact` chunks | Word-by-word tokens | StreamBuffer accumulates; flushes on `\n\n` boundaries or 1s interval |
| 2.6-12.3s | `artifact` chunks (continuing) | ~216 chunks, gradual streaming | **User sees text building up word-by-word** in Slack |
| 12.5s | `artifact` (final_result) | Full text (2098 chars) | **EventType.FINAL_RESULT** — skipped (already streamed via STREAMING_RESULT). `stopStream` called. |
| 12.5s | `task_completed` | | Done |

**Slack UX**: Text appears at **2.0s**, builds up smoothly over **10.5s**. No dead gaps. No tool indicators.

### v0.3.0 - Total: 18.2s

| Time | A2A Event | Content | Slack Bot Sees |
|-----:|-----------|---------|----------------|
| 0.0s | HTTP POST `message/stream` | | Connection opened |
| 0.0-17.8s | *(silence)* | | **17.8s dead gap** — `generate_structured_response` LLM builds JSON preamble (`{"is_task_complete": true, ...}`). No events emitted. Slack shows typing indicator. |
| 17.8s | `artifact` (notification) | `"Composing answer..."` (23 chars) | **EventType.TOOL_NOTIFICATION_START** for `composing_answer` → `_set_typing_status("is composing the answer...")` |
| 17.8s | `artifact` (streaming_result) | `"\n# "` (3 chars) | **EventType.STREAMING_RESULT** with `is_final_answer=True`. Opens stream. StreamBuffer starts. |
| 17.8-18.2s | `artifact` chunks (burst) | ~290 chunks in 0.4s burst | StreamBuffer accumulates; most arrives in single flush |
| 18.2s | `artifact` (final_result) | Full text (2571 chars) | **EventType.FINAL_RESULT** — skipped (already streamed). `stopStream` called. |
| 18.2s | `task_completed` | | Done |

**Slack UX**: **17.8s of nothing** (typing indicator only), then entire answer appears in a ~0.4s burst. No gradual build-up.

---

## Event Flow: RAG Query (`"what is caipe?"`)

### v0.2.41 - Not available (RAG disabled)

0.2.41 does not have RAG enabled, so tool-triggering queries fall through to direct LLM response (no search/fetch). The LLM answers from its training data with marker-mode streaming.

### v0.3.0 - Total: 114.9s

| Time | A2A Event | Content | Slack Bot Sees |
|-----:|-----------|---------|----------------|
| 0.0s | HTTP POST | | Connection opened |
| 17.9s | `artifact` (streaming_result) | `"Workflow: Calling [RAG]..."` | **EventType.STREAMING_RESULT** — pre-stream text, shown as typing status |
| 17.9s | `artifact` (tool start) | `"Supervisor: Calling List_Datasources..."` | Tool start notification → typing indicator |
| 17.9s | `artifact` (tool end) | `"Supervisor: List_Datasources completed"` | Tool end |
| 19.1s | `artifact` (workflow) | `"Calling Search..."` x2 | RAG search started (parallel) |
| 19.1s | `artifact` (streaming_result) | `"Now let me run both"` | Narrative text — shown as typing status (stream not open yet) |
| 24.8-27.6s | `artifact` (streaming_result) | `"searches returned strong results..."` | More narrative; still typing status |
| 27.6s | `artifact` (workflow) | `"Search completed"` x2 | Search done |
| 63.3s | `artifact` (workflow) | `"Fetch_Document..."` x2 | RAG document fetch (parallel) |
| 65.0s | `artifact` (workflow) | `"Fetch completed"` x2 | Fetch done |
| 65.0-104.9s | `artifact` (streaming_result) | `"Synthesize findings..."` + text | Synthesis narrative; typing status |
| 104.9s | `artifact` (summary) | Research process summary (686 chars) | Narrative text |
| 114.6s | `artifact` (notification) | `"Composing answer..."` | `composing_answer` typing status |
| 114.6s | `artifact` (streaming_result) | `"# What is CAIPE?"` | **Stream opens** — `is_final_answer=True`. First real content. |
| 114.6-114.9s | `artifact` chunks (burst) | ~300 chunks in 0.3s | StreamBuffer flushes; answer appears as burst |
| 114.9s | `artifact` (final_result) | Full text (2870 chars) | Skipped (already streamed) |
| 114.9s | `task_completed` | | Done |

**Slack UX**: Typing indicator for **114.6s** with periodic status updates, then answer appears in a **0.3s burst**.

---

## Side-by-Side: What the User Sees in Slack

| Phase | v0.2.41 (Golden) | v0.3.0 |
|-------|-------------------|--------|
| **0-2s** | Typing indicator ("is thinking...") | Typing indicator ("is thinking...") |
| **2-5s** | Text streaming word-by-word | Still typing indicator (no events yet) |
| **5-12s** | Text continues building up gradually | Still typing indicator |
| **12s** | Complete (full answer visible) | Still typing indicator |
| **12-18s** | *(done)* | Still typing indicator → "is composing the answer..." |
| **18s** | *(done)* | **Entire answer appears at once** (burst) |

### Key UX Differences

| Metric | v0.2.41 (Golden) | v0.3.0 | Delta |
|--------|-------------------|--------|-------|
| Time to first visible content | **2.0s** | **17.8s** | +15.8s worse |
| Streaming duration (visible build-up) | **10.5s** | **0.4s** | -10.1s (no gradual feel) |
| Total time (simple query) | **12.5s** | **18.2s** | +5.7s worse |
| User perception | "Fast, responsive, building answer" | "Long wait, then dump" |

---

## Token Streaming Detail

### v0.2.41: Real Token-by-Token

```
t=2.0s  "I'm an"           → StreamBuffer
t=2.0s  " **"              → StreamBuffer
t=2.0s  "AI Platform Eng…" → StreamBuffer
t=2.6s  " auto"            → flush to Slack (1s interval)
t=2.6s  "mate, and coord…" → StreamBuffer
t=3.0s  " Capabilities"    → flush to Slack (\n\n boundary)
...continues for 10.5s...
```

Each token arrives ~400-500ms apart. StreamBuffer flushes on paragraph breaks (`\n\n`) or 1s time intervals, creating smooth visual progression.

### v0.3.0: Burst After JSON Parsing

```
t=0-17.8s   (silence — LLM building JSON: {"is_task_complete": true, "content": "...)
t=17.8s     "Composing answer..." → typing status
t=17.8s     "\n# "               → StreamBuffer (is_final_answer)
t=17.8s     "Hi! Here'"          → StreamBuffer
t=17.8s     "s what I "          → StreamBuffer
...290 chunks in 0.4s...
t=18.2s     (done)               → single flush
```

The incremental JSON parser extracts content tokens from the ResponseFormat tool_call_chunks, but they arrive in bursts because:
1. The `generate_structured_response` LLM must first write the JSON preamble before reaching the `content` key
2. Once content starts flowing, network buffering groups many tokens together
3. The effective streaming window is only ~0.4s

---

## Tool Notification Flow

### v0.2.41

Tools are called inline by the supervisor LLM. No dedicated tool notifications exist — the LLM simply writes narrative text between tool calls:

```
[LLM writes]: "Let me search the knowledge base..."
[tool executes]: search()
[LLM writes]: "Found 3 results. Let me analyze..."
[LLM writes]: "[FINAL ANSWER]\n# Answer here..."
              ↑ marker gate opens, streaming begins
```

Everything before `[FINAL ANSWER]` is suppressed. Only post-marker content reaches the client.

### v0.3.0

The supervisor emits tool notifications as structured events:

```
artifact: "Workflow: Calling [RAG] Search..."     → TOOL_NOTIFICATION_START
artifact: "Supervisor: Calling Agent Search..."    → TOOL_NOTIFICATION_START
artifact: "Supervisor: Agent task Search completed"→ TOOL_NOTIFICATION_END
artifact: "Composing answer..."                    → TOOL_NOTIFICATION_START (composing_answer)
artifact: (streaming_result chunks)                → STREAMING_RESULT (is_final_answer)
artifact: (final_result)                           → FINAL_RESULT
```

Slack maps these to typing statuses:
- Tool starts → `_set_typing_status("is working...")`
- `composing_answer` → `_set_typing_status("is composing the answer...")`
- First `is_final_answer` chunk → opens stream, begins `appendStream`

---

## Final Response Delivery

| Aspect | v0.2.41 | v0.3.0 |
|--------|---------|--------|
| Source of final text | LLM output after `[FINAL ANSWER]` marker | `PlatformEngineerResponse.content` field from ResponseFormat tool |
| Delivery mechanism | Token-by-token via marker gate | Incremental JSON parser extracting from `tool_call_chunks` |
| A2A artifact type | `streaming_result` (each token) → `final_result` (full text) | `streaming_result` (`is_final_answer=True`, each parsed token) → `final_result` (full text) |
| Duplication guard | `streaming_final_answer` flag in Slack bot | Same flag + `streaming_artifact_id` guard in agent_executor |
| Format | Raw markdown | Structured JSON with `is_task_complete`, `require_user_input`, `content` fields |
| Extra metadata | None | `was_task_successful`, `input_fields` (for HITL forms) |

---

## Slack Bot Event Processing Pipeline

```
A2A SSE Event
  │
  ├─ EventType.STREAMING_RESULT
  │    ├─ has is_final_answer? → latch streaming_final_answer = True
  │    ├─ pre-stream (no stream_ts)?
  │    │    ├─ plan step in progress? → accumulate in step_thinking
  │    │    └─ no plan? → show as typing status
  │    └─ stream open (stream_ts set)?
  │         └─ StreamBuffer.append(text)
  │              ├─ \n\n found? → flush to paragraph boundary
  │              ├─ 1s elapsed + ≥40 chars? → flush to last \n
  │              └─ else → keep buffering
  │
  ├─ EventType.FINAL_RESULT
  │    ├─ streaming_final_answer = True? → SKIP (already streamed)
  │    └─ not streamed? → StreamBuffer.append + flush
  │
  ├─ EventType.TOOL_NOTIFICATION_START
  │    ├─ composing_answer? → typing status "is composing the answer..."
  │    └─ other tool? → open stream if needed, no text pushed
  │
  ├─ EventType.TOOL_NOTIFICATION_END
  │    └─ update typing status, clear tool indicator
  │
  └─ EventType.EXECUTION_PLAN
       └─ update plan step cards, track step completion
```

---

## Root Cause: Why 0.3.0 Feels Worse

1. **`generate_structured_response` is a separate LLM call** that builds a full JSON response. The JSON schema requires `is_task_complete` and `require_user_input` before `content`, so the LLM writes ~100 tokens of JSON preamble before the first content character appears.

2. **No narration in structured mode.** The supervisor LLM (first call) goes directly to the ResponseFormat tool without writing any visible text. In marker mode (0.2.41), the same LLM writes thinking text + `[FINAL ANSWER]` + answer — all streamed.

3. **Network buffering collapses streaming.** Even with the incremental JSON parser extracting word-boundary-aligned deltas, the tokens arrive in bursts (grouped by HTTP chunk boundaries), not one-by-one like direct LLM streaming.

4. **RAG adds 60-100s of tool time** before the final answer. During this time, only typing status indicators are visible — no text streams.

---

## Recommendations

To restore v0.2.41's streaming UX in v0.3.0:

| Option | Approach | Tradeoff |
|--------|----------|----------|
| **A. Switch to marker mode** | Set `USE_STRUCTURED_RESPONSE=false` | Loses `PlatformEngineerResponse` metadata (input_fields, is_task_complete). Web UI needs adaptation. |
| **B. Hybrid mode** | Build graph in marker mode; construct structured response in `agent_executor.py` post-stream | Best of both: real streaming + structured A2A artifacts. See plan in `piped-pondering-patterson.md`. |
| **C. Narration bridge** | Emit LLM narrative text as streaming_result during tool execution | Addresses the gap but not the burst-vs-gradual issue. Already partially done via `composing_answer`. |
| **D. Pre-content streaming** | Parse JSON preamble tokens and emit synthetic "Preparing response..." events | Cosmetic fix; doesn't change the fundamental burst delivery. |

**Recommendation**: Option B (hybrid mode) gives the v0.2.41 golden UX for all clients while preserving structured output for web-UI.
