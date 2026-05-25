# Data Model: Per-Agent Distribution Control

**Date**: 2026-04-08  
**Spec**: `098-unify-single-distributed-binding`

## Entities

### Environment Variable Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DISTRIBUTED_AGENTS` | comma-separated string | `""` (empty) | Agent names to run as remote A2A subagents. `all` = every agent. |
| `DISTRIBUTED_MODE` | boolean string | `"false"` | Legacy toggle. `true` → equivalent to `DISTRIBUTED_AGENTS=all`. |
| `ENABLE_<NAME>` | boolean string | `"true"` | Per-agent enable/disable (orthogonal to distribution). |

### Resolution Logic

```
ENABLE_<NAME>=false  →  agent skipped (highest priority)
DISTRIBUTED_AGENTS set  →  per-agent routing
DISTRIBUTED_MODE=true  →  treated as DISTRIBUTED_AGENTS=all (legacy compat)
Neither set  →  all agents in-process
```

### `_get_distributed_agents()` Return Type

| Return value | Meaning |
|---|---|
| `set()` (empty) | All agents run in-process |
| `{"argocd", "aws"}` | Only named agents run remotely |
| `{"__all__"}` | Every agent runs remotely |

### State Changes on `PlatformEngineerDeepAgent`

| Field | Before | After |
|---|---|---|
| `self.distributed_mode` | `DISTRIBUTED_MODE` boolean | `True` if any agent is distributed (non-empty `distributed_set`) |
| `self._distributed_agents` | N/A (new) | `set[str]` from `_get_distributed_agents()` |

### Agent Routing in `_create_subagent_defs`

For each `(name, fn)` in `SINGLE_NODE_AGENTS` where `_is_agent_enabled(name)`:

| Condition | Action |
|---|---|
| `name in distributed_set` or `"__all__" in distributed_set` | `_create_remote_a2a_subagent_def(name, agent_prompts)` |
| Otherwise | `fn(prompt_config)` (in-process MCP, loaded in parallel) |

---

## Session 2 — RAG Reliability & Slack Narrative Streaming (US-6, US-7)

**Date**: 2026-04-08

### RAG Tool Cap Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `FETCH_DOCUMENT_MAX_CALLS` | int string | `"10"` | Max `fetch_document` calls per query (per `thread_id`) |
| `SEARCH_MAX_CALLS` | int string | `"5"` | Max `search` calls per query (per `thread_id`) |
| `RAG_MAX_OUTPUT_CHARS` | int string | `"10000"` | Per-call output character truncation limit |
| `RAG_MAX_SEARCH_RESULTS` | int string | `"3"` | Max results per `search` call (overrides model's `limit`) |
| `LANGGRAPH_RECURSION_LIMIT` | int string | `"500"` | LangGraph recursion limit for the agent graph |

### RAG Wrapper Class Hierarchy

```
BaseTool (LangChain)
 └── _CapCounterMixin
      ├── FetchDocumentCapWrapper
      │    - wraps: fetch_document tool
      │    - cap: FETCH_DOCUMENT_MAX_CALLS
      │    - truncates output to RAG_MAX_OUTPUT_CHARS
      │    - returns success-string on cap hit
      └── SearchCapWrapper
           - wraps: search tool
           - cap: SEARCH_MAX_CALLS
           - overrides limit kwarg to min(requested, RAG_MAX_SEARCH_RESULTS)
           - truncates output to RAG_MAX_OUTPUT_CHARS
           - returns success-string on cap hit
```

### `_CapCounterMixin` State

| Field | Type | Description |
|-------|------|-------------|
| `_call_counts` | `dict[str, int]` | Map of `thread_id` → call count. Thread-safe via GIL for single-process. |
| `_max_calls` | `int` | Maximum allowed calls (from env var) |
| `_wrapped_tool` | `BaseTool` | The original MCP tool being wrapped |

### Cap Hit Response Format

When a cap is reached, the wrapper returns a string (not an exception):

```
"[Document already retrieved] You have reached the maximum allowed number of
{tool_name} calls ({max}). Please synthesize your answer from the documents
already retrieved. Do NOT call {tool_name} again."
```

### Slack Bot Streaming State (US-7 additions)

| Field | Type | Description | Change |
|-------|------|-------------|--------|
| `step_thinking` | `dict[str, str]` | Accumulated text per plan step | Unchanged |
| `any_subagent_completed` | `bool` | Set when a non-RAG sub-agent tool completes | Unchanged |
| `streaming_final_answer` | `bool` | Latch: true once the last plan step starts streaming | Unchanged |
| `RAG_TOOL_NAMES` | `set[str]` | `{"search", "fetch_document", "list_datasources", "fetch_url"}` | New constant — RAG tools excluded from echo suppression |

### STREAMING_RESULT Event Processing (US-7 flow)

```
STREAMING_RESULT received
  │
  ├── Is streaming_final_answer? → stream directly
  │
  ├── Is intermediate plan step?
  │    ├── Is last step? → set streaming_final_answer, stream
  │    └── Not last step → accumulate in step_thinking, BUT ALSO stream (narrative visible)
  │
  └── any_subagent_completed AND tool NOT in RAG_TOOL_NAMES?
       ├── True → suppress (post-tool echo from non-RAG sub-agent)
       └── False → stream

```

### FINAL_RESULT Content Fix (Research item 12)

| Field | Before | After |
|-------|--------|-------|
| `final_response['content']` when `response_format_result` exists | `''` (empty — assumed already streamed) | Content from `response_format_result` (actual synthesized answer) |

---

## Session 3 — Test Harness Entities

**Date**: 2026-04-08

### Test File Inventory

| File | Test Level | Covers | New/Existing |
|------|-----------|--------|--------------|
| `tests/test_rag_tools_hard_stop.py` | Unit | US-6: cap wrappers, truncation, thread scoping | Existing (437 lines) |
| `tests/test_streaming_narration.py` | Unit | US-2: tool narration strings, dedup | Existing |
| `tests/test_distributed_agents.py` | Unit | US-5: `_get_distributed_agents()` parsing | Existing |
| `tests/test_binding_streaming_events.py` | Unit | SC-003, SC-012, US-2, US-7: yielded A2A events | **New** |
| `tests/test_slack_narrative_streaming.py` | Unit | SC-011, US-7: narrative visible, echo suppression | **New** |
| `tests/test_final_result_content.py` | Unit | SC-012: FINAL_RESULT non-empty content | **New** |
| `tests/test_distributed_mode_binding.py` | Unit | SC-007, SC-008, US-5: mock HTTP A2A path | **New** |
| `integration/test_streaming_harness.py` | Integration | SC-003, SC-005, SC-011, SC-012: end-to-end | **New** |

### Test Fixture Schema

#### `tests/fixtures/a2a_agent_card.json`

```json
{
  "name": "mock-agent",
  "url": "http://mock-agent:8000",
  "version": "1.0.0",
  "capabilities": { "streaming": true },
  "skills": [{ "id": "test-skill", "name": "Test Skill" }]
}
```

#### `tests/fixtures/a2a_task_sse_stream.json`

```json
[
  { "event": "TaskArtifactUpdateEvent", "data": { "artifact": { "name": "tool_notification_start", "parts": [{"text": "Calling Agent mock-agent"}] } } },
  { "event": "TaskArtifactUpdateEvent", "data": { "artifact": { "name": "streaming_result", "parts": [{"text": "Here is the answer..."}] } } },
  { "event": "TaskArtifactUpdateEvent", "data": { "artifact": { "name": "final_result", "parts": [{"text": "Complete answer text"}] } } },
  { "event": "TaskStatusUpdateEvent", "data": { "status": { "state": "completed" } } }
]
```

#### `tests/fixtures/rag_search_response.json`

```json
{
  "results": [
    { "document_id": "doc-001", "score": 0.95, "snippet": "AGNTCY is a framework..." },
    { "document_id": "doc-002", "score": 0.87, "snippet": "SLIM provides..." },
    { "document_id": "doc-003", "score": 0.82, "snippet": "Getting started with..." }
  ]
}
```

### Mock Strategy Matrix

| Component Under Test | What is Mocked | Mock Type | Fixture |
|---------------------|----------------|-----------|---------|
| A2A binding event generator | `CompiledStateGraph.astream_events()` | `AsyncMock` yielding canned events | Inline |
| Distributed agent HTTP | `httpx.AsyncClient.get/post` | `patch` with canned responses | `a2a_agent_card.json`, `a2a_task_sse_stream.json` |
| Slack WebClient | `slack_sdk.WebClient` | `MagicMock` | N/A (assert on calls) |
| RAG BaseTool | `BaseTool._arun` | `AsyncMock` returning canned strings | `rag_search_response.json`, `rag_fetch_document_response.json` |
| StreamBuffer | Real instance | N/A (capture flush output) | N/A |
| StreamState | Real instance | N/A (lightweight dataclass) | N/A |
| Checkpointer | `InMemorySaver` | Real instance | N/A |
