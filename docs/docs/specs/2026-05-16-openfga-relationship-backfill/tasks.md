# Tasks: OpenFGA Relationship Backfill

**Input**: Design documents from `docs/docs/specs/2026-05-16-openfga-relationship-backfill/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openfga-relationship-backfill.md

**Tests**: Required by FR-015. Write tests before implementation changes.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: Prepare shared model, index, and test scaffolding.

- [x] T001 Add typed wildcard support for `agent.can_use` in `deploy/openfga/model.fga`
- [x] T002 Add `rbac_migrations` index definition to `scripts/init-rbac-mongo-indexes.ts`
- [x] T003 [P] Create Node test scaffold for migration derivation in `scripts/__tests__/backfill-universal-rebac.test.ts`

---

## Phase 2: Foundational

**Purpose**: Build shared migration primitives that every user story depends on.

- [x] T004 Extract OpenFGA tuple, migration record, run mode, and summary types in `scripts/backfill-universal-rebac.ts`
- [x] T005 Add OpenFGA-safe identifier validation helpers in `scripts/backfill-universal-rebac.ts`
- [x] T006 Add default-agent resolution helper using `platform_config.default_agent_id`, `DEFAULT_AGENT_ID`, and supervisor fallback in `scripts/backfill-universal-rebac.ts`
- [x] T007 Add OpenFGA store/model client helpers for store resolution, model support validation, tuple writes, and duplicate handling in `scripts/backfill-universal-rebac.ts`
- [x] T008 Add migration-status helpers for completed-run skip, running, completed, failed, and forced reconciliation states in `scripts/backfill-universal-rebac.ts`

**Checkpoint**: Shared helpers are ready; user-story tasks can proceed.

---

## Phase 3: User Story 1 - Backfill Real Team Relationships (Priority: P1)

**Goal**: Convert existing team memberships and resource assignments into real OpenFGA tuples plus Mongo provenance.

**Independent Test**: Run derivation against a fixture containing active teams, inactive teams, users, admins, and resources; verify planned tuples and provenance match expected graph edges.

### Tests for User Story 1

- [x] T009 [P] [US1] Add failing tests for team membership tuple derivation in `scripts/__tests__/backfill-universal-rebac.test.ts`
- [x] T010 [P] [US1] Add failing tests for team resource tuple derivation in `scripts/__tests__/backfill-universal-rebac.test.ts`
- [x] T011 [P] [US1] Add failing tests for invalid team/resource skip reporting in `scripts/__tests__/backfill-universal-rebac.test.ts`

### Implementation for User Story 1

- [x] T012 [US1] Implement team membership derivation from `teams.members` and mapped user subjects in `scripts/backfill-universal-rebac.ts`
- [x] T013 [US1] Implement team resource derivation for agents, agent admins, tools, knowledge bases, skills, and tasks in `scripts/backfill-universal-rebac.ts`
- [x] T014 [US1] Implement Mongo provenance upserts for `team_membership_sources` and `rebac_relationships` in `scripts/backfill-universal-rebac.ts`
- [x] T015 [US1] Implement OpenFGA tuple writes for team membership and team resource relationships in `scripts/backfill-universal-rebac.ts`
- [x] T016 [US1] Ensure US1 tests pass with `npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/__tests__/backfill-universal-rebac.test.ts`

**Checkpoint**: Existing team/resource access can be backfilled independently of default-agent access.

---

## Phase 4: User Story 2 - Grant Default Agent Access to Everyone (Priority: P1)

**Goal**: Preserve the default chat experience by granting every authenticated user access to the configured default dynamic agent.

**Independent Test**: Configure a default dynamic agent fixture and verify derivation writes `user:* can_use agent:<default-agent-id>` only when a valid dynamic default exists and the model supports it.

### Tests for User Story 2

- [x] T017 [P] [US2] Add failing tests for persisted default-agent precedence in `scripts/__tests__/backfill-universal-rebac.test.ts`
- [x] T018 [P] [US2] Add failing tests for `DEFAULT_AGENT_ID` fallback and supervisor skip behavior in `scripts/__tests__/backfill-universal-rebac.test.ts`
- [x] T019 [P] [US2] Add failing tests for missing typed wildcard model support in `scripts/__tests__/backfill-universal-rebac.test.ts`

### Implementation for User Story 2

- [x] T020 [US2] Implement default-agent validation against available dynamic agents in `scripts/backfill-universal-rebac.ts`
- [x] T021 [US2] Implement `user:* can_use agent:<default-agent-id>` tuple derivation and provenance summary in `scripts/backfill-universal-rebac.ts`
- [x] T022 [US2] Implement fail-closed model support validation before apply-mode default-agent writes in `scripts/backfill-universal-rebac.ts`
- [x] T023 [US2] Ensure US2 tests pass with `npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/__tests__/backfill-universal-rebac.test.ts`

**Checkpoint**: Authenticated users can use the configured default dynamic agent after migration.

---

## Phase 5: User Story 3 - Run Safely and Idempotently (Priority: P2)

**Goal**: Provide dry-run previews, apply mode, repeat protection, and forced reconciliation.

**Independent Test**: Run dry-run, apply, repeat apply, and force paths with mocked Mongo/OpenFGA writers; verify write behavior and migration record states.

### Tests for User Story 3

- [x] T024 [P] [US3] Add failing tests proving dry-run performs no writes in `scripts/__tests__/backfill-universal-rebac.test.ts`
- [x] T025 [P] [US3] Add failing tests proving completed migration records skip non-forced apply in `scripts/__tests__/backfill-universal-rebac.test.ts`
- [x] T026 [P] [US3] Add failing tests proving forced reconciliation rechecks writes idempotently in `scripts/__tests__/backfill-universal-rebac.test.ts`
- [x] T027 [P] [US3] Add failing tests proving failed apply records failure without completed status in `scripts/__tests__/backfill-universal-rebac.test.ts`

### Implementation for User Story 3

- [x] T028 [US3] Implement dry-run summary flow without Mongo/OpenFGA writes in `scripts/backfill-universal-rebac.ts`
- [x] T029 [US3] Implement apply-mode orchestration for status, tuple writes, provenance upserts, and completion record in `scripts/backfill-universal-rebac.ts`
- [x] T030 [US3] Implement repeat protection and `FORCE=true` reconciliation behavior in `scripts/backfill-universal-rebac.ts`
- [x] T031 [US3] Implement bounded error reporting and non-zero exit behavior for failed apply mode in `scripts/backfill-universal-rebac.ts`
- [x] T032 [US3] Ensure US3 tests pass with `npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/__tests__/backfill-universal-rebac.test.ts`

**Checkpoint**: Operators can safely preview, apply once, skip repeats, and force reconciliation.

---

## Phase 6: User Story 4 - Preserve Auditability and Visualization (Priority: P3)

**Goal**: Ensure migrated relationships are explainable in Mongo provenance and visible in graph/admin workflows.

**Independent Test**: Inspect mocked provenance records and documentation; verify source metadata and graph-oriented relationships are present.

### Tests for User Story 4

- [x] T033 [P] [US4] Add failing tests for migration `source_type`, `source_id`, and status fields in `scripts/__tests__/backfill-universal-rebac.test.ts`
- [x] T034 [P] [US4] Add failing tests that existing non-migration relationships are not downgraded in `scripts/__tests__/backfill-universal-rebac.test.ts`

### Implementation for User Story 4

- [x] T035 [US4] Preserve existing non-migration relationship records while upserting migration provenance in `scripts/backfill-universal-rebac.ts`
- [x] T036 [US4] Add graph-friendly default-agent wildcard provenance representation in `scripts/backfill-universal-rebac.ts`
- [x] T037 [US4] Update RBAC architecture documentation for OpenFGA backfill and default-agent wildcard grant in `docs/docs/security/rbac/architecture.md`
- [x] T038 [US4] Update RBAC file map for migration script, OpenFGA model, and migration-status collection in `docs/docs/security/rbac/file-map.md`
- [x] T039 [US4] Update RBAC usage documentation with dry-run, apply, repeat-protection, and verification steps in `docs/docs/security/rbac/usage.md`
- [x] T040 [US4] Ensure US4 tests pass with `npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/__tests__/backfill-universal-rebac.test.ts`

**Checkpoint**: Security reviewers can trace migrated access and operators can validate graph output.

---

## Phase 7: Polish & Verification

**Purpose**: Validate the full migration and documentation set.

- [x] T041 Run full migration unit test suite with `npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/__tests__/backfill-universal-rebac.test.ts`
- [x] T042 Run RBAC validator with `python3 scripts/validate-rbac-matrix.py --print`
- [x] T043 Run RBAC documentation validator with `python3 scripts/validate_rbac_docs.py`
- [x] T044 Run a dry-run against local Docker Compose services and capture planned tuple counts in the implementation notes
- [x] T045 Update `docs/docs/specs/2026-05-16-openfga-relationship-backfill/quickstart.md` with any final command/path corrections discovered during implementation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup and blocks user stories.
- **US1 and US2 (Phases 3-4)**: Depend on Foundational. They can proceed in parallel after shared helpers exist.
- **US3 (Phase 5)**: Depends on US1/US2 derivation outputs.
- **US4 (Phase 6)**: Depends on US1/US2/US3 behavior and can start documentation updates once implementation shape is stable.
- **Polish (Phase 7)**: Depends on selected story phases being complete.

### User Story Dependencies

- **US1**: Required for real team graph backfill MVP.
- **US2**: Required for default-agent availability after PDP enforcement.
- **US3**: Required before production apply.
- **US4**: Required before merge because this is an RBAC change and canonical docs must stay current.

### Parallel Opportunities

- T003 can run in parallel with model/index setup.
- T009, T010, and T011 can be written in parallel.
- T017, T018, and T019 can be written in parallel.
- T024 through T027 can be written in parallel.
- T037, T038, and T039 can be updated in parallel after implementation details settle.

## Implementation Strategy

### MVP First

1. Complete Setup and Foundational tasks.
2. Complete US1 to backfill real team/resource relationships.
3. Complete US2 before any production-oriented validation so the default agent remains accessible.
4. Stop and validate dry-run output before apply-mode work.

### Production-Safe Completion

1. Complete US3 idempotency and migration-status behavior.
2. Complete US4 docs and provenance hardening.
3. Run all focused tests and RBAC validators.
4. Perform a local dry-run against Docker Compose before claiming migration readiness.
