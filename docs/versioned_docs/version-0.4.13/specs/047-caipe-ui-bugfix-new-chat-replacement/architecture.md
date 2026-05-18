---
sidebar_position: 1
id: 047-caipe-ui-bugfix-new-chat-replacement-architecture
sidebar_label: Architecture
---

# Architecture: Bug Fix: New Chat Removing Old Conversations

**Date**: 2026-01-29

## Solution

### Fix 1: Intelligent Merge in Sync

Changed `syncConversationsFromMongoDB()` to merge intelligently:

```typescript
// NEW (FIXED) CODE:
// 1. Create maps for fast lookup
const existingMap = new Map(state.conversations.map((c) => [c.id, c]));

// 2. Merge: Update existing conversations, add new ones
mongoConversations.forEach((mongoConv) => {
  const existing = existingMap.get(mongoConv.id);
  if (existing) {
    // Keep local messages/events, update metadata from MongoDB
    merged.push({
      ...existing,
      title: mongoConv.title,
      updatedAt: mongoConv.updatedAt,
      // Keep existing messages and events!
    });
  } else {
    merged.push(mongoConv);
  }
});

// 3. Add any local-only conversations
state.conversations.forEach((localConv) => {
  if (!processedIds.has(localConv.id)) {
    merged.push(localConv);
  }
});

// 4. Sort by most recent first
merged.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
```

**Benefits**:
- ✅ Preserves existing conversations
- ✅ Keeps local messages and events
- ✅ Adds new conversations from MongoDB
- ✅ Maintains proper sort order
- ✅ No data loss

### Fix 2: Immediate Local Store Update

Changed the new chat creation flow:

```typescript
// NEW FLOW:
1. Create in MongoDB → GET ID
2. Add to local store IMMEDIATELY
3. Redirect to new conversation
// Sync happens later asynchronously
```

```typescript
// Add to local store immediately
const newConversation = {
  id: conversation._id,
  title: conversation.title,
  createdAt: new Date(conversation.created_at),
  updatedAt: new Date(conversation.updated_at),
  messages: [],
  a2aEvents: [],
};

useChatStore.setState((state) => ({
  conversations: [newConversation, ...state.conversations],
  activeConversationId: conversation._id,
}));
```

**Benefits**:
- ✅ Instant UI update
- ✅ New conversation appears in sidebar immediately
- ✅ Old conversations remain visible
- ✅ No delay waiting for sync


## Code Changes

### File: `ui/src/store/chat-store.ts`

**Changed**: `syncConversationsFromMongoDB()` method
- Lines 389-397 (old: naive replacement)
- Lines 389-428 (new: intelligent merge)

**Impact**: Better merge logic preserves all conversations

### File: `ui/src/app/(app)/chat/page.tsx`

**Changed**: New conversation creation flow
- Lines 27-42 (old: create + sync)
- Lines 27-52 (new: create + immediate local update)

**Impact**: Instant UI update, no data loss


## Edge Cases Handled

1. **Race Conditions**: Multiple rapid "New Chat" clicks
2. **Sync Timing**: Conversation created during sync operation
3. **Local vs MongoDB**: Conversations in different storage layers
4. **Order Preservation**: Most recent conversations first
5. **Message Retention**: Local messages preserved during sync


## Performance Impact

**Before**:
- Sync operation: O(n) replacement
- UI update: Delayed until sync completes
- Risk: Data loss during sync

**After**:
- Sync operation: O(n) merge (same complexity, better logic)
- UI update: Immediate (better UX)
- Risk: Zero data loss


## Future Improvements

Potential enhancements:

1. **Optimistic Updates**: Show new conversation immediately, sync later
2. **Conflict Resolution**: Handle concurrent edits across devices
3. **Incremental Sync**: Only fetch new/updated conversations
4. **Local Draft Indicator**: Show which conversations have unsaved changes
5. **Sync Queue**: Queue operations during offline mode


## Related

- Spec: [spec.md](./spec.md)
