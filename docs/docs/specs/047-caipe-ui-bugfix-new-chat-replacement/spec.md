---
sidebar_position: 2
sidebar_label: Specification
title: "2026-01-29: Bug Fix: New Chat Removing Old Conversations"
---

# Bug Fix: New Chat Removing Old Conversations

## Motivation

When clicking "New Chat", the old chat was being removed and replaced with the new one, instead of adding the new conversation to the existing list.


## Root Cause

The bug had **two problems**:

### Problem 1: Naive Sync Logic

The `syncConversationsFromMongoDB()` function was doing a naive replacement:

```typescript
// OLD (BROKEN) CODE:
conversations: [...mongoConversations, ...localOnly]
```

This completely replaced the conversation list with:
1. All MongoDB conversations (fresh from API)
2. Local-only conversations (not yet in MongoDB)

**Issues**:
- Lost the order of conversations
- Discarded any local changes/messages not yet synced
- Could cause race conditions during rapid operations

### Problem 2: No Immediate Local Update

When creating a new conversation in MongoDB mode:

```typescript
// OLD FLOW:
1. Create in MongoDB → GET ID
2. Call syncConversationsFromMongoDB() → Replace entire list
3. Redirect to new conversation
```

The sync operation would fetch ALL conversations from MongoDB and replace the local store, potentially losing:
- Conversations with unsaved messages
- Recently created conversations
- Local-only conversations


## Testing Strategy

### Test Case 1: Create Multiple Conversations

**Before (Broken)**:
```
1. Have conversation "Chat 1"
2. Click "New Chat"
3. ❌ "Chat 1" disappears
4. ❌ Only "New Conversation" visible
```

**After (Fixed)**:
```
1. Have conversation "Chat 1"
2. Click "New Chat"
3. ✅ "Chat 1" still visible
4. ✅ "New Conversation" added at top
5. ✅ Both conversations in sidebar
```

### Test Case 2: Rapid New Chats

**Before (Broken)**:
```
1. Click "New Chat" → Creates Chat A
2. Quickly click "New Chat" again → Creates Chat B
3. ❌ Chat A might disappear
4. ❌ Only Chat B visible
```

**After (Fixed)**:
```
1. Click "New Chat" → Creates Chat A
2. Quickly click "New Chat" again → Creates Chat B
3. ✅ Both Chat A and Chat B visible
4. ✅ Proper chronological order
```

### Test Case 3: MongoDB Sync with Local Conversations

**Before (Broken)**:
```
1. Create "Local Chat" (localStorage only)
2. Enable MongoDB
3. Create "MongoDB Chat"
4. ❌ "Local Chat" might disappear during sync
```

**After (Fixed)**:
```
1. Create "Local Chat" (localStorage only)
2. Enable MongoDB
3. Create "MongoDB Chat"
4. ✅ Both chats remain visible
5. ✅ "Local Chat" marked as local-only
6. ✅ "MongoDB Chat" synced to backend
```


## Summary

**Problem**: Creating new chat removed old conversations

**Root Cause**: 
1. Sync operation replaced entire list
2. No immediate local store update

**Solution**:
1. Intelligent merge preserves existing conversations
2. Immediate local update for instant UI feedback

**Result**: 
- ✅ All conversations preserved
- ✅ Proper chronological order
- ✅ Instant UI updates
- ✅ No data loss
- ✅ Better UX

The bug is now fixed! 🎉


## Related

- Architecture: [architecture.md](./architecture.md)
