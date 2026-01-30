# Storage Modes - CAIPE UI

## Overview

CAIPE UI uses **exclusive storage modes** - MongoDB OR localStorage, never both simultaneously.

## Storage Modes

### 🗄️ MongoDB Mode (Production)

**When**: `MONGODB_URI` and `MONGODB_DATABASE` are configured

**Features**:
- ✅ Persistent across devices
- ✅ Shareable conversations
- ✅ Team collaboration
- ✅ Admin analytics
- ✅ Multi-user support

**Data Location**: MongoDB database (server-side)

**Use Case**: Production deployments, team environments

---

### 💾 localStorage Mode (Development/Demo)

**When**: MongoDB NOT configured

**Features**:
- ✅ Zero configuration
- ✅ Fast local development
- ✅ No database required
- ⚠️ Browser-only (not shareable)
- ⚠️ Lost if browser cleared

**Data Location**: Browser's localStorage

**Use Case**: Local development, demos, testing

---

## Configuration

### Enable MongoDB Mode

In `ui/.env.local`:

```bash
# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=caipe

# Required for admin features
MONGODB_ADMIN_DB=admin
```

### Enable localStorage Mode

Simply **don't set** `MONGODB_URI` - that's it!

---

## How It Works

### Storage Detection

At build/runtime, the app checks:

```typescript
// ui/src/lib/storage-config.ts
export const IS_MONGODB_CONFIGURED = !!(MONGODB_URI && MONGODB_DATABASE);

export function getStorageMode(): 'mongodb' | 'localStorage' {
  return IS_MONGODB_CONFIGURED ? 'mongodb' : 'localStorage';
}
```

### Exclusive Behavior

**In MongoDB mode:**
- ❌ No localStorage persistence
- ✅ All CRUD operations go to MongoDB
- ✅ Server is source of truth

**In localStorage mode:**
- ❌ No MongoDB API calls
- ✅ All CRUD operations use Zustand + localStorage
- ✅ Browser is source of truth

---

## UI Indicators

### Sidebar Indicator

The sidebar shows the current storage mode:

**localStorage Mode:**
```
⚠️ Local Storage Mode
   Browser-only • Not shareable
```

**MongoDB Mode:**
```
✅ MongoDB Mode
   Persistent • Shareable • Teams
```

### Admin Dashboard

MongoDB mode enables:
- User management
- Team management
- Usage statistics (DAU/MAU)
- Conversation sharing

localStorage mode disables admin features.

---

## Migration

### From localStorage to MongoDB

If you previously used localStorage mode and want to migrate:

1. **Export your conversations** (manually copy from browser DevTools → Application → Local Storage)
2. **Configure MongoDB** in `.env.local`
3. **Restart the app**
4. **Use migration API** (if implemented) or manually import

### From MongoDB to localStorage

Simply remove `MONGODB_URI` from `.env.local` and restart.

**Note**: You'll lose access to server-side conversations until MongoDB is re-enabled.

---

## Architecture

### chat-store.ts

```typescript
// Conditional persistence based on storage mode
export const useChatStore = shouldUseLocalStorage()
  ? create<ChatState>()(persist(storeImplementation, { ... })) // With localStorage
  : create<ChatState>()(storeImplementation);                  // Without localStorage
```

### CRUD Operations

```typescript
createConversation: () => {
  const storageMode = getStorageMode();
  
  if (storageMode === 'mongodb') {
    // Create on server
    await apiClient.createConversation({ ... });
  }
  
  // Update local state (persisted only in localStorage mode)
  set({ conversations: [...] });
}
```

---

## Testing

### Test localStorage Mode

```bash
cd ui
# Don't set MONGODB_URI
npm run dev
```

### Test MongoDB Mode

```bash
cd ui
# Set in .env.local
echo "MONGODB_URI=mongodb://localhost:27017" >> .env.local
echo "MONGODB_DATABASE=caipe" >> .env.local
npm run dev
```

---

## FAQ

**Q: Can I use both MongoDB and localStorage simultaneously?**
A: No. The app uses exclusive storage mode to avoid confusion.

**Q: What happens to my localStorage conversations when I enable MongoDB?**
A: They remain in localStorage but won't be used. Use migration API to transfer them.

**Q: Can I switch between modes without losing data?**
A: 
- localStorage → MongoDB: Use migration API
- MongoDB → localStorage: Export data first

**Q: How do I know which mode I'm in?**
A: Check the sidebar indicator or server startup logs:
```
📦 Storage Mode: mongodb
   ✅ MongoDB configured - using persistent storage
```

---

## Best Practices

### Development
- Use **localStorage mode** for quick iteration
- No database setup required
- Fast startup

### Production
- Use **MongoDB mode** for persistence
- Enable team features
- Admin analytics

### Testing
- Test both modes in CI/CD
- Verify exclusive behavior
- Check migration paths
