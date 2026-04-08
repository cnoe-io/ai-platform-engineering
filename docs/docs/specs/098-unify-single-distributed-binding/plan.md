# Implementation Plan: Per-Agent Distribution Control via `DISTRIBUTED_AGENTS`

**Branch**: `098-unify-single-distributed-binding` | **Date**: 2026-04-08 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `docs/docs/specs/098-unify-single-distributed-binding/spec.md` (User Story 5)

## Summary

Add per-agent distribution control to the unified supervisor codebase. A single `DISTRIBUTED_AGENTS` env var (comma-separated agent names) replaces the binary `DISTRIBUTED_MODE` toggle, allowing operators to progressively migrate individual agents to remote A2A containers while keeping others in-process. The change is ~20 lines in `deep_agent.py` plus a test file.

## Technical Context

**Language/Version**: Python 3.11+  
**Primary Dependencies**: LangGraph, deepagents, LangChain, FastAPI  
**Storage**: MongoDB/Redis (checkpointer/store — unchanged by this feature)  
**Testing**: pytest (synchronous tests), pytest-asyncio (async tests)  
**Target Platform**: Linux containers (Docker/Kubernetes)  
**Project Type**: Multi-agent backend service  
**Performance Goals**: No measurable impact — env var parsed once at startup  
**Constraints**: Backward compatible with `DISTRIBUTED_MODE=true` deployments  
**Scale/Scope**: ~20 lines of code change in `deep_agent.py`, ~50 lines of tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Specs as Source of Truth | PASS | spec.md updated with User Story 5, FR-013/014, SC-007/008 |
| II. Agent-First Architecture | PASS | No change to agent architecture; configuration only |
| III. MCP Server Pattern | PASS | MCP tools still loaded in-process for local agents |
| IV. LangGraph-Based Agents | PASS | No change to graph construction |
| V. A2A Protocol Compliance | PASS | Remote A2A subagent creation unchanged |
| VI. Skills over Ad-Hoc Prompts | N/A | Not applicable to this feature |
| VII. Test-First Quality Gates | PASS | Unit tests cover all resolution scenarios |
| VIII. Structured Documentation | PASS | Plan, research, data-model, quickstart produced |
| IX. Security and Compliance | PASS | No secrets in source; env var injection only |
| X. Simplicity / YAGNI | PASS | Single helper function + modified branch; no new abstractions |

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/098-unify-single-distributed-binding/
├── spec.md              # Feature specification (updated with User Story 5)
├── plan.md              # This file
├── research.md          # Phase 0: design decisions and alternatives
├── data-model.md        # Phase 1: entity model and resolution logic
└── quickstart.md        # Phase 1: usage examples and verification
```

### Source Code (repository root)

```text
ai_platform_engineering/
└── multi_agents/
    └── platform_engineer/
        ├── deep_agent.py          # MODIFIED: _get_distributed_agents(), _create_subagent_defs()
        └── tests/
            └── test_distributed_agents.py  # NEW: unit tests for per-agent distribution

tests/                             # Existing tests — no modification needed
```

**Structure Decision**: Single file modification (`deep_agent.py`) plus one new test file. No new modules, packages, or abstractions.

## Implementation Design

### New Helper: `_get_distributed_agents()`

```python
def _get_distributed_agents() -> set[str]:
    """Parse DISTRIBUTED_AGENTS env var into a set of agent names.
    
    Returns {"__all__"} when all agents should be distributed,
    a specific set of names for selective distribution,
    or an empty set when all agents should run in-process.
    """
    raw = os.getenv("DISTRIBUTED_AGENTS", "").strip()
    if not raw:
        if DISTRIBUTED_MODE:
            return {"__all__"}
        return set()
    tokens = {t.strip().lower() for t in raw.split(",") if t.strip()}
    if "all" in tokens:
        return {"__all__"}
    return tokens


def _agent_is_distributed(name: str, distributed_set: set[str]) -> bool:
    """Check if a specific agent should run in distributed (remote A2A) mode."""
    return name in distributed_set or "__all__" in distributed_set
```

### Modified: `__init__` on `PlatformEngineerDeepAgent`

```python
self._distributed_agents = _get_distributed_agents()
self.distributed_mode = bool(self._distributed_agents)
```

### Modified: `_create_subagent_defs`

Replace the binary `if self.distributed_mode:` / `else:` with per-agent routing:

```python
agent_prompts = prompt_config.get("agent_prompts", {})
local_agents = []

for name, fn in enabled_agents:
    if _agent_is_distributed(name, self._distributed_agents):
        try:
            remote_def = _create_remote_a2a_subagent_def(name, agent_prompts)
            subagent_defs.append(remote_def)
            logger.info(f"📡 {name} → remote A2A subagent")
        except Exception as e:
            logger.warning(f"Failed to create remote subagent '{name}': {e}")
    else:
        local_agents.append((name, fn))
        logger.info(f"🏠 {name} → in-process MCP tools")

# Load local MCP tools in parallel
if local_agents:
    results = await asyncio.gather(
        *[fn(prompt_config) for _, fn in local_agents],
        return_exceptions=True,
    )
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            logger.warning(f"Failed to create subagent '{local_agents[i][0]}': {result}")
        else:
            subagent_defs.append(result)

# Also pick up extra registry agents (unchanged)
if self._platform_registry:
    ...
```

## Complexity Tracking

No constitution violations. No complexity justification needed.

| Metric | Value |
|--------|-------|
| Lines changed in `deep_agent.py` | ~25 |
| New files | 1 (test file) |
| New abstractions | 0 (two module-level helper functions) |
| New env vars | 1 (`DISTRIBUTED_AGENTS`) |
| Breaking changes | 0 (`DISTRIBUTED_MODE` remains supported) |

---

## Session 2 — RAG Reliability & Slack Narrative Streaming (US-6, US-7)

**Date**: 2026-04-08

### Updated Summary

In addition to per-agent distribution, this branch now includes RAG tool reliability (call caps, output truncation, context protection) and Slack narrative text streaming fixes. These arose from production debugging where RAG queries hit runaway loops and Slack displayed no intermediate narration or final answers.

### Updated Technical Context

**Testing**: pytest (sync tests; no pytest-asyncio — use `asyncio.run()` wrappers)
**Performance Goals**: RAG queries complete within 60s; streaming latency <500ms per chunk
**Constraints**: Context window ~128K tokens; recursion limit configurable (default 500)

### Phase B: RAG Reliability (US-6) — COMPLETED

Implemented `FetchDocumentCapWrapper` and `SearchCapWrapper` with:
- Per-query call caps (thread_id scoped via `_CapCounterMixin`)
- Success-string response on cap hit (not exceptions — key design decision)
- Per-call output truncation (`RAG_MAX_OUTPUT_CHARS`)
- Search result limit capping (`RAG_MAX_SEARCH_RESULTS`)
- Configurable `LANGGRAPH_RECURSION_LIMIT`
- `GraphRecursionError` isinstance detection (with string-match fallback)

**Files**: `rag_tools.py`, `deep_agent.py`, `agent.py`, `base_langgraph_agent.py`, `prompt_config.deep_agent.yaml`, `docker-compose.dev.yaml`

### Phase C: Slack Narrative Streaming (US-7) — IN PROGRESS

1. **COMPLETED**: Removed `continue` statement suppressing intermediate narrative
2. **COMPLETED**: Added RAG tool exclusion from echo suppression
3. **IN PROGRESS**: Fix `final_response['content'] = ''` in `agent.py` to include `response_format_result` content in `FINAL_RESULT` artifact

**Files**: `ai.py` (slack_bot), `agent.py` (a2a binding)

### Phase D: Test Harness — PLANNED

Build a comprehensive test harness covering all deployment modes, Slack rendering, and streaming events. Two tiers: unit/component tests (mocked deps, fast CI) + lightweight integration tests (Docker Compose test profile).

#### D.1 — Unit Tests: A2A Binding Streaming Events (`test_binding_streaming_events.py`)

**What**: Call the A2A binding's async generator directly with mocked LangGraph graph. Collect yielded events into a list. Assert on artifact names, content, and ordering.

**Covers**: SC-003 (tool notifications), SC-012 (final result content), US-2, US-7

**Approach**:
- Mock `CompiledStateGraph.astream_events()` to yield canned LangGraph events
- Call `AIPlatformEngineerA2ABinding._process_request()` (or equivalent generator)
- Collect all yielded A2A events
- Assert: `TOOL_NOTIFICATION_START` has correct `source_agent` (not "task")
- Assert: `EXECUTION_PLAN_UPDATE` present with agent-tagged steps
- Assert: `STREAMING_RESULT` events contain narrative text
- Assert: `FINAL_RESULT` has non-empty content

**Key mocks**:
- `CompiledStateGraph` → yields canned `on_chat_model_stream`, `on_tool_start`, `on_tool_end` events
- `StreamState` → real instance (lightweight dataclass, no deps)
- Checkpointer/Store → `InMemorySaver`

#### D.2 — Unit Tests: Slack Narrative & Echo Suppression (`test_slack_narrative_streaming.py`)

**What**: Feed mock A2A events into the Slack bot's event processing logic. Capture StreamBuffer output and mock Slack WebClient calls.

**Covers**: SC-011 (narrative visible), US-7 acceptance scenarios 1-3

**Approach**:
- Create a sequence of mock A2A events: `EXECUTION_PLAN_UPDATE` → `STREAMING_RESULT` (narrative) → `TOOL_NOTIFICATION_START` → `TOOL_NOTIFICATION_END` → `STREAMING_RESULT` (post-tool) → `FINAL_RESULT`
- Mock `slack_sdk.WebClient` (`chat_postMessage`, `chat_update`)
- Call the event processing function
- Assert: narrative text appears in StreamBuffer output
- Assert: RAG post-tool text is NOT suppressed
- Assert: non-RAG sub-agent post-tool echo IS suppressed
- Assert: `chat_postMessage` called for message creation, `chat_update` for streaming updates

#### D.3 — Unit Tests: FINAL_RESULT Content (`test_final_result_content.py`)

**What**: Test that the A2A binding correctly includes `response_format_result` content in the `FINAL_RESULT` artifact.

**Covers**: SC-012, Research item 12

**Approach**:
- Mock a LangGraph stream that produces a `ResponseFormat` tool call with content
- Verify `final_response['content']` is non-empty after processing
- Verify the yielded `FINAL_RESULT` event carries the full synthesized answer
- Test edge case: no `response_format_result` → content from accumulated model output

#### D.4 — Unit Tests: Distributed Mode Binding (`test_distributed_mode_binding.py`)

**What**: Test the distributed A2A path without real containers by mocking HTTP responses.

**Covers**: SC-007, SC-008, US-5

**Approach**:
- Patch `httpx.AsyncClient` to return a canned agent card JSON
- Patch SSE stream to yield canned task events
- Verify `A2ARemoteAgentConnectTool` correctly fetches the agent card
- Verify remote task delegation produces expected A2A events
- Test fallback behavior when agent is unreachable (edge case)

**Key fixtures**: `tests/fixtures/a2a_agent_card.json`, `tests/fixtures/a2a_task_sse_stream.json`

#### D.5 — JSON Test Fixtures (`tests/fixtures/`)

**Files**:
- `rag_search_response.json` — representative RAG search result (3 documents with IDs)
- `rag_fetch_document_response.json` — single document content (~5K chars)
- `a2a_agent_card.json` — minimal valid A2A agent card
- `a2a_task_sse_stream.json` — complete task lifecycle SSE events

#### D.6 — Integration Tests: Docker Compose Test Profile (`integration/test_streaming_harness.py`)

**What**: Lightweight integration tests using `make quick-sanity` infrastructure (supervisor + github + netutils).

**Covers**: SC-003, SC-005, SC-011, SC-012

**Approach**:
- Start supervisor + minimal agents via Docker Compose
- Send queries via A2A HTTP endpoint
- Consume SSE stream, parse events
- Assert: tool notifications, narrative text, non-empty final result

**Prerequisites**: `docker compose -f docker-compose.dev.yaml --profile github --profile netutils-agent up -d --build`
