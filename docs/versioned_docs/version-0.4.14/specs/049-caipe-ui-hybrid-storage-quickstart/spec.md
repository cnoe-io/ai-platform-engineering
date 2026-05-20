---
sidebar_position: 2
sidebar_label: Specification
title: "2026-01-29: Hybrid Storage Quick Start"
---

# Hybrid Storage Quick Start

## Testing Strategy

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


## Related

- Architecture: [architecture.md](./architecture.md)
