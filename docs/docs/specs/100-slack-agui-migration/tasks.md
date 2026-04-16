# Tasks: Slack Bot AG-UI Migration

**Input**: Design documents from `docs/docs/specs/100-slack-agui-migration/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/sse-events.md

**Tests**: Included — spec requires A2A tests be replaced with AG-UI tests (Phase 6 in plan.md).

**Organization**: Tasks are grouped by user story. Stories US1 and US2 share foundational work (Phases 1–2) and can proceed to their specific logic in parallel after that. US3–US6 build on the foundation and can also proceed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Slack bot source**: `ai_platform_engineering/integrations/slack_bot/`
- **Tests**: `ai_platform_engineering/integrations/slack_bot/tests/`
- **Docker**: `docker-compose.dev.yaml`, `docker-compose.yaml` (repo root)
- **Spec docs**: `docs/docs/specs/100-slack-agui-migration/`

---

## Phase 1: Foundation — Client & Config

**Purpose**: Rewrite SSE client for AG-UI endpoints, update config models, delete A2A client
**Commit**: `feat(slack-bot): rewrite SSE client for AG-UI endpoints`

- [ ] T001 [P] [US1] Rewrite `sse_client.py` — update `SSEClient` to target `POST /api/v1/chat/stream/start?protocol=agui` with `ChatRequest` body (`message`, `conversation_id`, `agent_id`, `trace_id`); replace `requests` with `httpx` streaming; keep `SSEEventType` enum, `SSEEvent` dataclass, `_get_headers()` with `X-Client-Source: slack-bot` and OAuth2 Bearer token in `ai_platform_engineering/integrations/slack_bot/sse_client.py`
- [ ] T002 [P] [US1] Add `SSEEvent` fields — add `outcome: str | None`, `interrupt: dict | None`, `steps: list | None`, `snapshot: dict | None` fields to the `SSEEvent` dataclass in `ai_platform_engineering/integrations/slack_bot/sse_client.py`
- [ ] T003 [US2] Add `invoke()` method to `SSEClient` — `POST /api/v1/chat/invoke` with `ChatRequest` body, returns parsed JSON dict in `ai_platform_engineering/integrations/slack_bot/sse_client.py`
- [ ] T004 [US3] Add `resume_stream()` method to `SSEClient` — `POST /api/v1/chat/stream/resume?protocol=agui` with `ResumeRequest` body (`agent_id`, `conversation_id`, `form_data`, `trace_id`), returns SSE stream in `ai_platform_engineering/integrations/slack_bot/sse_client.py`
- [ ] T005 [US1] Add `thread_ts_to_conversation_id()` helper — deterministic UUID v5 from `thread_ts` using `SLACK_NAMESPACE = uuid5(NAMESPACE_URL, "slack.caipe.io")` in `ai_platform_engineering/integrations/slack_bot/sse_client.py`
- [ ] T006 [P] [US4] Update `ChannelConfig` — add `agent_id: Optional[str] = None` field in `ai_platform_engineering/integrations/slack_bot/utils/config_models.py`
- [ ] T007 [P] [US4] Update `GlobalDefaults` — add `default_agent_id: Optional[str] = None` field with validation warning when `ai_enabled=True` and no `agent_id` is set in `ai_platform_engineering/integrations/slack_bot/utils/config_models.py`
- [ ] T008 [US6] Delete `a2a_client.py` — remove `ai_platform_engineering/integrations/slack_bot/a2a_client.py` entirely

**Checkpoint**: SSE client targets AG-UI endpoints with three methods (stream, invoke, resume). Config models support `agent_id`. A2A client deleted.

---

## Phase 2: Streaming Handler

**Purpose**: Replace A2A streaming handler with AG-UI event mapping, delete A2A event parser
**Commit**: `feat(slack-bot): replace A2A streaming handler with AG-UI event mapping`

- [ ] T009 [US1] Rewrite `stream_response()` in `ai.py` — replace `stream_a2a_response()` with AG-UI event mapping: `TEXT_MESSAGE_START` → `chat_startStream`, `TEXT_MESSAGE_CONTENT` → `StreamBuffer.append`, `TEXT_MESSAGE_END` → flush, `TOOL_CALL_START/END` → task_update chunks, `RUN_FINISHED(success)` → `chat_stopStream` with feedback/footer, `RUN_FINISHED(interrupt)` → delegate to HITL handler, `RUN_ERROR` → error blocks, `CUSTOM(NAMESPACE_CONTEXT)` → track subagent, `CUSTOM(WARNING)` → log warning in `ai_platform_engineering/integrations/slack_bot/utils/ai.py`
- [ ] T010 [US2] Implement `invoke_response()` in `ai.py` — call `sse_client.invoke()`, post `content` via `chat_postMessage` with feedback blocks and footer, handle errors with `{"retry_needed": True}` in `ai_platform_engineering/integrations/slack_bot/utils/ai.py`
- [ ] T011 [US1] Keep and verify unchanged functions — confirm `StreamBuffer`, `_build_footer_text()`, `_build_stream_final_blocks()`, `_post_final_response()`, `_check_overthink_skip()`, `RETRY_PROMPT_PREFIX` remain unchanged in `ai_platform_engineering/integrations/slack_bot/utils/ai.py`
- [ ] T012 [US1] Update `handle_ai_alert_processing()` — update to use new SSE client and `agent_id` parameter instead of A2A client in `ai_platform_engineering/integrations/slack_bot/utils/ai.py`
- [ ] T013 [US6] Delete `event_parser.py` — remove `ai_platform_engineering/integrations/slack_bot/utils/event_parser.py` entirely

**Checkpoint**: `ai.py` provides `stream_response()` and `invoke_response()` using AG-UI events. A2A event parser deleted. `StreamBuffer` and helper functions preserved.

---

## Phase 3: User Story 3 — HITL Support (Priority: P2)

**Goal**: Update HITL handler to parse AG-UI interrupt format and resume via dynamic agents
**Commit**: `feat(slack-bot): update HITL handler for AG-UI interrupt format`

**Independent Test**: Trigger an agent workflow that requires human input, verify the form renders in Slack, submit a response, confirm the agent resumes.

### Implementation

- [ ] T014 [US3] Implement `parse_agui_interrupt()` — parse `SSEEvent` with `type=RUN_FINISHED` and `outcome="interrupt"`, extract `id`, `reason`, `payload.prompt`, `payload.fields`, `payload.agent` from `interrupt` dict, map AG-UI field types to Slack Block Kit (`text→plain_text_input`, `select→static_select`, `multiselect→multi_static_select`, `boolean→button pair`, `number/url/email→plain_text_input`), return `HITLForm` with `form_id=interrupt.id` in `ai_platform_engineering/integrations/slack_bot/utils/hitl_handler.py`
- [ ] T015 [US3] Update `HITLCallbackHandler.__init__()` — change constructor to `__init__(self, sse_client)` (remove `session_manager` param), store `sse_client` for resume calls in `ai_platform_engineering/integrations/slack_bot/utils/hitl_handler.py`
- [ ] T016 [US3] Update `HITLCallbackHandler.handle_interaction()` — extract `conversation_id`, `agent_id`, `interrupt_id` from action value JSON; on Approve: collect form values → JSON string → `sse_client.resume_stream()`; on Reject: `sse_client.resume_stream()` with rejection message in `ai_platform_engineering/integrations/slack_bot/utils/hitl_handler.py`
- [ ] T017 [US3] Store resume context in HITL form — embed `conversation_id`, `agent_id` in button action `value` JSON so resume handler can extract them in `ai_platform_engineering/integrations/slack_bot/utils/hitl_handler.py`

**Checkpoint**: HITL interrupt events from AG-UI are parsed, rendered as Slack forms, and submissions resume the agent via dynamic agents.

---

## Phase 4: User Story 1 + 2 + 4 — App.py Rewiring (Priority: P1/P2)

**Goal**: Rewire app.py event handlers for dynamic agents, simplify session manager to deterministic UUIDs
**Commit**: `refactor(slack-bot): rewire app.py for dynamic agents`

**Independent Test**: Send a real user message and a bot user message; verify streaming and invoke paths work end-to-end. Verify two channels route to different agents.

### Implementation

- [ ] T018 [US1] Update `app.py` initialization — replace `SUPERVISOR_SSE_URL`/`CAIPE_URL` with `DYNAMIC_AGENTS_URL` env var; create `SSEClient(DYNAMIC_AGENTS_URL, timeout=300, auth_client=auth_client)`; update health check to `GET {DYNAMIC_AGENTS_URL}/healthz`; update `HITLCallbackHandler(sse_client)` without `session_manager` param; remove A2A-specific imports in `ai_platform_engineering/integrations/slack_bot/app.py`
- [ ] T019 [US1] Update `handle_mention` handler — get `agent_id` from `channel_config.agent_id` (fallback to `config.defaults.default_agent_id`), generate `conversation_id` via `thread_ts_to_conversation_id(thread_ts)`, branch on user type: real user → `ai.stream_response()`, bot user → `ai.invoke_response()` in `ai_platform_engineering/integrations/slack_bot/app.py`
- [ ] T020 [US1] Update `handle_dm_message` handler — same `agent_id`/`conversation_id` pattern as `handle_mention`, branch on user type in `ai_platform_engineering/integrations/slack_bot/app.py`
- [ ] T021 [P] [US1] Update `handle_qanda_message` handler — same `agent_id`/`conversation_id` pattern, branch on user type in `ai_platform_engineering/integrations/slack_bot/app.py`
- [ ] T022 [US3] Update `handle_hitl_action` handler — call `hitl_handler.handle_interaction()`, process resume SSE stream with `stream_response()` in the original thread in `ai_platform_engineering/integrations/slack_bot/app.py`
- [ ] T023 [P] [US1] Update feedback, retry, and alert handlers — pass `agent_id` and `conversation_id` to updated function signatures in `ai_platform_engineering/integrations/slack_bot/app.py`
- [ ] T024 [US1] Simplify `session_manager.py` — replace `get_context_id(thread_ts)` with deterministic `thread_ts_to_conversation_id(thread_ts)` (no API call); remove `set_context_id()`; remove supervisor API calls; remove `supervisor_url` and `auth_client` constructor params; keep TTL caches (`_user_info_cache`, `_skipped_cache`, `_escalated_threads`); remove `_context_cache` and `_trace_cache` in `ai_platform_engineering/integrations/slack_bot/utils/session_manager.py`

**Checkpoint**: All event handlers use dynamic agents. Session manager is stateless for conversation IDs. Streaming, invoke, HITL, and channel routing all wired up.

---

## Phase 5: User Story 5 + Docker/Config (Priority: P3)

**Goal**: Update Docker dependencies, environment variables, and version bump
**Commit**: `chore(slack-bot): update Docker config for dynamic agents`

**Independent Test**: `docker compose -f docker-compose.dev.yaml config` validates without errors; `slack-bot` service depends on `dynamic-agents`.

### Implementation

- [ ] T025 [P] [US5] Update `docker-compose.dev.yaml` — change `slack-bot.depends_on` from `caipe-supervisor` to `dynamic-agents`; replace `CAIPE_URL` with `DYNAMIC_AGENTS_URL=http://dynamic-agents:8100`; remove `SUPERVISOR_SSE_URL`; keep `CAIPE_UI_URL` in `docker-compose.dev.yaml`
- [ ] T026 [P] [US5] Update `docker-compose.yaml` — same dependency and env var changes as dev; update image tag to `0.4.0` in `docker-compose.yaml`
- [ ] T027 [P] [US5] Version bump `pyproject.toml` — change version from `0.3.0` to `0.4.0` in `ai_platform_engineering/integrations/slack_bot/pyproject.toml`

**Checkpoint**: Docker configs target dynamic agents. Version is 0.4.0. Slack conversations remain isolated from web UI by using deterministic UUID v5 IDs that are not queried by the web UI.

---

## Phase 6: Tests

**Goal**: Replace A2A tests with AG-UI tests, update existing test fixtures
**Commit**: `test(slack-bot): replace A2A tests with AG-UI tests`

**Independent Test**: `uv run pytest tests/ -v` passes with zero failures.

### Delete A2A Tests

- [ ] T028 [P] [US6] Delete `test_a2a_client.py` — remove `ai_platform_engineering/integrations/slack_bot/tests/test_a2a_client.py`
- [ ] T029 [P] [US6] Delete `test_a2a_streaming.py` — remove `ai_platform_engineering/integrations/slack_bot/tests/test_a2a_streaming.py`
- [ ] T030 [P] [US6] Delete A2A test data — remove `ai_platform_engineering/integrations/slack_bot/tests/test_data/a2a_heavy_search.json` and `ai_platform_engineering/integrations/slack_bot/tests/test_data/a2a_jira_ticket_creation.json`

### New AG-UI Tests

- [ ] T031 [P] [US1] Create `test_sse_client.py` — test SSEClient init, `stream_chat()` endpoint/params, `resume_stream()`, `invoke()`, `thread_ts_to_conversation_id()` determinism, auth headers in `ai_platform_engineering/integrations/slack_bot/tests/test_sse_client.py`
- [ ] T032 [P] [US1] Create `test_streaming.py` — AG-UI event stream replay tests: text streaming, tool calls, plan steps, error recovery, HITL interrupt delegation in `ai_platform_engineering/integrations/slack_bot/tests/test_streaming.py`
- [ ] T033 [P] [US3] Create `test_hitl_handler.py` — test `parse_agui_interrupt()`, field type mapping (text, select, multiselect, boolean, number), form rendering, resume submission, rejection handling in `ai_platform_engineering/integrations/slack_bot/tests/test_hitl_handler.py`

### Update Existing Tests

- [ ] T034 [P] [US1] Update `conftest.py` — update env vars (`DYNAMIC_AGENTS_URL` instead of `CAIPE_URL`), add `agent_id` to channel config fixture, update SSEClient fixture in `ai_platform_engineering/integrations/slack_bot/tests/conftest.py`
- [ ] T035 [P] [US4] Update `test_config.py` — add `agent_id` validation tests, default `default_agent_id` fallback, warning when `ai_enabled=True` with no `agent_id` in `ai_platform_engineering/integrations/slack_bot/tests/test_config.py`
- [ ] T036 [P] [US1] Update `test_ai.py` — update for `stream_response()` / `invoke_response()` signatures, AG-UI event fixtures in `ai_platform_engineering/integrations/slack_bot/tests/test_ai.py`
- [ ] T037 [P] [US1] Update `test_ai_plan_streaming.py` — update SSE event fixtures from A2A to AG-UI format in `ai_platform_engineering/integrations/slack_bot/tests/test_ai_plan_streaming.py`
- [ ] T038 [P] [US1] Update `test_error_recovery.py` — update for new handler signature and AG-UI error events (`RUN_ERROR`) in `ai_platform_engineering/integrations/slack_bot/tests/test_error_recovery.py`
- [ ] T039 [P] [US5] Update `test_metadata_leak_e2e.py` — update SSE event fixtures to AG-UI format, verify no metadata leaks in `ai_platform_engineering/integrations/slack_bot/tests/test_metadata_leak_e2e.py`
- [ ] T040 [P] [US1] Update `test_mongodb_session.py` — update for deterministic UUID (no API mocking needed, test `thread_ts_to_conversation_id()`) in `ai_platform_engineering/integrations/slack_bot/tests/test_mongodb_session.py`

**Checkpoint**: All tests pass. Zero A2A test references remain. AG-UI streaming, invoke, HITL, config, and error recovery are covered.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup across all user stories

- [ ] T041 Run `uv run ruff check` on all modified files and fix any linting issues in `ai_platform_engineering/integrations/slack_bot/`
- [ ] T042 Run `uv run pytest tests/ -v` and confirm zero failures in `ai_platform_engineering/integrations/slack_bot/tests/`
- [ ] T043 Verify A2A code removal — confirm zero references to `a2a_client`, `A2AClient`, `send_message_stream`, `event_parser` in Slack bot codebase
- [ ] T044 Run quickstart.md validation scenarios (Scenarios 1–8) against a running environment
- [ ] T045 Update `docs/docs/specs/100-slack-agui-migration/` status from Draft to Complete

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Foundation)**: No dependencies — can start immediately
- **Phase 2 (Streaming Handler)**: Depends on Phase 1 (T001–T005 for SSEClient methods)
- **Phase 3 (HITL)**: Depends on Phase 1 (T004 for `resume_stream()`) and Phase 2 (T009 for `stream_response()` HITL delegation)
- **Phase 4 (App.py Rewiring)**: Depends on Phases 1–3 (all client/handler functions must exist)
- **Phase 5 (Docker/Config)**: No code dependencies — can run in parallel with Phases 2–4
- **Phase 6 (Tests)**: Depends on Phases 1–4 (tests exercise the new code)
- **Phase 7 (Polish)**: Depends on all prior phases

### User Story Dependencies

- **US1 (Streaming)**: Foundation (Phase 1) + Streaming Handler (Phase 2) + App.py Rewiring (Phase 4) — core path
- **US2 (Invoke)**: Foundation (Phase 1, T003) + Streaming Handler (Phase 2, T010) + App.py Rewiring (Phase 4, T019–T020) — can be implemented alongside US1
- **US3 (HITL)**: Foundation (Phase 1, T004) + HITL Handler (Phase 3) + App.py Rewiring (Phase 4, T022) — depends on US1 streaming being functional
- **US4 (Routing)**: Foundation (Phase 1, T006–T007) + App.py Rewiring (Phase 4, T019–T021) — config changes are independent; wiring depends on US1
- **US5 (Isolation)**: Docker/Config (Phase 5) — independent of code changes; relies on deterministic UUIDs from T005
- **US6 (A2A Removal)**: Deletions in Phase 1 (T008), Phase 2 (T013), Phase 6 (T028–T030) — can happen as soon as replacement code is in place

### Within Each Phase

- Tasks marked [P] within the same phase can run in parallel
- Tasks without [P] must run sequentially within their phase
- T001 and T002 are parallel (both modify `sse_client.py` but different sections)
- T006 and T007 are parallel with T001 (different files)
- T009 depends on T001–T005 (uses new SSEClient)
- T010 depends on T003 (uses `invoke()`)

### Parallel Opportunities

- **Phase 1**: T001+T002 (sse_client.py), T006+T007 (config_models.py), T008 (delete) — all three groups can run in parallel
- **Phase 5**: T025+T026+T027 — all three are independent files
- **Phase 6**: All delete tasks (T028–T030), all new tests (T031–T033), all update tasks (T034–T040) — can run in parallel within each group
- **Cross-phase**: Phase 5 (Docker) can run in parallel with Phases 2–4 (code changes)

---

## Parallel Example: Phase 1

```bash
# Launch config and client tasks in parallel (different files):
Task: "Rewrite SSEClient for AG-UI endpoints in sse_client.py"
Task: "Add agent_id to ChannelConfig in config_models.py"
Task: "Add default_agent_id to GlobalDefaults in config_models.py"

# Then sequentially (same file, depends on T001):
Task: "Add invoke() method to SSEClient in sse_client.py"
Task: "Add resume_stream() method to SSEClient in sse_client.py"
Task: "Add thread_ts_to_conversation_id() helper in sse_client.py"

# Independent (can run anytime):
Task: "Delete a2a_client.py"
```

---

## Parallel Example: Phase 6

```bash
# Launch all delete tasks in parallel:
Task: "Delete test_a2a_client.py"
Task: "Delete test_a2a_streaming.py"
Task: "Delete A2A test data files"

# Launch all new test creation in parallel:
Task: "Create test_sse_client.py"
Task: "Create test_streaming.py"
Task: "Create test_hitl_handler.py"

# Launch all test updates in parallel:
Task: "Update conftest.py"
Task: "Update test_config.py"
Task: "Update test_ai.py"
Task: "Update test_ai_plan_streaming.py"
Task: "Update test_error_recovery.py"
Task: "Update test_metadata_leak_e2e.py"
Task: "Update test_mongodb_session.py"
```

---

## Implementation Strategy

### MVP First (US1 + US2 — P1 Stories)

1. Complete Phase 1: Foundation (T001–T008)
2. Complete Phase 2: Streaming Handler (T009–T013)
3. Complete Phase 4: App.py Rewiring — US1/US2 tasks only (T018–T021, T023–T024)
4. **STOP and VALIDATE**: Test streaming (Scenario 1) and invoke (Scenario 2) end-to-end
5. Deploy to dev and verify

### Incremental Delivery

1. Complete Phases 1–2 + Phase 4 (US1/US2 tasks) → MVP functional
2. Add Phase 3 + Phase 4 T022 (HITL) → Test Scenario 4 → HITL works
3. Add Phase 5 (Docker) → Test Scenario 5 (routing) → Config updated
4. Add Phase 6 (Tests) → `uv run pytest` passes → Full test coverage
5. Phase 7 (Polish) → Run quickstart validation → Release ready

### Single Developer Strategy

Recommended order for a single developer:

1. Phase 1 (Foundation) — one commit
2. Phase 2 (Streaming Handler) — one commit
3. Phase 3 (HITL) — one commit
4. Phase 4 (App.py Rewiring) — one commit
5. Phase 5 (Docker/Config) — one commit
6. Phase 6 (Tests) — one commit
7. Phase 7 (Polish) — no commit (verification only)

Each phase = one conventional commit per plan.md.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each phase (6 commits total per plan.md)
- Stop at any checkpoint to validate independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- All file paths are relative to repository root
