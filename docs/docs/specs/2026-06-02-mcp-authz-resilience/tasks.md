---
description: "Task list for MCP Authorization Resilience"
---

# Tasks: MCP Authorization Resilience

**Input**: Design documents from `docs/docs/specs/2026-06-02-mcp-authz-resilience/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED. The spec's success criteria (SC-002/004/005) demand verifiable transient/permanent/denial behavior, so behavioral unit tests are part of the work (TDD: write failing tests before impl).

**Organization**: By user story (US1 timeout default, US2 retry/reconcile, US3 messaging) so each is independently deliverable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1/US2/US3
- Exact file paths included.

## Path Conventions

- Chart: `charts/ai-platform-engineering/`
- Runtime: `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/`
- Tests: `ai_platform_engineering/dynamic_agents/tests/`
- Dev gateway: `deploy/agentgateway/`
- Docs: `docs/docs/security/rbac/`

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Ensure dynamic-agents dev env for lint/tests: `cd ai_platform_engineering/dynamic_agents && uv venv --python python3.13 .venv && uv sync` (per CLAUDE.md worktree/venv rule)

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: The shared error classifier blocks US2 (retry decisions) and US3 (messaging). US1 does NOT depend on this phase and may proceed in parallel.

- [x] T002 Add `MCPServerLoadOutcome` status typing (`available|transient|permanent|denied`) and a single `classify_load_error(error_msg: str, status_code: int | None = None) -> str` helper in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/mcp_client.py`, reusing `_extract_error_message`/`_diagnose_endpoint_failure`. Conservative bias: ambiguous 403 ⇒ `denied`. Type hints + docstring + named constants per constitution.

**Checkpoint**: classifier available — US2 and US3 can build on it.

---

## Phase 3: User Story 1 - Default install has working MCP tools (Priority: P1) 🎯 MVP

**Goal**: Ship the configurable ext_authz timeout default (10s) so a default install no longer reports healthy/authorized MCP servers as unavailable.

**Independent Test**: `helm template` shows `timeout: "10s"` under `extAuthz` and honors `--set global.agentgateway.extAuth.timeout=5s`; dev compose reloads config with 10s.

### Implementation for User Story 1

- [x] T003 [P] [US1] Add `timeout: "10s"` (with why-comment about the 200ms race) under `global.agentgateway.extAuth` in `charts/ai-platform-engineering/values.yaml`
- [x] T004 [US1] Render `timeout: {{ $extAuth.timeout | default "10s" | quote }}` inside the `extAuthz` block of `charts/ai-platform-engineering/templates/agentgateway-static-config.yaml` (depends on T003)
- [x] T005 [P] [US1] Dev-parity: `extAuthz.timeout: 10s` in `deploy/agentgateway/config.yaml` and `DEFAULT_MCP_ROUTE_POLICIES` in `deploy/agentgateway/config_bridge.py` — **already applied as the live dev hotfix** (cross-ref; verify still present)
- [x] T006 [P] [US1] Document the new ext_authz timeout knob + default in `docs/docs/security/rbac/architecture.md` (RBAC living-documentation rule)
- [x] T007 [P] [US1] Document CRD/Gateway-API path guidance (no policy timeout field; tune via authz-bridge backend `requestTimeout`) near the `extAuth`/`routingMode` comments in `charts/ai-platform-engineering/values.yaml` and the agentgateway routing doc
- [x] T008 [US1] Verify: `helm template` render shows 10s default and honors override (quickstart US1) (depends on T003, T004)

**Checkpoint**: US1 independently shippable — the reported defect's primary root cause is fixed.

---

## Phase 4: User Story 2 - Cold-start slowness self-heals (Priority: P2)

**Goal**: Bounded transient-retry so cold-start auth timeouts become available without manual action.

**Independent Test**: unit tests for retry-then-success / permanent-fail-fast / no-retry-on-success / denial-not-retried.

### Tests for User Story 2 (write first, ensure they FAIL) ⚠️

- [x] T009 [P] [US2] Unit test: transient first attempt then success ⇒ server available, `attempts>1`, not in failed list — `ai_platform_engineering/dynamic_agents/tests/test_mcp_resilience_retry.py`
- [x] T010 [P] [US2] Unit test: permanent error ⇒ `attempts==1` (fail fast), in permanent-failed list — same test file
- [x] T011 [P] [US2] Unit test: success on first attempt ⇒ `attempts==1` (zero retries, no added latency) — same test file
- [x] T012 [P] [US2] Unit test: clean policy 403 (denial) ⇒ `attempts==1`, not retried — same test file

### Implementation for User Story 2

- [x] T013 [US2] Add bounded retry (`max_attempts=3`, jittered exponential backoff `base_backoff_s=0.25`) gated by `classify_load_error` in `get_tools_with_resilience` (`mcp_client.py`): retry only `transient`; `permanent`/`denied` return immediately; per-server concurrency preserved (depends on T002)
- [x] T014 [US2] Expose a per-server status map from `get_tools_with_resilience` while preserving the existing `(all_tools, failed_servers, failed_errors)` return for current callers (`mcp_client.py`) (depends on T013)
- [x] T015 [US2] Run US2 tests green (depends on T009–T014)

**Checkpoint**: US2 self-heals transient cold-start failures; US1+US2 both work.

---

## Phase 5: User Story 3 - Honest not-ready vs failed messaging (Priority: P3)

**Goal**: Distinct transient ("starting up, will retry") vs permanent ("needs attention") messaging; denials unchanged.

**Independent Test**: unit tests for classification mapping and message wording per class.

**Note**: Builds on the status map from US2 (T014) and the classifier (T002).

### Tests for User Story 3 (write first, ensure they FAIL) ⚠️

- [ ] T016 [P] [US3] Unit test: `classify_load_error` mapping (timeout/5xx/authz-timeout-403⇒transient; unknown-host/refused/404⇒permanent; clean 401/403⇒denied) — `ai_platform_engineering/dynamic_agents/tests/test_mcp_load_classification.py`
- [ ] T017 [P] [US3] Unit test: transient warning conveys "starting up/retry" (NOT "will not work"); permanent warning keeps "Tools from this server will not work."; denial message unchanged — `ai_platform_engineering/dynamic_agents/tests/test_agent_runtime_warnings.py`

### Implementation for User Story 3

- [ ] T018 [US3] Replace `_failed_servers`/`_failed_servers_error` with classification-aware state (`_failed_servers_transient`, `_failed_servers_permanent` + messages) populated from the US2 status map in `agent_runtime.py` (~lines 263, 363–375) (depends on T014)
- [ ] T019 [US3] Emit distinct system-prompt warning lines for transient vs permanent in `agent_runtime.py` (~lines 587–589) per contract C3 (depends on T018)
- [ ] T020 [US3] Emit distinct streamed `on_warning` messages for transient vs permanent; keep denial messaging unchanged in `agent_runtime.py` (~lines 1061–1063) (depends on T018)
- [ ] T021 [P] [US3] Apply the same transient/permanent split to the subagent load path logging in `agent_runtime.py` (~lines 893–896) (depends on T014)
- [ ] T022 [US3] Run US3 tests green (depends on T016–T021)

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T023 [P] Lint: `cd ai_platform_engineering/dynamic_agents && uv run ruff check src`
- [ ] T024 [P] Full tests: `cd ai_platform_engineering/dynamic_agents && PYTHONPATH=src uv run pytest tests -q`
- [ ] T025 Run quickstart.md validation (helm render static+override; optional compose smoke: enumerate tools, confirm no healthy server marked unavailable)
- [ ] T026 [P] Note the new `get_tools_with_resilience` retry/classification behavior in the dynamic-agents README/ARCHITECTURE.md if config/behavior docs exist there

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)**: none.
- **Foundational (P2 / T002)**: blocks US2 + US3 (not US1).
- **US1 (P3)**: independent — can run alongside Foundational/US2/US3.
- **US2 (P4)**: needs T002.
- **US3 (P5)**: needs T002 + US2's T014 (status map).
- **Polish (P6)**: after the stories you intend to ship.

### Within stories

- Tests written and failing before implementation (US2, US3).
- US2 retry (T013) before status exposure (T014) before US3 consumes it.

### Parallel Opportunities

- T003, T006, T007 (US1 docs/values, different files) run in parallel; T004 after T003.
- US2 test tasks T009–T012 in parallel.
- US3 test tasks T016–T017 in parallel; T021 parallel to T019/T020 (different region/file concern).
- US1 (config/docs) can be done by one person while another does Foundational+US2 (code).

---

## Implementation Strategy

### MVP first (US1 only)

1. T001 setup → 2. T003/T004/T008 (timeout default) + T005 verify hotfix + T006/T007 docs → **ship the permanent fix for the reported defect.**

### Incremental delivery

1. US1 (MVP) → render-verify → ship.
2. + Foundational (T002) + US2 (retry) → unit-test → ship self-healing.
3. + US3 (messaging) → unit-test → ship honest status.

---

## Notes

- [P] = different files, no incomplete-task dependency.
- T005 is pre-completed (live dev hotfix); all other boxes unchecked.
- Security: retry never flips ext_authz to fail-open; denials never retried/relabeled (FR-004, FR-009).
- Commit per logical group with Conventional Commits + DCO.
