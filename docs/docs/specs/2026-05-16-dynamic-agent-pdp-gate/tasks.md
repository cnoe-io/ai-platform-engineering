# Tasks: Dynamic Agent PDP Gate

**Input**: Design documents from `docs/docs/specs/2026-05-16-dynamic-agent-pdp-gate/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/chat-execution-authz.md`, `quickstart.md`

**Tests**: Required by FR-009 and the user's requested test-first implementation approach. Write each test task before its paired implementation and verify it fails for the expected missing behavior.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm existing auth, OpenFGA, and Dynamic Agents surfaces before writing feature code.

- [x] T001 Review current BFF Dynamic Agents proxy contract in `ui/src/lib/da-proxy.ts`
- [x] T002 [P] Review existing OpenFGA tuple helpers in `ui/src/lib/rbac/openfga.ts`
- [x] T003 [P] Review current `/api/v1/chat` proxy routes in `ui/src/app/api/v1/chat/stream/start/route.ts`, `ui/src/app/api/v1/chat/invoke/route.ts`, `ui/src/app/api/v1/chat/stream/resume/route.ts`, and `ui/src/app/api/v1/chat/stream/cancel/route.ts`
- [x] T004 [P] Review Dynamic Agents bearer context and chat route entrypoints in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/jwt_middleware.py`, `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/token_context.py`, and `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/chat.py`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create reusable authorization helpers needed by all protected execution stories.

**Critical**: No user story work can begin until the shared BFF and runtime helpers exist with failing tests first.

- [x] T005 [P] Add failing BFF helper tests for OpenFGA allow, deny, unavailable, missing subject, and invalid agent id in `ui/src/lib/rbac/__tests__/openfga-agent-authz.test.ts`
- [x] T006 Add subject propagation tests for Dynamic Agents proxy auth results in `ui/src/lib/__tests__/da-proxy-auth-result.test.ts`
- [x] T007 Implement subject propagation in `AuthResult` and `authenticateRequest` in `ui/src/lib/da-proxy.ts`
- [x] T008 Implement BFF OpenFGA agent-use helper in `ui/src/lib/rbac/openfga-agent-authz.ts`
- [x] T009 Run focused BFF helper tests in `ui/src/lib/rbac/__tests__/openfga-agent-authz.test.ts` and `ui/src/lib/__tests__/da-proxy-auth-result.test.ts`
- [x] T010 [P] Add failing Dynamic Agents OpenFGA helper tests for allow, deny, unavailable, missing bearer, invalid token, and invalid agent id in `ai_platform_engineering/dynamic_agents/tests/test_openfga_authz.py`
- [x] T011 Implement runtime OpenFGA authz helper in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/openfga_authz.py`
- [x] T012 Run focused Dynamic Agents helper tests in `ai_platform_engineering/dynamic_agents/tests/test_openfga_authz.py`

**Checkpoint**: Shared OpenFGA authorization helpers are tested and ready for route integration.

---

## Phase 3: User Story 1 - Block Unauthorized Agent Runs (Priority: P1) MVP

**Goal**: Deny unauthorized start, invoke, and resume requests before Dynamic Agent runtime work begins.

**Independent Test**: Configure an allowed and denied OpenFGA response for the same selected agent; verify only the allowed path reaches proxy/runtime execution for start, invoke, and resume.

### Tests for User Story 1

- [x] T013 [P] [US1] Add failing BFF route tests for allowed and denied start, invoke, and resume requests in `ui/src/app/api/v1/chat/__tests__/routes.test.ts`
- [x] T014 [P] [US1] Add failing Dynamic Agents route tests proving denied start, invoke, and resume requests stop before runtime work in `ai_platform_engineering/dynamic_agents/tests/test_chat_pdp_gate.py`
- [x] T015 [P] [US1] Add OpenFGA `agent#use` coverage expectations for protected execution routes in `tests/rbac/rbac-matrix.yaml`

### Implementation for User Story 1

- [x] T016 [US1] Gate BFF streaming start with OpenFGA before proxying in `ui/src/app/api/v1/chat/stream/start/route.ts`
- [x] T017 [US1] Gate BFF non-streaming invoke with OpenFGA before proxying in `ui/src/app/api/v1/chat/invoke/route.ts`
- [x] T018 [US1] Gate BFF streaming resume with OpenFGA before proxying in `ui/src/app/api/v1/chat/stream/resume/route.ts`
- [x] T019 [US1] Gate Dynamic Agents streaming start before MCP lookup and runtime creation in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/chat.py`
- [x] T020 [US1] Gate Dynamic Agents non-streaming invoke before runtime cache usage in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/chat.py`
- [x] T021 [US1] Gate Dynamic Agents streaming resume before runtime resume work in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/chat.py`
- [x] T022 [US1] Extend route coverage validation for OpenFGA execution gates in `scripts/validate-rbac-matrix.py`
- [x] T023 [US1] Run User Story 1 focused tests in `ui/src/app/api/v1/chat/__tests__/routes.test.ts`, `ai_platform_engineering/dynamic_agents/tests/test_chat_pdp_gate.py`, and the selected ReBAC validator

**Checkpoint**: Unauthorized start, invoke, and resume requests are denied before runtime work; authorized requests still proceed.

---

## Phase 4: User Story 2 - Preserve Safe Cancellation (Priority: P2)

**Goal**: Keep cancellation available to authenticated callers without requiring a fresh agent-use decision.

**Independent Test**: Attempt cancellation as an authenticated caller without an OpenFGA `can_use` allow decision and verify cancellation is accepted; attempt cancellation unauthenticated and verify it is rejected.

### Tests for User Story 2

- [x] T024 [P] [US2] Add failing BFF cancel tests proving cancel authenticates but does not call OpenFGA in `ui/src/app/api/v1/chat/__tests__/routes.test.ts`
- [x] T025 [P] [US2] Add failing Dynamic Agents cancel tests proving cancel remains OpenFGA-ungated in `ai_platform_engineering/dynamic_agents/tests/test_chat_pdp_gate.py`

### Implementation for User Story 2

- [x] T026 [US2] Preserve auth-only cancellation behavior in `ui/src/app/api/v1/chat/stream/cancel/route.ts`
- [x] T027 [US2] Preserve auth-only cancellation behavior in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/chat.py`
- [x] T028 [US2] Document cancellation as auth-only in the execution contract `docs/docs/specs/2026-05-16-dynamic-agent-pdp-gate/contracts/chat-execution-authz.md`
- [x] T029 [US2] Run User Story 2 focused tests in `ui/src/app/api/v1/chat/__tests__/routes.test.ts` and `ai_platform_engineering/dynamic_agents/tests/test_chat_pdp_gate.py`

**Checkpoint**: Cancel stops work for authenticated callers and remains unavailable to unauthenticated callers.

---

## Phase 5: User Story 3 - Report Authorization Failures Clearly (Priority: P3)

**Goal**: Return distinguishable, structured outcomes for denied, unavailable, and unauthenticated authorization cases.

**Independent Test**: Force denied, unavailable, and unauthenticated cases for protected execution routes and verify response status, reason, and action match the contract.

### Tests for User Story 3

- [x] T030 [P] [US3] Add BFF response-shape tests for `pdp_denied`, `pdp_unavailable`, and `not_signed_in` in `ui/src/app/api/v1/chat/__tests__/routes.test.ts`
- [x] T031 [P] [US3] Add Dynamic Agents response-shape tests for `pdp_denied`, `pdp_unavailable`, `missing_bearer`, and invalid bearer cases in `ai_platform_engineering/dynamic_agents/tests/test_chat_pdp_gate.py`
- [x] T032 [P] [US3] Add or update stream error parsing expectations for authorization-service failures in `ui/src/lib/streaming/__tests__/stream-error.test.ts`

### Implementation for User Story 3

- [x] T033 [US3] Normalize BFF OpenFGA denial and unavailable responses in `ui/src/lib/rbac/openfga-agent-authz.ts`
- [x] T034 [US3] Normalize Dynamic Agents OpenFGA denial and unavailable responses in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/openfga_authz.py`
- [x] T035 [US3] Ensure streaming clients classify OpenFGA authorization-service failures correctly in `ui/src/lib/streaming/stream-error.ts`
- [x] T036 [US3] Run User Story 3 focused tests in `ui/src/app/api/v1/chat/__tests__/routes.test.ts`, `ui/src/lib/streaming/__tests__/stream-error.test.ts`, and `ai_platform_engineering/dynamic_agents/tests/test_chat_pdp_gate.py`

**Checkpoint**: Users and support engineers can distinguish authn, authz, and PDP outage outcomes without starting agent work.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, validation, and final verification across all stories.

- [x] T037 [P] Update Dynamic Agents RBAC architecture reference in `docs/docs/security/rbac/architecture.md`
- [x] T038 [P] Add Dynamic Agent invocation sequence to `docs/docs/security/rbac/workflows.md`
- [x] T039 [P] Add auth-relevant files for this feature to `docs/docs/security/rbac/file-map.md`
- [x] T040 [P] Update operator verification steps in `docs/docs/security/rbac/usage.md`
- [x] T041 [P] Update feature quickstart with final command names in `docs/docs/specs/2026-05-16-dynamic-agent-pdp-gate/quickstart.md`
- [x] T042 Run RBAC/ReBAC validation command from `docs/docs/specs/2026-05-16-dynamic-agent-pdp-gate/quickstart.md`
- [x] T043 Run focused UI tests from `docs/docs/specs/2026-05-16-dynamic-agent-pdp-gate/quickstart.md`
- [x] T044 Run focused Dynamic Agents tests from `docs/docs/specs/2026-05-16-dynamic-agent-pdp-gate/quickstart.md`
- [x] T045 Run linter checks for edited TypeScript and Python files using repository commands documented in `AGENTS.md`
- [x] T046 Review all changed files for secret exposure and auth-relevant documentation drift in `docs/docs/security/rbac/file-map.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies; can start immediately.
- **Phase 2 Foundational**: Depends on Phase 1 review; blocks all user story implementation.
- **Phase 3 US1**: Depends on Phase 2 helpers; MVP scope.
- **Phase 4 US2**: Depends on Phase 2 helpers; can run after Phase 2 and in parallel with US1 if route conflicts are coordinated.
- **Phase 5 US3**: Depends on Phase 2 helpers; easiest after US1 route wiring exists.
- **Phase 6 Polish**: Depends on desired user stories being complete.

### User Story Dependencies

- **US1 Block Unauthorized Agent Runs**: MVP. No dependency on US2 or US3 after foundational helpers.
- **US2 Preserve Safe Cancellation**: Independent from US1 behavior, but touches shared chat route test files.
- **US3 Report Authorization Failures Clearly**: Depends on helper and route error paths created for US1.

### Within Each User Story

- Tests must be written and observed failing before implementation.
- BFF helper and route tests should precede TypeScript route changes.
- Dynamic Agents helper and route tests should precede Python route changes.
- Route coverage validation should follow initial route wiring.

## Parallel Opportunities

- T002, T003, and T004 can run in parallel during setup.
- T005 and T010 can run in parallel because they target different stacks.
- T013, T014, and T015 can run in parallel once foundational helpers exist.
- T024 and T025 can run in parallel for cancellation coverage.
- T030, T031, and T032 can run in parallel for response-shape coverage.
- T037, T038, T039, T040, and T041 can run in parallel after behavior stabilizes.

## Parallel Example: User Story 1

```bash
# BFF route tests
Task: "Add failing BFF route tests for allowed and denied start, invoke, and resume requests in ui/src/app/api/v1/chat/__tests__/routes.test.ts"

# Dynamic Agents route tests
Task: "Add failing Dynamic Agents route tests proving denied start, invoke, and resume requests stop before runtime work in ai_platform_engineering/dynamic_agents/tests/test_chat_pdp_gate.py"

# Route coverage validation
Task: "Add OpenFGA agent#use coverage expectations for protected execution routes in tests/rbac/rbac-matrix.yaml"
```

## Parallel Example: User Story 2

```bash
Task: "Add failing BFF cancel tests proving cancel authenticates but does not call OpenFGA in ui/src/app/api/v1/chat/__tests__/routes.test.ts"
Task: "Add failing Dynamic Agents cancel tests proving cancel remains OpenFGA-ungated in ai_platform_engineering/dynamic_agents/tests/test_chat_pdp_gate.py"
```

## Parallel Example: User Story 3

```bash
Task: "Add BFF response-shape tests for pdp_denied, pdp_unavailable, and not_signed_in in ui/src/app/api/v1/chat/__tests__/routes.test.ts"
Task: "Add Dynamic Agents response-shape tests for pdp_denied, pdp_unavailable, missing_bearer, and invalid bearer cases in ai_platform_engineering/dynamic_agents/tests/test_chat_pdp_gate.py"
Task: "Add or update stream error parsing expectations for authorization-service failures in ui/src/lib/streaming/__tests__/stream-error.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup review.
2. Complete Phase 2 foundational helpers with tests.
3. Complete Phase 3 US1 tests and implementation.
4. Validate that unauthorized start, invoke, and resume requests stop before runtime work.
5. Demo MVP using one allowed and one denied caller.

### Incremental Delivery

1. Add US1 to block unauthorized execution.
2. Add US2 to prove cancellation remains safely available.
3. Add US3 to refine structured failure outcomes.
4. Finish docs and validation in Phase 6.

### Format Validation

All tasks use the required checklist format:

```text
- [ ] T### [P?] [US?] Description with file path
```

Story labels appear only in user story phases. Setup, foundational, and polish tasks omit story labels.
