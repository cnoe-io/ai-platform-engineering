# Slack Streaming Conformance Benchmark

**Status**: Active — all edits to the streaming pipeline MUST pass this benchmark.
**Last validated**: 2026-04-09 (22/22 checks, 4 scenarios)

## Purpose

This benchmark defines the minimum conformant behavior for the CAIPE Slack streaming pipeline. Any code change touching the files listed in [Scope](#scope) MUST pass the full conformance suite before merge.

## Running the Benchmark

```bash
PYTHONPATH=. uv run python tests/simulate_slack_stream.py --suite
```

**Exit code 0** = all checks passed. **Exit code 1** = one or more failures.

For verbose output (shows every event):
```bash
PYTHONPATH=. uv run python tests/simulate_slack_stream.py --suite -v
```

## Scope — Files Covered by This Benchmark

Changes to any of the following files require a conformance suite run:

| File | Role |
|------|------|
| `ai_platform_engineering/integrations/slack_bot/utils/ai.py` | Slack streaming event loop, StreamBuffer, finalization |
| `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py` | A2A binding — yields streaming events from LangGraph |
| `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py` | Executor — artifact construction, deterministic chunker |
| `ai_platform_engineering/multi_agents/platform_engineer/rag_tools.py` | RAG cap wrappers, per-tool cap tracking |
| `ai_platform_engineering/utils/deepagents_custom/middleware.py` | DeterministicTaskMiddleware — RAG loop detection |
| `ai_platform_engineering/integrations/slack_bot/utils/event_parser.py` | SSE event parser (EventType enum) |
| `ai_platform_engineering/integrations/slack_bot/a2a_client.py` | A2A SSE client |

## Scenarios

### 1. `simple-chat` — No-Tool Query

**Query**: `"tell me a joke"`

A casual query that triggers no tools. Tests that the streaming pipeline works end-to-end even without `TOOL_NOTIFICATION_START` events to open the stream.

| Check | Rule |
|-------|------|
| `content_delivered` | Response > 20 chars |
| `stream_opened` | `startStream` was called |
| `live_streamed` | Content delivered via `appendStream` (not just `stopStream`) |
| `no_duplicate` | No content appears in both `appendStream` and `stopStream` |
| `final_answer_latched` | `streaming_final_answer == True` |
| `no_tools` | Zero tools fired |

**Why this matters**: Without this check, `is_final_answer` chunks from the deterministic chunker get swallowed by the pre-stream typing-status guard (the stream never opens because no tool notifications fire).

### 2. `off-topic` — Out-of-Scope Query

**Query**: `"how is the weather in San Francisco?"`

An out-of-scope query where the supervisor politely declines. Tests that non-RAG, non-tool responses still reach the user.

| Check | Rule |
|-------|------|
| `content_delivered` | Response > 20 chars |
| `stream_opened` | `startStream` was called |
| `live_streamed` | Content delivered via `appendStream` |
| `final_answer_latched` | `streaming_final_answer == True` |

**Why this matters**: Validates the same no-tool path as `simple-chat` but with a different LLM response pattern (polite decline vs. joke).

### 3. `rag-simple` — Single RAG Query

**Query**: `"what is agntcy"`

A knowledge-base query that uses `search` + `fetch_document` tools. Tests the full RAG streaming pipeline including tool notifications, narrative text, and word-by-word final answer delivery.

| Check | Rule |
|-------|------|
| `content_delivered` | Response > 200 chars |
| `stream_opened` | `startStream` was called |
| `live_streamed` | Content delivered via `appendStream` (word-by-word) |
| `tools_used` | At least one of `search` or `fetch_document` was called |
| `no_duplicate` | No content in both `appendStream` and `stopStream` |
| `final_answer_latched` | `streaming_final_answer == True` |
| `multi_chunk` | Final answer arrived in > 1 streaming chunk |

**Why this matters**: This is the core RAG path. Regressions here mean the user sees no final answer, duplicates, or a single giant block instead of word-by-word streaming.

### 4. `rag-complex` — Multi-Search Comparison Query

**Query**: `"compare agntcy and caipe onboarding"`

A complex query requiring multiple searches, fetches, and synthesis. Tests per-tool RAG cap isolation and plan-step streaming.

| Check | Rule |
|-------|------|
| `content_delivered` | Response > 300 chars |
| `stream_opened` | `startStream` was called |
| `live_streamed` | Content delivered via `appendStream` |
| `tools_used` | At least one RAG tool was called |
| `final_answer_latched` | `streaming_final_answer == True` |

**Why this matters**: Tests per-tool cap tracking — if `search` hits its cap, `fetch_document` must still be allowed to proceed. Without this, the middleware prematurely terminates the graph and the user gets no answer.

## Invariants — Rules That Must Never Be Violated

These are the fundamental streaming invariants. Any violation is a critical regression.

### INV-1: Every query gets a response

No query should result in an empty Slack message. The user must always see content, whether it's a joke, a polite decline, or a RAG answer.

### INV-2: No duplicate content

The same text must not appear in both `appendStream` and `stopStream.chunks`. This causes the user to see the answer twice.

### INV-3: `streaming_final_answer` gates `FINAL_RESULT`

When `streaming_final_answer == True`, the `FINAL_RESULT` event must be skipped (its content was already streamed). When `False`, the `FINAL_RESULT` content must be delivered.

### INV-4: Stream opens for `is_final_answer` chunks

When the executor sends `STREAMING_RESULT` events with `is_final_answer: True` metadata, the stream must open even if no tool notifications have fired. The pre-stream typing guard must not swallow these chunks.

### INV-5: Per-tool RAG cap isolation

Capping one RAG tool (e.g., `search`) must not prevent other RAG tools (e.g., `fetch_document`) from executing. The middleware must check each tool individually.

### INV-6: Live streaming preferred

The final answer should be delivered via `appendStream` (word-by-word) rather than deferred to `stopStream.chunks`. This provides the best UX — the user sees text appearing progressively.

## Adding New Scenarios

To add a new conformance scenario, edit `tests/simulate_slack_stream.py` and add an entry to the `SCENARIOS` list:

```python
{
    "name": "my-new-scenario",
    "query": "the query to test",
    "description": "What this scenario validates",
    "checks": [
        ("check_id",
         "Human-readable description",
         lambda r: (r["total_chars"] > 100,
                    f"{r['total_chars']}c delivered")),
    ],
},
```

Each check is a tuple of `(id, description, check_fn)` where `check_fn` receives the structured result dict and returns `(passed: bool, detail: str)`.

Available result fields: `total_chars`, `streamed_chars`, `stopped_chars`, `append_text_calls`, `streaming_final_answer`, `already_streamed`, `plan_steps`, `tool_counts`, `event_counts`, `final_chunk_count`, `elapsed`, `stream_opened`.

## History

| Date | Change | Result |
|------|--------|--------|
| 2026-04-09 | Initial benchmark — 4 scenarios, 22 checks | 22/22 passed |
