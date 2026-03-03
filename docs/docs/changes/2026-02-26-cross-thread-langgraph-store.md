# LangGraph Persistence — Checkpointer & Cross-Thread Store

**Status**: 🟢 In-use
**Category**: Architecture & Design
**Date**: February 26, 2026

## Overview

Implemented full LangGraph persistence with two complementary layers: (1) per-thread **Checkpointer** for conversation state within a thread, including auto-trimming and orphan repair; and (2) cross-thread **Store** for long-term user-scoped memory that persists across threads.

## Problem Statement

Without persistence, the agent loses all state on restart, threads are isolated with no carryover, and users must re-explain context in every conversation.

## Decision

Use LangGraph's native persistence APIs to implement a two-layer system:

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **LangGraph Checkpointer + Store (chosen)** | Native APIs, two clean layers, pluggable backends | More wiring to set up | Selected |
| Custom key-value store | Full control over data model | No LangGraph integration, manual wiring | Rejected |
| Shared checkpointer thread | Simple concept | Violates thread isolation, fragile | Rejected |

## Solution Architecture

### Two-Layer Persistence

```
Layer 1: Checkpointer (per-thread state)
  - Scope: Per thread_id
  - Stores: Raw messages (HumanMessage, AIMessage, ToolMessage, SystemMessage)
  - Backends: InMemorySaver (default)
  - Features:
    • Disabled when LANGGRAPH_DEV is set (for LangGraph Studio compatibility)
    • Auto-trim: _trim_messages_if_needed removes old messages when context exceeds token limit
    • Safe split: _find_safe_split_index ensures tool-call/tool-result pairs are never orphaned
    • System messages always preserved during trimming
    • Repair fallback: adds reset message when orphan repair fails (checks checkpointer presence)
    • Wired into: deep_agent, base_langgraph_agent, GitHub, GitLab, Slack, AWS, Splunk agents

Layer 2: Store (cross-thread user memory)
  - Scope: Per user_id, across all threads
  - Stores: User memories, conversation summaries
  - Backends: InMemoryStore (default), Redis, Postgres
  - Features:
    • Cross-thread recall on new conversations
    • LangMem summary persistence after context compression
    • Automatic fact extraction (opt-in via ENABLE_FACT_EXTRACTION)
    • User isolation: each user has own namespace
```

### Checkpointer Data Flow

1. User sends message with `context_id` (mapped to `thread_id`)
2. Graph invokes with `config = {"configurable": {"thread_id": context_id}}`
3. Checkpointer saves state (messages) after each graph invocation
4. On next message in same thread: checkpointer restores state, agent continues conversation
5. Before invocation: `_trim_messages_if_needed` checks token count and removes old messages if needed
6. On repair failure: fallback adds reset message via `aupdate_state` (only when checkpointer is present)

### Store Data Flow

1. User sends message with JWT token containing user identity
2. Metrics middleware extracts `user_id` / `user_email` from JWT
3. Agent executor propagates `user_id` into agent config metadata
4. On new thread: agent queries store for recent summaries/memories and injects as SystemMessage
5. On context compression: LangMem saves summary to store for future threads
6. (When enabled) After response: background task extracts facts and persists to store

### Configuration

```bash
# Checkpointer
LANGGRAPH_DEV=                      # Set to any value to disable checkpointer

# Store
LANGGRAPH_STORE_TYPE=memory         # memory (default) | redis | postgres
LANGGRAPH_STORE_REDIS_URL=          # defaults to REDIS_URL
LANGGRAPH_STORE_POSTGRES_DSN=       # defaults to POSTGRES_DSN
LANGGRAPH_STORE_TTL_MINUTES=10080   # 7 days default

# Fact extraction
ENABLE_FACT_EXTRACTION=false        # Enable background fact extraction
FACT_EXTRACTION_MODEL=              # Model for extraction (empty = default LLM)
```

## Components Changed

### Checkpointer
- `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` - InMemorySaver wiring, `LANGGRAPH_DEV` toggle
- `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py` - `MemorySaver` for individual agents, `_trim_messages_if_needed`, `_find_safe_split_index`, `_count_message_tokens`
- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py` - Repair fallback using checkpointer
- `ai_platform_engineering/agents/github/`, `gitlab/`, `slack/`, `aws/`, `splunk/` - All compile graphs with checkpointer

### Cross-Thread Store
- `ai_platform_engineering/utils/store.py` (new) - Store factory
- `deepagents/graph.py` - Added `store` parameter to graph builder
- `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` - Wires store into graph
- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py` - Cross-thread retrieval, fact extraction
- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py` - User identity propagation
- `ai_platform_engineering/utils/a2a_common/langmem_utils.py` - Summary persistence to store
- `ai_platform_engineering/utils/agent_memory/fact_extraction.py` (new) - LangMem fact extraction

### Tests
- `tests/test_checkpoint.py` (new) - 49 checkpoint unit tests
- `tests/test_store.py` (new) - 86 store unit tests
- `tests/test_fact_extraction.py` (new) - 65 fact extraction unit tests
- `tests/test_persistence_unit.py` - 89 persistence/compression/orphan repair tests

## Related

- Spec: `.specify/specs/cross-thread-store.md`
- ADR: `2026-02-26-automatic-fact-extraction.md` (Fact extraction decision)
- ADR: `2025-12-13-context-management-and-resilience.md` (LangMem context management)
