# Tasks: Skill Scanner Validation Errors

**Input**: Design documents from `docs/docs/specs/2026-05-13-skill-scanner-load-error/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/scan-upload-validation-error.md`, `quickstart.md`
**Tests**: Regression tests are included because the feature specification defines independent test criteria for each user story.
**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other tasks in the same phase because it touches different files or has no dependency on incomplete work.
- **[Story]**: Maps task to a user story from `spec.md`.
- Every task includes an exact file path.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the scanner packaging and test surface before changing behavior.

- [X] T001 Inspect the latest available `cisco-ai-skill-scanner` package and record whether a version bump or temporary image-local patch will be used in `build/Dockerfile.skill-scanner`
- [X] T002 [P] Create the scanner patch workspace directory and README in `build/skill-scanner-patches/README.md`
- [X] T003 [P] Create a placeholder regression test module for scanner API patch behavior in `ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the shared packaging mechanism required before user-story behavior can be implemented.

**Critical**: No user story work can begin until this phase is complete.

- [X] T004 Implement an idempotent scanner router patch helper in `build/skill-scanner-patches/patch_router_validation_errors.py`
- [X] T005 Wire the scanner package bump or patch helper into the image build in `build/Dockerfile.skill-scanner`
- [X] T006 [P] Document the selected bump-or-patch approach and removal condition in `build/skill-scanner-patches/README.md`
- [X] T007 [P] Update scanner packaging notes for the selected validation-error fix approach in `charts/ai-platform-engineering/charts/skill-scanner/README.md`

**Checkpoint**: Scanner image packaging can now modify the upstream API behavior reproducibly.

---

## Phase 3: User Story 1 - Receive Actionable Validation Feedback (Priority: P1) MVP

**Goal**: Malformed skill submissions return a validation failure with the actionable loader message instead of a generic internal scan error.

**Independent Test**: Submit a zipped skill whose `SKILL.md` omits `name`; verify the scanner response is a validation failure and includes `SKILL.md missing required field: name` without a traceback.

### Tests for User Story 1

- [X] T008 [P] [US1] Add a regression test for mapping `SkillLoadError` to a validation response in `ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py`
- [X] T009 [P] [US1] Add a regression test that validation details are bounded and do not include traceback text in `ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py`

### Implementation for User Story 1

- [X] T010 [US1] Update scanner router patch logic to import and catch known skill loading validation exceptions in `build/skill-scanner-patches/patch_router_validation_errors.py`
- [X] T011 [US1] Update scanner router patch logic to return HTTP 422 with sanitized actionable detail in `build/skill-scanner-patches/patch_router_validation_errors.py`
- [X] T012 [US1] Validate the malformed missing-name upload path with the scanner image using `docs/docs/specs/2026-05-13-skill-scanner-load-error/quickstart.md`

**Checkpoint**: User Story 1 is independently functional and satisfies the MVP.

---

## Phase 4: User Story 2 - Preserve Genuine Server Fault Handling (Priority: P2)

**Goal**: Unexpected scanner faults remain distinguishable from user-correctable skill validation failures.

**Independent Test**: Trigger or simulate a non-validation scan failure and verify it remains categorized as an internal failure while malformed skills return validation failures.

### Tests for User Story 2

- [X] T013 [P] [US2] Add a regression test showing generic exceptions still map to internal scan errors in `ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py`
- [X] T014 [P] [US2] Add a regression test showing existing archive-level HTTP 400 responses are not rewritten in `ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py`

### Implementation for User Story 2

- [X] T015 [US2] Ensure the scanner router patch catches validation exceptions before the generic exception handler in `build/skill-scanner-patches/patch_router_validation_errors.py`
- [X] T016 [US2] Ensure the scanner router patch leaves unexpected exception handling and logging unchanged in `build/skill-scanner-patches/patch_router_validation_errors.py`
- [X] T017 [US2] Verify UI server-side client behavior still reports non-2xx scanner responses as `unscanned` in `ui/src/lib/skill-scan.ts`

**Checkpoint**: User Story 2 works without weakening incident triage for real service faults.

---

## Phase 5: User Story 3 - Keep Valid Skill Scans Unchanged (Priority: P3)

**Goal**: Valid skill scans continue to return the normal successful scanner response.

**Independent Test**: Submit a valid skill archive to the scanner image and verify the response shape remains the normal successful scan response.

### Tests for User Story 3

- [X] T018 [P] [US3] Add an idempotency test proving repeated patch application does not alter already-patched router source in `ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py`
- [X] T019 [P] [US3] Add scanner client contract coverage for successful scan interpretation in `ui/src/lib/__tests__/skill-scan-ancillary.test.ts`

### Implementation for User Story 3

- [X] T020 [US3] Confirm the scanner image build still runs `skill-scanner --version` and `skill-scanner-api --help` in `build/Dockerfile.skill-scanner`
- [X] T021 [US3] Validate the valid-skill upload path with the scanner image using `docs/docs/specs/2026-05-13-skill-scanner-load-error/quickstart.md`
- [X] T022 [US3] Confirm scanner deployment settings remain internal-only and non-root in `charts/ai-platform-engineering/charts/skill-scanner/values.yaml`

**Checkpoint**: Valid scans behave as before while validation errors are improved.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and documentation cleanup across the feature.

- [X] T023 [P] Run targeted Python regression tests with `uv run pytest ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py -v`
- [X] T024 [P] Run existing scanner helper tests with `uv run pytest ai_platform_engineering/skills_middleware/tests/test_skill_scanner_runner.py -v`
- [X] T025 [P] Run scanner client tests with `cd ui && npm test -- --runTestsByPath src/lib/__tests__/skill-scan-ancillary.test.ts`
- [X] T026 Build the scanner image with `docker build -f build/Dockerfile.skill-scanner -t skill-scanner:validation-error .`
- [X] T027 Execute the malformed and valid upload checks from `docs/docs/specs/2026-05-13-skill-scanner-load-error/quickstart.md`
- [X] T028 Update implementation notes in `docs/docs/specs/2026-05-13-skill-scanner-load-error/quickstart.md` if verification commands differ from the final implementation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational; recommended MVP.
- **User Story 2 (Phase 4)**: Depends on Foundational and can run after or alongside US1 implementation, but final verification should compare against US1 behavior.
- **User Story 3 (Phase 5)**: Depends on Foundational and can run alongside US1/US2 after packaging mechanics exist.
- **Polish (Phase 6)**: Depends on desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: No dependency on other user stories; delivers the MVP validation response.
- **US2 (P2)**: Depends on the same exception classification surface as US1; should not change the US1 contract.
- **US3 (P3)**: Depends on the same image build path as US1; verifies no regression for valid scans.

### Within Each User Story

- Tests should be written before implementation tasks in the same story.
- Patch helper behavior should be covered before wiring it into image validation.
- Manual quickstart checks should run after the image can be built with the final package or patch.

### Parallel Opportunities

- T002 and T003 can run in parallel after T001.
- T006 and T007 can run in parallel after T004 and T005 are understood.
- T008 and T009 can run in parallel for US1.
- T013 and T014 can run in parallel for US2.
- T018 and T019 can run in parallel for US3.
- T023, T024, and T025 can run in parallel during polish after relevant implementation is complete.

---

## Parallel Example: User Story 1

```bash
Task: "Add a regression test for mapping SkillLoadError to a validation response in ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py"
Task: "Add a regression test that validation details are bounded and do not include traceback text in ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py"
```

---

## Parallel Example: User Story 2

```bash
Task: "Add a regression test showing generic exceptions still map to internal scan errors in ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py"
Task: "Add a regression test showing existing archive-level HTTP 400 responses are not rewritten in ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py"
```

---

## Parallel Example: User Story 3

```bash
Task: "Add an idempotency test proving repeated patch application does not alter already-patched router source in ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py"
Task: "Add or update scanner client contract coverage for successful scan interpretation in ui/src/lib/__tests__/skill-scan-ancillary.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup.
2. Complete Phase 2 foundational packaging work.
3. Complete Phase 3 for US1.
4. Stop and validate malformed missing-name uploads independently.

### Incremental Delivery

1. Deliver US1 so callers receive actionable validation failures.
2. Add US2 to prove genuine service faults remain internal failures.
3. Add US3 to prove valid scan behavior is unchanged.
4. Run polish validation and update quickstart notes if final commands differ.

### Notes

- Keep the image-local patch temporary and narrowly scoped; remove it when a fixed upstream `cisco-ai-skill-scanner` release is available.
- Do not expose the scanner publicly; it remains internal-only and unauthenticated by design.
- Do not add persisted storage or migrations for this feature.
