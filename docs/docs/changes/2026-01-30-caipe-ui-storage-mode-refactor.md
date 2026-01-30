# Storage Mode Refactor - Exclusive Storage (No Hybrid)

## Summary

Refactored CAIPE UI from **hybrid storage** (MongoDB + localStorage simultaneously) to **exclusive storage mode** (MongoDB OR localStorage, never both).

## Problem Statement

**Before**: 
- App always used localStorage (via Zustand persist)
- Also synced to MongoDB if available
- Confusing dual-write behavior
- Users didn't know where their data lived
- Old conversations could be in localStorage, new ones in MongoDB

**After**:
- Clean separation: MongoDB XOR localStorage
- Storage mode determined by `MONGODB_URI` env variable
- No confusion about data location
- Clear UI indicators

---

## Changes Made

### 1. New Storage Configuration System

**File**: `ui/src/lib/storage-config.ts`

```typescript
// Replaces old storage-mode.ts with simpler, exclusive logic
export const IS_MONGODB_CONFIGURED = !!(MONGODB_URI && MONGODB_DATABASE);

export function getStorageMode(): 'mongodb' | 'localStorage' {
  return IS_MONGODB_CONFIGURED ? 'mongodb' : 'localStorage';
}

export function shouldUseLocalStorage(): boolean {
  return !IS_MONGODB_CONFIGURED;
}
```

**Key difference from old `storage-mode.ts`**:
- Old: Async API check for MongoDB availability (runtime)
- New: Build-time env variable check (static)
- Simpler, faster, no race conditions

---

### 2. Conditional Zustand Persistence

**File**: `ui/src/store/chat-store.ts`

**Before** (hybrid):
```typescript
export const useChatStore = create<ChatState>()(
  persist(storeImplementation, { ... })  // Always persisted to localStorage
);

// Separately sync to MongoDB
if (await isMongoDBAvailable()) {
  await apiClient.createConversation({ ... });
}
```

**After** (exclusive):
```typescript
export const useChatStore = shouldUseLocalStorage()
  ? create<ChatState>()(persist(storeImplementation, { ... }))  // localStorage mode
  : create<ChatState>()(storeImplementation);                   // MongoDB mode (no persistence)
```

**Impact**:
- localStorage mode: Zustand persist enabled → data saved in browser
- MongoDB mode: Zustand persist disabled → data only in MongoDB

---

### 3. Exclusive CRUD Operations

**Updated methods**:
- `createConversation()` - No longer dual-writes
- `deleteConversation()` - Deletes from active storage only
- `syncConversationsFromMongoDB()` → `loadConversationsFromServer()` - Clearer naming

**Example** (`createConversation`):

```typescript
const storageMode = getStorageMode();

if (storageMode === 'mongodb') {
  // Create on server
  await apiClient.createConversation({ ... });
}

// Update local state (only persisted in localStorage mode)
set({ conversations: [...] });
```

---

### 4. Updated Components

#### Sidebar.tsx

**Before**:
```typescript
import { getCachedStorageMode } from "@/lib/storage-mode";

const [storageMode, setStorageMode] = useState<'mongodb' | 'localStorage' | null>(null);

useEffect(() => {
  syncConversationsFromMongoDB();
  setTimeout(() => {
    setStorageMode(getCachedStorageMode());
  }, 500);
}, [activeTab]);
```

**After**:
```typescript
import { getStorageMode, getStorageModeDisplay } from "@/lib/storage-config";

const storageMode = getStorageMode();  // Synchronous, no state needed

useEffect(() => {
  loadConversationsFromServer();  // Only loads if MongoDB mode
}, [activeTab]);
```

**Benefits**:
- No async storage detection
- No setTimeout hacks
- Immediate, deterministic

---

### 5. Enhanced UI Indicators

**Sidebar Storage Mode Indicator**:

**localStorage mode**:
```
⚠️ Local Storage Mode
   Browser-only • Not shareable
```

**MongoDB mode**:
```
✅ MongoDB Mode
   Persistent • Shareable • Teams
```

Shows users exactly where their data lives.

---

### 6. Environment Configuration

**ui/env.example**:

```bash
# ===========================================
# Storage Configuration - MongoDB vs localStorage (EXCLUSIVE)
# ===========================================
#
# IMPORTANT: The app uses ONLY ONE storage mode (not hybrid)
# - MongoDB mode: Persistent, shareable, team collaboration
# - localStorage mode: Browser-only, not shareable
#
# Set MONGODB_URI to enable MongoDB mode
# Leave unset for localStorage mode

MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=caipe
```

**ui/.env.local** (updated with clear comments):

```bash
# ===========================================
# Storage Mode: MongoDB vs localStorage (EXCLUSIVE)
# ===========================================
# 
# ✅ MongoDB mode (current): Persistent, shareable, team collaboration
#    - Conversations stored in MongoDB
#    - localStorage NOT used
#    - Admin features enabled
#
# To switch to localStorage mode: Comment out MONGODB_URI
#    - Conversations stored in browser only
#    - Not shareable
#    - No admin features
#
MONGODB_URI=mongodb://admin:changeme@localhost:27017
MONGODB_DATABASE=caipe
```

---

## Migration Path

### For Users with Existing localStorage Data

If you have conversations in localStorage and want to migrate to MongoDB:

1. **Before**: localStorage mode (no MongoDB configured)
2. **Export** localStorage data (if needed for backup)
3. **Configure** MongoDB in `.env.local`
4. **Restart** the app
5. **Migration** happens via admin API (separate feature)

### For Development

**Testing localStorage mode**:
```bash
cd ui
# Comment out MONGODB_URI in .env.local
npm run dev
```

**Testing MongoDB mode**:
```bash
cd ui
# Ensure MONGODB_URI is set in .env.local
npm run dev
```

---

## Files Modified

### Core Changes
- ✅ `ui/src/lib/storage-config.ts` - NEW: Exclusive storage mode logic
- ✅ `ui/src/store/chat-store.ts` - Conditional Zustand persistence
- ✅ `ui/src/components/layout/Sidebar.tsx` - Updated storage indicators
- ✅ `ui/src/app/(app)/chat/page.tsx` - Use new `loadConversationsFromServer()`
- ✅ `ui/src/app/(app)/admin/page.tsx` - Removed hybrid migration tool

### Documentation
- ✅ `docs/storage-modes.md` - NEW: Comprehensive storage mode docs
- ✅ `ui/env.example` - Updated with exclusive storage comments
- ✅ `ui/.env.local` - Clear mode indicator comments
- ✅ `STORAGE_MODE_REFACTOR.md` - This file

### Deprecated (can be removed after testing)
- ⚠️ `ui/src/lib/storage-mode.ts` - Replaced by `storage-config.ts`
- ⚠️ `ui/src/app/api/admin/migrate-conversations/route.ts` - Old migration API

---

## Benefits

### For Users
✅ **Clear data location** - No confusion about where conversations live
✅ **Predictable behavior** - One storage mode, not two
✅ **Visual indicators** - Always know what mode you're in
✅ **No surprises** - Data doesn't mysteriously appear/disappear

### For Developers
✅ **Simpler logic** - No dual-write complexity
✅ **Fewer bugs** - No sync race conditions
✅ **Easier testing** - Test one mode at a time
✅ **Better performance** - No unnecessary localStorage writes in MongoDB mode

### For Admins
✅ **MongoDB is source of truth** - No localStorage confusion
✅ **Better analytics** - All data in one place
✅ **Team features work** - Sharing, collaboration enabled

---

## Testing Checklist

### localStorage Mode
- [ ] Conversations persist in browser
- [ ] Conversations NOT sent to server
- [ ] Sidebar shows "Local Storage Mode"
- [ ] Admin features disabled
- [ ] Works without MongoDB configured

### MongoDB Mode
- [ ] Conversations saved to MongoDB
- [ ] localStorage NOT used for persistence
- [ ] Sidebar shows "MongoDB Mode"
- [ ] Admin features enabled
- [ ] Sharing/teams work

### Mode Switching
- [ ] localStorage → MongoDB: Data migrates cleanly
- [ ] MongoDB → localStorage: Graceful fallback
- [ ] No data loss
- [ ] Clear error messages

---

## Rollout Plan

### Phase 1: Internal Testing ✅ (Current)
- Test with dev team
- Verify both modes work
- Check migration paths

### Phase 2: Staged Rollout
- Enable for power users first
- Monitor for issues
- Gather feedback

### Phase 3: Full Deployment
- Update all environments
- Update documentation
- Train support team

---

## Support

### Common Issues

**Q: My conversations disappeared!**
A: Check storage mode. If you switched from MongoDB → localStorage, you need to re-enable MongoDB.

**Q: I see old conversations but not new ones**
A: You may have switched storage modes. Check `.env.local` and restart.

**Q: Can I use both at once?**
A: No. Exclusive storage mode prevents confusion.

---

## Future Enhancements

- [ ] Automatic migration wizard in UI
- [ ] Export/import conversations
- [ ] Storage mode selector in settings
- [ ] Data sync across devices (MongoDB mode)

---

## Credits

**Author**: Sri Aradhyula (sraradhy@cisco.com)
**Date**: 2026-01-30
**Version**: v1.0 (Exclusive Storage Mode)
**Related**: Admin Dashboard, Team Features, Storage Architecture
