# MongoDB Chat History Migration Guide

## Background

As of January 2026, CAIPE has migrated from localStorage-only chat history to MongoDB-backed persistent storage. This enables:
- ✅ Shareable conversation links
- ✅ Cross-device chat history
- ✅ User collaboration features
- ✅ Persistent chat data

## For Users

### Old Conversations (Before MongoDB)

**Conversations created before this migration exist only in your browser's localStorage and CANNOT be shared.**

**What this means:**
- Old conversations are visible in your chat history
- You can still view and continue these conversations
- **Sharing feature will NOT work** for old conversations
- Attempting to share will show: "This conversation was created before MongoDB integration"

### New Conversations (After MongoDB)

**All new conversations created after this update are automatically stored in MongoDB.**

**How to create a new shareable conversation:**
1. Click "New Chat" button in the sidebar
2. System creates conversation in MongoDB
3. You'll be redirected to `/chat/[uuid]`
4. Conversation is immediately shareable ✅

### Migration Options

#### Option 1: Start Fresh (Recommended)
- Create new conversations going forward
- Old conversations remain view-only in your browser
- Simplest approach for most users

#### Option 2: Clear Local Storage
If you want to start completely fresh:

```javascript
// In browser console (F12)
localStorage.removeItem('caipe-chat-history');
window.location.reload();
```

**⚠️ Warning:** This will delete all local conversations permanently.

#### Option 3: Manual Migration (Advanced)
If you have important old conversations:

1. Open the conversation you want to keep
2. Copy all messages
3. Create a new conversation (Click "New Chat")
4. Paste/recreate the important content
5. The new conversation will be in MongoDB and shareable

## For Developers

### Architecture Changes

**Before:**
```
User → Zustand Store → localStorage
```

**After:**
```
User → Next.js API Routes → MongoDB → Zustand Store (cache)
```

### Key Files Changed

- `ui/src/app/(app)/chat/page.tsx` - Creates MongoDB conversations
- `ui/src/app/api/chat/conversations/route.ts` - POST endpoint
- `ui/src/components/layout/Sidebar.tsx` - New Chat button fixed
- `ui/src/lib/mongodb.ts` - MongoDB connection utility
- `ui/src/types/mongodb.ts` - TypeScript interfaces

### Database Schema

**Collections:**
- `users` - User profiles and SSO info
- `conversations` - Chat conversations with UUIDs
- `messages` - Individual messages linked to conversations
- `user_settings` - User preferences
- `conversation_bookmarks` - Saved conversations
- `sharing_access` - Conversation sharing permissions

### Environment Setup

Required environment variables:

```bash
# .env
MONGODB_URI=mongodb://admin:changeme@mongodb:27017
MONGODB_DATABASE=caipe

# ui/.env.local
MONGODB_URI=mongodb://admin:changeme@localhost:27017
MONGODB_DATABASE=caipe
```

### Running MongoDB Locally

```bash
# Start MongoDB with docker-compose
docker-compose --profile caipe-ui-dev up -d mongodb mongo-express

# Access mongo-express UI
open http://localhost:8081
```

### API Endpoints

**Chat Conversations:**
- `GET /api/chat/conversations` - List conversations
- `POST /api/chat/conversations` - Create conversation
- `GET /api/chat/conversations/[id]` - Get conversation
- `PUT /api/chat/conversations/[id]` - Update conversation
- `DELETE /api/chat/conversations/[id]` - Delete conversation
- `GET /api/chat/conversations/[id]/messages` - Get messages
- `POST /api/chat/conversations/[id]/messages` - Add message
- `GET /api/chat/conversations/[id]/share` - Get sharing info
- `POST /api/chat/conversations/[id]/share` - Share conversation

**Users:**
- `GET /api/users/me` - Get current user
- `PUT /api/users/me` - Update current user
- `GET /api/users/search?q=email` - Search users

**Settings:**
- `GET /api/settings` - Get user settings
- `PUT /api/settings` - Update user settings

### Handling Legacy Conversations

```typescript
// Check if conversation exists in MongoDB
const response = await fetch(`/api/chat/conversations/${conversationId}`);
if (response.status === 404) {
  // Legacy conversation, handle gracefully
  console.warn("Legacy conversation detected");
}
```

### Future Enhancements

- [ ] Background sync of localStorage to MongoDB
- [ ] Bulk migration tool for users
- [ ] Export/import conversation feature
- [ ] Conversation merge functionality

## Troubleshooting

### "Conversation not found" when sharing

**Cause:** Trying to share a legacy (localStorage-only) conversation

**Solution:** Create a new conversation using "New Chat" button

### MongoDB connection failed

**Cause:** MongoDB service not running or wrong credentials

**Solution:**
```bash
# Check MongoDB is running
docker ps | grep mongodb

# Restart MongoDB
docker-compose --profile caipe-ui-dev up -d mongodb

# Check logs
docker-compose logs mongodb
```

### Conversations not appearing in sidebar

**Cause:** Mismatch between localStorage and MongoDB

**Solution:**
1. Clear browser cache
2. Reload page
3. MongoDB conversations should load from `/api/chat/conversations`

## Support

For issues or questions:
- Check GitHub issues
- Contact: sraradhy@cisco.com
- Team: Platform Engineering Team

---

**Last Updated:** January 29, 2026
