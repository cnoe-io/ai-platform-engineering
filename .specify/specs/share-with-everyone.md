# Spec: Share with Everyone

## Overview

Add a "Share with everyone" option to conversation sharing, allowing owners to make a conversation publicly visible to all authenticated users in the organization. This completes the three-tier sharing model: individual users, teams, and everyone.

## Motivation

Currently, sharing a conversation requires adding users one by one or selecting specific teams. There is no way to broadcast a conversation to the entire organization. This is common in knowledge-sharing and transparency scenarios where a conversation contains broadly useful information (best practices, incident post-mortems, architectural decisions).

The `is_public` field already existed in the `Conversation.sharing` schema but was never wired through the API or UI. This feature activates it end-to-end.

## Scope

### In Scope
- Toggle `is_public` via the share API endpoint
- Allow `is_public` as a standalone sharing action (no `user_emails`/`team_ids` required)
- Grant full access (read + write) to any authenticated user when `is_public: true`
- Include public conversations in listings and shared views
- UI toggle switch in the ShareDialog with clear visual indication
- Visual indicator (Globe icon) in the sidebar for public conversations
- Combine `is_public` with user/team sharing in a single request
- Tests covering access control, API toggle, query inclusion, and combined scenarios

### Out of Scope
- Anonymous/unauthenticated access to public conversations
- Read-only enforcement for public viewers (may be added later)
- Public conversation search/discovery page
- Notifications when a conversation is made public
- Admin-level override to disable public sharing

## Design

### Architecture

The `sharing.is_public` boolean on the `Conversation` document controls visibility:

```
is_public: false  → only owner, shared_with users, shared_with_teams members
is_public: true   → any authenticated user in the organization (full access)
```

Public access grants the same level of access as user/team sharing — authenticated users can both view and send messages. Read-only enforcement is deferred to a future iteration.

**Access check order** in `requireConversationAccess`:
1. Owner check
2. **Public check** (`is_public: true`) — new
3. Direct user share check (`shared_with`)
4. Team share check (`shared_with_teams`)
5. `sharing_access` record check

**Query inclusion** — conversations listing and shared listing both add:
```javascript
{ 'sharing.is_public': true }
```
to the `$or` conditions, so public conversations appear alongside owned and shared ones.

### Data Model

No schema changes — `is_public` already exists on `Conversation.sharing`:

```typescript
sharing: {
  is_public: boolean;       // ← activated by this feature
  shared_with: string[];
  shared_with_teams: string[];
  share_link_enabled: boolean;
  share_link_expires?: Date;
}
```

`ShareConversationRequest` gains an optional `is_public` field:

```typescript
interface ShareConversationRequest {
  user_emails?: string[];
  team_ids?: string[];
  permission: 'view' | 'comment';
  enable_link?: boolean;
  link_expires?: string;
  is_public?: boolean;       // ← new
}
```

### Components Affected
- [ ] Agents (`ai_platform_engineering/agents/`)
- [ ] Multi-Agents (`ai_platform_engineering/multi_agents/`)
- [ ] MCP Servers
- [ ] Knowledge Bases (`ai_platform_engineering/knowledge_bases/`)
- [x] UI (`ui/`)
  - `ui/src/types/mongodb.ts` — `ShareConversationRequest.is_public`
  - `ui/src/lib/api-middleware.ts` — `requireConversationAccess` public check
  - `ui/src/app/api/chat/conversations/[id]/share/route.ts` — `is_public` toggle
  - `ui/src/app/api/chat/conversations/route.ts` — public query condition
  - `ui/src/app/api/chat/shared/route.ts` — public query condition
  - `ui/src/components/chat/ShareDialog.tsx` — toggle UI + access list
  - `ui/src/components/layout/Sidebar.tsx` — Globe icon for public conversations
- [x] Documentation (`docs/`)
  - ADR: `docs/docs/changes/2026-03-03-share-with-everyone.md`
- [ ] Helm Charts (`charts/`)

## Acceptance Criteria

- [x] Owner can toggle "Share with everyone" in the ShareDialog
- [x] `POST /api/chat/conversations/[id]/share` accepts `{ is_public: true/false }` as a standalone action
- [x] Any authenticated user can access a public conversation (full read + write access)
- [x] Public conversations appear in the conversation listing for all users
- [x] Public conversations appear in the shared conversations listing
- [x] Sidebar shows a green Globe icon for public conversations (distinct from blue Users icon)
- [x] ShareDialog shows "Everyone" entry in the access list when public
- [x] Only the owner can toggle public sharing
- [x] Existing sharing (users, teams) continues to work unchanged
- [x] Tests pass (existing + new)
- [x] Spec and ADR created

## Implementation Plan

### Phase 1: Backend ✅
- [x] Add `is_public?: boolean` to `ShareConversationRequest` type
- [x] Update `requireConversationAccess` to check `is_public`
- [x] Update share API POST to handle `is_public` toggle
- [x] Update share API validation to allow `is_public` as standalone action
- [x] Add `{ 'sharing.is_public': true }` to conversations listing query
- [x] Add `{ 'sharing.is_public': true }` to shared conversations query

### Phase 2: Frontend ✅
- [x] Add toggle switch UI in ShareDialog with Globe icon
- [x] Add `handleTogglePublic` handler
- [x] Show "Everyone" entry in access list when public
- [x] Update access count label
- [x] Add Globe icon import and rendering in Sidebar
- [x] Differentiate public (green Globe) vs shared (blue Users) indicators

### Phase 3: Tests ✅
- [x] Update existing `chat-sharing-teams.test.ts` expectations for new `is_public` query condition
- [x] Create `chat-sharing-public.test.ts` with 19 tests covering:
  - `requireConversationAccess` — public grant, deny, owner bypass, skip-teams optimization
  - `POST share` — toggle on/off, standalone, validation, owner-only, combined with users, auth
  - `GET share` — returns is_public state (true/false)
  - `GET conversations` — public query inclusion, alongside other conditions
  - `GET shared` — public query inclusion, excludes own conversations

### Phase 4: Documentation ✅
- [x] Create spec in `.specify/specs/`
- [x] Create ADR in `docs/docs/changes/`

## Testing Strategy

- Unit tests: 19 new tests in `chat-sharing-public.test.ts`
  - Access control: public grant, deny, owner bypass, skip-teams optimization (5 tests)
  - API POST: toggle on/off, standalone, validation, owner-only, combined, permission required, response, auth (9 tests)
  - API GET: returns is_public true/false (2 tests)
  - Queries: conversations listing with all conditions, shared listing with exclusion (3 tests)
- Existing tests: Updated 2 tests in `chat-sharing-teams.test.ts` for new query conditions
- Manual verification:
  1. Open a conversation → Share → toggle "Share with everyone" on
  2. Log in as a different user → verify conversation appears in listing
  3. Verify Globe icon in sidebar for the public conversation
  4. Toggle off → verify access revoked
  5. Send a message as another user on a public conversation → verify it works

## Rollout Plan

1. PR merge to `main` via `prebuild/feat/share-with-everyone` branch
2. Container rebuild triggered by `prebuild/` prefix
3. No migration needed — `is_public` field already exists in schema with default `false`
4. Backward compatible — no existing behavior changes

## Related

- ADR: `docs/docs/changes/2026-03-03-share-with-everyone.md`
- Related ADR: `docs/docs/changes/2026-01-30-admin-dashboard-teams-management.md`
- Branch: `prebuild/feat/share-with-everyone`
