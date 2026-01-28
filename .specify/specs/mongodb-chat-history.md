# Spec: MongoDB Chat History and Shareable Links

**Feature ID**: `mongodb-chat-history`  
**Status**: 🟡 Planning  
**Priority**: High  
**Assignee**: TBD  
**Created**: 2026-01-28  
**Updated**: 2026-01-28

---

## Overview

Enable persistent chat history storage in MongoDB with shareable links, allowing users to access conversations across devices and collaborate with teammates.

## Motivation

### Problem Statement

Currently, CAIPE stores chat history only in browser localStorage, which:
- Cannot be accessed from other devices
- Cannot be shared with team members
- Has storage limits (~5-10MB)
- Provides no analytics or usage tracking
- Offers no user management or access control

### User Story

As a **CAIPE user**, I want to:
1. Access my chat history from any device
2. Share specific conversations with teammates via shareable links
3. See who has access to shared conversations
4. Control permissions for shared conversations
5. Store unlimited conversation history

### Success Metrics

- ✅ Users can access chats from multiple devices
- ✅ Share links work for authorized users
- ✅ Unauthorized users are blocked with clear UI
- ✅ Zero data loss during migration from localStorage
- ✅ API response time < 300ms for chat operations
- ✅ 100% of conversations synced to backend

## Related Documents

- **ADR**: [`docs/docs/changes/2026-01-28-mongodb-chat-history-and-sharing.md`](../../docs/docs/changes/2026-01-28-mongodb-chat-history-and-sharing.md)
- **Beads Issues**: TBD (will create after this spec)

---

## Design

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                    │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  /chat/[id]/page.tsx                               │ │
│  │  - Load conversation by UUID                       │ │
│  │  - Show share badge and controls                   │ │
│  │  - Validate user access                            │ │
│  └────────────────────────────────────────────────────┘ │
│                      │                                   │
│  ┌────────────────────────────────────────────────────┐ │
│  │  chat-store.ts (Zustand)                           │ │
│  │  - In-memory state                                 │ │
│  │  - Syncs with backend                              │ │
│  │  - Falls back to localStorage                      │ │
│  └────────────────────────────────────────────────────┘ │
│                      │                                   │
│  ┌────────────────────────────────────────────────────┐ │
│  │  chat-api.ts (API Client)                          │ │
│  │  - createConversation()                            │ │
│  │  - shareConversation()                             │ │
│  │  - getShareStatus()                                │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTP/REST
                       ▼
┌──────────────────────────────────────────────────────────┐
│              Backend (FastAPI/Starlette)                 │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  /api/chat/conversations/*                         │ │
│  │  - Conversation CRUD operations                    │ │
│  │  - Share management                                │ │
│  │  - Access validation                               │ │
│  └────────────────────────────────────────────────────┘ │
│                      │                                   │
│  ┌────────────────────────────────────────────────────┐ │
│  │  ChatService (Business Logic)                      │ │
│  │  - validateAccess()                                │ │
│  │  - shareWithUsers()                                │ │
│  └────────────────────────────────────────────────────┘ │
│                      │                                   │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Motor (MongoDB Driver)                            │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│                      MongoDB                             │
│  ┌──────────────────┐  ┌──────────────────────────────┐ │
│  │  users           │  │  conversations               │ │
│  │  - email (unique)│  │  - _id (UUID from frontend)  │ │
│  │  - preferences   │  │  - created_by (user_id)      │ │
│  │  - last_login    │  │  - shared_with []            │ │
│  └──────────────────┘  │  - messages []               │ │
│                        │  - visibility                │ │
│                        └──────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### MongoDB Schema

#### Users Collection

```javascript
{
  _id: UUID("user-uuid"),
  email: "sraradhy@cisco.com",
  name: "Sri Aradhyula",
  avatar_url: "https://...",
  preferences: {
    theme: "minimal",
    font_family: "system",
    default_agents: ["argocd", "aws"]
  },
  created_at: ISODate(),
  last_login: ISODate()
}
```

**Indexes:**
- `email` (unique)
- `created_at`

#### Conversations Collection

```javascript
{
  _id: UUID("conversation-uuid"),  // Same as frontend UUID
  title: "How to deploy to ArgoCD?",
  created_by: UUID("user-uuid"),
  created_at: ISODate(),
  updated_at: ISODate(),
  
  shared_with: [
    {
      user_id: UUID("colleague-uuid"),
      user_email: "colleague@cisco.com",
      shared_at: ISODate(),
      shared_by: UUID("user-uuid"),
      permissions: ["read"]
    }
  ],
  
  visibility: "private",  // "private" | "team" | "public"
  
  messages: [
    {
      id: UUID("msg-uuid"),
      role: "user" | "assistant",
      content: "message text",
      timestamp: ISODate(),
      turn_id: "turn-123-abc",
      is_final: true,
      feedback: {
        rating: "positive" | "negative",
        comment: "...",
        submitted_at: ISODate()
      }
    }
  ],
  
  tags: ["argocd", "deployment"],
  total_messages: 10,
  last_message_at: ISODate()
}
```

**Indexes:**
- `created_by` (for user's conversations)
- `created_at` (for sorting)
- `updated_at` (for sorting)
- `shared_with.user_id` (for finding shared conversations)
- `visibility` (for filtering)

### API Endpoints

#### Conversation Management

```
POST   /api/chat/conversations           # Create conversation
GET    /api/chat/conversations           # List conversations
GET    /api/chat/conversations/:id       # Get conversation
PUT    /api/chat/conversations/:id       # Update conversation
DELETE /api/chat/conversations/:id       # Delete conversation
POST   /api/chat/conversations/:id/messages  # Add message
```

#### Sharing Management

```
POST   /api/chat/conversations/:id/share          # Share with users
GET    /api/chat/conversations/:id/share          # Get share status
DELETE /api/chat/conversations/:id/share/:userId  # Remove access
```

#### User Management

```
GET    /api/users/me                    # Get current user
PUT    /api/users/me/preferences        # Update preferences
```

### Frontend Components

#### 1. ShareDialog Component

```typescript
// ui/src/components/chat/ShareDialog.tsx
interface ShareDialogProps {
  conversationId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ShareDialog({ conversationId, isOpen, onClose }: ShareDialogProps) {
  const [shareStatus, setShareStatus] = useState<ShareStatus | null>(null);
  const [emailInput, setEmailInput] = useState("");
  
  // Features:
  // - Show creator info
  // - List users with access
  // - Add new users by email
  // - Remove access buttons
  // - Copy share link button
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      {/* Share UI */}
    </Dialog>
  );
}
```

#### 2. ShareBadge Component

```typescript
// ui/src/components/chat/ShareBadge.tsx
interface ShareBadgeProps {
  conversation: Conversation;
  onClick: () => void;
}

export function ShareBadge({ conversation, onClick }: ShareBadgeProps) {
  const isShared = conversation.shared_with.length > 0;
  
  return (
    <Badge 
      variant={isShared ? "secondary" : "outline"}
      onClick={onClick}
      className="cursor-pointer"
    >
      {isShared 
        ? `Shared with ${conversation.shared_with.length} user${conversation.shared_with.length > 1 ? 's' : ''}`
        : "Private"
      }
    </Badge>
  );
}
```

#### 3. Updated Chat Route

```typescript
// ui/src/app/(app)/chat/[id]/page.tsx
export default async function ChatPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  
  // Load conversation from backend
  const conversation = await chatAPI.getConversation(params.id);
  
  // Validate access
  if (!conversation || !canUserAccessConversation(session.user, conversation)) {
    return <UnauthorizedPage />;
  }
  
  return (
    <ChatPageContent 
      conversationId={params.id}
      initialConversation={conversation}
    />
  );
}
```

### Access Control Logic

```typescript
function canUserAccessConversation(user: User, conversation: Conversation): boolean {
  // Creator always has access
  if (conversation.created_by === user.id) {
    return true;
  }
  
  // Check if user is in shared_with list
  const sharedUser = conversation.shared_with.find(
    (share) => share.user_id === user.id
  );
  
  return sharedUser !== undefined;
}
```

---

## Implementation Phases

### Phase 1: Backend Foundation ✅

**Goal**: Set up MongoDB and core API endpoints

**Tasks:**
1. ✅ Add MongoDB connection with Motor
2. ✅ Create `users` collection with indexes
3. ✅ Create `conversations` collection with indexes
4. ✅ Implement user creation/lookup on login
5. ✅ Implement conversation CRUD endpoints
6. ✅ Add authentication middleware to chat endpoints

**Acceptance Criteria:**
- [ ] MongoDB container running in docker-compose
- [ ] Motor connected with connection pooling
- [ ] Users auto-created on first login
- [ ] All conversation CRUD endpoints work
- [ ] Endpoints return 401 if not authenticated
- [ ] Indexes created for performance

**Deliverables:**
- `ai_platform_engineering/database/mongodb.py` (connection manager)
- `ai_platform_engineering/services/chat_service.py` (business logic)
- `ai_platform_engineering/api/routes/chat.py` (FastAPI routes)

### Phase 2: Sharing Implementation ✅

**Goal**: Enable conversation sharing with access control

**Tasks:**
1. ✅ Implement share endpoints (POST, GET, DELETE)
2. ✅ Add access validation middleware
3. ✅ Create share notification system (optional)
4. ✅ Add audit logging for share actions

**Acceptance Criteria:**
- [ ] Users can share conversations by email
- [ ] Share links work for authorized users
- [ ] Unauthorized users see 403 error
- [ ] Share status UI shows all users with access
- [ ] Can remove share access
- [ ] All share actions logged

**Deliverables:**
- Share endpoints in `chat.py`
- Access validation in `chat_service.py`
- Audit log schema

### Phase 3: Frontend Integration ✅

**Goal**: Update UI to use MongoDB backend

**Tasks:**
1. ✅ Create ChatAPI client (`ui/src/lib/chat-api.ts`)
2. ✅ Update chat-store.ts to sync with backend
3. ✅ Add ShareDialog component
4. ✅ Add ShareBadge component
5. ✅ Update chat routes to load by UUID
6. ✅ Add sync status indicators
7. ✅ Add error handling and retries

**Acceptance Criteria:**
- [ ] New conversations auto-sync to backend
- [ ] Conversations load from backend on page load
- [ ] Share dialog shows current access list
- [ ] Can add/remove users from share dialog
- [ ] Share badge shows correct status
- [ ] UUID-based routes work (`/chat/:id`)
- [ ] Loading states during API calls
- [ ] Error messages for failed operations

**Deliverables:**
- `ui/src/lib/chat-api.ts`
- `ui/src/components/chat/ShareDialog.tsx`
- `ui/src/components/chat/ShareBadge.tsx`
- `ui/src/app/(app)/chat/[id]/page.tsx`
- Updated `chat-store.ts`

### Phase 4: Migration & Testing ✅

**Goal**: Migrate existing data and ensure quality

**Tasks:**
1. ✅ Create migration script for localStorage → MongoDB
2. ✅ Add "Sync to Cloud" button in settings
3. ✅ Write integration tests for API
4. ✅ Write E2E tests for sharing flow
5. ✅ Add monitoring and logging
6. ✅ Performance testing

**Acceptance Criteria:**
- [ ] Migration script successfully moves localStorage data
- [ ] No data loss during migration
- [ ] All API endpoints have integration tests
- [ ] E2E tests cover sharing scenarios
- [ ] API response times < 300ms (p95)
- [ ] Error rates < 0.1%

**Deliverables:**
- `scripts/migrate-chat-history.py`
- `integration/test_chat_api.py`
- `ui/tests/e2e/chat-sharing.spec.ts`
- Grafana dashboard for chat metrics

---

## Technical Decisions

### Why MongoDB?

**Pros:**
- ✅ Document model matches chat structure (nested messages)
- ✅ Flexible schema for A2A events and metadata
- ✅ Good performance for read-heavy workloads
- ✅ Easy to scale horizontally
- ✅ Built-in aggregation for analytics

**Cons:**
- ❌ No ACID transactions (not needed for chat)
- ❌ More complex joins (minimal join needs)

### Why Motor (async driver)?

- FastAPI is async, Motor integrates seamlessly
- Better performance than blocking drivers
- Supports connection pooling out-of-the-box

### Why UUID as _id?

- Frontend generates UUIDs for conversations
- Backend uses same UUID as MongoDB `_id`
- No ID mapping needed
- Share links use same UUID

### Why Not WebSockets for Sync?

**Current approach**: REST API with polling

**Future**: If real-time collaboration needed, add WebSocket support for live updates

---

## Data Flow Examples

### Creating a New Conversation

```
User sends message
    ↓
Frontend: chat-store.createConversation()
    ↓
Frontend: Generate UUID for conversation
    ↓
API: POST /api/chat/conversations { message: "..." }
    ↓
Backend: Create user in MongoDB (if first time)
    ↓
Backend: Insert conversation with message
    ↓
Backend: Return conversation with UUID
    ↓
Frontend: Update store with conversation
    ↓
Frontend: Navigate to /chat/:id
```

### Sharing a Conversation

```
User clicks "Share" button
    ↓
Frontend: Open ShareDialog
    ↓
User enters colleague@cisco.com
    ↓
API: POST /api/chat/conversations/:id/share 
     { user_emails: ["colleague@cisco.com"] }
    ↓
Backend: Look up user by email (create if needed)
    ↓
Backend: Add to shared_with array
    ↓
Backend: Return updated share status
    ↓
Frontend: Update ShareDialog UI
    ↓
Colleague receives notification (future)
```

### Accessing Shared Conversation

```
Colleague opens link: /chat/:id
    ↓
Frontend: GET /api/chat/conversations/:id
    ↓
Backend: Validate user access
    ├─ Is creator? ✅ Return conversation
    ├─ In shared_with? ✅ Return conversation
    └─ Otherwise? ❌ Return 403
    ↓
Frontend: Show conversation or UnauthorizedPage
```

---

## Testing Strategy

### Unit Tests

```python
# tests/unit/test_chat_service.py
def test_create_conversation():
    """Test conversation creation"""
    
def test_share_conversation():
    """Test sharing with valid users"""
    
def test_share_conversation_invalid_email():
    """Test sharing with invalid email"""
    
def test_validate_access_creator():
    """Test creator always has access"""
    
def test_validate_access_shared_user():
    """Test shared user has access"""
    
def test_validate_access_unauthorized():
    """Test unauthorized user blocked"""
```

### Integration Tests

```python
# integration/test_chat_api.py
async def test_create_and_list_conversations():
    """Test full CRUD flow"""
    
async def test_share_flow():
    """Test sharing with another user"""
    
async def test_access_control():
    """Test unauthorized access blocked"""
```

### E2E Tests

```typescript
// ui/tests/e2e/chat-sharing.spec.ts
test('share conversation with colleague', async ({ page }) => {
  // Create conversation
  // Share with colleague
  // Verify colleague can access
  // Verify other user cannot access
});
```

---

## Rollout Plan

### Week 1: Backend Foundation
- Set up MongoDB in docker-compose
- Implement core API endpoints
- Add authentication

### Week 2: Sharing Implementation
- Implement share endpoints
- Add access control
- Add audit logging

### Week 3: Frontend Integration
- Create API client
- Update chat store
- Add share UI components

### Week 4: Migration & Testing
- Create migration script
- Write integration tests
- Performance testing
- Bug fixes

### Week 5: Beta Release
- Deploy to preview environment
- Internal testing with team
- Gather feedback
- Iterate

### Week 6: Production Release
- Deploy to production
- Monitor metrics
- Support users during migration

---

## Monitoring & Observability

### Metrics to Track

```python
# Conversation metrics
conversations_created_total
conversations_shared_total
conversations_accessed_total

# API metrics
chat_api_requests_total
chat_api_request_duration_seconds
chat_api_errors_total

# Database metrics
mongodb_conversations_count
mongodb_users_count
mongodb_query_duration_seconds
```

### Alerts

```yaml
# alerts.yaml
- name: ChatAPIHighLatency
  expr: chat_api_request_duration_seconds{quantile="0.95"} > 0.3
  for: 5m
  
- name: ChatAPIHighErrorRate
  expr: rate(chat_api_errors_total[5m]) > 0.001
  for: 5m
  
- name: MongoDBConnectionFailures
  expr: mongodb_connections_failed_total > 0
  for: 1m
```

---

## Security Considerations

### Authentication
- All endpoints require valid NextAuth session
- User ID extracted from session JWT
- No anonymous access

### Authorization
- Creator has full access (read, write, share, delete)
- Shared users have read access (future: configurable)
- Access validated on every request

### Data Privacy
- Conversations encrypted at rest (MongoDB encryption)
- No public sharing by default
- Users must explicitly share
- Audit log for all share actions

### Rate Limiting
- 100 requests/minute per user for chat endpoints
- 10 share actions/minute per conversation

---

## Future Enhancements

### Phase 5+ (Post-MVP)

1. **Real-time Collaboration**
   - WebSocket support for live updates
   - See who's viewing the conversation
   - Live cursor positions

2. **Advanced Permissions**
   - Read-only vs. edit access
   - Share with teams/groups
   - Time-limited share links

3. **Search & Analytics**
   - Full-text search across conversations
   - Usage analytics dashboard
   - Popular queries and patterns

4. **Export & Import**
   - Export conversations to JSON/Markdown
   - Import conversations from other tools
   - Backup/restore functionality

5. **Conversation Templates**
   - Save conversations as templates
   - Public template library
   - Quick start guides

---

## Open Questions

- ❓ Should we support public share links (no auth required)?
- ❓ Should we add conversation folders/organization?
- ❓ Should we implement conversation forking (branch from specific message)?
- ❓ Should we add reactions to messages?
- ❓ Should we implement conversation archiving vs. deletion?

---

## Status Updates

### 2026-01-28
- ✅ ADR created
- ✅ Spec created
- 🟡 Waiting for Beads issues to be created
- 🔴 Implementation not started

---

## References

- **ADR**: [`docs/docs/changes/2026-01-28-mongodb-chat-history-and-sharing.md`](../../docs/docs/changes/2026-01-28-mongodb-chat-history-and-sharing.md)
- [MongoDB with Motor](https://motor.readthedocs.io/)
- [Zustand Persistence](https://github.com/pmndrs/zustand/blob/main/docs/integrations/persisting-store-data.md)
- [NextAuth Session Management](https://next-auth.js.org/getting-started/client#usesession)
