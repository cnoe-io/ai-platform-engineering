# Research: Fix Audit Chat Active Conversation Preservation

**Feature**: 093-fix-audit-chat-active-preserve
**Date**: 2026-03-17

## No Outstanding Unknowns

All technical decisions were resolved during specification and clarification. No external research was required.

## Decision Log

### 1. Preserve active conversation regardless of message count

- **Decision**: Remove `conv.messages.length > 0` gate from the `localOnlyPreserved` filter
- **Rationale**: The `activeConversationId` is set synchronously when the user navigates to a conversation. Messages load asynchronously via `loadMessagesFromServer`. The message count gate creates a race condition where the periodic `loadConversationsFromServer` refresh can fire between navigation and message load completion, wiping the conversation from the store.
- **Alternatives considered**:
  - Grace period timer after activation — rejected (adds complexity, still has a timing window)
  - Separate `isMessageLoading` state flag — rejected (over-engineering for one predicate change)
  - Debounce `loadConversationsFromServer` after navigation — rejected (delays all refreshes, not just audit conversations)

### 2. Align local-only path with server-returned path

- **Decision**: Match the behavior already present in the server-conversation mapping (lines 847-851) where `isActive` alone preserves messages without a count check
- **Rationale**: Consistency within the same function reduces surprise. Both code paths handle the same conceptual scenario (active conversation during refresh) and should use the same criteria.
- **Alternatives considered**: None — this is clearly the right approach for consistency
