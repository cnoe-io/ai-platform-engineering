# Implementation Plan: Fix Audit Chat Active Conversation Preservation

**Branch**: `093-fix-audit-chat-active-preserve` | **Date**: 2026-03-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/093-fix-audit-chat-active-preserve/spec.md`

## Summary

Fix a bug where `loadConversationsFromServer` wipes the active audit/shared conversation from the sidebar on each polling refresh. The local-only preservation filter only kept streaming conversations; it must also keep the active conversation regardless of message loading state. This eliminates an intermittent infinite "Loading conversation..." spinner caused by a race between conversation list refresh and per-conversation message loading.

## Technical Context

**Language/Version**: TypeScript (Next.js 16, React 19)
**Primary Dependencies**: Zustand (state management), Next.js App Router
**Storage**: MongoDB (server-side via API), Zustand store (client-side)
**Testing**: Jest + React Testing Library
**Target Platform**: Web browser (SPA)
**Project Type**: Web application (UI component of CAIPE)
**Performance Goals**: N/A (bug fix, no new performance requirements)
**Constraints**: Single-file store change + test updates; no API changes
**Scale/Scope**: 1 source file, 1 test file, ~10 lines of production code changed

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| I. Specs as Source of Truth | PASS | Spec exists at `docs/docs/specs/093-fix-audit-chat-active-preserve/spec.md` |
| VII. Test-First Quality Gates | PASS | Existing test suite covers `loadConversationsFromServer`; new tests will be added for active conversation preservation |
| IX. Security by Default | PASS | No new attack surface; read-only audit access is unchanged |
| X. Simplicity / YAGNI | PASS | Minimal change: one condition modified in one filter expression |

No violations. Complexity Tracking section not needed.

## Project Structure

### Documentation (this feature)

```text
specs/093-fix-audit-chat-active-preserve/
├── spec.md              # Feature specification (complete)
├── plan.md              # This file
├── research.md          # Phase 0 output (below)
├── data-model.md        # Phase 1 output (below)
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
ui/src/
├── store/
│   ├── chat-store.ts                    # PRIMARY: localOnlyPreserved filter fix
│   └── __tests__/
│       └── chat-store.test.ts           # Test updates for active conversation preservation
└── app/(app)/chat/[uuid]/
    ├── page.tsx                          # READ-ONLY: verify spinner logic is compatible (no changes needed)
    └── __tests__/page.test.tsx           # READ-ONLY: existing spinner tests validate fix indirectly
```

**Structure Decision**: Frontend-only bug fix. All changes are in `ui/src/store/`. The chat page component (`page.tsx`) already has a reactive `storeHasMessages` selector and race-condition-aware spinner logic that will work correctly once the store preserves the active conversation.

## Phase 0: Research

No NEEDS CLARIFICATION items remain. The spec and clarification session resolved the key design decision (preserve active conversation regardless of message count).

### Key Findings

**Decision**: Remove `conv.messages.length > 0` gate from local-only active conversation preservation.

**Rationale**: The intermittent "Loading conversation..." spinner is caused by a race condition:
1. User navigates to audit conversation via URL → `setActiveConversation(uuid)` sets the active ID
2. `loadMessagesFromServer(uuid)` begins async fetch (messages still empty)
3. `loadConversationsFromServer` fires on polling interval
4. Server response doesn't include the audit conversation (belongs to another user)
5. Filter checks `conv.messages.length > 0` → false (messages still loading) → conversation wiped
6. `page.tsx`'s `storeHasMessages` selector sees no conversation → spinner shows forever

Removing the message count gate eliminates step 5. The `activeConversationId` alone is sufficient — it's set synchronously when the user navigates.

**Alternatives considered**:
- Grace period timer after activation: Adds complexity, still has a window of vulnerability
- Separate "loading" state flag: Over-engineering for a single condition check

**Consistency note**: For conversations that ARE in the server response (lines 847-851 of `chat-store.ts`), `isActive` alone already preserves messages — no message count check. The fix aligns the local-only path with this existing pattern.

## Phase 1: Design

### Data Model

No new entities or schema changes. The fix modifies the filter predicate in the existing `localOnlyPreserved` computation.

**Before** (current code on branch):
```
conv => !serverIds.has(conv.id) && (
  currentState.streamingConversations.has(conv.id) ||
  (conv.id === currentState.activeConversationId && conv.messages.length > 0)
)
```

**After** (target):
```
conv => !serverIds.has(conv.id) && (
  currentState.streamingConversations.has(conv.id) ||
  conv.id === currentState.activeConversationId
)
```

### Contracts

No external interface changes. The API contract between the UI and backend is unchanged. The fix is entirely client-side state management logic.

### Test Plan

New tests to add to `chat-store.test.ts` under the `loadConversationsFromServer — deletion sync` describe block:

1. **`preserves active conversation not in server response`**: Set `activeConversationId` to a conversation not returned by server. Verify it remains in the store after refresh.

2. **`preserves active conversation with zero messages (race condition)`**: Set `activeConversationId` to a conversation with empty messages array (simulating messages still loading). Verify it's preserved.

3. **`does not preserve non-active, non-streaming local-only conversations`**: Verify that conversations which are neither active nor streaming are correctly removed.

4. **`no duplicate when active conversation is also in server response`**: Set `activeConversationId` to a conversation that IS in the server response. Verify only one entry exists (from server, not duplicated by local-only logic).

### Existing Test Updates

The test at line 1181 (`clears active conversation if it was deleted on another device`) tests the scenario where the active conversation is removed from the server AND from local. This test should continue to pass because it tests a conversation that exists locally with the `activeConversationId` set to it — but the conversation will now be preserved as a local-only entry. **This test's expected behavior changes**: the active conversation should NO LONGER be cleared when it's both active and local-only, because it could be an audit conversation. This test needs to be updated or split:
- For the "deleted on another device" case: the conversation should still be preserved if it's the active one (the user is looking at it)
- The `activeConversationId` should only be cleared when the user navigates away and the conversation isn't in the server response on the next refresh

### Log Message Update

Update the console.log at line 896 to use `localOnlyPreserved` variable name and describe both preservation reasons.
