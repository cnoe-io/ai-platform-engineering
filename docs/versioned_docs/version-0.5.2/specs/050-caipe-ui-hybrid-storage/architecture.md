---
sidebar_position: 1
id: 050-caipe-ui-hybrid-storage-architecture
sidebar_label: Architecture
---

# Architecture: Hybrid Storage System

**Date**: 2026-01-29

## Architecture

```mermaid
graph TD
    A[User Action] --> B{Check MongoDB Available?}
    B -->|Yes| C[MongoDB Storage]
    B -->|No| D[localStorage Storage]
    C --> E[Zustand Store Cache]
    D --> E
    E --> F[UI Update]
    
    C -.Sync.-> E
    D -.Sync.-> E
```


## How It Works

### Storage Mode Detection

The app automatically detects which storage mode to use:

```typescript
import { isMongoDBAvailable, getStorageMode } from '@/lib/storage-mode';

// Check availability (cached for 60s)
const available = await isMongoDBAvailable();

// Get current mode
const mode = await getStorageMode(); // 'mongodb' | 'localStorage'
```

### Automatic Fallback

The system gracefully falls back to localStorage in these scenarios:

1. **MongoDB not configured** - `MONGODB_URI` or `MONGODB_DATABASE` env vars missing
2. **MongoDB connection fails** - Network issues, server down, timeout
3. **API errors** - Any error when trying to access MongoDB endpoints

### Feature Parity

| Feature | MongoDB Mode | localStorage Mode |
|---------|--------------|-------------------|
| Create conversations | ✅ Persistent across devices | ✅ Local device only |
| View chat history | ✅ Synced across devices | ✅ Local device only |
| Search conversations | ✅ Server-side search | ⚠️ Client-side only |
| Share conversations | ✅ Full sharing features | ❌ Not available |
| Export conversations | ✅ Available | ✅ Available |
| Message persistence | ✅ Server-side | ✅ localStorage |
| A2A event streaming | ✅ Both modes | ✅ Both modes |


## Configuration

### Enable MongoDB Mode (Recommended)

Set these environment variables in `ui/.env.local`:

```bash
# MongoDB Configuration
MONGODB_URI=mongodb://admin:changeme@localhost:27017
MONGODB_DATABASE=caipe

# The app will automatically use MongoDB if configured
```

### Run in localStorage-Only Mode

Simply **don't set** the MongoDB environment variables, or comment them out:

```bash
# MONGODB_URI=mongodb://admin:changeme@localhost:27017
# MONGODB_DATABASE=caipe
```

The app will detect this and run in localStorage-only mode with a notification banner.


## Implementation Details

### Key Files

1. **`ui/src/lib/storage-mode.ts`**
   - Detects MongoDB availability
   - Caches results for 60 seconds
   - Provides storage mode API

2. **`ui/src/lib/mongodb.ts`**
   - MongoDB connection utility
   - Gracefully handles missing configuration
   - Exports `isMongoDBConfigured` flag

3. **`ui/src/store/chat-store.ts`**
   - Zustand store with localStorage persistence
   - `syncConversationsFromMongoDB()` - syncs from backend
   - `createConversation()` - creates in both stores

4. **`ui/src/components/layout/Sidebar.tsx`**
   - Displays storage mode indicator
   - Auto-syncs on mount if MongoDB available

### State Synchronization

```typescript
// Zustand Store (localStorage) ←→ MongoDB

// On app start:
1. Zustand hydrates from localStorage
2. Sidebar calls syncConversationsFromMongoDB()
3. If MongoDB available: merge MongoDB data into Zustand
4. If MongoDB unavailable: keep using localStorage only

// On new conversation:
1. Create in Zustand store immediately (instant UI update)
2. Async: Create in MongoDB if available
3. On success: Sync back to ensure consistency
4. On failure: Continue with localStorage only
```


## Migration Path

### From localStorage-Only to MongoDB

When you enable MongoDB for the first time:

1. Existing localStorage conversations remain accessible
2. New conversations are saved to both places
3. Over time, the MongoDB becomes the source of truth
4. localStorage acts as a cache/fallback

**No manual migration needed** - the hybrid system handles it automatically!

### From MongoDB to localStorage-Only

If you disable MongoDB:

1. Recent conversations cached in localStorage remain accessible
2. Older conversations (not in cache) become unavailable
3. All new conversations save to localStorage only
4. To recover: re-enable MongoDB and data will be accessible again


## Troubleshooting

### "Local Storage Mode" Banner Won't Go Away

**Cause**: MongoDB is not accessible

**Solutions**:
1. Check MongoDB is running: `docker ps | grep mongo`
2. Verify `MONGODB_URI` in `.env.local`
3. Check network connectivity: `curl http://localhost:27017`
4. Check browser console for errors

### Conversations Disappear When Switching Browsers

**Cause**: Running in localStorage mode (local-only)

**Solution**: Enable MongoDB to sync across devices

### API Errors About MongoDB

**Expected behavior** if MongoDB not configured. The app continues to work with localStorage.

**To fix**: Set `MONGODB_URI` and `MONGODB_DATABASE` environment variables.


## Security Considerations

### localStorage Mode

- Data stored in browser localStorage (unencrypted)
- Accessible to all JavaScript on same origin
- Not suitable for sensitive data
- Use HTTPS in production

### MongoDB Mode

- Data encrypted in transit (if using TLS)
- Server-side authentication required
- Follow MongoDB security best practices
- Enable authentication in production


## Performance

### localStorage Mode

- ⚡ **Instant** - No network calls
- ⚡ **Low latency** - Local storage access
- ⚠️ **Limited capacity** - ~5-10MB per domain
- ⚠️ **No server-side search** - Linear scan only

### MongoDB Mode

- 🌐 **Network latency** - API round-trip required
- 🔍 **Server-side search** - Indexed queries
- 💾 **Unlimited storage** - No practical limit
- 🔄 **Caching** - Zustand provides local cache


## Monitoring

### Console Logs

```javascript
// Storage mode detection
[StorageMode] MongoDB backend unavailable, using localStorage only

// Conversation creation
[ChatStore] MongoDB unavailable - conversation saved to localStorage only
[ChatStore] Created local conversation with ID: abc-123

// Sync operations
[ChatStore] Synced 15 conversations from MongoDB
[ChatStore] MongoDB unavailable - using localStorage only
```

### Visual Indicators

- 📦 Amber banner in sidebar (localStorage mode)
- ✅ No indicator (MongoDB mode - default)


## Future Enhancements

Potential improvements:

1. **Offline sync** - Queue operations when offline, sync when online
2. **Conflict resolution** - Handle concurrent edits across devices
3. **Selective sync** - Only sync recent conversations
4. **IndexedDB** - Replace localStorage with IndexedDB for larger capacity
5. **Progressive Web App** - Full offline support with service workers


## Related

- Spec: [spec.md](./spec.md)
