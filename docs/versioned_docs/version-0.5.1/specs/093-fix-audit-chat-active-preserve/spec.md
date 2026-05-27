# Feature Specification: Fix Audit Chat Active Conversation Preservation

**Feature Branch**: `093-fix-audit-chat-active-preserve`
**Created**: 2026-03-17
**Status**: Draft
**Input**: User description: "Audit Chat loading loadConversationsFromServer needs to preserve conversations that aren't in the server response but are the active conversation (not just streaming ones). Line 860-863 only preserves localOnlyStreaming, not localOnlyActive."

## Clarifications

### Session 2026-03-17

- Q: Should the active conversation be preserved regardless of message count, or only when messages are loaded? → A: Preserve regardless of message count (Option A) — eliminates race condition where conversation list refresh fires before message loading completes, causing infinite "Loading conversation..." spinner.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Active Audit Chat Survives Server Reload (Priority: P1)

A user opens a shared or audit conversation that belongs to another user. Since this conversation does not belong to the current user, it does not appear in the server's response when the conversation list is periodically refreshed. Despite this, the conversation must remain visible and intact in the sidebar because the user is actively viewing it.

**Why this priority**: This is the core bug. Without this fix, users lose their active conversation — including all loaded messages and context — every time the sidebar refreshes. This makes audit and shared conversations unusable in practice.

**Independent Test**: Can be fully tested by opening an audit/shared conversation owned by another user and triggering a conversation list refresh. The conversation should remain in the sidebar with all messages intact.

**Acceptance Scenarios**:

1. **Given** a user is viewing a shared/audit conversation that belongs to another user, **When** the system refreshes the conversation list from the server, **Then** the active conversation remains in the sidebar with all its loaded messages preserved.
2. **Given** a user is viewing a shared/audit conversation (with or without messages loaded yet), **When** the server response does not include that conversation, **Then** the conversation is not removed from the local conversation list.
3. **Given** a user is viewing a shared/audit conversation, **When** the server response includes conversations from the user's own history, **Then** those server conversations are merged alongside the preserved active conversation without duplicates.
4. **Given** a user navigates to an audit conversation via URL and messages are still loading, **When** the conversation list refresh fires before message loading completes, **Then** the conversation is preserved in the sidebar and the loading spinner resolves normally once messages arrive.

---

### User Story 2 - Streaming Conversations Continue to Be Preserved (Priority: P1)

A user has just started a new conversation that is actively streaming a response. The server has not yet persisted this conversation. When the conversation list refreshes, the streaming conversation must not be lost.

**Why this priority**: This is existing behavior that must not regress. Streaming conversations were already preserved; the fix must maintain this guarantee alongside the new active-conversation preservation.

**Independent Test**: Can be tested by starting a new conversation, initiating a streaming response, and triggering a conversation list refresh while streaming is in progress. The conversation should remain in the sidebar.

**Acceptance Scenarios**:

1. **Given** a conversation is actively streaming, **When** the conversation list refreshes from the server, **Then** the streaming conversation remains in the sidebar with its messages intact.
2. **Given** a conversation is actively streaming and not yet in the server response, **When** a refresh occurs, **Then** the conversation is included in the merged conversation list.

---

### Edge Cases

- What happens when the active conversation has no loaded messages (e.g., messages still loading from server)? The conversation MUST still be preserved — this eliminates the race condition between message loading and conversation list refresh that causes the infinite spinner.
- What happens when a conversation is both streaming AND the active conversation? It should be preserved (only one copy, no duplicates).
- What happens when the active conversation IS in the server response? It should come from the server response as normal; the local-only preservation logic should not create a duplicate.
- What happens when a user switches away from an audit conversation and a refresh occurs? The previously-active audit conversation should be removed since it is no longer active and is not in the server response.
- What happens when the conversation list refresh returns an error? The existing conversation list should remain unchanged (existing behavior, no regression).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST preserve any local-only conversation that is the currently active conversation, regardless of whether messages have loaded yet, even when it is absent from the server response.
- **FR-002**: System MUST continue to preserve conversations that are actively streaming, regardless of whether they appear in the server response.
- **FR-003**: System MUST NOT create duplicate entries when a conversation qualifies for preservation under multiple criteria (e.g., both streaming and active).
- **FR-004**: System MUST NOT preserve local-only conversations that are neither streaming nor the active conversation — these should be removed on refresh.
- **FR-005**: System MUST log when local-only conversations are preserved, indicating the reason (streaming, active audit/shared, or both).

### Key Entities

- **Conversation**: A chat session with an ID, title, messages, timestamps, owner, and sharing settings. May be owned by the current user or shared/audited from another user.
- **Active Conversation**: The conversation currently being viewed by the user, identified by the active conversation ID in the application state.
- **Streaming Conversation**: A conversation with an ongoing server-sent event stream, tracked in a set of streaming conversation IDs.
- **Server Conversation List**: The set of conversations returned by the server for the current user — does not include audit/shared conversations owned by other users.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of active audit/shared conversations survive conversation list refreshes without data loss, regardless of whether messages have finished loading.
- **SC-002**: Zero regressions in streaming conversation preservation — all streaming conversations continue to be preserved during refreshes.
- **SC-003**: Zero duplicate conversations appear in the sidebar after a refresh when a conversation qualifies for preservation under multiple criteria.
- **SC-004**: Users viewing audit/shared conversations experience zero unexpected sidebar resets or conversation disappearances during their session.

## Assumptions

- Audit and shared conversations belong to another user and therefore are expected to be absent from the current user's server response when the conversation list is fetched.
- The conversation list refresh occurs periodically in the background (polling) and the fix must handle this transparent to the user.
- The "active conversation" is always identifiable via a single active conversation ID in the application state.
- The active conversation ID being set is a reliable indicator that the user has navigated to that conversation, even before messages finish loading.
