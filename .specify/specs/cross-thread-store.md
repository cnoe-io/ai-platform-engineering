# Spec: LangGraph Persistence — Checkpointer & Cross-Thread Store

## Overview

Implement full LangGraph persistence with two complementary layers: (1) per-thread **Checkpointer** for saving conversation state (messages) within a thread, including auto-trimming and orphan repair; and (2) cross-thread **Store** for long-term user-scoped memory (summaries, facts, preferences) that persists across threads. Additionally, integrate LangMem for automatic fact extraction from conversations.

## Motivation

Without persistence, conversation state is lost on restart, threads are isolated, and agents have no memory of prior interactions. This spec covers:

- **Checkpointer**: Enables multi-turn conversation continuity within a thread. Without it, the agent forgets the conversation after each message.
- **Cross-thread Store**: When a user starts a new conversation, the agent can recall context from prior threads — no need to re-explain preferences, project details, or environment.
- **Fact extraction**: Actively extracts and persists facts from conversations so the agent proactively remembers details, even from short conversations that never trigger context compression.

## Scope

### In Scope
- **Checkpointer** (per-thread state persistence):
  - InMemorySaver (default), with InMemorySaver disabled when `LANGGRAPH_DEV` is set
  - Checkpointer wired into graph compilation for deep agent, GitHub, GitLab, Slack, AWS, Splunk agents
  - `_trim_messages_if_needed` auto-compression when context exceeds token limit
  - `_find_safe_split_index` respects tool-call/tool-result boundaries during trimming
  - Repair fallback: resets thread state via `aupdate_state` when orphan repair fails
  - Thread isolation: different `thread_id` values produce isolated state
  - `context_id` → `thread_id` mapping for A2A protocol
- **Cross-thread Store** (user-scoped long-term memory):
  - Store factory with InMemoryStore (default), Redis, and Postgres backends
  - Wiring the store through `deepagents` graph compilation
  - Saving LangMem compression summaries to the store for cross-thread access
  - Retrieving cross-thread context (summaries + memories) when starting new threads
  - Propagating user identity from JWT middleware into agent config
- **Automatic fact extraction** from conversations using LangMem's `create_memory_store_manager`
- Environment variable configuration
- Unit tests for all layers

### Out of Scope
- AsyncRedisSaver / AsyncPostgresSaver checkpointer backends (future — infrastructure not yet wired)
- Explicit "remember this" / "forget this" user commands (future)
- Store-based RAG / semantic search over memories (future)
- Admin UI for viewing/managing stored memories

## Design

### Architecture

LangGraph persistence has two independent layers:

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Checkpointer (per-thread state)           │
│  ─────────────────────────────────────────────       │
│  Scope: thread_id                                   │
│  Stores: Raw messages (Human, AI, Tool, System)     │
│  Backends: InMemorySaver (default)                  │
│  Features:                                          │
│    • Multi-turn conversation continuity             │
│    • Auto-trim when context exceeds token limit     │
│    • Safe split: respects tool-call/result pairs    │
│    • Orphan repair fallback: resets corrupted state  │
│    • Disabled when LANGGRAPH_DEV is set             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Layer 2: Store (cross-thread user memory)          │
│  ─────────────────────────────────────────────       │
│  Scope: user_id (across all threads)                │
│  Stores: User memories, conversation summaries      │
│  Backends: InMemoryStore (default), Redis, Postgres │
│  Features:                                          │
│    • Cross-thread recall on new conversations       │
│    • LangMem summary persistence after compression  │
│    • Automatic fact extraction (opt-in)             │
│    • User isolation: each user has own namespace    │
└─────────────────────────────────────────────────────┘
```

### Data Model

```
Checkpointer:
  thread_id -> [HumanMessage, AIMessage, ToolMessage, SystemMessage, ...]

Store Namespaces:
  ("memories", <user_id>)   -> {key: uuid, value: {"data": "...", "source_thread": "...", "timestamp": ...}}
  ("summaries", <user_id>)  -> {key: uuid, value: {"summary": "...", "thread_id": "...", "timestamp": ...}}
```

### Components Affected
- [x] Multi-Agents (`ai_platform_engineering/multi_agents/`) - deep_agent.py (checkpointer + store wiring), agent.py (repair fallback, fact extraction), agent_executor.py (user_id propagation), agent_registry.py
- [x] Utils (`ai_platform_engineering/utils/`) - store.py, agent_memory/fact_extraction.py, a2a_common/langmem_utils.py, a2a_common/base_langgraph_agent.py (trim, safe split, checkpointer)
- [x] Deepagents (`deepagents/`) - graph.py (store parameter)
- [x] Agents (`ai_platform_engineering/agents/`) - GitHub, GitLab, Slack, AWS, Splunk all wire checkpointers via base_langgraph_agent
- [x] Documentation (`docs/`)
- [ ] MCP Servers
- [ ] Knowledge Bases (`ai_platform_engineering/knowledge_bases/`)
- [ ] UI (`ui/`)
- [ ] Helm Charts (`charts/`)

## Acceptance Criteria

### Checkpointer (per-thread persistence)
- [x] InMemorySaver attached to deep agent by default
- [x] Checkpointer disabled when `LANGGRAPH_DEV` env var is set
- [x] Thread isolation: different thread_ids produce independent state
- [x] Same-thread accumulation: messages persist across invocations
- [x] `_trim_messages_if_needed` trims old messages when context exceeds token limit
- [x] `_find_safe_split_index` never orphans tool-call/tool-result pairs
- [x] System messages preserved during trimming
- [x] Repair fallback: adds reset message via `aupdate_state` when orphan repair fails
- [x] Repair fallback skipped when checkpointer is None or thread_id is absent
- [x] `context_id` correctly mapped to `thread_id` in stream config
- [x] Individual agents (GitHub, GitLab, Slack, AWS, Splunk) wire checkpointers
- [x] Graph compiles correctly with, without, and with None checkpointer
- [x] Checkpoint tests pass (49 tests)

### Cross-thread Store (user-scoped memory)
- [x] Store factory creates InMemoryStore by default
- [x] Store factory supports Redis and Postgres via env vars
- [x] Store is wired into graph compilation via deepagents
- [x] User identity flows from JWT middleware to agent config
- [x] LangMem summaries are saved to store after compression
- [x] New threads retrieve cross-thread summaries/memories
- [x] Graceful fallback when store is unavailable
- [x] Store unit tests pass (86 tests)

### Automatic Fact Extraction
- [x] Fact extraction runs in background after each response (when enabled)
- [x] Controlled by `ENABLE_FACT_EXTRACTION` env var (default false)
- [x] Extracted facts persisted to ("memories", user_id) namespace via MemoryStoreManager
- [x] Fact extraction unit tests pass (65 tests)

### Documentation & Overall
- [x] Documentation updated (ADR + env vars)
- [x] All 289 persistence-related unit tests pass

## Implementation Plan

### Phase 1: Checkpointer (per-thread persistence)
- [x] InMemorySaver wired into deep_agent.py with `LANGGRAPH_DEV` toggle
- [x] base_langgraph_agent.py uses `MemorySaver` for individual agent graphs
- [x] `_trim_messages_if_needed` auto-compression with `_find_safe_split_index` boundary safety
- [x] Repair fallback in agent.py when orphan repair fails (checks checkpointer presence)
- [x] context_id → thread_id mapping and user_id/trace_id metadata propagation

### Phase 2: Cross-Thread Store Infrastructure
- [x] Create store factory (`ai_platform_engineering/utils/store.py`)
- [x] Add `store` parameter to deepagents graph builder
- [x] Wire store into deep_agent.py

### Phase 3: Cross-Thread Data Flow
- [x] Propagate user_id from JWT middleware through executor to agent
- [x] Save LangMem summaries to store
- [x] Retrieve cross-thread context on new threads

### Phase 4: Configuration & Tests
- [x] Update .env.example and docker-compose.dev.yaml
- [x] Write unit tests for store (86 tests)
- [x] Create ADR for cross-thread store

### Phase 5: Automatic Fact Extraction
- [x] Create `ai_platform_engineering/utils/agent_memory/fact_extraction.py` with LangMem `create_memory_store_manager` integration
- [x] Add background `asyncio.create_task()` in `agent.py` stream() to extract facts after response
- [x] Add `ENABLE_FACT_EXTRACTION` and `FACT_EXTRACTION_MODEL` env vars
- [x] Verify `store_get_cross_thread_context` handles MemoryStoreManager output format
- [x] Write unit tests for fact extraction (65 tests)
- [x] Create ADR for automatic fact extraction decision

### Phase 6: Checkpoint Testing
- [x] Write comprehensive checkpoint tests (49 tests) covering:
  - InMemorySaver lifecycle and thread isolation
  - State round-trip (Human, AI, System, Unicode messages)
  - `_find_safe_split_index` boundary safety with tool-call pairs
  - `_trim_messages_if_needed` all branches (disabled, no state, under limit, over limit, system preserved)
  - Repair fallback with/without checkpointer/thread_id, error handling
  - Concurrent checkpoint access (10 threads write, 10 concurrent reads)
  - Graph compilation variants (with, without, None checkpointer)
  - Agent checkpointer wiring verification (source inspection)
  - Edge cases (long thread IDs, special chars, 50-message accumulation)

## Testing Strategy

### Unit Tests (289 total)

| Test File | Count | Coverage |
|---|---|---|
| `tests/test_checkpoint.py` | 49 | InMemorySaver lifecycle, thread isolation, state round-trip, `_find_safe_split_index`, `_trim_messages_if_needed` (all branches), repair fallback, context_id→thread_id, concurrent access, graph compilation, agent wiring, edge cases |
| `tests/test_store.py` | 86 | Store factory, put memory/summary, cross-thread retrieval, user isolation, LangMem integration, user_id extraction/propagation, InMemoryStore integration, lazy Postgres |
| `tests/test_fact_extraction.py` | 65 | Feature flag, config builder, extraction model, extractor creation/caching, extract-and-store, store compatibility, agent integration, edge cases |
| `tests/test_persistence_unit.py` | 89 | `_extract_tool_call_ids`, `_find_safe_summarization_boundary`, `summarize_messages`, `_fallback_summarize`, `preflight_context_check`, `_repair_orphaned_tool_calls`, stream config wiring, deep_agent checkpointer wiring |

### Integration Tests
- `integration/test_fact_extraction_live.py` -- Seeds facts via multi-turn conversation, waits for background extraction, verifies recall on a new thread, and checks user isolation
- `integration/test_persistence_features.py` -- End-to-end thread persistence, recall, isolation, multi-turn via A2A HTTP API

### Manual verification
- Multi-thread conversation with memory recall

## Rollout Plan

1. Merge with InMemoryStore default (no infrastructure changes needed)
2. Teams can opt-in to Redis/Postgres store via env vars
3. Future: semantic search over memories, explicit remember/forget commands

## Related

- ADR: `docs/docs/changes/2026-02-26-cross-thread-langgraph-store.md`
- PR: #861 (LangGraph Redis persistence)
