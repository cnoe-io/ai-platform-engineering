---
sidebar_position: 2
sidebar_label: Specification
title: "2026-01-30: Test Share Feature - Step by Step"
---

# Test Share Feature - Step by Step

## Prerequisites

### 1. MongoDB Must Be Running

```bash
# Check if MongoDB is running
docker ps | grep mongodb

# If not running, start it:
cd /Users/sraradhy/cisco/eti/sre/cnoe/ai-platform-engineering
docker-compose --profile caipe-ui-dev up -d mongodb mongo-express

# Verify it's running
docker ps | grep mongodb
# Should see: mongodb and mongo-express containers
```

### 2. UI Dev Server Must Be Running

```bash
cd ui
npm run dev
# Should be running on http://localhost:3000
```


## Testing Steps

### Step 1: Clear Old Conversations (IMPORTANT!)

**Open Browser Console (F12) and run:**

```javascript
// This removes ALL old localStorage conversations
localStorage.removeItem('caipe-chat-history');
console.log("✅ Cleared old conversations");
window.location.reload();
```

**Why?** Old conversations only exist in localStorage and CANNOT be shared. We need to start fresh.

### Step 2: Create a NEW Conversation

1. After page reloads, you should see an empty chat history
2. **Click "New Chat"** button in the sidebar
3. **Wait for redirect** - URL should change to: `http://localhost:3000/chat/[some-uuid]`
4. **Check the UUID format** - It should look like: `550e8400-e29b-41d4-a716-446655440000`

**Expected behavior:**
- Loading spinner appears: "Creating new conversation..."
- Redirects to `/chat/[mongodb-generated-uuid]`
- Chat interface loads

**If this fails:**
- Check browser console for errors
- Check MongoDB is running (Step 1)
- Check API endpoint: `curl http://localhost:3000/api/chat/conversations`

### Step 3: Send a Message

1. Type "test message" in the chat input
2. Send the message
3. Wait for response from CAIPE

**This ensures the conversation is active and has content**

### Step 4: Test Share Button

1. **Hover over the conversation** in the left sidebar
2. You should see two icons appear: **Share (🔗) and Delete (🗑️)**
3. **Click the Share icon (🔗)**

**Expected behavior:**
- Modal dialog appears **centered on screen** (not in sidebar)
- Dark backdrop covers entire viewport
- Dialog shows:
  - "Share Conversation"
  - Conversation title
  - "Share Link" with URL
  - "Copy" button
  - "Add People" search box

**If you see error "Conversation not found":**
- This means you're still using an old conversation
- Go back to Step 1 and clear localStorage
- Create a completely new conversation

### Step 5: Test Copy Link

1. Click the **"Copy"** button next to the share link
2. Button should change to show checkmark: "Copied"
3. Open a new incognito browser window
4. Paste the URL and press Enter

**Expected behavior:**
- New user should see the conversation
- Messages should load from MongoDB

### Step 6: Test User Search

1. In the "Add People" field, type an email: `sraradhy@cisco.com`
2. Wait 300ms for search to trigger
3. If user exists in MongoDB, they should appear in dropdown
4. Click the user to share

**Note:** Users must have logged into CAIPE at least once to appear in search.


## Success Criteria

✅ MongoDB is running  
✅ New conversation created via "New Chat" button  
✅ URL shows MongoDB UUID format  
✅ Share button appears on hover  
✅ Share dialog opens centered on screen  
✅ Can copy link successfully  
✅ Can search for users  
✅ Shared link works in incognito mode  


## Still Having Issues?

### Collect Debug Info

```bash
# 1. Check Docker services
docker ps

# 2. Check MongoDB logs
docker-compose logs mongodb | tail -50

# 3. Check UI dev server logs
# (should be in terminal where `npm run dev` is running)

# 4. Export MongoDB data
docker exec -it ai-platform-engineering-mongodb-1 mongosh -u admin -p changeme --eval "use caipe; db.conversations.find().pretty()" > conversations.json
cat conversations.json
```

### Share Debug Info

Include:
- Browser console errors
- Network tab for failed API calls
- MongoDB logs
- Conversation IDs you're trying to share
- Steps you followed

---

**Last Updated:** January 29, 2026
**Author:** Sri Aradhyula


## Related

- Architecture: [architecture.md](./architecture.md)
