# Feature Specification: Fix Thinking Panel Re-Expand on Conversation Switch

**Feature Branch**: `095-fix-thinking-panel-expand`
**Created**: 2026-03-18
**Status**: Complete
**Input**: User description: "Once the streaming is done and the plan/thinking collapses after final response, when you switch between conversation and come back to first conversation, the plan expands on every switch. Root cause: showRawStream state re-initializes to true on remount; fix: when message.isFinal, default to collapsed."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Completed Message Thinking Panel Stays Collapsed on Return (Priority: P1)

A user finishes a conversation (streaming complete, thinking/plan panel has collapsed). They switch to another conversation and then switch back to the first. The thinking/plan panel for that completed message must remain collapsed instead of expanding again.

**Why this priority**: This is the core bug. Without the fix, every return to a conversation with a completed response causes the thinking panel to re-expand, creating a noisy and inconsistent experience.

**Independent Test**: Open a conversation, wait for the response to finish (thinking panel collapses). Switch to another conversation, then back. The thinking panel for the completed message must still be collapsed.

**Acceptance Scenarios**:

1. **Given** a message has completed streaming (final response), **When** the user switches to another conversation and then returns to the first, **Then** the thinking/plan panel for that message is collapsed (not expanded).
2. **Given** a message has completed streaming, **When** the message is first displayed (e.g. after refresh or navigation), **Then** the thinking panel defaults to collapsed.

---

### User Story 2 - Streaming Messages Honor User Preference (Priority: P2)

While a response is still streaming, the thinking/plan panel respects the user's default preference (e.g. expanded or collapsed from settings or feature flag). This behavior must not regress.

**Why this priority**: Preserves existing behavior for in-progress streams so the fix only changes behavior for completed messages.

**Independent Test**: Start a new conversation with streaming. Verify the thinking panel opens or stays closed according to the user's default preference. After the fix, the same preference applies during streaming; only completed messages default to collapsed.

**Acceptance Scenarios**:

1. **Given** a message is still streaming, **When** the message is displayed, **Then** the thinking panel initial state follows the user's default preference (e.g. showThinkingDefault).
2. **Given** the user has toggled the thinking panel during or after streaming, **When** they interact with the same message, **Then** the panel remains user-toggleable (expand/collapse still works).

---

### Edge Cases

- **User had manually expanded the panel before switching away**: When they return, the panel will show in its default state for that message (collapsed for final messages). Persisting per-message expand state across navigation is out of scope for this fix.
- **Multiple conversations with mix of streaming and completed**: Each message's thinking panel initial state is determined by that message's completion status (final → collapsed; otherwise → user default).
- **Rapid conversation switching**: No flicker or incorrect state; initial state is derived from message.isFinal at render time.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a message is final (streaming complete), the thinking/plan panel MUST default to collapsed when the message is displayed, including when the user navigates back to the conversation.
- **FR-002**: When a message is not yet final (streaming in progress), the thinking/plan panel MUST default to the user's preference (e.g. from feature flag or settings).
- **FR-003**: The thinking/plan panel MUST remain user-toggleable (user can expand or collapse at any time) in both streaming and completed states.
- **FR-004**: Initial expand/collapse state MUST be derived from message completion status and user preference only; no dependency on remount order or navigation history.

### Key Entities

- **Message**: A chat message with a completion status (e.g. isFinal). When true, streaming has finished and the response is complete.
- **Thinking/Plan panel**: The UI section that shows raw stream or plan/thinking content; it can be expanded or collapsed. Its initial state is controlled by component state initialized from message completion status and user default.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero occurrences of the thinking panel re-expanding when a user returns to a conversation whose response has already completed (100% of such returns show the panel collapsed by default).
- **SC-002**: User preference for thinking panel visibility during new/streaming responses is unchanged (no regression in default open/closed behavior for in-progress streams).
- **SC-003**: No increase in support or bug reports related to thinking panel state after the fix is released.

## Assumptions

- The chat UI remounts message components when switching conversations (e.g. due to key or identity changes), so initial state runs again; the fix is to make that initial state depend on message.isFinal.
- "User preference" for streaming is already provided (e.g. showThinkingDefault from feature flag store); the fix only changes behavior when message.isFinal is true.
- Persisting expand/collapse state per message across navigation is out of scope; only the default on (re)mount is changed.
