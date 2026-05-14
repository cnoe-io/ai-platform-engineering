# Feature Specification: Slack Streaming Conformance & Benchmark

**Feature Branch**: `fix/1120-streaming-artifact-id-reset`  
**Created**: 2026-04-09  
**Status**: Implemented  
**Related**: `098-unify-single-distributed-binding` (parent spec — RAG caps, binding unification)  
**Input**: Fix three streaming regressions discovered during live Slack testing, add a conformance test suite and benchmark enforcement rule.

## Overview

This spec covers the end-to-end Slack streaming pipeline conformance: ensuring every query type — simple chat, off-topic, and RAG-heavy — delivers the full answer via live word-by-word streaming without artifact ID resets, swallowed responses, or premature graph termination.

It defines a conformance test suite (`tests/simulate_slack_stream.py --suite`) that validates 4 scenarios with 22 checks, a benchmark document (`tests/STREAMING_CONFORMANCE.md`), and a Cursor enforcement rule (`.cursor/rules/streaming-conformance.mdc`) that triggers the suite on any edit to the streaming pipeline.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Live Word-by-Word Final Answer Streaming (Priority: P1)

As a user interacting via Slack, I want the final answer to stream word-by-word via `appendStream` calls instead of arriving as a single block in `stopStream`, so that I see progressive text rendering.

**Why this priority**: A previous fix to prevent artifact ID resets replaced live post-`[FINAL ANSWER]` yields with a `continue` statement. This eliminated UI stutter but also eliminated live streaming — the answer only appeared at the end in `stopStream.chunks`.

**Design**:
- `agent.py`: Restored live yield of post-`[FINAL ANSWER]` content with `is_final_answer: True` metadata. Each chunk increments `yielded_chunk_count`, which tells the executor to skip its deterministic chunker (content already streamed).
- `agent_executor.py`: Non-tool-notification `STREAMING_RESULT` artifacts with `is_final_answer` in the event propagate that flag into `artifact.metadata`, allowing the Slack bot to latch `streaming_final_answer=True`.

**Acceptance Scenarios**:

1. **Given** a RAG query (e.g., "what is agntcy"), **When** the model generates a final answer, **Then** the answer streams word-by-word via `appendStream` calls (not deferred to `stopStream.chunks`).
2. **Given** `STREAMING_RESULT` events with `is_final_answer=True` metadata, **When** the Slack bot receives them, **Then** `streaming_final_answer` is latched to `True` and the subsequent `FINAL_RESULT` event is skipped (no duplicate output).

---

### User Story 2 - Per-Tool RAG Cap Isolation (Priority: P1)

As a user asking a RAG query, I want `fetch_document` to continue working even when `search` has hit its call cap, so that the model can retrieve and synthesize from documents it already found.

**Why this priority**: A global `_rag_hard_stop_set` flag was set when *any* RAG tool hit its cap. The `DeterministicTaskMiddleware` checked this global flag and prematurely terminated the graph, preventing uncapped tools from executing. This caused complete answer loss for Slack queries.

**Design**:
- `rag_tools.py`: Replaced `_rag_hard_stop_set` with `_rag_capped_tools: dict[str, set[str]]` mapping thread IDs to sets of *specific* capped tool names. Added `is_rag_tool_capped(thread_id, tool_name)` for per-tool checks. Updated `_record_rag_cap_hit` to accept `tool_name`.
- `middleware.py`: `after_model` now only terminates the graph when *all* RAG tool calls in the LLM's current output are individually capped (via `is_rag_tool_capped`), not just when *any* tool has hit its cap.

**Acceptance Scenarios**:

1. **Given** `SEARCH_MAX_CALLS=3` and a RAG query that triggers 3 search calls, **When** the search cap is hit but the model requests `fetch_document` calls, **Then** the middleware allows `fetch_document` to proceed.
2. **Given** both `search` and `fetch_document` have hit their individual caps, **When** the model requests more RAG tool calls, **Then** the middleware terminates the graph and forces synthesis.

---

### User Story 3 - No-Tool Query Stream Opening (Priority: P1)

As a user asking a simple question (e.g., "tell me a joke"), I want the answer to appear in Slack even when no tools fire, so that casual queries are not silently swallowed.

**Why this priority**: For queries without tool calls, no `TOOL_NOTIFICATION_START` event fires to open the stream. The `is_final_answer` chunks from the deterministic chunker were consumed by the pre-stream typing-status guard (`if not stream_ts: continue`) and never rendered.

**Design**:
- `ai.py`: Changed the pre-stream typing guard from `if not stream_ts:` to `if not stream_ts and not streaming_final_answer:`. When `streaming_final_answer` is latched (the chunk IS the final answer), the stream opens and content renders instead of being silently consumed as a typing status.

**Acceptance Scenarios**:

1. **Given** a no-tool query (e.g., "tell me a joke"), **When** the supervisor generates a response without calling any tools, **Then** the answer is delivered via live `appendStream` calls.
2. **Given** an off-topic query (e.g., "how is the weather in SF?"), **When** the supervisor politely declines, **Then** the decline message appears in Slack via live streaming.

---

### User Story 4 - Conformance Test Suite & Benchmark (Priority: P1)

As a developer editing the streaming pipeline, I want an automated conformance suite that validates all streaming scenarios, so that regressions are caught before merge.

**Why this priority**: Three distinct regressions were discovered during live Slack testing that unit tests did not catch. A live-runtime conformance suite that tests real end-to-end streaming behavior is needed.

**Design**:
- `simulate_slack_stream.py --suite`: Runs 4 scenarios (simple-chat, off-topic, rag-simple, rag-complex) with 22 conformance checks against the live supervisor.
- `tests/STREAMING_CONFORMANCE.md`: Defines the benchmark — scenarios, checks, invariants, scope, and instructions for adding new scenarios.
- `.cursor/rules/streaming-conformance.mdc`: Cursor rule glob-matched to the 7 streaming pipeline files. Activates automatically when any scoped file is edited and instructs the AI to run the suite.

**Acceptance Scenarios**:

1. **Given** the conformance suite, **When** all 4 scenarios run, **Then** all 22 checks pass: content delivered, stream opened, live streamed, no duplicates, `streaming_final_answer` latched, correct tool usage.
2. **Given** a developer edits `ai.py`, **When** the Cursor rule activates, **Then** the developer is instructed to run the suite and verify all checks pass before committing.

---

### User Story 5 - Parallel RAG Tool Call Hints (Priority: P2)

As a user querying the knowledge base, I want the model to issue multiple `search` or `fetch_document` calls in a single response for faster retrieval.

**Design**: Added instructions to `prompt_config.rag.yaml` and `prompt_config.deep_agent.yaml` for the LLM to issue parallel tool calls.

**Acceptance Scenarios**:

1. **Given** a broad RAG query, **When** the model determines multiple searches are needed, **Then** it issues them in a single response (parallel tool calls) rather than sequentially.

---

### Edge Cases

- What happens when the supervisor uses `[FINAL ANSWER]` marker vs. plain text? Both paths work: marker-based content is yielded live from `agent.py`; plain text goes through the executor's deterministic chunker with `is_final_answer=True` metadata.
- What happens when `stream_ts` is never set and no `is_final_answer` chunks arrive? The stream opens at finalization via `_start_stream_if_needed()` and content is delivered in `stopStream.chunks`.
- What happens when the conformance suite runs against an unreachable supervisor? Connection error with clear message; exit code 1.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The A2A binding MUST yield live post-`[FINAL ANSWER]` content chunks with `is_final_answer: True` metadata, incrementing `yielded_chunk_count` so the executor skips deterministic re-chunking.
- **FR-002**: The executor MUST propagate `is_final_answer` from streaming events into artifact metadata for non-tool-notification chunks.
- **FR-003**: RAG cap tracking MUST be per-tool (`_rag_capped_tools: dict[str, set[str]]`), not global. The middleware MUST only terminate the graph when *all* RAG tool calls in the LLM's current output are individually capped.
- **FR-004**: The Slack bot MUST open the stream for `is_final_answer` chunks even when no prior tool notifications have fired (no-tool queries).
- **FR-005**: A conformance test suite (`tests/simulate_slack_stream.py --suite`) MUST validate all streaming scenarios: simple-chat, off-topic, rag-simple, rag-complex.
- **FR-006**: RAG prompts MUST include hints for parallel tool calls (issuing multiple `search` or `fetch_document` calls in a single response).
- **FR-007**: A benchmark document (`tests/STREAMING_CONFORMANCE.md`) MUST define scenarios, checks, invariants, and scope.
- **FR-008**: A Cursor rule (`.cursor/rules/streaming-conformance.mdc`) MUST trigger on edits to streaming pipeline files and instruct conformance suite execution.

### Streaming Invariants

These are the fundamental rules that must never be violated:

1. **INV-1: Every query gets a response** — No query should result in an empty Slack message.
2. **INV-2: No duplicate content** — The same text must not appear in both `appendStream` and `stopStream.chunks`.
3. **INV-3: `streaming_final_answer` gates `FINAL_RESULT`** — When `True`, the `FINAL_RESULT` event is skipped. When `False`, `FINAL_RESULT` content is delivered.
4. **INV-4: Stream opens for `is_final_answer` chunks** — Even without prior tool notifications.
5. **INV-5: Per-tool RAG cap isolation** — Capping one RAG tool must not prevent other uncapped RAG tools from executing.
6. **INV-6: Live streaming preferred** — Final answer via `appendStream` (word-by-word), not deferred to `stopStream.chunks`.

### Key Entities

- **`StreamBuffer`**: Batches markdown text chunks before flushing to Slack's `appendStream`. Copied into the simulator to avoid Slack config imports.
- **`streaming_final_answer`**: Boolean latch in the Slack bot's event loop. Set `True` when `is_final_answer` metadata is seen on a `STREAMING_RESULT` event. Gates `FINAL_RESULT` handling.
- **`_rag_capped_tools`**: `dict[str, set[str]]` mapping LangGraph `thread_id` to sets of specific tool names that have hit their caps.
- **`is_rag_tool_capped(thread_id, tool_name)`**: Returns `True` if a specific tool is capped for a given thread.
- **`FakeSlackClient`**: Test double in the simulator that records `startStream`, `appendStream`, `stopStream` calls and produces conformance metrics.

### Conformance Suite — Scenarios & Checks

| Scenario | Query | Checks | What It Validates |
|----------|-------|--------|-------------------|
| `simple-chat` | "tell me a joke" | 6 | No-tool query streams via appendStream; stream opens; no duplicates |
| `off-topic` | "how is the weather in San Francisco?" | 4 | Out-of-scope response delivered; not swallowed |
| `rag-simple` | "what is agntcy" | 7 | RAG tools fire; word-by-word multi-chunk delivery; no duplicates |
| `rag-complex` | "compare agntcy and caipe onboarding" | 5 | Multi-search RAG with plan steps; per-tool cap isolation |

**Total**: 22 checks across 4 scenarios.

### Scope — Files Covered by Benchmark

| File | Role |
|------|------|
| `ai_platform_engineering/integrations/slack_bot/utils/ai.py` | Slack streaming event loop, StreamBuffer, finalization |
| `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py` | A2A binding — yields streaming events from LangGraph |
| `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py` | Executor — artifact construction, deterministic chunker |
| `ai_platform_engineering/multi_agents/platform_engineer/rag_tools.py` | RAG cap wrappers, per-tool cap tracking |
| `ai_platform_engineering/utils/deepagents_custom/middleware.py` | DeterministicTaskMiddleware — RAG loop detection |
| `ai_platform_engineering/integrations/slack_bot/utils/event_parser.py` | SSE event parser (EventType enum) |
| `ai_platform_engineering/integrations/slack_bot/a2a_client.py` | A2A SSE client |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The conformance test suite (`--suite`) passes all 22 checks across 4 scenarios: simple-chat, off-topic, rag-simple, rag-complex.
- **SC-002**: No-tool queries (e.g., "tell me a joke") deliver the full answer via live `appendStream` calls, not via `stopStream.chunks` or swallowed by the typing-status guard.
- **SC-003**: When `search` hits its cap but `fetch_document` is uncapped, the middleware allows `fetch_document` to proceed (no premature graph termination).
- **SC-004**: All 32 unit tests in `test_rag_tools_hard_stop.py` pass with the per-tool cap tracking changes.
- **SC-005**: The Cursor rule `.cursor/rules/streaming-conformance.mdc` exists and is glob-matched to the 7 scoped files.
- **SC-006**: The benchmark document `tests/STREAMING_CONFORMANCE.md` exists with scenario definitions, invariant rules, and instructions for adding new scenarios.

## Implementation Progress

### Completed

| File | Change | Stories |
|------|--------|---------|
| `agent.py` (a2a binding) | Restored live post-marker yield with `is_final_answer: True` tag; `yielded_chunk_count` increment | US-1 |
| `agent_executor.py` | Propagate `is_final_answer` from event to artifact metadata | US-1 |
| `rag_tools.py` | Per-tool cap tracking (`_rag_capped_tools`); `is_rag_tool_capped()` function; `_record_rag_cap_hit(tool_name=...)` | US-2 |
| `middleware.py` | `after_model` uses `is_rag_tool_capped` per-call; only terminates when all requested tools are individually capped | US-2 |
| `ai.py` (slack_bot) | No-tool stream opening: `if not stream_ts and not streaming_final_answer:` guard | US-3 |
| `prompt_config.rag.yaml` | Parallel tool call hint in `search_tool_prompt` | US-5 |
| `prompt_config.deep_agent.yaml` | Parallel tool call hint in RAG instructions | US-5 |
| `simulate_slack_stream.py` | `--suite` conformance mode: 4 scenarios, 22 checks | US-4 |
| `STREAMING_CONFORMANCE.md` | Benchmark document: scenarios, invariants, scope, instructions | US-4 |
| `.cursor/rules/streaming-conformance.mdc` | Cursor enforcement rule: glob-matched to 7 pipeline files | US-4 |
| `test_rag_tools_hard_stop.py` | Updated for per-tool cap tracking; added `test_is_rag_tool_capped_tracks_individual_tools` | US-2 |

## Clarifications

### Session 2026-04-09
- Q: Should US-8 content remain in 098 spec or be fully moved to a new 099 spec? → A: Complete move — no trace remains in 098.
