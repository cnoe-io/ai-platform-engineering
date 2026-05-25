# Tasks: Slack Streaming Conformance — Artifact ID Reset, No-Tool Queries, RAG Cap Isolation

**Input**: Spec from `.specify/specs/099-slack-streaming-conformance/spec.md`
**Related**: `098-unify-single-distributed-binding` (parent spec — binding unification, RAG caps)

**Organization**: Tasks migrated from 098 Phase 10, organized by user story. All tasks are completed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US4)
- Include exact file paths in descriptions

## Path Conventions

- **A2A binding**: `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/`
- **Slack bot**: `ai_platform_engineering/integrations/slack_bot/`
- **RAG tools**: `ai_platform_engineering/multi_agents/platform_engineer/rag_tools.py`
- **Middleware**: `ai_platform_engineering/utils/deepagents_custom/middleware.py`
- **Prompts**: `charts/ai-platform-engineering/data/`
- **Tests**: `tests/`

---

## Phase 1: Live Final-Answer Streaming & Metadata Propagation ✅

**Goal**: Restore word-by-word streaming of the final answer to Slack and propagate `is_final_answer` metadata through the executor.

- [x] T001 [US1] Restore live post-marker token yield with `is_final_answer: True` metadata in `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py` (lines ~1054-1061)
- [x] T002 [US1] Propagate `is_final_answer` from event to artifact metadata in `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py` (lines ~779-781)

**Checkpoint**: `STREAMING_RESULT` events carry `is_final_answer=True` in metadata; executor propagates to artifacts.

---

## Phase 2: Per-Tool RAG Cap Tracking ✅

**Goal**: Replace global RAG hard-stop with per-tool cap tracking to prevent premature graph termination.

- [x] T003 [US2] Replace global `_rag_hard_stop_set` with `_rag_capped_tools: dict[str, set[str]]` in `ai_platform_engineering/multi_agents/platform_engineer/rag_tools.py`
- [x] T004 [US2] Add `is_rag_tool_capped(thread_id, tool_name)` function in `rag_tools.py`
- [x] T005 [US2] Update `_record_rag_cap_hit` to accept `tool_name` argument in `rag_tools.py`
- [x] T006 [US2] Update `DeterministicTaskMiddleware.after_model` to use per-tool cap checks in `ai_platform_engineering/utils/deepagents_custom/middleware.py`
- [x] T007 [US2] Update `tests/test_rag_tools_hard_stop.py` for new cap tracking structure; add `test_is_rag_tool_capped_tracks_individual_tools`

**Checkpoint**: Capping `search` does not block `fetch_document`; graph only terminates when all requested tools are individually capped. SC-003, SC-004 satisfied.

---

## Phase 3: No-Tool Query Stream Opening ✅

**Goal**: Ensure simple/off-topic queries (no tool calls) deliver answers to Slack.

- [x] T008 [US3] Fix pre-stream typing guard: `if not stream_ts and not streaming_final_answer:` in `ai_platform_engineering/integrations/slack_bot/utils/ai.py` (line ~401)

**Checkpoint**: "tell me a joke" and "how is the weather in SF?" produce visible Slack output. SC-002 satisfied.

---

## Phase 4: RAG Parallel Tool Call Prompts ✅

**Goal**: Hint the LLM to issue multiple RAG tool calls per response for faster retrieval.

- [x] T009 [P] [US5] Add parallel tool call hint to `search_tool_prompt` in `charts/ai-platform-engineering/data/prompt_config.rag.yaml`
- [x] T010 [P] [US5] Add parallel tool call hint to RAG instructions in `charts/ai-platform-engineering/data/prompt_config.deep_agent.yaml`

**Checkpoint**: RAG prompts include "Parallel Tool Calls" hint section.

---

## Phase 5: Conformance Test Suite ✅

**Goal**: Build an automated suite that validates all Slack streaming scenarios end-to-end.

- [x] T011 [US4] Add `--suite` mode to `tests/simulate_slack_stream.py` with `run_suite()` function
- [x] T012 [US4] Define 4 conformance scenarios: `simple-chat`, `off-topic`, `rag-simple`, `rag-complex`
- [x] T013 [US4] Implement conformance checks: content_delivered, stream_opened, live_streamed, no_duplicate, final_answer_latched, tools_used, multi_chunk, no_tools
- [x] T014 [US4] Modify `simulate()` to return structured result dict for suite consumption

**Checkpoint**: All 22 conformance checks pass. SC-001 satisfied.

---

## Phase 6: Benchmark & Enforcement ✅

**Goal**: Define the formal benchmark and automate enforcement via a Cursor rule.

- [x] T015 [US4] Create `tests/STREAMING_CONFORMANCE.md` with scenarios, invariants, scope, and instructions for adding new scenarios (SC-006)
- [x] T016 [US4] Create `.cursor/rules/streaming-conformance.mdc` glob-matched to 7 pipeline files (SC-005)

**Checkpoint**: Benchmark document exists; Cursor rule triggers on pipeline edits.

---

## Dependencies & Execution Order

```
Phase 1 (live streaming)  ──→ Phase 3 (no-tool fix) ──→ Phase 5 (conformance suite)
                                                         ↑
Phase 2 (RAG caps)  ─────────────────────────────────────┘
                                                         ↓
Phase 4 (prompts)  ──────────────────────────────────→ Phase 6 (benchmark)
```

- Phases 1, 2, 4 can run in parallel (different files, no shared state)
- Phase 3 depends on Phase 1 (`is_final_answer` metadata must exist)
- Phase 5 depends on Phases 1, 2, 3 (validates all fixes)
- Phase 6 depends on Phase 5 (benchmark references the suite)

---

## Notes

- All 16 tasks (T001–T016) are completed
- All tasks use exact file paths for traceability
- These tasks were originally Phase 10 / T058–T071 in the 098 spec
- The conformance test suite requires a running supervisor: `PYTHONPATH=. uv run python tests/simulate_slack_stream.py --suite`
