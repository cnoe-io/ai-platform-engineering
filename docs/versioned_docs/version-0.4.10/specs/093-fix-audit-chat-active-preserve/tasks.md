# Tasks: Fix Audit Chat Active Conversation Preservation

**Input**: Design documents from `/specs/093-fix-audit-chat-active-preserve/`
**Prerequisites**: plan.md (complete), spec.md (complete), research.md (complete), data-model.md (complete)

**Tests**: Included — constitution requires test-first quality gates (VII).

**Organization**: Tasks grouped by user story. Both stories are P1 and share the same source file, so they execute sequentially.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Exact file paths included in descriptions

## Path Conventions

- **UI source**: `ui/src/store/chat-store.ts`
- **UI tests**: `ui/src/store/__tests__/chat-store.test.ts`

---

## Phase 1: Setup

**Purpose**: No setup needed — this is a bug fix in an existing codebase with existing test infrastructure.

*No tasks in this phase.*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No foundational work needed — all infrastructure exists.

*No tasks in this phase.*

---

## Phase 3: User Story 1 — Active Audit Chat Survives Server Reload (Priority: P1) MVP

**Goal**: Preserve the active conversation in `loadConversationsFromServer` regardless of message count, eliminating the race condition that causes the infinite "Loading conversation..." spinner for audit/shared conversations.

**Independent Test**: Open an audit conversation owned by another user, trigger a conversation list refresh, verify the conversation remains in the sidebar with messages intact.

### Tests for User Story 1

> **Write these tests FIRST, ensure they FAIL before implementation**

- [x] T001 [US1] Add test `preserves active conversation not in server response` to `loadConversationsFromServer — deletion sync` describe block in `ui/src/store/__tests__/chat-store.test.ts`. Set `activeConversationId` to `'audit-conv'`, add that conversation to local state with messages, mock server to return empty list. Assert `'audit-conv'` remains in store after `loadConversationsFromServer()`.

- [x] T002 [US1] Add test `preserves active conversation with zero messages (race condition)` in `ui/src/store/__tests__/chat-store.test.ts`. Set `activeConversationId` to `'loading-conv'`, add that conversation with empty `messages: []` (simulating messages still loading). Mock server to return empty list. Assert `'loading-conv'` remains in store after refresh. This validates FR-001's "regardless of whether messages have loaded yet" requirement.

- [x] T003 [US1] Add test `no duplicate when active conversation is also in server response` in `ui/src/store/__tests__/chat-store.test.ts`. Set `activeConversationId` to `'both-conv'`, add that conversation locally, AND include it in the mock server response. Assert exactly 1 entry for `'both-conv'` in the store after refresh (from server, not duplicated by local-only preservation).

- [x] T004 [US1] Update existing test `clears active conversation if it was deleted on another device` (line ~1181) in `ui/src/store/__tests__/chat-store.test.ts`. The test currently expects `activeConversationId` to switch when the active conversation is not in the server response. With the fix, the active conversation should now be preserved as a local-only entry. Update assertions: the conversation should remain in the store and `activeConversationId` should stay unchanged. Rename test to `preserves active conversation even when absent from server response (audit/shared scenario)`.

### Implementation for User Story 1

- [x] T005 [US1] Modify the `localOnlyPreserved` filter in `loadConversationsFromServer` in `ui/src/store/chat-store.ts` (~line 864-869). Remove `&& conv.messages.length > 0` from the active conversation condition. Change from `(conv.id === currentState.activeConversationId && conv.messages.length > 0)` to `(conv.id === currentState.activeConversationId)`.

- [x] T006 [US1] Update the `console.log` at ~line 896 in `ui/src/store/chat-store.ts` to accurately reference `localOnlyPreserved` and describe both preservation reasons (streaming and active audit/shared).

**Checkpoint**: Run `make caipe-ui-tests` — all new and updated tests for US1 should pass. The active conversation is preserved on refresh regardless of message count.

---

## Phase 4: User Story 2 — Streaming Conversations Continue to Be Preserved (Priority: P1)

**Goal**: Verify no regression in existing streaming conversation preservation behavior.

**Independent Test**: Start a new streaming conversation, trigger a refresh, verify the streaming conversation remains.

### Verification for User Story 2

- [x] T007 [US2] Verify existing test `preserves local-only conversations that are actively streaming` (line ~1154) in `ui/src/store/__tests__/chat-store.test.ts` still passes after the changes from US1. No code changes expected — this is a regression check. Run the specific test to confirm.

- [x] T008 [US2] Add test `does not preserve non-active non-streaming local-only conversations` in `ui/src/store/__tests__/chat-store.test.ts`. Add a conversation that is NOT active and NOT streaming. Mock server to return empty list. Assert the conversation is removed from the store. This validates FR-004.

**Checkpoint**: Run `make caipe-ui-tests` — all streaming-related tests pass alongside the new active conversation tests.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final validation across both user stories

- [x] T009 Run `make caipe-ui-tests` to validate all chat-store tests pass (both new and existing)
- [x] T010 Run `make lint` to ensure no linting issues introduced

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 3 (US1)**: No dependencies — can start immediately
- **Phase 4 (US2)**: Depends on Phase 3 (US1) since both modify the same test file
- **Phase 5 (Polish)**: Depends on Phase 3 + Phase 4

### Within User Story 1

1. T001–T004 (tests) — write first, verify they fail
2. T005–T006 (implementation) — make tests pass
3. Checkpoint: all tests green

### Within User Story 2

1. T007 (regression check) — verify existing test still passes
2. T008 (new negative test) — verify non-preserved conversations are removed

### Parallel Opportunities

- T001, T002, T003 can be written in parallel (different test cases, same file — but logically independent)
- T005 and T006 are in the same file but different locations — can be done together in one edit pass

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Write tests T001–T004 → verify they fail
2. Implement T005–T006 → verify tests pass
3. **STOP and VALIDATE**: `make caipe-ui-tests`
4. This alone fixes the core bug

### Incremental Delivery

1. US1 (T001–T006) → Core fix, race condition eliminated
2. US2 (T007–T008) → Regression safety net
3. Polish (T009–T010) → Full validation

---

## Notes

- Total: 10 tasks (4 test tasks, 2 implementation tasks, 2 verification tasks, 2 validation tasks)
- All changes in 2 files: `chat-store.ts` (production) and `chat-store.test.ts` (tests)
- Production code change is ~3 lines (remove one condition, update one log message)
- The existing diff on the branch already has most of the fix — it just needs the `messages.length > 0` check removed per the clarification
