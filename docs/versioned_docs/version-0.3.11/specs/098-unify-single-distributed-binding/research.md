# Research: Per-Agent Distribution Control via `DISTRIBUTED_AGENTS`

**Date**: 2026-04-08  
**Spec**: `098-unify-single-distributed-binding`

## Research Tasks

### 1. How should per-agent distribution interact with the existing `DISTRIBUTED_MODE` toggle?

**Decision**: `DISTRIBUTED_AGENTS` env var takes precedence when set; `DISTRIBUTED_MODE=true` is treated as `DISTRIBUTED_AGENTS=all` for backward compatibility.

**Rationale**: The existing binary toggle (`DISTRIBUTED_MODE`) forced all agents into either local or remote mode. Deployments need finer control — e.g., ArgoCD in its own container (high memory use) while lightweight agents run in-process. A single comma-separated list is the simplest mechanism that provides per-agent control without a proliferation of env vars.

**Alternatives considered**:
- **Option B: `AGENT_MODE_<NAME>` per-agent overrides** — More flexible (each agent has its own env var defaulting to the global `DISTRIBUTED_MODE`), but creates N extra env vars. Rejected for unnecessary complexity at this stage.
- **Option C: Separate `ENABLE_<NAME>` + `DISTRIBUTED_<NAME>` flags** — Doubles the env var surface. Conflates enable/disable with distribution mode. Rejected.

### 2. What is the resolution order when multiple env vars are set?

**Decision**: Three-level resolution:

1. `ENABLE_<NAME>=false` → agent is **skipped entirely** (highest priority)
2. `DISTRIBUTED_AGENTS` is set → controls per-agent distribution mode
3. `DISTRIBUTED_MODE=true` (legacy) → treated as `DISTRIBUTED_AGENTS=all`
4. Neither set → all agents run in-process (single-node / all-in-one)

**Rationale**: Enable/disable is orthogonal to distribution mode and should always win. The `DISTRIBUTED_AGENTS` list is the primary mechanism; `DISTRIBUTED_MODE` is legacy backward compat only.

### 3. How does `_create_subagent_defs` need to change?

**Decision**: Replace the binary `if self.distributed_mode:` branch with per-agent logic:

```python
distributed_set = _get_distributed_agents()  # parses DISTRIBUTED_AGENTS env var

for name, fn in enabled_agents:
    if name in distributed_set:
        # remote A2A subagent
        subagent_defs.append(_create_remote_a2a_subagent_def(name, agent_prompts))
    else:
        # in-process MCP tools (gathered for parallel loading)
        local_agents.append((name, fn))

# Load local MCP tools in parallel
results = await asyncio.gather(...)
```

**Rationale**: This preserves the existing parallel MCP loading for local agents (performance) while allowing individual agents to be switched to remote mode. The `_get_distributed_agents()` helper centralizes env var parsing and backward compat logic.

### 4. Should `self.distributed_mode` remain on the class?

**Decision**: Keep `self.distributed_mode` as a boolean that means "at least one agent is distributed" (i.e., `distributed_set` is non-empty). This preserves the existing platform_registry initialization and dynamic monitoring logic that only needs to run when any agent is remote.

**Rationale**: The platform_registry and dynamic agent monitoring are only useful when remote agents exist. A boolean flag is the simplest way to gate that initialization.

### 5. What about agents discovered via `platform_registry` that aren't in `SINGLE_NODE_AGENTS`?

**Decision**: Extra registry agents (e.g., weather, gitlab) are always treated as remote — they have no in-process MCP implementation. No change needed; existing logic already handles this correctly.

**Rationale**: These agents don't appear in `SINGLE_NODE_AGENTS` and are only available via their own A2A containers. The per-agent distribution feature only affects agents that *have* both local and remote implementations.

### 6. How should the `DISTRIBUTED_AGENTS` value be parsed?

**Decision**: Parse as comma-separated, case-insensitive, trimmed tokens. The special value `all` means every agent in `SINGLE_NODE_AGENTS` is distributed.

```python
def _get_distributed_agents() -> set[str]:
    raw = os.getenv("DISTRIBUTED_AGENTS", "").strip()
    if not raw:
        if DISTRIBUTED_MODE:
            return {"__all__"}
        return set()
    tokens = {t.strip().lower() for t in raw.split(",") if t.strip()}
    if "all" in tokens:
        return {"__all__"}
    return tokens
```

Use `"__all__"` as a sentinel to mean "every agent". The check becomes `name in distributed_set or "__all__" in distributed_set`.

**Rationale**: Simple to implement, easy to read in `docker-compose.yaml` or Helm values, and avoids parsing ambiguity.

---

## Session 2 — RAG Reliability & Slack Narrative Streaming (US-6, US-7)

**Date**: 2026-04-08

### 7. Why do RAG tool calls enter runaway loops?

**Decision**: The root cause is a combination of three factors: (a) no per-query call limits, (b) unconstrained output sizes, and (c) LLM prompt instructions that demand "retrieve 3-5 documents minimum." Fix all three layers.

**Rationale**: The LLM treats each `fetch_document` call as independent. When earlier documents don't satisfy the query, it keeps calling `fetch_document` on new document IDs until the LangGraph recursion limit (formerly 100) is hit. The model has no mechanism to know it should stop — it's following its system prompt instruction faithfully.

**Alternatives considered**:
- **Option A: Raise `ToolInvocationError` with `is_error=True` when cap hit** — Implemented first. Failed because the model interpreted error ToolMessages as "this document failed; try the next one," causing it to keep trying different documents.
- **Option B: Return a normal-looking success string instructing the model to stop** — Adopted. The model treats this as a successful tool response and follows the embedded instruction to synthesize.
- **Option C: Context window middleware** — Considered a custom LangGraph middleware that checks token usage before each tool call. Rejected as overly complex for the immediate problem. May be revisited for general context protection.

### 8. What is the correct mechanism for capping tool calls?

**Decision**: Two wrapper classes (`FetchDocumentCapWrapper`, `SearchCapWrapper`) extend `BaseTool` via a shared `_CapCounterMixin`. The mixin provides a thread-safe call counter keyed by LangGraph `thread_id`, ensuring counts are scoped to a single user query and don't leak across concurrent requests.

**Rationale**: Wrappers intercept the tool call before it reaches the underlying MCP tool, providing a clean separation of concerns. The `thread_id` scoping ensures that concurrent queries maintain independent counters.

**Key implementation detail**: When the cap is hit, the wrapper returns:
```
"[Document already retrieved] You have reached the maximum allowed number of
fetch_document calls (10). Please synthesize your answer from the documents
already retrieved. Do NOT call fetch_document again."
```
This looks like a normal tool response (not an error), which the model processes without retry logic.

### 9. Why must search results be capped per-call?

**Decision**: Cap the `limit` argument in `search` tool calls to `RAG_MAX_SEARCH_RESULTS` (default 3), regardless of what the model requests.

**Rationale**: The model sometimes requests `limit=10` or `limit=20` in search calls. Each result includes a document ID that the model may then try to `fetch_document` on, cascading into many fetch calls. Capping search results at 3 per call limits the downstream `fetch_document` cascade.

**Alternatives considered**:
- **Option A: Only cap `fetch_document`** — Insufficient. A single `search(limit=20)` generates 20 document IDs, each becoming a potential `fetch_document` target.
- **Option B: Cap at the search wrapper level** — Adopted. The wrapper overrides the `limit` kwarg before passing to the underlying tool.

### 10. How should the LangGraph recursion limit be configured?

**Decision**: Make it configurable via `LANGGRAPH_RECURSION_LIMIT` environment variable (default 500). Apply it in both `agent.py` (A2A binding) and `base_langgraph_agent.py` (shared base class).

**Rationale**: The default LangGraph limit of 25 is too low for multi-agent RAG workflows that involve plan creation, multiple search/fetch cycles, and synthesis. The value 500 provides headroom for complex queries while still catching genuine infinite loops. Making it env-configurable allows tuning without code changes.

**Error detection**: Changed from string matching (`"recursion limit" in error_str.lower()`) to `isinstance(e, GraphRecursionError)` with a string-match fallback for older LangGraph versions that may not export the exception class.

### 11. Why are intermediate narrative messages missing in Slack?

**Decision**: The Slack bot's `ai.py` had a `continue` statement that suppressed ALL `STREAMING_RESULT` events during intermediate plan steps. Narrative text like "I'll search the knowledge base..." was accumulated in `step_thinking` but never streamed.

**Rationale**: The original intent was to suppress post-tool "echo" text — the model often restates what a tool returned. But the implementation was too aggressive: it also suppressed the model's pre-tool narrative, which users need to see.

**Fix**: Remove the `continue` and let narrative text fall through to the streaming code. Post-tool echo suppression is handled by the `any_subagent_completed` flag, which is only set when non-RAG sub-agents complete.

**RAG tool exclusion**: RAG tools (`search`, `fetch_document`, `list_datasources`, `fetch_url`) are explicitly excluded from the sub-agent echo suppression because their post-tool `STREAMING_RESULT` IS the synthesized answer, not an echo.

### 12. Why is the final synthesized answer missing from Slack?

**Decision**: The A2A binding's `agent.py` (line ~1736) explicitly sets `final_response['content'] = ''` when a `response_format_result` is present, with the comment "Already emitted via the ResponseFormat handler." This assumption is incorrect — the content is not always fully emitted during streaming.

**Rationale**: The `ResponseFormat` tool captures the model's structured final answer. The code assumed this was already streamed chunk-by-chunk via `STREAMING_RESULT` events, but the Slack bot receives the `FINAL_RESULT` artifact with the full content. When that content is cleared, the Slack bot displays nothing.

**Fix**: Include the `response_format_result` content in `final_response['content']` so the `FINAL_RESULT` artifact carries the actual answer. The streaming chunks and final artifact serve different purposes — streaming provides real-time UX, while the final artifact provides the authoritative complete answer.

**Alternatives considered**:
- **Option A: Rely only on streaming chunks** — Fragile. If any chunk is lost or the stream is interrupted, the user gets an incomplete answer. The final artifact should always contain the complete text.
- **Option B: Include content in final artifact** — Adopted. The `FINAL_RESULT` event now carries the full synthesized answer.

---

## Session 3 — Test Harness Design

**Date**: 2026-04-08

### 13. What test level should the harness target?

**Decision**: Both unit/component tests (mocked deps, fast CI) and a lightweight integration suite (Docker Compose test profile).

**Rationale**: Unit tests provide fast feedback (< 30s) for CI on every commit. Integration tests verify end-to-end streaming through real containers but are slower (2-5 min). Both are needed: unit tests catch regressions quickly; integration tests catch protocol/serialization issues that mocks can't reveal.

**Existing patterns**: The project already uses both tiers — `tests/` for unit tests, `integration/` for Docker-based tests. The new harness follows the same split.

### 14. How should streaming events be asserted in unit tests?

**Decision**: Collect yielded events from the A2A binding's async generator into a Python list, then assert on artifact names, content strings, and event ordering.

**Rationale**: The binding's generator yields structured Python dicts/events internally before they become SSE. Intercepting at this layer avoids HTTP/SSE parsing complexity while testing the actual event generation logic. The existing `test_a2a_streaming.py` in `slack_bot/tests/` already uses a similar replay approach with `parse_event()`.

**Key insight from codebase analysis**: `slack_bot/tests/test_a2a_streaming.py` stores raw events as JSON fixtures in `test_data/` and replays them through `parse_event()`. The new tests will generate events programmatically via mocked LangGraph streams rather than captured real events, allowing deterministic assertions.

### 15. How should Slack message rendering be tested?

**Decision**: Both StreamBuffer output testing (content/ordering) and mock Slack WebClient testing (message lifecycle).

**Rationale**: `StreamBuffer` (defined in `ai.py`) batches markdown text chunks before sending to Slack. Testing its output directly verifies content correctness. Mocking `WebClient` verifies the `chat_postMessage` → `chat_update` lifecycle. Together they cover the full Slack rendering path.

**Existing patterns**: `slack_bot/tests/test_ai_plan_streaming.py` already uses `StreamBuffer` with mock WebClient. The new tests extend this pattern for narrative and echo suppression scenarios.

### 16. How should distributed mode be tested without real containers?

**Decision**: Mock HTTP responses (httpx patch for canned agent card + SSE streams) for fast unit tests, plus a fake in-process A2A server (FastAPI with canned responses) for richer path testing.

**Rationale**: The distributed path calls `A2ARemoteAgentConnectTool` which fetches an agent card via HTTP and sends tasks via SSE. Mocking at the HTTP layer tests the full distributed code path — subagent resolution, tool notification extraction, HITL interrupt handling — without Docker overhead.

**Fixture strategy**: Canned JSON fixtures stored in `tests/fixtures/`:
- `a2a_agent_card.json` — minimal valid agent card
- `a2a_task_sse_stream.json` — complete task lifecycle SSE events

### 17. What RAG test fixture strategy should the harness use?

**Decision**: Mock `BaseTool` for wrapper cap/truncation/thread-scoping logic (extends existing `test_rag_tools_hard_stop.py` pattern) + JSON fixtures in `tests/fixtures/` for integration tests exercising the full RAG → binding → streaming pipeline.

**Rationale**: The existing `test_rag_tools_hard_stop.py` (437 lines) already mocks `BaseTool` instances and passes them to the wrapper constructors. This pattern is proven and fast. JSON fixtures provide deterministic, realistic data for integration tests that verify the full pipeline from RAG tool response through A2A event generation to Slack rendering.

**Fixture strategy**:
- `rag_search_response.json` — 3 results with document IDs, scores, snippets
- `rag_fetch_document_response.json` — single document (~5K chars, realistic content)
