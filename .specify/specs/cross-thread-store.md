# Spec: Cross-Thread LangGraph Store

## Overview

Add cross-thread long-term memory via LangGraph Store, enabling user memories and conversation summaries to persist across threads/conversations. InMemoryStore is the default; Redis and Postgres stores are opt-in.

## Motivation

Currently, each conversation thread is fully isolated. When a user starts a new conversation, the agent has zero knowledge of prior interactions. This forces users to re-explain context, preferences, and project details repeatedly. Cross-thread memory solves this by persisting user-scoped facts and conversation summaries that carry over to new threads.

## Scope

### In Scope
- Store factory with InMemoryStore (default), Redis, and Postgres backends
- Wiring the store through `deepagents` graph compilation
- Saving LangMem compression summaries to the store for cross-thread access
- Retrieving cross-thread context (summaries + memories) when starting new threads
- Propagating user identity from JWT middleware into agent config
- Automatic fact extraction from conversations using LangMem's `create_memory_store_manager`
- Environment variable configuration
- Unit tests

### Out of Scope
- Explicit "remember this" / "forget this" user commands (future)
- Store-based RAG / semantic search over memories (future)
- Admin UI for viewing/managing stored memories

## Design

### Architecture

The Store is a separate component from the Checkpointer:
- **Checkpointer**: saves raw messages per `thread_id` (unchanged)
- **Store**: saves key-value data per `user_id` across all threads (new)

### Data Model

```
Store Namespaces:
  ("memories", <user_id>)   -> {key: uuid, value: {"data": "...", "source_thread": "...", "timestamp": ...}}
  ("summaries", <user_id>)  -> {key: uuid, value: {"summary": "...", "thread_id": "...", "timestamp": ...}}
```

### Components Affected
- [x] Multi-Agents (`ai_platform_engineering/multi_agents/`) - deep_agent.py, agent.py, agent_executor.py
- [x] Utils (`ai_platform_engineering/utils/`) - new store.py, langmem_utils.py
- [x] Deepagents (`deepagents/`) - graph.py
- [x] Documentation (`docs/`)
- [ ] Agents (`ai_platform_engineering/agents/`)
- [ ] MCP Servers
- [ ] Knowledge Bases (`ai_platform_engineering/knowledge_bases/`)
- [ ] UI (`ui/`)
- [ ] Helm Charts (`charts/`)

## Acceptance Criteria

- [x] Store factory creates InMemoryStore by default
- [x] Store factory supports Redis and Postgres via env vars
- [x] Store is wired into graph compilation via deepagents
- [x] User identity flows from JWT middleware to agent config
- [x] LangMem summaries are saved to store after compression
- [x] New threads retrieve cross-thread summaries/memories
- [x] Graceful fallback when store is unavailable
- [x] Unit tests pass
- [x] Documentation updated (ADR + env vars)
- [x] Automatic fact extraction runs in background after each response (when enabled)
- [x] Fact extraction controlled by ENABLE_FACT_EXTRACTION env var (default false)
- [x] Extracted facts persisted to ("memories", user_id) namespace via MemoryStoreManager
- [x] Fact extraction unit tests pass

## Implementation Plan

### Phase 1: Infrastructure
- [x] Create store factory (`ai_platform_engineering/utils/store.py`)
- [x] Add `store` parameter to deepagents graph builder
- [x] Wire store into deep_agent.py

### Phase 2: Data Flow
- [x] Propagate user_id from JWT middleware through executor to agent
- [x] Save LangMem summaries to store
- [x] Retrieve cross-thread context on new threads

### Phase 3: Configuration & Tests
- [x] Update .env.example and docker-compose.dev.yaml
- [x] Write unit tests
- [x] Create ADR

### Phase 4: Automatic Fact Extraction
- [x] Create `ai_platform_engineering/utils/agent_memory/fact_extraction.py` with LangMem `create_memory_store_manager` integration
- [x] Add background `asyncio.create_task()` in `agent.py` stream() to extract facts after response
- [x] Add `ENABLE_FACT_EXTRACTION` and `FACT_EXTRACTION_MODEL` env vars
- [x] Verify `store_get_cross_thread_context` handles MemoryStoreManager output format
- [x] Write unit tests for fact extraction (151 tests passing)
- [x] Create ADR for automatic fact extraction decision

## Testing Strategy

- Unit tests: Store factory, put/get/search, namespace isolation, summary persistence, cross-thread retrieval, error handling, fact extraction feature flag, extractor creation/caching, background extraction, store compatibility (old/new formats), concurrent access, unicode, edge cases (151 tests)
- Integration test: `scripts/test_fact_extraction_live.py` -- seeds facts via multi-turn conversation, waits for background extraction, verifies recall on a new thread, and checks user isolation
- Manual verification: Multi-thread conversation with memory recall

## Rollout Plan

1. Merge with InMemoryStore default (no infrastructure changes needed)
2. Teams can opt-in to Redis/Postgres store via env vars
3. Future: semantic search over memories, explicit remember/forget commands

## Related

- ADR: `docs/docs/changes/2026-02-26-cross-thread-langgraph-store.md`
- PR: #861 (LangGraph Redis persistence)
