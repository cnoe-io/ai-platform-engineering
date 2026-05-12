---
sidebar_position: 1
id: 060-caipe-ui-test-share-feature-architecture
sidebar_label: Architecture
---

# Architecture: Test Share Feature - Step by Step

**Date**: 2026-01-30

## Debugging

### Check if Conversation Exists in MongoDB

**Browser Console:**

```javascript
// Get current conversation ID from URL
const conversationId = window.location.pathname.split('/').pop();
console.log("Current conversation ID:", conversationId);

// Check if it exists in MongoDB
fetch(`/api/chat/conversations/${conversationId}`)
  .then(res => res.json())
  .then(data => console.log("✅ Conversation exists in MongoDB:", data))
  .catch(err => console.error("❌ Conversation NOT in MongoDB:", err));
```

### Check MongoDB Direct Connection

**Terminal:**

```bash
# Connect to MongoDB
docker exec -it ai-platform-engineering-mongodb-1 mongosh -u admin -p changeme

# In MongoDB shell:
use caipe

# List all conversations
db.conversations.find({}).pretty()

# Count conversations
db.conversations.countDocuments()

# Exit
exit
```

### Check MongoDB via mongo-express

1. Open: http://localhost:8081
2. Login: admin / changeme
3. Click "caipe" database
4. Click "conversations" collection
5. You should see your conversations listed

### Common Issues

#### Issue: "MongoDB connection refused"

**Solution:**
```bash
docker-compose --profile caipe-ui-dev up -d mongodb
docker-compose logs mongodb
```

#### Issue: "Conversation not found" even with new conversation

**Check:**
1. MongoDB is running: `docker ps | grep mongodb`
2. Conversation was created via API: Check browser network tab for `POST /api/chat/conversations`
3. Response includes `_id` field
4. URL contains the MongoDB UUID

**Debug API Call:**
```javascript
// In browser console after clicking "New Chat"
fetch('/api/chat/conversations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Test Conversation' })
})
  .then(res => res.json())
  .then(data => console.log("✅ Created:", data))
  .catch(err => console.error("❌ Failed:", err));
```

#### Issue: Share dialog doesn't appear centered

**Check:**
1. Clear browser cache: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
2. Check for z-index conflicts in browser DevTools
3. Verify `document.body` is not styled with `position: relative`

#### Issue: User search returns no results

**Check:**
1. User has logged in at least once: `db.users.find({email: "sraradhy@cisco.com"})`
2. API endpoint works: `curl http://localhost:3000/api/users/search?q=sraradhy`
3. Authentication is working


## Related

- Spec: [spec.md](./spec.md)
