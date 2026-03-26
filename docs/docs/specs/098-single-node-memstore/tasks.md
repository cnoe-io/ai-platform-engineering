# Tasks: Single-Node Persistent Memory Store

**Input**: Design documents from `/specs/098-single-node-memstore/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md

**Tests**: No test tasks included (not requested in spec). Existing test suite validates the factories.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No project initialization needed — all files already exist. This phase is empty.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Replace the multi-node agent file with a re-export shim. This MUST complete before user story work because it changes the canonical import paths.

- [X] T001 Replace `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` with a backward-compatible re-export shim that imports `AIPlatformEngineerMAS`, `PlatformEngineerDeepAgent`, and `USE_STRUCTURED_RESPONSE` from `deep_agent_single`
- [X] T002 Update import and patch paths in `tests/test_persistence_unit.py` lines 1038-1062 from `deep_agent` to `deep_agent_single` module, and rewrite the two tests (`test_checkpointer_attached_to_graph`, `test_checkpointer_disabled_with_langgraph_dev`) to work with the async `PlatformEngineerDeepAgent` class

**Checkpoint**: Shim in place, all existing import paths resolve, existing test suite passes

---

## Phase 3: User Story 1 - Conversation state persists across pod restarts (Priority: P1) MVP

**Goal**: Single-node agent uses configurable `create_checkpointer()` and `create_store()` instead of hardcoded `InMemorySaver()`

**Independent Test**: Start agent with `LANGGRAPH_CHECKPOINT_TYPE=mongodb` + `MONGODB_URI` set. Verify logs show `MongoDBSaver configured`. Start with no env vars. Verify logs show `InMemorySaver created`.

### Implementation for User Story 1

- [X] T003 [US1] Replace `from langgraph.checkpoint.memory import InMemorySaver` with `from ai_platform_engineering.utils.checkpointer import create_checkpointer` in `ai_platform_engineering/multi_agents/platform_engineer/deep_agent_single.py` (line 30)
- [X] T004 [US1] Add `from ai_platform_engineering.utils.store import create_store` import in `ai_platform_engineering/multi_agents/platform_engineer/deep_agent_single.py` (near line 30)
- [X] T005 [US1] In `_build_graph_async()` method of `ai_platform_engineering/multi_agents/platform_engineer/deep_agent_single.py`, add store creation block after `deep_agent_kwargs` dict construction (~line 1254) and before the `USE_STRUCTURED_RESPONSE` check: call `create_store()`, attach to `deep_agent_kwargs["store"]` if non-None, with try/except fallback
- [X] T006 [US1] In `_build_graph_async()` method of `ai_platform_engineering/multi_agents/platform_engineer/deep_agent_single.py`, replace `deep_agent.checkpointer = InMemorySaver()` (line 1267) with `deep_agent.checkpointer = create_checkpointer()`

**Checkpoint**: Single-node agent uses configurable persistence backends. Default behavior (InMemorySaver + InMemoryStore) unchanged when no env vars set.

---

## Phase 4: User Story 2 - Agent remembers user preferences across conversations (Priority: P1)

**Goal**: Single-node A2A binding retrieves cross-thread memory context for new conversations and runs background fact extraction after responses

**Independent Test**: Configure `LANGGRAPH_STORE_TYPE=redis` + `REDIS_URL` + `ENABLE_FACT_EXTRACTION=true`. Start a conversation mentioning team context. Verify logs show `Launched background fact extraction`. Start new conversation. Verify logs show `Injected cross-thread context`.

### Implementation for User Story 2

- [X] T007 [US2] Add cross-thread memory retrieval block in `stream()` method of `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_single.py` after config metadata setup (~line 383) and before preflight context check (~line 433): get `graph_store` from `self.graph.store`, check for new thread + `user_email`, call `store_get_cross_thread_context()`, inject `SystemMessage` into `inputs['messages']`
- [X] T008 [US2] Add background fact extraction block in `stream()` method of `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_single.py` before `yield final_response` (line 1791): import `is_fact_extraction_enabled` and `extract_and_store_facts`, check conditions, launch `asyncio.create_task()` with `user_email` as `user_id`

**Checkpoint**: Cross-thread memory and fact extraction working in single-node mode, matching multi-node parity.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validation and cleanup across all stories

- [X] T009 Run `make lint` to verify all modified files pass Ruff linting
- [X] T010 Run `make test` to verify all existing tests pass
- [X] T011 Verify backward-compatible imports work: `python -c "from ai_platform_engineering.multi_agents.platform_engineer.deep_agent import AIPlatformEngineerMAS; print(AIPlatformEngineerMAS)"`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: No dependencies - can start immediately
- **User Story 1 (Phase 3)**: Can start after Phase 2 (needs shim in place so imports resolve)
- **User Story 2 (Phase 4)**: Depends on Phase 3 (needs store attached to graph before A2A binding can access it)
- **Polish (Phase 5)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends on Phase 2 (shim). Modifies `deep_agent_single.py` only.
- **User Story 2 (P1)**: Depends on US1 (store must be attached to graph). Modifies `agent_single.py` only.
- **User Story 3 (P2)**: Completed by Phase 2 (the shim IS the consolidation). No additional work needed.

### Within Each User Story

- T003 and T004 can run in parallel (both are import changes in the same file, different lines)
- T005 depends on T004 (needs `create_store` import)
- T006 depends on T003 (needs `create_checkpointer` import)
- T007 and T008 are independent of each other (different locations in `agent_single.py`)

### Parallel Opportunities

```bash
# Phase 2: Both tasks are in different files, can run in parallel
Task: T001 (deep_agent.py shim)
Task: T002 (test_persistence_unit.py patches)

# Phase 3: Import changes can be done together
Task: T003 + T004 (both import changes in deep_agent_single.py)

# Phase 4: Both additions in agent_single.py are at different locations
Task: T007 (cross-thread memory, ~line 383)
Task: T008 (fact extraction, ~line 1790)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (shim + test updates)
2. Complete Phase 3: User Story 1 (persistence wiring)
3. **STOP and VALIDATE**: Run `make test`, verify default InMemorySaver behavior
4. This alone delivers persistent checkpointing + cross-thread store

### Incremental Delivery

1. Phase 2 → Shim in place, tests pass (US3 done)
2. Phase 3 → Persistence wiring (US1 done, US3 done)
3. Phase 4 → Memory + fact extraction in A2A binding (US1 + US2 + US3 all done)
4. Phase 5 → Final validation
