# Tasks: Extended Middleware Registry for Dynamic Agents

**Input**: Design documents from `docs/docs/specs/102-dynamic-agents-middleware-ui/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅

**Organization**: Tasks are grouped by user story. All 4 user stories modify the same file
(`middleware.py`) so they cannot fully parallelize — they must be applied sequentially.
The test file is created once and extended per story.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new files or packages needed — feature is purely additive to an existing module.

- [X] T001 Verify imports for all 4 new middleware classes exist in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/middleware.py` and add missing ones

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the 4 special builder functions and wire them into `_SPECIAL_BUILDERS`. All user story registry entries depend on these builders existing.

- [X] T002 Add `_build_summarization(params)` builder function to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/middleware.py` — constructs `SummarizationMiddleware` using `_instantiate_model()` for the model, `trigger=[("tokens", trigger_tokens), ("messages", trigger_messages)]`, `keep=("messages", keep_messages)`; returns `None` with warning when no model configured
- [X] T003 Add `_build_human_in_the_loop(params)` builder function to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/middleware.py` — splits comma-separated `tool_names` into `interrupt_on={name: True for name in names}`; returns `None` with warning when `tool_names` is empty
- [X] T004 Add `_build_shell_tool(params)` builder function to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/middleware.py` — passes `workspace_root=params["workspace_root"] or None`, `tool_name=params["tool_name"]`
- [X] T005 Add `_build_filesystem_search(params)` builder function to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/middleware.py` — returns `None` with warning when `root_path` is empty; otherwise constructs `FilesystemFileSearchMiddleware(root_path=..., use_ripgrep=..., max_file_size_mb=...)`
- [X] T006 Register all 4 new builders in `_SPECIAL_BUILDERS` dict in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/middleware.py`
- [X] T007 Create test file `ai_platform_engineering/dynamic_agents/src/dynamic_agents/tests/test_middleware_builders.py` with imports and shared fixtures

**Checkpoint**: Builders exist and are registered — registry entries can now be added in any order.

---

## Phase 3: User Story 1 — Conversation Summarization (Priority: P1) 🎯 MVP

**Goal**: Operators can add and configure `SummarizationMiddleware` via the dynamic agent editor.

**Independent Test**: Add `summarization` to `MIDDLEWARE_REGISTRY`, call `get_middleware_definitions()`, confirm entry appears. Call `build_middleware` with a summarization entry that has a mocked model — confirm `SummarizationMiddleware` instance is in the returned stack.

- [X] T008 [US1] Add `summarization` `MiddlewareSpec` entry to `MIDDLEWARE_REGISTRY` in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/middleware.py` with: `cls=SummarizationMiddleware`, `default_params={"trigger_tokens": 4000, "trigger_messages": 50, "keep_messages": 20}`, `enabled_by_default=False`, `allow_multiple=False`, `model_params=True`, `param_schema={"trigger_tokens": "number", "trigger_messages": "number", "keep_messages": "number"}`
- [X] T009 [US1] Add unit test `test_build_summarization_skips_when_no_model` to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/tests/test_middleware_builders.py` — asserts `_build_summarization({})` returns `None`
- [X] T010 [US1] Add unit test `test_build_summarization_with_model` to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/tests/test_middleware_builders.py` — mocks `_instantiate_model`, asserts `SummarizationMiddleware` instance returned with correct trigger params
- [X] T011 [US1] Add unit test `test_summarization_appears_in_definitions` to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/tests/test_middleware_builders.py` — calls `get_middleware_definitions()`, asserts `summarization` key present with correct `model_params=True` and `param_schema`

**Checkpoint**: `summarization` appears in `/api/dynamic-agents/middleware` response; model selector renders in UI.

---

## Phase 4: User Story 2 — Human-in-the-Loop Approval (Priority: P2)

**Goal**: Operators can add and configure `HumanInTheLoopMiddleware` via the dynamic agent editor.

**Independent Test**: Add `human_in_the_loop` to `MIDDLEWARE_REGISTRY`, call `build_middleware` with `tool_names="deploy,delete"` — confirm `HumanInTheLoopMiddleware` instance has `interrupt_on={"deploy": ..., "delete": ...}`.

- [X] T012 [US2] Add `human_in_the_loop` `MiddlewareSpec` entry to `MIDDLEWARE_REGISTRY` in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/middleware.py` with: `cls=HumanInTheLoopMiddleware`, `default_params={"tool_names": "", "description_prefix": "Tool execution requires approval"}`, `enabled_by_default=False`, `allow_multiple=False`, `model_params=False`, `param_schema={"tool_names": "string", "description_prefix": "string"}`
- [X] T013 [US2] Add unit test `test_build_hitl_skips_when_no_tool_names` to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/tests/test_middleware_builders.py` — asserts `_build_human_in_the_loop({"tool_names": ""})` returns `None`
- [X] T014 [US2] Add unit test `test_build_hitl_with_tool_names` to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/tests/test_middleware_builders.py` — asserts `_build_human_in_the_loop({"tool_names": "deploy,delete", "description_prefix": "Confirm"})` returns `HumanInTheLoopMiddleware` with `interrupt_on` containing `deploy` and `delete` keys

**Checkpoint**: `human_in_the_loop` appears in UI dropdown; tool names field renders as text input.

---

## Phase 5: User Story 3 — Persistent Shell Access (Priority: P3)

**Goal**: Operators can add and configure `ShellToolMiddleware` via the dynamic agent editor.

**Independent Test**: Add `shell_tool` to `MIDDLEWARE_REGISTRY`, call `build_middleware` with empty `workspace_root` — confirm `ShellToolMiddleware` instance constructed with `workspace_root=None`.

- [X] T015 [US3] Add `shell_tool` `MiddlewareSpec` entry to `MIDDLEWARE_REGISTRY` in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/middleware.py` with: `cls=ShellToolMiddleware`, `default_params={"workspace_root": "", "tool_name": "shell"}`, `enabled_by_default=False`, `allow_multiple=False`, `model_params=False`, `param_schema={"workspace_root": "string", "tool_name": "string"}`
- [X] T016 [US3] Add unit test `test_build_shell_tool_empty_workspace_root` to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/tests/test_middleware_builders.py` — asserts `_build_shell_tool({"workspace_root": "", "tool_name": "shell"})` produces `ShellToolMiddleware` instance (no error)
- [X] T017 [US3] Add unit test `test_build_shell_tool_with_workspace_root` to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/tests/test_middleware_builders.py` — asserts `_build_shell_tool({"workspace_root": "/workspace", "tool_name": "sh"})` produces instance without raising

**Checkpoint**: `shell_tool` appears in UI dropdown; workspace root and tool name text fields render.

---

## Phase 6: User Story 4 — Filesystem Search (Priority: P4)

**Goal**: Operators can add and configure `FilesystemFileSearchMiddleware` via the dynamic agent editor.

**Independent Test**: Add `filesystem_search` to `MIDDLEWARE_REGISTRY`, call `build_middleware` with empty `root_path` — confirm `None` returned (skipped); call with valid path — confirm `FilesystemFileSearchMiddleware` instance.

- [X] T018 [US4] Add `filesystem_search` `MiddlewareSpec` entry to `MIDDLEWARE_REGISTRY` in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/middleware.py` with: `cls=FilesystemFileSearchMiddleware`, `default_params={"root_path": "", "use_ripgrep": True, "max_file_size_mb": 10}`, `enabled_by_default=False`, `allow_multiple=False`, `model_params=False`, `param_schema={"root_path": "string", "use_ripgrep": "boolean", "max_file_size_mb": "number"}`
- [X] T019 [US4] Add unit test `test_build_filesystem_search_skips_when_no_root_path` to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/tests/test_middleware_builders.py` — asserts `_build_filesystem_search({"root_path": ""})` returns `None`
- [X] T020 [US4] Add unit test `test_build_filesystem_search_with_root_path` to `ai_platform_engineering/dynamic_agents/src/dynamic_agents/tests/test_middleware_builders.py` — asserts `_build_filesystem_search({"root_path": "/workspace", "use_ripgrep": True, "max_file_size_mb": 10})` returns `FilesystemFileSearchMiddleware` instance

**Checkpoint**: All 4 new middleware appear in UI dropdown. `get_middleware_definitions()` returns 12 total entries.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T021 Run `uv run --group unittest pytest ai_platform_engineering/dynamic_agents/src/dynamic_agents/tests/test_middleware_builders.py -v` and fix any failures
- [X] T022 Run `make lint` and fix any Ruff violations in modified files
- [X] T023 Verify `get_middleware_definitions()` returns all 12 entries (8 existing + 4 new) by adding a smoke-test assertion to `test_middleware_builders.py`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **User Stories (Phases 3–6)**: Depend on Foundational; can proceed sequentially (one file, no parallelism)
- **Polish (Phase 7)**: Depends on all story phases complete

### User Story Dependencies

All 4 user stories are independent of each other (different registry keys, different builders). They share `middleware.py` so must be applied one at a time, but can be ordered freely after Phase 2.

### Parallel Opportunities

- T009–T011 (US1 tests) can run in parallel after T008
- T013–T014 (US2 tests) can run in parallel after T012
- T016–T017 (US3 tests) can run in parallel after T015
- T019–T020 (US4 tests) can run in parallel after T018

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001)
2. Complete Phase 2 (T002–T007)
3. Complete Phase 3 (T008–T011)
4. **STOP and VALIDATE**: Confirm `summarization` appears in UI and `build_middleware` produces correct instance
5. Ship — value delivered for the most important use case

### Incremental Delivery

1. Phase 1–2 + Phase 3 → Summarization available in UI (MVP)
2. Phase 4 → HITL available in UI
3. Phase 5 → Shell available in UI
4. Phase 6 → Filesystem Search available in UI
5. Phase 7 → Polish and lint

---

## Notes

- All changes are in one Python file (`middleware.py`) plus one new test file — no frontend changes
- The UI renders new entries automatically via the existing data-driven `MiddlewarePicker`
- Builders returning `None` follow the established pattern from `_build_model_fallback`
- `SummarizationMiddleware` is the only one requiring `model_params=True` (needs LLM for summarization)
- Total: 23 tasks across 7 phases
