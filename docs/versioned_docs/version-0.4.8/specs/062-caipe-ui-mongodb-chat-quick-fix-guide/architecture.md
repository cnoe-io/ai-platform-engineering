---
sidebar_position: 1
id: 062-caipe-ui-mongodb-chat-quick-fix-guide-architecture
sidebar_label: Architecture
---

# Architecture: CAIPE UI MongoDB Chat Quick Fix Guide

**Date**: 2026-02-03

## Solution: Logout and Login Again

### Step 1: Clear Everything

**Open Browser Console (F12) and run these commands:**

```javascript
// 1. Clear localStorage (old conversations)
localStorage.removeItem('caipe-chat-history');
console.log("✅ Cleared chat history");

// 2. Clear all storage
localStorage.clear();
sessionStorage.clear();
console.log("✅ Cleared all storage");

// 3. Reload to log out
window.location.href = '/login';
```

### Step 2: Log Back In

1. You'll be redirected to your SSO provider
2. Complete authentication
3. You'll land on the home page
4. **Fresh session with valid token!** ✅

### Step 3: Verify MongoDB is Running

Open a **new terminal**:

```bash
cd /path/to/ai-platform-engineering
docker-compose --profile caipe-ui-dev ps mongodb
```

**If not running:**

```bash
docker-compose --profile caipe-ui-dev up -d mongodb mongo-express
```

Wait for MongoDB to start (about 30 seconds).

### Step 4: Create NEW Conversation

1. Click **"New Chat"** in sidebar
2. **Watch the URL** - It should change to:
   ```
   http://localhost:3000/chat/550e8400-e29b-41d4-a716-446655440000
   ```
   ☝️ That long UUID means it's in MongoDB!

3. If you see loading screen: **Wait for it** - MongoDB creation takes a moment

### Step 5: Test Share

1. Send a test message in the new conversation
2. **Hover over conversation** in sidebar
3. Click **Share icon** (🔗)
4. **Modal should appear centered on screen**
5. **Should NOT get "Conversation not found" error!**


## Verify It's Working

### Check 1: User Initialized in MongoDB

```javascript
// In browser console
fetch('/api/users/me')
  .then(res => res.json())
  .then(data => console.log("✅ Your user profile:", data))
  .catch(err => console.error("❌ Failed:", err));
```

### Check 2: Conversation Created

```javascript
// After creating new chat, get conversation ID from URL
const convId = window.location.pathname.split('/').pop();
fetch(`/api/chat/conversations/${convId}`)
  .then(res => res.json())
  .then(data => console.log("✅ Conversation in MongoDB:", data))
  .catch(err => console.error("❌ Not in MongoDB:", err));
```

### Check 3: Share API Works

```javascript
// Test share endpoint
const convId = window.location.pathname.split('/').pop();
fetch(`/api/chat/conversations/${convId}/share`)
  .then(res => res.json())
  .then(data => console.log("✅ Share info loaded:", data))
  .catch(err => console.error("❌ Share failed:", err));
```


## If Still Not Working

### Authentication Issues

**Symptoms:**
- Can't create conversations
- API calls return 401 or redirect to login
- Token refresh errors

**Solution:**
```bash
# Clear ALL browser data
1. Open Chrome DevTools (F12)
2. Application tab
3. Clear storage button
4. Check "Cookies", "Local storage", "Session storage"
5. Click "Clear site data"
6. Close browser completely
7. Reopen and login again
```

### MongoDB Issues

**Symptoms:**
- "Conversation not found" even with new conversations
- Creating conversation hangs forever
- No error messages, just loading

**Solution:**
```bash
# Restart MongoDB
docker-compose --profile caipe-ui-dev down mongodb
docker-compose --profile caipe-ui-dev up -d mongodb

# Wait 30 seconds, then check
docker-compose logs mongodb | tail -20

# Should see: "Waiting for connections"
```

### UI Dev Server Issues

**Symptoms:**
- Code changes not appearing
- Old components still showing
- Cached build artifacts

**Solution:**
```bash
cd ui

# Clear Next.js cache
rm -rf .next

# Restart dev server
npm run dev
```


## Related

- Spec: [spec.md](./spec.md)
