# Slack Streaming Conformance Benchmark

> **Spec**: [099-slack-streaming-conformance](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.specify/specs/099-slack-streaming-conformance/spec.md)  
> **Benchmark Definition**: [`tests/STREAMING_CONFORMANCE.md`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/tests/STREAMING_CONFORMANCE.md)  
> **Runner**: `tests/simulate_slack_stream.py --suite --report`

## Overview

The Slack Streaming Conformance suite validates that every query type —
simple chat, off-topic, and RAG-heavy — delivers the full answer via live
word-by-word streaming without artifact ID resets, swallowed responses,
or premature graph termination.

The suite runs 4 scenarios with 22 checks against a live supervisor,
exercising the complete SSE → event parser → StreamBuffer → Slack API
pipeline.

---

## Scenarios

| # | Scenario | Query | What It Validates |
|---|----------|-------|-------------------|
| 1 | `simple-chat` | "tell me a joke" | No-tool query streams via `appendStream`; stream opens without tool notifications |
| 2 | `off-topic` | "how is the weather in San Francisco?" | Out-of-scope response still delivered; not swallowed |
| 3 | `rag-simple` | "what is agntcy" | RAG tools fire; answer streams word-by-word in multiple chunks; no duplicates |
| 4 | `rag-complex` | "explain how agntcy agents communicate with each other" | Multi-search RAG with plan steps; per-tool cap isolation; substantial content |

---

## Conformance Checks (22 total)

### `simple-chat` (6 checks)

| Check | Description |
|-------|-------------|
| `content_delivered` | Response must have content (>20 chars) |
| `stream_opened` | Stream must be opened (`startStream` called) |
| `live_streamed` | Answer delivered via `appendStream` (not just `stopStream`) |
| `no_duplicate` | No duplicate content in both `appendStream` and `stopStream` |
| `final_answer_latched` | `streaming_final_answer` must be `True` |
| `no_tools` | No tools should fire for a casual chat query |

### `off-topic` (4 checks)

| Check | Description |
|-------|-------------|
| `content_delivered` | Response must have content (>20 chars) |
| `stream_opened` | Stream must be opened |
| `live_streamed` | Answer delivered via `appendStream` |
| `final_answer_latched` | `streaming_final_answer` must be `True` |

### `rag-simple` (7 checks)

| Check | Description |
|-------|-------------|
| `content_delivered` | Response must have substantial content (>200 chars) |
| `stream_opened` | Stream must be opened |
| `live_streamed` | Answer delivered via `appendStream` (word-by-word) |
| `tools_used` | RAG tools (`search`/`fetch_document`) must be called |
| `no_duplicate` | No duplicate content in both streams |
| `final_answer_latched` | `streaming_final_answer` must be `True` |
| `multi_chunk` | Answer should arrive in multiple streaming chunks (>1) |

### `rag-complex` (5 checks)

| Check | Description |
|-------|-------------|
| `content_delivered` | Response must have substantial content (>300 chars) |
| `stream_opened` | Stream must be opened |
| `live_streamed` | Answer delivered via `appendStream` |
| `tools_used` | RAG tools must be called |
| `final_answer_latched` | `streaming_final_answer` must be `True` |

---

## Streaming Invariants

These are the fundamental rules that must **never** be violated:

| # | Invariant | Description |
|---|-----------|-------------|
| INV-1 | **Every query gets a response** | No query should result in an empty Slack message |
| INV-2 | **No duplicate content** | The same text must not appear in both `appendStream` and `stopStream.chunks` |
| INV-3 | **`streaming_final_answer` gates `FINAL_RESULT`** | When `True`, the `FINAL_RESULT` event is skipped; when `False`, content is delivered |
| INV-4 | **Stream opens for `is_final_answer` chunks** | Even without prior tool notifications |
| INV-5 | **Per-tool RAG cap isolation** | Capping one RAG tool must not prevent other uncapped RAG tools from executing |
| INV-6 | **Live streaming preferred** | Final answer via `appendStream` (word-by-word), not deferred to `stopStream.chunks` |

---

## Per-Query Metrics (template)

The `--report` flag generates a detailed markdown report with per-query streaming metrics.

| Metric | Description |
|--------|-------------|
| **Total Chars** | Total characters delivered to the user (streamed + stopped) |
| **Streamed (append)** | Characters delivered via `appendStream` calls (live streaming) |
| **Stopped** | Characters delivered via `stopStream.chunks` (deferred) |
| **Append Calls** | Number of `appendStream` text calls made |
| **Final Chunks** | Number of streaming chunks tagged as final answer |
| **Tools** | Tools called during the query (with call counts) |
| **Delivery** | `live stream`, `stopStream only`, `split`, or `empty` |

---

## Pipeline Scope

The following files are covered by this benchmark:

| File | Role |
|------|------|
| `ai_platform_engineering/integrations/slack_bot/utils/ai.py` | Slack streaming event loop, StreamBuffer, finalization |
| `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py` | A2A binding — yields streaming events from LangGraph |
| `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py` | Executor — artifact construction, deterministic chunker |
| `ai_platform_engineering/multi_agents/platform_engineer/rag_tools.py` | RAG cap wrappers, per-tool cap tracking |
| `ai_platform_engineering/utils/deepagents_custom/middleware.py` | DeterministicTaskMiddleware — RAG loop detection |
| `ai_platform_engineering/integrations/slack_bot/utils/event_parser.py` | SSE event parser (EventType enum) |
| `ai_platform_engineering/integrations/slack_bot/a2a_client.py` | A2A SSE client |

---

## Running the Suite

### Prerequisites

- Supervisor running at `http://localhost:8000` (or specify `--url`)
- RAG knowledge base loaded (for `rag-simple` and `rag-complex` scenarios)

### Commands

```bash
# Run the conformance suite (terminal output)
PYTHONPATH=. uv run python tests/simulate_slack_stream.py --suite

# Run with verbose output (shows every tool and appendStream call)
PYTHONPATH=. uv run python tests/simulate_slack_stream.py --suite -v

# Generate a markdown report (auto-timestamped)
PYTHONPATH=. uv run python tests/simulate_slack_stream.py --suite --report

# Generate a report to a specific path
PYTHONPATH=. uv run python tests/simulate_slack_stream.py --suite --report results.md
```

### Report Output

The `--report` flag generates a tabulated markdown report with:

1. **Scenario Results** — per-scenario pass/fail with duration
2. **Per-Query Streaming Metrics** — chars, calls, chunks, tools, delivery method
3. **Conformance Check Details** — per-check pass/fail with detail
4. **State Flags** — `streaming_final_answer`, `stream_opened`, `plan_steps` per scenario
5. **Event Counts** — SSE event type counts per scenario

Reports are saved to `tests/reports/` (gitignored) by default.

---

## Enforcement

A Cursor IDE rule (`.cursor/rules/streaming-conformance.mdc`) automatically
triggers when any of the 7 pipeline files are edited. The rule instructs
developers to run the conformance suite before committing.

---

## Adding New Scenarios

1. Add a new entry to the `SCENARIOS` list in `tests/simulate_slack_stream.py`
2. Define the query, description, and conformance checks (lambdas)
3. Update `tests/STREAMING_CONFORMANCE.md` with the new scenario
4. Run `--suite` to verify all checks pass
5. Update this doc with the new scenario details
