# Hybrid Storage Quick Start

## TL;DR

The CAIPE UI now supports **both MongoDB and localStorage** with automatic fallback:

- ✅ **With MongoDB**: Persistent storage, multi-device sync, sharing features
- ✅ **Without MongoDB**: Local-only storage, no setup required, fully functional

**No configuration needed** - the app automatically detects and adapts!

## Quick Setup

### Option 1: localStorage Only (Zero Config)

```bash
cd ui
# Comment out or remove MongoDB env vars in .env.local
# MONGODB_URI=...
# MONGODB_DATABASE=...

npm run dev
```

✅ App works immediately with local storage!

### Option 2: MongoDB Enabled (Recommended)

```bash
# Start MongoDB
docker run -d --name caipe-mongo -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=changeme \
  mongo:7.0

# Configure UI
cd ui
cat >> .env.local << EOF
MONGODB_URI=mongodb://admin:changeme@localhost:27017
MONGODB_DATABASE=caipe
EOF

npm run dev
```

✅ App works with persistent storage!

## Visual Indicators

### MongoDB Mode (Default)
```
┌─────────────────────────┐
│ + New Chat              │  No special indicator
│                         │  Conversations synced
│ 💬 Conversation 1       │
│ 💬 Conversation 2       │
└─────────────────────────┘
```

### localStorage Mode (Fallback)
```
┌─────────────────────────┐
│ + New Chat              │
│ ┌─────────────────────┐ │
│ │ 📦 Local Storage    │ │  ← Amber banner
│ │    Mode              │ │
│ └─────────────────────┘ │
│ 💬 Conversation 1       │
│ 💬 Conversation 2       │
└─────────────────────────┘
```

## How to Switch Modes

### From localStorage → MongoDB

1. Start MongoDB: `docker run -d -p 27017:27017 mongo:7.0`
2. Add to `.env.local`:
   ```bash
   MONGODB_URI=mongodb://localhost:27017
   MONGODB_DATABASE=caipe
   ```
3. Refresh browser

✅ Existing local conversations remain accessible  
✅ New conversations saved to MongoDB  
✅ Banner disappears

### From MongoDB → localStorage

1. Stop MongoDB: `docker stop caipe-mongo`
2. Refresh browser

✅ Cached conversations still visible  
✅ New conversations save locally  
✅ Banner appears

## Testing

### Test 1: localStorage Mode Works

```bash
# Don't start MongoDB
cd ui && npm run dev
```

**Expected**:
- ✅ Amber "Local Storage Mode" banner in sidebar
- ✅ Can create new conversations
- ✅ Conversations persist in browser localStorage
- ✅ No errors in console

### Test 2: MongoDB Mode Works

```bash
# Start MongoDB first
docker run -d --name caipe-mongo -p 27017:27017 mongo:7.0

# Configure and start UI
cd ui && npm run dev
```

**Expected**:
- ✅ No storage mode banner
- ✅ Can create new conversations
- ✅ Conversations visible across browser sessions
- ✅ Console shows: "Synced X conversations from MongoDB"

### Test 3: Automatic Fallback

```bash
# Start with MongoDB
docker run -d --name caipe-mongo -p 27017:27017 mongo:7.0
cd ui && npm run dev

# Create some conversations

# Stop MongoDB mid-session
docker stop caipe-mongo

# Try to create new conversation
```

**Expected**:
- ✅ Banner appears after ~1 minute
- ✅ New conversations still work (localStorage)
- ✅ No app crashes or errors
- ✅ Console shows: "Falling back to localStorage"

## Common Scenarios

### Developer Starting Fresh

```bash
git clone repo
cd ui
npm install
npm run dev
```

✅ Works immediately with localStorage (no MongoDB needed)!

### Production Deployment

```yaml
# docker-compose.yml
services:
  mongodb:
    image: mongo:7.0
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD}
    volumes:
      - mongo-data:/data/db

  caipe-ui:
    build: ./ui
    environment:
      MONGODB_URI: mongodb://admin:${MONGO_PASSWORD}@mongodb:27017
      MONGODB_DATABASE: caipe
```

✅ Persistent storage with backups and scaling!

### Demo Environment (No Infrastructure)

```bash
# Just run the UI, no MongoDB needed
cd ui && npm run dev
```

✅ Fully functional for single-user demos!

## Troubleshooting

### Problem: Banner says "Local Storage Mode" but I want MongoDB

**Solution**:
1. Check MongoDB is running: `docker ps | grep mongo`
2. Check `.env.local` has `MONGODB_URI` and `MONGODB_DATABASE`
3. Restart dev server: `npm run dev`
4. Refresh browser

### Problem: Conversations disappear when I close browser

**Cause**: Running in localStorage mode and cleared browser data

**Solutions**:
- Enable MongoDB for persistent storage
- Don't clear browser data
- Use browser's "Don't clear on exit" for this site

### Problem: Old conversations not showing after enabling MongoDB

**Expected behavior**: localStorage conversations don't auto-migrate to MongoDB

**Solution**: They're still in localStorage and will remain accessible. New conversations go to MongoDB.

## Advanced Usage

### Check Current Storage Mode (Console)

```javascript
// In browser console
localStorage.getItem('caipe-chat-history')
// If data exists → localStorage has conversations

// Check storage mode
fetch('/api/chat/conversations?page=1&page_size=1')
  .then(r => r.ok ? 'MongoDB' : 'localStorage')
  .then(console.log)
```

### Manually Sync Conversations

```javascript
// In browser console
// Trigger sync from MongoDB
useChatStore.getState().syncConversationsFromMongoDB()
```

### Force localStorage Mode (Testing)

```javascript
// In mongodb.ts, temporarily set:
export const isMongoDBConfigured = false;

// Or in .env.local, comment out MongoDB vars
```

## Performance Comparison

| Operation | localStorage Mode | MongoDB Mode |
|-----------|------------------|--------------|
| Create conversation | ~1ms ⚡ | ~50ms 🌐 |
| Load conversation | ~1ms ⚡ | ~100ms 🌐 |
| Search conversations | ~10ms (linear) | ~50ms (indexed) |
| First load | ~1ms ⚡ | ~200ms 🌐 |
| Cross-device sync | ❌ | ✅ |
| Storage limit | ~5-10MB | Unlimited |

## Security Notes

### localStorage Mode
- ⚠️ Data stored unencrypted in browser
- ⚠️ Accessible to all JS on same origin
- ⚠️ Cleared if user clears browsing data
- ✅ Fine for demos and development
- ❌ Not recommended for sensitive data

### MongoDB Mode
- ✅ Server-side authentication
- ✅ Encrypted in transit (with TLS)
- ✅ Backed up on server
- ✅ Fine for production
- ✅ Suitable for sensitive data

## What Gets Stored Where?

### Always in localStorage (Zustand Cache)
- Recent conversation list
- Active conversation ID
- UI preferences
- Temporary streaming state

### MongoDB Mode Only
- Full conversation history
- Message content with metadata
- Sharing permissions
- User settings
- Search indexes

### localStorage Mode Only
- Full conversation history (local-only)
- Message content
- No sharing features
- Limited to one device

## Migration Guide

### Moving from localStorage to MongoDB

**No action required!** The hybrid system handles it:

1. localStorage conversations remain in cache
2. New conversations go to MongoDB
3. Old conversations accessible but local-only
4. Over time, MongoDB becomes source of truth

**Optional manual migration**: Export from localStorage, import to MongoDB (tool coming soon)

### Moving from MongoDB to localStorage

**Automatic**: Recent conversations cached in localStorage remain accessible.

**Limitation**: Older conversations not in cache become unavailable until MongoDB restored.

## Summary

| Question | Answer |
|----------|--------|
| **Do I need MongoDB?** | No! App works great with localStorage only |
| **Should I use MongoDB?** | Yes, for production. Optional for dev. |
| **What if MongoDB fails?** | App automatically falls back to localStorage |
| **Can I switch modes?** | Yes, anytime. Data remains accessible. |
| **Is it complicated?** | No! Automatic detection, zero config needed. |

**Recommendation**:
- 🧪 **Development**: localStorage mode (fast setup)
- 🎭 **Demos**: localStorage mode (no infrastructure)
- 🚀 **Production**: MongoDB mode (persistent, scalable)

For more details, see the hybrid storage documentation in the UI source code.
