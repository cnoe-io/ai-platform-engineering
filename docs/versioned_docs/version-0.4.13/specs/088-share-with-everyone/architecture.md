---
sidebar_position: 1
id: 088-share-with-everyone-architecture
sidebar_label: Architecture
---

# Architecture: Share with Everyone

## Decision

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **Activate existing is_public field (chosen)** | Zero schema migration, leverages existing field | Full read+write access (no read-only yet) | Selected |
| New sharing tier with separate collection | Clean separation, granular permissions | Migration needed, more complex queries | Rejected |
| Link-based public sharing (share URL) | No auth required for viewing | Security risk, no audit trail | Rejected |
| Organization-wide team group | Uses existing team infrastructure | Requires all users in a team, admin overhead | Rejected |

## Solution Architecture

### Access Control Flow

The `requireConversationAccess` middleware in `api-middleware.ts` checks access in priority order:

```
Request ──▶ requireConversationAccess(conversationId, session)
  │
  ├── 1. Owner? ──▶ GRANT (full access)
  ├── 2. sharing.is_public === true? ──▶ GRANT (any authenticated user)
  ├── 3. shared_with includes user? ──▶ GRANT
  ├── 4. shared_with_teams includes user's team? ──▶ GRANT
  ├── 5. sharing_access record exists? ──▶ GRANT
  └── None matched ──▶ DENY (403)
```

The `is_public` check at position 2 short-circuits the more expensive team membership lookups when a conversation is public.

### API Changes

The share endpoint accepts `is_public` as a **standalone** toggle -- no `user_emails` or `team_ids` required:

```
POST /api/chat/conversations/[id]/share
Body: { "is_public": true }   ← standalone toggle
Body: { "is_public": true, "user_emails": [...] }  ← combined
```

MongoDB update: `$set: { "sharing.is_public": true/false }`

### Query Changes

Both conversation listing and shared listing add `is_public` to their `$or` conditions:

```javascript
{ $or: [
    { owner_id: userId },
    { 'sharing.shared_with': userEmail },
    { 'sharing.shared_with_teams': { $in: userTeams } },
    { 'sharing.is_public': true }    // ← new condition
] }
```

### Data Model

No schema changes -- `is_public` already existed on `Conversation.sharing` with default `false`:

```typescript
sharing: {
  is_public: boolean;            // activated by this feature
  shared_with: string[];
  shared_with_teams: string[];
  share_link_enabled: boolean;
  share_link_expires?: Date;
}
```

### UI Indicators

| State | Sidebar Icon | Color |
|---|---|---|
| Public (`is_public: true`) | Globe | Green |
| Shared (users/teams only) | Users | Blue |
| Private (not shared) | None | Default |

The ShareDialog includes a toggle switch with Globe icon and shows "Everyone" in the access list when public.

## Components Changed

| File | Description |
|---|---|
| `ui/src/lib/api-middleware.ts` | Added `is_public` check at position 2 in `requireConversationAccess` |
| `ui/src/app/api/chat/conversations/[id]/share/route.ts` | Handles `is_public` toggle as standalone action; validates owner-only |
| `ui/src/app/api/chat/conversations/route.ts` | Added `{ 'sharing.is_public': true }` to listing `$or` conditions |
| `ui/src/app/api/chat/shared/route.ts` | Added `{ 'sharing.is_public': true }` to shared listing `$or` conditions |
| `ui/src/components/chat/ShareDialog.tsx` | Toggle switch UI, "Everyone" access list entry, `handleTogglePublic` handler |
| `ui/src/components/layout/Sidebar.tsx` | Globe icon (green) for public conversations vs Users icon (blue) |
| `ui/src/types/mongodb.ts` | Added `is_public?: boolean` to `ShareConversationRequest` |

## Related

- Spec: [spec.md](./spec.md)
