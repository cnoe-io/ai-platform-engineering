---
sidebar_position: 1
id: 055-caipe-ui-exclusive-storage-summary-architecture
sidebar_label: Architecture
---

# Architecture: ✅ Exclusive Storage Mode - Implementation Complete

**Date**: 2026-01-30

## 📦 Storage Mode Selection

### MongoDB Mode (Production)
**Trigger**: `MONGODB_URI` is set in `.env.local`

```bash
# ui/.env.local
MONGODB_URI=mongodb://admin:changeme@localhost:27017
MONGODB_DATABASE=caipe
```

**Behavior**:
- ✅ All conversations saved to MongoDB
- ✅ No localStorage persistence
- ✅ Shareable conversations
- ✅ Team collaboration enabled
- ✅ Admin dashboard fully functional
- ✅ DAU/MAU analytics

**UI Indicator**:
```
✅ MongoDB Mode
   Persistent • Shareable • Teams
```

---

### localStorage Mode (Development/Demo)
**Trigger**: `MONGODB_URI` is NOT set

```bash
# ui/.env.local
# MONGODB_URI=  ← commented out or missing
```

**Behavior**:
- ✅ All conversations saved to browser localStorage
- ✅ No MongoDB API calls
- ✅ Fast, zero configuration
- ⚠️ Not shareable
- ⚠️ No team features
- ⚠️ Lost if browser cleared

**UI Indicator**:
```
⚠️ Local Storage Mode
   Browser-only • Not shareable
```

---


## 🔧 Implementation Details

### Core Files

#### 1. `ui/src/lib/storage-config.ts` (NEW)
Replaces old `storage-mode.ts` with simpler, synchronous logic:

```typescript
export const IS_MONGODB_CONFIGURED = !!(MONGODB_URI && MONGODB_DATABASE);

export function getStorageMode(): 'mongodb' | 'localStorage' {
  return IS_MONGODB_CONFIGURED ? 'mongodb' : 'localStorage';
}

export function shouldUseLocalStorage(): boolean {
  return !IS_MONGODB_CONFIGURED;
}
```

#### 2. `ui/src/store/chat-store.ts` (UPDATED)
Conditional Zustand persistence:

```typescript
// Exclusive persistence based on storage mode
export const useChatStore = shouldUseLocalStorage()
  ? create<ChatState>()(persist(storeImplementation, { ... }))  // localStorage mode
  : create<ChatState>()(storeImplementation);                   // MongoDB mode
```

#### 3. CRUD Operations (UPDATED)
All operations now check storage mode:

```typescript
createConversation: () => {
  const storageMode = getStorageMode();
  
  if (storageMode === 'mongodb') {
    await apiClient.createConversation({ ... });
  }
  
  // Local state update (only persisted in localStorage mode)
  set({ conversations: [...] });
}
```

### Updated Components

- ✅ `Sidebar.tsx` - Shows storage mode indicator
- ✅ `chat/page.tsx` - Uses synchronous `getStorageMode()`
- ✅ `chat/[uuid]/page.tsx` - Simplified storage detection
- ✅ `use-caipe-health.ts` - Removed async storage check
- ✅ `admin/page.tsx` - Removed hybrid migration tool

### Documentation

- ✅ `docs/storage-modes.md` - Comprehensive guide
- ✅ `ui/env.example` - Clear storage mode comments
- ✅ `ui/.env.local` - Annotated with current mode
- ✅ `STORAGE_MODE_REFACTOR.md` - Technical details
- ✅ `EXCLUSIVE_STORAGE_SUMMARY.md` - This file

---


## 🔍 Verification Commands

### Check Current Storage Mode
```bash
# Server logs on startup
cd ui && npm run dev
# Look for: "📦 Storage Mode: mongodb" or "localStorage"
```

### Check Browser Storage (localStorage mode)
```javascript
// In browser DevTools console
localStorage.getItem('caipe-chat-history')
```

### Check MongoDB (MongoDB mode)
```bash
mongo mongodb://localhost:27017
use caipe
db.conversations.count()
db.conversations.find().pretty()
```

---


## Related

- Spec: [spec.md](./spec.md)
