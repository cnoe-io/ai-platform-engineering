# ADR: MongoDB Chat History and Shareable Links

**Date**: 2026-01-28  
**Status**: Proposed  
**Authors**: Sri Aradhyula  
**Related Issues**: TBD (will be created via Beads)

## Context

Currently, CAIPE stores chat history exclusively in browser localStorage via Zustand persistence. This approach has several limitations:

1. **No Persistence Across Devices**: Users cannot access their chat history from different browsers or devices
2. **No Collaboration**: Users cannot share chat conversations with teammates
3. **Limited Storage**: Browser localStorage has size limits (~5-10MB), causing data loss with large conversations
4. **No Analytics**: Cannot track usage patterns, popular queries, or user engagement
5. **No User Management**: No concept of chat ownership or access control

### User Requirements

From the user story, we need to support:

- **Unique Chat URLs**: Each chat has a UUID (e.g., `/chat/330c131a-5970-4278-8d2e-fda4189c7b59`)
- **Chat History Storage**: Persist messages and task history in MongoDB
- **User Preferences**: Store user-specific settings
- **Shareable Links**: UUID-based links that can be shared with other users
- **Access Control**: Track who created the chat and who it's shared with
- **Share Validation**: Validate access when someone accesses a shared link
- **Share UI**: Show UI indicating if chat is shared and with whom

### Current Implementation

```typescript
// ui/src/store/chat-store.ts (Zustand + localStorage)
interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  // ... stored in localStorage as "caipe-chat-history"
}
```

## Decision

We will implement **MongoDB-backed chat history with shareable links and user management**.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Zustand Store (chat-store.ts)                            │  │
│  │  - In-memory state                                        │  │
│  │  - Syncs with backend API                                 │  │
│  │  - Falls back to localStorage for offline support        │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ REST API
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Backend (FastAPI/A2A)                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  New Endpoints:                                           │  │
│  │  - POST   /api/chat/conversations                        │  │
│  │  - GET    /api/chat/conversations                        │  │
│  │  - GET    /api/chat/conversations/:id                    │  │
│  │  - PUT    /api/chat/conversations/:id                    │  │
│  │  - DELETE /api/chat/conversations/:id                    │  │
│  │  - POST   /api/chat/conversations/:id/share              │  │
│  │  - GET    /api/chat/conversations/:id/share              │  │
│  │  - DELETE /api/chat/conversations/:id/share/:userId      │  │
│  │  - POST   /api/chat/conversations/:id/messages           │  │
│  │  - GET    /api/users/me                                  │  │
│  │  - PUT    /api/users/me/preferences                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Motor (async MongoDB driver)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                         MongoDB                                 │
│  ┌─────────────────────┐  ┌─────────────────────────────────┐  │
│  │  conversations      │  │  users                          │  │
│  │  ----------------   │  │  ------                         │  │
│  │  _id: UUID         │  │  _id: UUID                      │  │
│  │  title: string     │  │  email: string (unique)         │  │
│  │  created_by: UUID  │  │  name: string                   │  │
│  │  created_at: Date  │  │  preferences: object            │  │
│  │  updated_at: Date  │  │  created_at: Date               │  │
│  │  messages: [...]   │  │  last_login: Date               │  │
│  │  shared_with: [    │  └─────────────────────────────────┘  │
│  │    {               │                                        │
│  │      user_id: UUID │                                        │
│  │      shared_at: D  │                                        │
│  │      permissions:  │                                        │
│  │        ["read"]    │                                        │
│  │    }               │                                        │
│  │  ]                 │                                        │
│  └─────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
```

### MongoDB Collections

#### 1. `users` Collection

Stores user information and preferences.

```javascript
{
  _id: UUID("user-uuid"),  // Same as SSO user ID
  email: "sraradhy@cisco.com",
  name: "Sri Aradhyula",
  avatar_url: "https://...",
  preferences: {
    theme: "minimal",                    // from caipe-gradient-theme
    font_family: "system",               // from caipe-font-family
    default_agents: ["argocd", "aws"],
    notifications_enabled: true
  },
  created_at: ISODate("2026-01-28T10:00:00Z"),
  last_login: ISODate("2026-01-28T19:24:00Z")
}
```

**Indexes:**
- `email` (unique)
- `created_at`

#### 2. `conversations` Collection

Stores chat conversations with messages and sharing info.

```javascript
{
  _id: UUID("330c131a-5970-4278-8d2e-fda4189c7b59"),  // thread_id/context_id
  title: "howdy",
  created_by: UUID("user-uuid"),
  created_at: ISODate("2026-01-28T19:24:29.942Z"),
  updated_at: ISODate("2026-01-28T19:24:37.020Z"),
  
  // Access control
  shared_with: [
    {
      user_id: UUID("other-user-uuid"),
      user_email: "colleague@cisco.com",
      shared_at: ISODate("2026-01-28T20:00:00Z"),
      shared_by: UUID("user-uuid"),
      permissions: ["read"]  // Future: ["read", "write", "share"]
    }
  ],
  
  // Visibility settings
  visibility: "private",  // "private" | "team" | "public"
  
  // Chat data
  messages: [
    {
      id: UUID("message-uuid"),
      role: "user",
      content: "howdy",
      timestamp: ISODate("2026-01-28T19:24:29.943Z"),
      turn_id: "turn-1769628269943-p8ztc59",
      
      // Not persisted to save space:
      // events: []  // A2A events not stored (too large)
    },
    {
      id: UUID("assistant-msg-uuid"),
      role: "assistant",
      content: "Hey there! 👋 Welcome to the CAIPE ecosystem...",
      timestamp: ISODate("2026-01-28T19:24:29.943Z"),
      turn_id: "turn-1769628269943-p8ztc59",
      is_final: true,
      
      // Optional feedback
      feedback: {
        rating: "positive",  // "positive" | "negative"
        comment: "Very helpful!",
        submitted_at: ISODate("2026-01-28T19:25:00Z")
      }
    }
  ],
  
  // Metadata
  tags: ["devops", "argocd"],
  total_messages: 2,
  last_message_at: ISODate("2026-01-28T19:24:37.020Z")
}
```

**Indexes:**
- `created_by`
- `created_at`
- `updated_at`
- `shared_with.user_id` (for finding shared conversations)
- `visibility`
- `tags`

### API Endpoints

All endpoints require authentication (NextAuth session).

#### Conversation Management

```typescript
// Create new conversation
POST /api/chat/conversations
Request: {
  title?: string;
  message: string;  // Initial message
}
Response: {
  id: string;
  title: string;
  created_at: string;
  messages: Message[];
}

// List user's conversations (owned + shared)
GET /api/chat/conversations
Query: {
  page?: number;
  limit?: number;
  filter?: "owned" | "shared" | "all";
}
Response: {
  conversations: Conversation[];
  total: number;
  page: number;
  limit: number;
}

// Get conversation by ID
GET /api/chat/conversations/:id
Response: Conversation

// Update conversation (title, tags)
PUT /api/chat/conversations/:id
Request: {
  title?: string;
  tags?: string[];
}
Response: Conversation

// Delete conversation
DELETE /api/chat/conversations/:id
Response: { success: boolean }

// Add message to conversation
POST /api/chat/conversations/:id/messages
Request: {
  role: "user" | "assistant";
  content: string;
  turn_id?: string;
}
Response: Message
```

#### Sharing Management

```typescript
// Share conversation with users
POST /api/chat/conversations/:id/share
Request: {
  user_emails: string[];
  permissions: ("read" | "write" | "share")[];
}
Response: {
  shared_with: SharedUser[];
}

// Get share status
GET /api/chat/conversations/:id/share
Response: {
  created_by: User;
  shared_with: SharedUser[];
  visibility: string;
}

// Remove share access
DELETE /api/chat/conversations/:id/share/:userId
Response: { success: boolean }
```

#### User Management

```typescript
// Get current user profile
GET /api/users/me
Response: User

// Update user preferences
PUT /api/users/me/preferences
Request: {
  theme?: string;
  font_family?: string;
  default_agents?: string[];
  notifications_enabled?: boolean;
}
Response: User
```

### Frontend Changes

#### 1. Update chat-store.ts

```typescript
interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  
  // New sync state
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  
  // Actions
  syncWithBackend: () => Promise<void>;
  createConversationOnBackend: (message: string) => Promise<string>;
  shareConversation: (id: string, emails: string[]) => Promise<void>;
  // ...
}
```

#### 2. Add API Client

```typescript
// ui/src/lib/chat-api.ts
export class ChatAPI {
  async createConversation(data: CreateConversationRequest): Promise<Conversation>
  async listConversations(filter?: string): Promise<ConversationList>
  async getConversation(id: string): Promise<Conversation>
  async updateConversation(id: string, data: UpdateConversationRequest): Promise<Conversation>
  async deleteConversation(id: string): Promise<void>
  async shareConversation(id: string, data: ShareRequest): Promise<SharedStatus>
  async getShareStatus(id: string): Promise<SharedStatus>
  async removeShare(id: string, userId: string): Promise<void>
  async addMessage(id: string, message: MessageRequest): Promise<Message>
}
```

#### 3. Add Share UI Components

```typescript
// ui/src/components/chat/ShareDialog.tsx
export function ShareDialog({ conversationId }: { conversationId: string }) {
  // Shows:
  // - List of users who have access
  // - Input to add new users by email
  // - Permissions dropdown
  // - Remove access buttons
}

// ui/src/components/chat/ShareBadge.tsx
export function ShareBadge({ conversation }: { conversation: Conversation }) {
  // Shows:
  // - "Private" badge if not shared
  // - "Shared with N users" badge if shared
  // - Opens ShareDialog on click
}
```

#### 4. Update Chat Routes

```typescript
// ui/src/app/(app)/chat/[id]/page.tsx
export default function ChatPage({ params }: { params: { id: string } }) {
  // Load conversation by ID from backend
  // Show share badge and controls
  // Validate user has access (read permission)
}
```

### Authentication Integration

1. **User Creation/Lookup**: On login via NextAuth, create or update user in MongoDB
2. **Session Context**: Include user ID in all API requests
3. **Access Validation**: 
   - Check if user is conversation creator
   - Check if user is in `shared_with` array
   - Return 403 if unauthorized

### Migration Strategy

1. **Phase 1** (Initial Implementation):
   - Add MongoDB backend with new endpoints
   - UI continues using localStorage (backward compatible)
   - Add "Sync to Cloud" button for users to manually migrate

2. **Phase 2** (Hybrid Mode):
   - UI auto-syncs new conversations to backend
   - Loads conversations from backend on app start
   - Falls back to localStorage if backend unavailable

3. **Phase 3** (Full Migration):
   - UI primarily uses backend
   - localStorage only for offline support
   - Auto-migrate old conversations on first login

### Data Retention & Privacy

- **Retention**: Conversations stored indefinitely (future: add retention policies)
- **Deletion**: Hard delete from MongoDB on user request
- **Privacy**: Users must explicitly share conversations
- **Audit Trail**: Log all share/unshare actions with timestamps

## Alternatives Considered

### Alternative 1: PostgreSQL

**Pros:**
- Strong ACID guarantees
- Better for complex joins
- Mature tooling

**Cons:**
- More rigid schema (messages array would need separate table)
- Harder to store nested A2A events (would need JSON columns)
- More complex queries for hierarchical data

**Decision:** MongoDB is better suited for document-based chat data with nested messages and flexible schema.

### Alternative 2: Continue with localStorage Only

**Pros:**
- No backend changes needed
- Fast local access
- No database costs

**Cons:**
- No cross-device sync
- No sharing capabilities
- Limited storage
- No analytics

**Decision:** Rejected - doesn't meet user requirements for sharing and persistence.

### Alternative 3: Redis + PostgreSQL

**Pros:**
- Redis for fast session/cache
- PostgreSQL for durable storage

**Cons:**
- More complex architecture
- Two databases to manage
- Higher operational overhead

**Decision:** MongoDB alone provides sufficient performance and simpler architecture.

## Consequences

### Positive

1. **Cross-Device Access**: Users can access chats from any device
2. **Collaboration**: Teams can share and discuss conversations
3. **Unlimited Storage**: No localStorage size limits
4. **Analytics**: Can track usage patterns and popular queries
5. **Backup**: Conversations are backed up and durable
6. **Search**: Can implement server-side search across all conversations

### Negative

1. **Backend Dependency**: UI now depends on backend availability
2. **Latency**: Network requests slower than localStorage access
3. **Privacy Concerns**: Chat data stored on server
4. **Migration Required**: Existing users need to migrate localStorage data
5. **Complexity**: More code to maintain (API, database, sync logic)

### Mitigation Strategies

1. **Offline Support**: Keep localStorage as fallback cache
2. **Loading States**: Show skeleton loaders during API calls
3. **Data Encryption**: Encrypt sensitive data at rest
4. **Migration Tool**: Automated migration on first login
5. **Monitoring**: Add observability for API performance and errors

## Implementation Plan

See SpecKit specification: `.specify/specs/mongodb-chat-history.md`

## References

- [Zustand Persistence](https://github.com/pmndrs/zustand/blob/main/docs/integrations/persisting-store-data.md)
- [MongoDB with Motor (async Python driver)](https://motor.readthedocs.io/)
- [NextAuth Session Management](https://next-auth.js.org/getting-started/client#usesession)
- [A2A Protocol Specification](https://agent-2-agent.org/protocols/a2a)

## Change Log

- **2026-01-28**: Initial ADR created
