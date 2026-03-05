---
title: "2026-03-03: Admin Feedback Visibility & NPS Score Dashboard"
---

# Admin Feedback Visibility & NPS Score Dashboard

**Date**: 2026-03-03
**Status**: Implemented
**Type**: Feature Addition

## Summary

Added comprehensive feedback and NPS (Net Promoter Score) features to the admin dashboard:

1. **Feedback tab** (optional, `FEEDBACK_ENABLED=true` by default): Shows all user feedback (thumbs up/down) with reasons, comments, user attribution, message context, and clickable links to source conversations
2. **NPS tab** (optional, `NPS_ENABLED=true`): Admin-controlled campaign-based NPS tracking with score gauge, promoter/passive/detractor breakdown, trend chart, campaign management, and individual response list
3. **Read-only admin audit**: Admins can view any conversation via feedback chat links in read-only mode without modifying it
4. **Read-only sharing permissions**: Owners can share conversations as "Can view" (read-only) or "Can edit" (full access) per user and team, with per-team permission storage and backward-compatible defaults
5. **Deep-linkable admin tabs**: Admin page supports `?tab=feedback` query parameter for direct navigation

Also fixed the feedback persistence gap — user feedback is now saved to MongoDB alongside the existing Langfuse integration, making it visible to admins.

## Context

User feedback was collected via `FeedbackButton` (thumbs up/down + reasons) but only sent to Langfuse. It was never persisted to MongoDB, so the admin dashboard's `feedback_summary` in the Statistics tab always showed zeros. Admins had no visibility into individual feedback entries or satisfaction trends.

Additionally, there was no mechanism for measuring Net Promoter Score — a standard product health metric used to gauge user loyalty and satisfaction. NPS should be admin-controlled (not automatic) so that admins decide when to launch surveys.

## Decision

### Feedback Persistence

Close the feedback loop by persisting feedback to MongoDB on the message document when users submit it. The existing Langfuse path remains unchanged (dual-write).

The `FeedbackButton` submission flow now:
1. Sends to Langfuse via `POST /api/feedback` (existing, unchanged)
2. Saves to MongoDB via `PUT /api/chat/messages/[id]` with `feedback` payload (new)

### Feedback as Optional Feature

Feedback is controlled by the `FEEDBACK_ENABLED` environment variable (default: `true`). When disabled:
- Feedback tab is hidden from admin dashboard
- `GET /api/admin/feedback` returns 404 with `FEEDBACK_DISABLED` code
- Tab grid columns adjust dynamically (6 base + feedback + NPS)

Note: feedback *persistence* to MongoDB (the dual-write from ChatPanel) is not gated — it continues to write regardless. Only the admin-facing tab and API are gated.

### Admin Feedback Tab

New `GET /api/admin/feedback` endpoint queries messages with `feedback.rating` set, batch-fetches conversation titles, and returns paginated results. The admin tab displays a filterable table with columns: user, rating, reason, message preview, timestamp, and a clickable chat link.

### Read-Only Admin Audit

Extended `requireConversationAccess` to return `{ conversation, access_level }` where `access_level` can be `'owner'`, `'shared'`, `'shared_readonly'`, or `'admin_audit'`. Admins get `admin_audit` access to any conversation they don't own or have shared access to.

- `GET /api/chat/conversations/[id]` returns `access_level` in response
- `POST /api/chat/conversations/[id]/messages` blocks writes for `admin_audit` and `shared_readonly` (403)
- `ChatPanel` renders contextual read-only banners: "Read-Only Audit Mode" for admins, "View Only" for shared_readonly users

### Read-Only Sharing Permissions

The sharing model now supports per-user and per-team permission levels:
- **Direct user shares**: Permission stored in `SharingAccess` collection (`'view'` or `'comment'`)
- **Team shares**: Permission stored in `conversation.sharing.team_permissions` map
- **Public shares**: Permission stored in `conversation.sharing.public_permission` (default: `'comment'`/read-write); owner can switch to read-only via dropdown
- **Backward compatibility**: Legacy shares without permission records default to `'comment'` (full access)

The `ShareDialog` component now shows:
- A default permission selector ("Can view" / "Can edit") next to the search input for new shares (defaults to "Can edit")
- A per-user/team permission dropdown in the access list for changing existing permissions
- A permission dropdown on the "Share with everyone" row to control public access level
- Permissions are changed via `PATCH /api/chat/conversations/[id]/share`

### NPS as Optional Feature

NPS is controlled by the `NPS_ENABLED` environment variable (default: `false`). When disabled:
- NPS tab is hidden from admin dashboard
- NPSSurvey component does not render
- All NPS API endpoints return appropriate disabled responses

### Admin-Controlled NPS Campaigns

Instead of automatic periodic surveys, admins create time-bounded campaigns:
- `POST /api/admin/nps/campaigns` — create campaign with name, start/end dates (overlap prevention enforced)
- `GET /api/admin/nps/campaigns` — list all campaigns with response counts and status (active/ended/scheduled)
- `PATCH /api/admin/nps/campaigns` — stop a campaign early (sets `ends_at` to now, records `stopped_by`)
- `GET /api/nps/active` — users check for an active campaign to determine if survey should show

### NPS Survey Component

`NPSSurvey` component checks for active campaigns and shows:
- Campaign name
- Question: "How well does \{appName\} help you get your work done?"
- 0–10 score scale (color-coded: red detractors, yellow passives, green promoters)
- Optional comment
- Dismissal tracked per campaign in localStorage

### Campaign-Specific NPS Analytics

`GET /api/admin/nps` accepts optional `campaign_id` query parameter to filter all analytics (score, breakdown, trend, recent responses) to a specific campaign. The admin UI shows clickable campaign rows and a "Clear filter" banner.

### Deep-Linkable Admin Tabs

Admin page reads `?tab=` from query params via `useSearchParams()`. Valid tabs: `users`, `teams`, `stats`, `skills`, `feedback`, `nps`, `metrics`, `health`. The "Back to Feedback" button in audit mode navigates to `/admin?tab=feedback`.

## Implementation

### New API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/admin/feedback` | `requireAdminView` | Paginated feedback list with conversation titles |
| `POST` | `/api/nps` | authenticated | Submit NPS response (score 0–10, optional comment, campaign_id) |
| `GET` | `/api/nps/active` | authenticated | Check for active NPS campaign |
| `GET` | `/api/admin/nps` | `requireAdminView` | NPS analytics (filterable by campaign_id) |
| `POST` | `/api/admin/nps/campaigns` | `requireAdmin` | Create NPS campaign |
| `GET` | `/api/admin/nps/campaigns` | `requireAdminView` | List campaigns with response counts and status |
| `PATCH` | `/api/admin/nps/campaigns` | `requireAdmin` | Stop campaign early |
| `PATCH` | `/api/chat/conversations/[id]/share` | owner | Update user/team permission |

### Modified API Behavior

| Method | Endpoint | Change |
|--------|----------|--------|
| `GET` | `/api/chat/conversations/[id]` | Returns `access_level` field |
| `POST` | `/api/chat/conversations/[id]/messages` | Blocks writes for `admin_audit` and `shared_readonly` (403) |
| `PUT` | `/api/chat/messages/[id]` | Stores `feedback.submitted_by` from session |

### MongoDB Collections

| Collection | Fields | Notes |
|------------|--------|-------|
| `messages` (existing) | `feedback.{rating, reason, comment, submitted_at, submitted_by}` | Feedback stored on message doc |
| `nps_responses` (new) | `user_email, score, comment, campaign_id, created_at` | Linked to campaigns |
| `nps_campaigns` (new) | `name, starts_at, ends_at, created_by, created_at, stopped_by, stopped_at` | Campaign lifecycle |

### Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `FEEDBACK_ENABLED` | `true` | Enable/disable admin Feedback tab and API (set `false` to disable) |
| `NPS_ENABLED` | `false` | Enable/disable NPS feature |

### Key Files

| File | Description |
|------|-------------|
| `ui/src/app/(app)/admin/page.tsx` | Admin dashboard with Feedback, NPS tabs, campaign management, deep-linkable tabs |
| `ui/src/app/api/admin/feedback/route.ts` | Admin feedback list API |
| `ui/src/app/api/admin/nps/route.ts` | Admin NPS analytics API (campaign-filterable) |
| `ui/src/app/api/admin/nps/campaigns/route.ts` | Campaign CRUD + stop API |
| `ui/src/app/api/nps/route.ts` | NPS submission API |
| `ui/src/app/api/nps/active/route.ts` | Active campaign check API |
| `ui/src/components/nps/NPSSurvey.tsx` | NPS survey component (campaign-aware) |
| `ui/src/components/chat/ChatPanel.tsx` | Read-only audit mode, feedback persistence |
| `ui/src/app/(app)/chat/[uuid]/page.tsx` | Wires `readOnly` prop based on access_level |
| `ui/src/lib/api-middleware.ts` | `requireConversationAccess` with access levels (`owner`, `shared`, `shared_readonly`, `admin_audit`) |
| `ui/src/components/chat/ShareDialog.tsx` | Share dialog with per-user/team permission dropdowns |
| `ui/src/app/api/chat/conversations/[id]/share/route.ts` | Share API with PATCH for permission updates |
| `ui/src/lib/config.ts` | `feedbackEnabled` and `npsEnabled` config keys |
| `ui/scripts/seed-feedback-nps.mjs` | Seed script for test data |

## Security Considerations

1. **Admin-only access**: All admin feedback/NPS endpoints check `requireAdminView` or `requireAdmin` — returns 403 for non-admin users
2. **Read-only audit**: Admin audit access blocks message creation (403); admins cannot modify conversations they audit
3. **Authenticated NPS submission**: NPS submissions require a valid session; anonymous submissions are rejected
4. **Campaign overlap prevention**: Server-side check prevents overlapping active campaigns
5. **No PII in feedback**: Feedback reasons are pre-defined chips; free-text is optional and user-initiated
6. **Transparency disclaimers**: Both the feedback popover and NPS survey show subtle notes informing users their responses are visible to admins
7. **Feature gating**: Feedback is enabled by default, opt-out via `FEEDBACK_ENABLED=false`; NPS is opt-in via `NPS_ENABLED=true`; all gated endpoints return disabled responses when off
8. **MongoDB required**: Both features require MongoDB (same as existing admin features); returns 503 if not configured

## Testing

### Automated Tests (2026 tests, 83 suites — all pass)

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `admin-feedback.test.ts` | 11 | Auth, authz, feedback disabled guard, MongoDB guard, pagination, filtering, structure, truncation |
| `nps-submit.test.ts` | 19 | Score validation, submit variations, active campaign detection, NPS disabled |
| `nps-campaigns.test.ts` | 30 | Create, list, stop, overlap prevention, status computation, all guards |
| `admin-nps.test.ts` | 11 | NPS calculation, campaign filtering, trend, guards |
| `admin-audit-access.test.ts` | 11 | Access levels (owner/shared/admin_audit), conversation route, 403/404 |
| `chat-messages.test.ts` | +3 | Write blocking for admin_audit, owner allowed, GET for audit |
| `chat-sharing-readonly.test.ts` | 20 | Permission-based access levels, PATCH permission updates, backward compat, public permission, message blocking |
| `config.test.ts` | +7 | `feedbackEnabled` defaults/env var tests, `npsEnabled` key presence |
| `admin-page.test.tsx` | +fixes | Mock for `/api/admin/feedback`, `/api/admin/nps`, `useSearchParams` |

### Seed Script

`node ui/scripts/seed-feedback-nps.mjs` populates MongoDB with sample conversations, feedback, an NPS campaign, and NPS responses for manual testing.

## Conventional Commit

```
feat(admin): add feedback visibility, NPS campaigns, and admin audit mode

- Persist user feedback to MongoDB alongside Langfuse (dual-write)
- Add admin Feedback tab with filterable table and chat links
- Add read-only admin audit mode for viewing conversations
- Add optional NPS feature (NPS_ENABLED env var)
- Add admin-controlled NPS campaigns (create, list, stop)
- Add NPS survey component triggered by active campaigns
- Add campaign-specific NPS analytics filtering
- Add deep-linkable admin tabs via ?tab= query param
- Comprehensive test coverage (1906 tests, 79 suites)

Signed-off-by: Sri Aradhyula <sraradhy@cisco.com>
```
