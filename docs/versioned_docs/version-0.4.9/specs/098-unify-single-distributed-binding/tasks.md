# Tasks: Unify Single-Node & Distributed Binding + RAG Reliability + Test Harness

**Input**: Design documents from `docs/docs/specs/098-unify-single-distributed-binding/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Included — the test harness (Phase D) is a core deliverable of this spec.

**Organization**: Tasks are grouped by user story. US-1 through US-6 are already completed. Remaining work covers US-7 completion and the full test harness (Phase D).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US7)
- Include exact file paths in descriptions

## Path Conventions

- **Supervisor backend**: `ai_platform_engineering/multi_agents/platform_engineer/`
- **A2A binding**: `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/`
- **Slack bot**: `ai_platform_engineering/integrations/slack_bot/`
- **Unit tests**: `tests/`
- **Integration tests**: `integration/`
- **Fixtures**: `tests/fixtures/`

---

## Phase 1: Completed Work (US-1 through US-6) ✅

> These phases are already implemented and tracked in the spec's Implementation Progress table.
> Listed here for completeness and dependency tracking.

- [x] T001 [US1] Merge `deep_agent_single.py` into `deep_agent.py` in `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py`
- [x] T002 [US1] Merge `agent_single.py` into `agent.py` in `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py`
- [x] T003 [US1] Merge `agent_executor_single.py` into `agent_executor.py`
- [x] T004 [US1] Merge `main_single.py` into `main.py`
- [x] T005 [US1] Merge Docker Compose into single `caipe-supervisor` service in `docker-compose.dev.yaml`
- [x] T006 [US1] Auto-enable connectivity check when `DISTRIBUTED_AGENTS` is set in `ai_platform_engineering/multi_agents/agent_registry.py`
- [x] T007 [US5] Implement `_get_distributed_agents()` and `_agent_is_distributed()` in `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py`
- [x] T008 [US5] Unit tests for per-agent distribution in `tests/test_distributed_agents.py`
- [x] T009 [US2] Tool narration with correct subagent name extraction in `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py`
- [x] T010 [US2] Unit tests for tool narration in `tests/test_streaming_narration.py`
- [x] T011 [US6] Implement `FetchDocumentCapWrapper` and `SearchCapWrapper` in `ai_platform_engineering/multi_agents/platform_engineer/rag_tools.py`
- [x] T012 [US6] Wire cap wrappers into tool loading in `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py`
- [x] T013 [US6] Configurable `LANGGRAPH_RECURSION_LIMIT` in `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py`
- [x] T014 [US6] Configurable recursion limit in `ai_platform_engineering/utils/a2a_common/base_langgraph_agent.py`
- [x] T015 [US6] `GraphRecursionError` isinstance detection in `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py`
- [x] T016 [US6] Update RAG prompt instructions in `charts/ai-platform-engineering/data/prompt_config.deep_agent.yaml`
- [x] T017 [US6] RAG env vars in `docker-compose.dev.yaml`
- [x] T018 [US6] Unit tests for RAG cap wrappers in `tests/test_rag_tools_hard_stop.py`
- [x] T019 [US7] Remove `continue` suppressing intermediate narrative in `ai_platform_engineering/integrations/slack_bot/utils/ai.py`
- [x] T020 [US7] Add RAG tool exclusion from echo suppression in `ai_platform_engineering/integrations/slack_bot/utils/ai.py`

**Checkpoint**: US-1 through US-6 fully implemented. US-7 partially complete (narrative streaming works, final answer delivery pending).

---

## Phase 2: US-7 Completion — Final Answer Delivery (Priority: P1)

**Goal**: Fix the final synthesized answer being cleared before the `FINAL_RESULT` event, so Slack receives the actual answer.

**Independent Test**: Ask a RAG query via Slack and verify the final answer text is non-empty and contains the synthesized content (not "I've completed your request." with no body).

### Implementation for US-7 Completion

- [x] T021 [US7] Fix `final_response['content'] = ''` to include `response_format_result` content in `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py` (~line 1862)
- [x] T022 [US7] Verify edge case: no `response_format_result` — ensure content falls back to accumulated model output; added `final_model_content` fallback from `response_format_result` (~line 1922)

**Checkpoint**: SC-012 satisfied — final synthesized answer arrives in Slack as non-empty `FINAL_RESULT` artifact.

---

## Phase 3: Test Harness — JSON Fixtures (Phase D.5)

**Goal**: Create deterministic test fixtures for use by all subsequent test phases.

**Independent Test**: Fixtures load successfully and conform to expected schemas.

- [x] T023 [P] Create `tests/fixtures/` directory structure
- [x] T024 [P] Create canned RAG search response fixture in `tests/fixtures/rag_search_response.json` (3 results with document IDs, scores, snippets)
- [x] T025 [P] Create canned fetch_document response fixture in `tests/fixtures/rag_fetch_document_response.json` (single document, ~5K chars)
- [x] T026 [P] Create canned A2A agent card fixture in `tests/fixtures/a2a_agent_card.json` (minimal valid agent card with skills, capabilities)
- [x] T027 [P] Create canned A2A task SSE stream fixture in `tests/fixtures/a2a_task_sse_stream.json` (complete task lifecycle: status→notification→streaming→final_result→completed)

**Checkpoint**: All 4 fixture files exist and are valid JSON.

---

## Phase 4: Test Harness — FINAL_RESULT Content Tests (Phase D.3)

**Goal**: Verify the A2A binding correctly includes `response_format_result` content in the `FINAL_RESULT` artifact. Validates the Phase 2 fix.

**Independent Test**: `pytest tests/test_final_result_content.py -v` — all tests pass.

- [x] T028 [US7] Create test file with 26 tests in `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/test_final_result_content.py`
- [x] T029 [US7] Test: `response_format_result` present → `final_response['content']` is non-empty (+ dedup survival, Bedrock list format, require_user_input)
- [x] T030 [US7] Test: no `response_format_result` → content from accumulated model output (+ empty fallback)
- [x] T031 [US7] Test: yielded `FINAL_RESULT` event carries full synthesized answer via `final_model_content` (+ trace_id propagation, regression guards)

**Checkpoint**: FINAL_RESULT content logic verified by 3+ test cases.

---

## Phase 5: Test Harness — A2A Binding Streaming Events (Phase D.1)

**Goal**: Verify the A2A binding yields correct streaming events (tool notifications, execution plans, narrative, final result) with proper artifact names and content.

**Independent Test**: `pytest tests/test_binding_streaming_events.py -v` — all tests pass.

- [x] T032 [P] [US2] Create test file with executor mock helpers in `protocol_bindings/a2a/tests/test_binding_streaming_events.py`
- [x] T033 [US2] Test: `TOOL_NOTIFICATION_START` has correct `source_agent` (not "task") — 3 tests for github, write_todos, tool_result
- [x] T034 [US2] Test: `EXECUTION_PLAN_UPDATE` present with agent-tagged steps — executor plan artifact emission
- [x] T035 [US7] Test: `STREAMING_RESULT` events contain narrative text — 3 tests for content, append, post-subagent
- [x] T036 [US7] Test: `FINAL_RESULT` has non-empty content — 3 tests for final_model_content, accumulated, stream_end
- [x] T037 [US7] Test: event ordering — notifications before streaming before final_result

**Checkpoint**: All A2A binding streaming event assertions pass.

---

## Phase 6: Test Harness — Slack Narrative & Echo Suppression (Phase D.2)

**Goal**: Verify Slack bot correctly streams narrative text, suppresses non-RAG post-tool echoes, and passes through RAG post-tool text.

**Independent Test**: `pytest tests/test_slack_narrative_streaming.py -v` — all tests pass.

- [x] T038 [P] [US7] Create test file in `tests/test_slack_narrative_streaming.py` — 11 tests covering event parsing, RAG exclusion, final text priority
- [x] T039 [US7] Test: EventType parsing for STREAMING_RESULT, FINAL_RESULT, TOOL_NOTIFICATION_START/END
- [x] T040 [US7] Test: RAG tools (search, fetch_document, list_datasources, fetch_url) in RAG_TOOL_NAMES set
- [x] T041 [US7] Test: non-RAG tools (github, argocd) NOT in RAG_TOOL_NAMES set
- [x] T042 [US7] Test: _get_final_text priority — FINAL_RESULT > PARTIAL_RESULT > MESSAGE > artifacts
- [x] T043 [US7] Test: empty sources fallback behavior in _get_final_text

**Checkpoint**: All Slack narrative streaming and echo suppression assertions pass.

---

## Phase 7: Test Harness — Distributed Mode Binding (Phase D.4)

**Goal**: Verify the distributed A2A path works correctly with mocked HTTP responses, without real agent containers.

**Independent Test**: `pytest tests/test_distributed_mode_binding.py -v` — all tests pass.

- [x] T044 [P] [US5] Create test file in `tests/test_distributed_mode_binding.py` — 9 tests for parsing edge cases and routing
- [x] T045 [US5] Test: all+other tokens → {"__all__"}, mixed-case "all", 200-name list parsing
- [x] T046 [US5] Test: _agent_is_distributed routing for github with various distributed sets
- [x] T047 [US5] Test: ENABLE_GITHUB=false drops agent before remote/local split (edge case)
- [x] T048 [US5] Test: `DISTRIBUTED_AGENTS=argocd` routes argocd to remote, github to local; all vs none scenarios

**Checkpoint**: Distributed mode fully testable without Docker.

---

## Phase 8: Test Harness — Integration Tests (Phase D.6)

**Goal**: End-to-end streaming validation using Docker Compose test profile.

**Independent Test**: Start minimal Docker environment, run `pytest integration/test_streaming_harness.py -v`.

**Prerequisites**: Docker Compose with `--profile github --profile netutils-agent`

- [x] T049 Create integration test file in `integration/test_streaming_harness.py`
- [x] T050 Test: supervisor starts and responds to A2A health check (agent card validation)
- [x] T051 Test: tool notifications contain correct agent names (not "task") — sourceAgent metadata assertion
- [x] T052 Test: streaming events received via SSE in correct order — streaming_result before final_result
- [x] T053 Test: final result artifact has non-empty content — length > 10 chars assertion

**Checkpoint**: End-to-end streaming validated through real Docker containers.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Finalize documentation, verify all tests pass together, clean up.

- [x] T054 [P] Run full test suite: 193 tests passed, 0 failures
- [x] T055 [P] Run linting: ruff check passed on all changed files (fixed 3 issues: unused imports, line length)
- [x] T056 Update spec.md Implementation Progress table to reflect all completed work
- [x] T057 Verify quickstart.md test commands — unit test suite verified working

**Checkpoint**: All quality gates pass. Ready for PR review.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** (Completed): No dependencies ✅
- **Phase 2** (US-7 fix): Depends on Phase 1 — BLOCKS Phase 4 (FINAL_RESULT tests)
- **Phase 3** (Fixtures): No dependencies — can start immediately, in parallel with Phase 2
- **Phase 4** (FINAL_RESULT tests): Depends on Phase 2 (tests validate the fix) + Phase 3 (fixtures)
- **Phase 5** (Binding events): Depends on Phase 3 (fixtures) — can parallelize with Phase 4
- **Phase 6** (Slack narrative): Depends on Phase 3 (fixtures) — can parallelize with Phase 4, 5
- **Phase 7** (Distributed mode): Depends on Phase 3 (fixtures) — can parallelize with Phase 4, 5, 6
- **Phase 8** (Integration): Depends on Phases 2, 4, 5, 6 — needs all unit tests passing first
- **Phase 9** (Polish): Depends on all previous phases

### User Story Dependencies

- **US-7** (Phase 2): One remaining task — fix `final_response['content']`. Independent of other stories.
- **Test Harness** (Phases 3-8): Validates US-1 through US-7. Independent test files, no cross-story blocking.

### Within Each Test Phase

- Create test file skeleton → add individual test cases → run and verify
- Fixtures must exist before tests that reference them

### Parallel Opportunities

```
Phase 2 (US-7 fix)  ──────────────────┐
                                       ├──→ Phase 4 (FINAL_RESULT tests)
Phase 3 (Fixtures) ───┬──→ Phase 5 ──┤
                       ├──→ Phase 6 ──┤
                       └──→ Phase 7 ──┤
                                       └──→ Phase 8 (Integration)
                                              └──→ Phase 9 (Polish)
```

- Phases 5, 6, 7 can ALL run in parallel (different test files, no shared state)
- Phase 3 (fixtures) can run in parallel with Phase 2 (US-7 fix)
- Within each phase, tasks marked [P] can run in parallel

---

## Parallel Example: Test Harness Fixtures (Phase 3)

```bash
# All fixture files can be created in parallel:
Task: "Create tests/fixtures/rag_search_response.json"
Task: "Create tests/fixtures/rag_fetch_document_response.json"
Task: "Create tests/fixtures/a2a_agent_card.json"
Task: "Create tests/fixtures/a2a_task_sse_stream.json"
```

## Parallel Example: Test Files (Phases 5-7)

```bash
# After fixtures exist, all test files can be worked on in parallel:
Task: "tests/test_binding_streaming_events.py"    # Phase 5
Task: "tests/test_slack_narrative_streaming.py"    # Phase 6
Task: "tests/test_distributed_mode_binding.py"     # Phase 7
```

---

## Implementation Strategy

### MVP First (Phase 2 Only)

1. Fix `final_response['content']` in `agent.py` (T021-T022)
2. **STOP and VALIDATE**: Test via Slack — final answer should now appear
3. Deploy to dev environment for user validation

### Incremental Delivery

1. Phase 2 → Fix final answer → Validate in Slack (critical bug fix)
2. Phase 3 → Create fixtures → Foundation for all test work
3. Phases 4-7 → Unit tests → Fast CI coverage (can parallelize)
4. Phase 8 → Integration test → End-to-end confidence
5. Phase 9 → Polish → PR ready

### Parallel Team Strategy

With 3 developers after Phase 3 completes:
- Developer A: Phase 5 (binding events) + Phase 4 (FINAL_RESULT)
- Developer B: Phase 6 (Slack narrative)
- Developer C: Phase 7 (distributed mode)
- All converge: Phase 8 (integration) → Phase 9 (polish)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Completed tasks (Phases 1-9) are marked `[x]` — all 57 tasks done
- Streaming conformance tasks (formerly Phase 10) moved to `.specify/specs/099-slack-streaming-conformance/tasks.md`
- All tests use `asyncio.run()` wrappers (no `pytest-asyncio` dependency)
- Mock patterns follow existing `test_rag_tools_hard_stop.py` and `slack_bot/tests/test_a2a_streaming.py`
