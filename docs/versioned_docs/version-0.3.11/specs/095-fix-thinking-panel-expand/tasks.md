# Tasks: Fix Thinking Panel Re-Expand on Conversation Switch

**Input**: Design documents from `docs/docs/specs/095-fix-thinking-panel-expand/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included per Constitution gate VII (test-first quality gates).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: Verify the existing code state and ensure we're on the right branch

- [x] T001 Verify branch is `095-fix-thinking-panel-expand` and rebased on latest `origin/main`
- [x] T002 Verify existing `showRawStream` initializer in `ui/src/components/chat/ChatPanel.tsx` uses lazy `useState(() => ...)` with `message.isFinal` check

---

## Phase 2: User Story 1 - Completed Message Thinking Panel Stays Collapsed on Return (Priority: P1) 🎯 MVP

**Goal**: When a message has finished streaming (`isFinal === true`), the thinking/plan panel defaults to collapsed on mount, including when the user navigates back to the conversation.

**Independent Test**: Switch away from a conversation with a completed response, switch back — the thinking panel must remain collapsed.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation (if code fix not yet applied)**

- [x] T003 [US1] Add test in `ui/src/components/chat/__tests__/ChatPanel.test.tsx`: for a message with `isFinal: true` and `rawStreamContent`, assert thinking section defaults to collapsed (not expanded)
- [x] T004 [US1] Add test in `ui/src/components/chat/__tests__/ChatPanel.test.tsx`: for a message with `isFinal: true` rendered after remount (simulating conversation switch), assert thinking section remains collapsed

### Implementation for User Story 1

- [x] T005 [US1] In `ChatMessage` in `ui/src/components/chat/ChatPanel.tsx`, ensure `showRawStream` `useState` initializer returns `false` when `message.isFinal === true`

**Checkpoint**: At this point, User Story 1 should be fully functional — final messages default to collapsed on (re)mount

---

## Phase 3: User Story 2 - Streaming Messages Honor User Preference (Priority: P2)

**Goal**: When a message is still streaming (`isFinal !== true`), the thinking panel defaults to the user's preference from `showThinkingDefault`. No regression from existing behavior.

**Independent Test**: Start a new conversation, confirm the thinking panel follows the feature flag default during streaming.

### Tests for User Story 2

- [x] T006 [P] [US2] Add test in `ui/src/components/chat/__tests__/ChatPanel.test.tsx`: for a message with `isFinal: false` and `rawStreamContent`, assert thinking section defaults to expanded (when `showThinking` flag is `true`)
- [x] T007 [P] [US2] Add test in `ui/src/components/chat/__tests__/ChatPanel.test.tsx`: verify the thinking panel toggle button works (user can expand/collapse regardless of initial state)

### Implementation for User Story 2

- [x] T008 [US2] In `ChatMessage` in `ui/src/components/chat/ChatPanel.tsx`, ensure `showRawStream` `useState` initializer returns `showThinkingDefault` when `message.isFinal !== true` (verify no regression)

**Checkpoint**: Both User Story 1 and 2 pass — final messages collapsed, streaming messages honor user preference

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Quality gates, docs, and commit

- [x] T009 Run `make caipe-ui-tests` and confirm all ChatPanel tests pass (zero failures)
- [ ] T010 Run manual smoke test per `quickstart.md`: switch conversations with completed responses, verify collapsed state
- [x] T011 [P] Update spec status from `Draft` to `Complete` in `docs/docs/specs/095-fix-thinking-panel-expand/spec.md`
- [ ] T012 Commit all changes with conventional commit: `fix(ui): default thinking panel to collapsed for completed messages`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — verify state immediately
- **User Story 1 (Phase 2)**: Depends on Setup — core bug fix
- **User Story 2 (Phase 3)**: Can start in parallel with US1 (tests are in a different describe block, implementation is the same `useState` line)
- **Polish (Phase 4)**: Depends on US1 and US2 completion

### User Story Dependencies

- **User Story 1 (P1)**: Independent — no dependencies on other stories
- **User Story 2 (P2)**: Independent — validates existing behavior is preserved (no regression)

### Within Each User Story

- Tests MUST be written and FAIL before implementation (if fix not yet applied)
- Implementation is a single `useState` initializer change
- Story complete when tests pass

### Parallel Opportunities

- T003 and T004 (US1 tests) must be sequential (same test file section)
- T006 and T007 (US2 tests) are marked [P] — they test different behaviors and can be written independently
- T009 and T011 (Polish) are independent

---

## Parallel Example: User Story 1 + User Story 2

```bash
# Since both stories touch the same useState line, implement sequentially:
# 1. Write US1 tests (T003, T004) → verify fix (T005) → checkpoint
# 2. Write US2 tests (T006, T007) → verify no regression (T008) → checkpoint
# 3. Run full test suite (T009) → smoke test (T010) → commit (T012)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Verify setup
2. Complete Phase 2: Add US1 tests + verify fix
3. **STOP and VALIDATE**: Run `make caipe-ui-tests`
4. If passing → this is the MVP

### Full Delivery

1. Complete MVP (US1)
2. Add US2 regression tests → verify
3. Run full quality gates → commit → PR

---

## Notes

- The code fix (T005/T008) is already applied in the working tree — the `useState` initializer already checks `message.isFinal`. The primary remaining work is adding tests (T003, T004, T006, T007) and running quality gates.
- [P] tasks = different files or independent test cases, no dependencies
- [Story] label maps task to specific user story for traceability
- Commit after all tests pass with `git commit -s` for DCO sign-off
