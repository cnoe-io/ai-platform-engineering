# Data Model: Fix Audit Chat Active Conversation Preservation

**Feature**: 093-fix-audit-chat-active-preserve
**Date**: 2026-03-17

## No Schema Changes

This bug fix does not introduce or modify any data entities. All changes are to client-side filter logic within the existing Zustand store.

## Existing Entities (Reference)

### Conversation (Zustand store)

| Field | Type | Description |
|-------|------|-------------|
| id | string | Conversation UUID |
| title | string | Display title |
| messages | Message[] | Loaded messages (empty until `loadMessagesFromServer` fetches them) |
| a2aEvents | A2AEvent[] | Agent-to-agent events |
| sseEvents | SSEEvent[] | Server-sent events for dynamic agents |
| createdAt | Date | Creation timestamp |
| updatedAt | Date | Last update timestamp |
| agent_id | string? | Dynamic agent ID (undefined = Platform Engineer) |
| owner_id | string? | Email of conversation owner |
| sharing | SharingConfig? | Sharing settings (is_public, shared_with, shared_with_teams) |

### Store State (relevant fields)

| Field | Type | Description |
|-------|------|-------------|
| conversations | Conversation[] | All known conversations |
| activeConversationId | string \| null | Currently viewed conversation |
| streamingConversations | Map | Conversations with active SSE streams |

## Filter Predicate Change

The `localOnlyPreserved` filter in `loadConversationsFromServer` changes from:

```
streaming OR (active AND has_messages)
```

to:

```
streaming OR active
```

This aligns with the server-returned conversation path which already uses `isActive` without a message count check.
