---
title: "2026-03-03: Share with Everyone"
---

# Share with Everyone

**Date**: 2026-03-03  
**Status**: Implemented  
**Type**: Feature Addition

## Summary

Added a "Share with everyone" option to conversation sharing, completing the three-tier sharing model: individual users, teams, and everyone. Owners can toggle a conversation's visibility to make it accessible to all authenticated users in the organization.

## Problem Statement

Conversation sharing was limited to specific users (by email) or teams (by team ID). There was no way to make a conversation broadly visible to the entire organization. The `is_public` field existed in the sharing schema but was not wired through the API or UI, leaving it permanently `false`.

Common use cases that required this:
- Sharing best practices and solutions organization-wide
- Incident post-mortem conversations
- Onboarding materials and reference conversations
- Cross-team knowledge sharing without managing individual access

## Decision

Activate the existing `is_public` boolean field end-to-end rather than introducing a new sharing mechanism. This approach:
- Requires zero schema migration (field already exists with default `false`)
- Maintains backward compatibility
- Follows the same API pattern as user/team sharing

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| Activate `is_public` field | No migration, simple, consistent | Binary (all or nothing) | **Chosen** |
| "Organization" pseudo-team | Reuses team model | Requires special team management, confusing UX | Rejected |
| Separate public endpoint | Clean separation | API duplication, extra routes to maintain | Rejected |

## Solution Architecture

### Access Check Flow

```
requireConversationAccess(conversationId, userId)
  │
  ├─ Owner? ──────────────── ✅ GRANT
  │
  ├─ is_public? ─────────── ✅ GRANT (new)
  │
  ├─ shared_with user? ──── ✅ GRANT
  │
  ├─ shared_with_teams? ─── ✅ GRANT (if member)
  │
  ├─ sharing_access? ────── ✅ GRANT (if record exists)
  │
  └─ ────────────────────── ❌ DENY
```

### API Changes

**POST /api/chat/conversations/[id]/share**

New: accepts `is_public` as a standalone sharing action:

```json
{ "is_public": true }
```

Previously required `user_emails` or `team_ids` with `permission`. Now accepts any combination of:
- `is_public` (standalone toggle)
- `user_emails` + `permission`
- `team_ids` + `permission`

### Query Changes

Both conversation listing and shared listing endpoints add a public condition:

```javascript
// GET /api/chat/conversations
const ownershipConditions = [
  { owner_id: user.email },
  { 'sharing.shared_with': user.email },
  { 'sharing.is_public': true },           // ← new
  // + team conditions if applicable
];

// GET /api/chat/shared
const sharedConditions = [
  { 'sharing.shared_with': user.email },
  { 'sharing.is_public': true },           // ← new
  // + team conditions if applicable
];
```

### UI Changes

**ShareDialog** — New toggle switch between the copy-link section and the people/teams search:

```
┌─────────────────────────────────────────┐
│  Share Conversation                     │
│  My Conversation Title                  │
├─────────────────────────────────────────┤
│  Share Link  [https://...] [Copy]       │
├─────────────────────────────────────────┤
│  🌐 Share with everyone         [━━●]   │  ← new toggle
│     Anyone in the organization...       │
├─────────────────────────────────────────┤
│  People, Teams                          │
│  [Search by email or team name...]      │
├─────────────────────────────────────────┤
│  Access (Everyone)                      │
│  🌐 Everyone — All org members  Can view│  ← new entry
│  👤 user@example.com           [🗑]     │
│  👥 Platform Engineering       [🗑]     │
└─────────────────────────────────────────┘
```

**Sidebar** — Differentiated sharing indicator:
- **Public**: Green Globe icon with "Shared with everyone" tooltip
- **Private share**: Blue Users icon with "Shared conversation" tooltip

## Components Changed

| File | Change |
|---|---|
| `ui/src/types/mongodb.ts` | Added `is_public?: boolean` to `ShareConversationRequest` |
| `ui/src/lib/api-middleware.ts` | `requireConversationAccess` checks `is_public` after owner check |
| `ui/src/app/api/chat/conversations/[id]/share/route.ts` | Handles `is_public` toggle; relaxed validation for standalone toggle |
| `ui/src/app/api/chat/conversations/route.ts` | Added `{ 'sharing.is_public': true }` to `$or` conditions |
| `ui/src/app/api/chat/shared/route.ts` | Added `{ 'sharing.is_public': true }` to `$or` conditions |
| `ui/src/components/chat/ShareDialog.tsx` | Toggle switch, `handleTogglePublic`, "Everyone" access entry |
| `ui/src/components/layout/Sidebar.tsx` | Globe icon (green) for public, Users icon (blue) for private sharing |
| `ui/src/app/api/__tests__/chat-sharing-teams.test.ts` | Updated expectations for new `is_public` query condition |
| `ui/src/app/api/__tests__/chat-sharing-public.test.ts` | **New** — 12 tests for public sharing |

## Testing

- **12 new tests** covering access control, API toggle, and query inclusion
- **2 updated tests** in existing sharing test suite for new query conditions
- **Full suite**: 75 suites, 1832 tests pass, zero regressions

## Migration Notes

- **No migration required** — `is_public` already exists in the schema with default `false`
- **Backward compatible** — existing sharing with users and teams is unchanged
- **Gradual adoption** — public sharing is opt-in per conversation by the owner

## Related

- Spec: `.specify/specs/share-with-everyone.md`
- Related ADR: `docs/docs/changes/2026-01-30-admin-dashboard-teams-management.md`
- Branch: `prebuild/feat/share-with-everyone`
