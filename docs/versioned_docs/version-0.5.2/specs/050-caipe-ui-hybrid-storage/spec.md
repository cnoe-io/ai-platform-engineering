---
sidebar_position: 2
sidebar_label: Specification
title: "2026-01-29: Hybrid Storage System"
---

# Hybrid Storage System

The CAIPE UI supports **two storage modes** with automatic fallback for resilient operation:

1. **MongoDB Mode** (Default) - Persistent storage with sharing and collaboration features
2. **localStorage Mode** (Fallback) - Local-only storage when MongoDB is unavailable

## User Experience

### MongoDB Mode Indicators

- ✅ No special indicators (default expected mode)
- Sidebar syncs conversations from MongoDB on load
- New conversations appear immediately in sidebar

### localStorage Mode Indicators

- 📦 **Amber banner** in sidebar: "Local Storage Mode"
- 📦 **Small badge** in chat view: "Local storage mode"
- Console logs indicate fallback: `[ChatStore] MongoDB unavailable - using localStorage only`


## Testing Strategy

### Test MongoDB Mode

```bash
# Start MongoDB
docker run -d --name caipe-mongo -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=changeme \
  mongo:7.0

# Verify in UI
# ✅ No storage mode banner
# ✅ Conversations persist across browser sessions
```

### Test localStorage Mode

```bash
# Stop MongoDB
docker stop caipe-mongo

# Verify in UI
# ✅ Amber "Local Storage Mode" banner appears
# ✅ Conversations work but are local-only
# ✅ No errors in console
```

### Test Automatic Fallback

```bash
# Start with MongoDB running
# Create some conversations

# Stop MongoDB mid-session
docker stop caipe-mongo

# Continue using the app
# ✅ Existing conversations still visible (from Zustand cache)
# ✅ New conversations save to localStorage
# ✅ Banner appears indicating local mode
```


## Best Practices

### For Development

```bash
# Option 1: Quick local development (no MongoDB needed)
# Just comment out MongoDB env vars
# Pros: Fast setup, no dependencies
# Cons: Local-only data

# Option 2: Full-stack development (with MongoDB)
make caipe-mongodb  # Start MongoDB
# Set MongoDB env vars
# Pros: Full feature testing
# Cons: Requires Docker
```

### For Production

**Always use MongoDB mode** in production:

- ✅ Persistent storage
- ✅ Multi-user support
- ✅ Sharing features
- ✅ Server-side search
- ✅ Data backups possible

### For Demos

**localStorage mode is fine** for single-user demos:

- ✅ No infrastructure needed
- ✅ Fast setup
- ✅ Core features work
- ⚠️ Data is local-only


## Summary

The hybrid storage system provides:

- ✅ **Zero-config local development** - No MongoDB required to start coding
- ✅ **Production-ready persistence** - MongoDB for shared environments
- ✅ **Graceful degradation** - Continues working if MongoDB fails
- ✅ **Automatic detection** - No manual configuration needed
- ✅ **User transparency** - Clear indicators of storage mode
- ✅ **No data loss** - Cached data remains accessible

**Bottom line**: The app "just works" regardless of backend availability! 🎉


## Related

- Architecture: [architecture.md](./architecture.md)
