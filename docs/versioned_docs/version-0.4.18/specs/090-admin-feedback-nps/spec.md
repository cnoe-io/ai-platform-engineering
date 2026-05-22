---
sidebar_position: 2
sidebar_label: Specification
---

# Spec: Admin Feedback Visibility & NPS Score Dashboard

## Overview

Make user feedback visible to admins in a dedicated Feedback tab on the admin dashboard, and introduce a Net Promoter Score (NPS) survey system with admin-controlled campaigns, its own admin tab for tracking user satisfaction, and read-only admin audit access to conversations.

## Motivation

Currently, user feedback (thumbs up/down + reasons) is collected via `FeedbackButton` and sent to Langfuse, but it is **not persisted to MongoDB**. The admin dashboard's `feedback_summary` reads from MongoDB and always shows zeros. Admins have no way to:

1. See individual feedback entries, who submitted them, what reasons were given, or what messages they relate to
2. Track satisfaction trends over time
3. Measure Net Promoter Score — a standard product health metric
4. Audit conversations that received feedback without modifying them

This feature closes the feedback loop so platform operators can monitor quality and act on user signals.

## Scope

### In Scope
- **Feedback persistence**: Save feedback to MongoDB when users submit it (alongside the existing Langfuse path)
- **Admin Feedback tab**: New tab in `/admin` showing a filterable list of all feedback entries with user, message context, reason, timestamp, and link to conversation
- **Admin feedback API**: `GET /api/admin/feedback` endpoint returning paginated feedback data
- **Feedback as optional feature**: Controlled via `FEEDBACK_ENABLED` environment variable (default: on)
- **NPS as optional feature**: Controlled via `NPS_ENABLED` environment variable (default: off)
- **Admin-controlled NPS campaigns**: Admins create time-bounded campaigns; users see the survey only when a campaign is active
- **NPS campaign management**: Create, list, and stop campaigns via `/api/admin/nps/campaigns`
- **NPS survey component**: In-app NPS survey (0–10 scale + optional comment) triggered by active campaigns
- **Campaign-specific NPS results**: Admin can filter NPS analytics by individual campaign
- **NPS API endpoints**: `POST /api/nps`, `GET /api/nps/active`, `GET /api/admin/nps`, `POST/GET/PATCH /api/admin/nps/campaigns`
- **NPS MongoDB collections**: `nps_responses` and `nps_campaigns` collections
- **Admin NPS tab**: NPS score, breakdown, trend chart, campaign management, and individual responses
- **Read-only admin audit**: Admins can view any conversation via feedback chat links in read-only mode
- **Read-only sharing permissions**: Owners can share conversations as "Can view" (read-only) or "Can edit" (full access) per user/team
- **Deep-linkable admin tabs**: Admin page supports `?tab=feedback` query parameter for direct navigation

### Out of Scope
- Langfuse changes (existing Langfuse integration remains as-is)
- Email/Slack NPS notifications
- Export/CSV download of feedback or NPS data (future)

## Design

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Feedback Flow (Enhanced)                               │
│  ─────────────────────────────────────────────          │
│  User clicks thumbs up/down → FeedbackButton            │
│    ├─→ POST /api/feedback → Langfuse (existing)         │
│    └─→ PUT /api/chat/messages/[id] → MongoDB (NEW)      │
│                                                         │
│  Admin views:                                           │
│    GET /api/admin/feedback → paginated feedback list     │
│    └─→ Reads messages collection where feedback exists   │
│    Click chat link → /chat/[id] → read-only audit mode  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  NPS Flow (Campaign-based)                              │
│  ─────────────────────────────────────────────          │
│  Admin creates campaign (date range) via dashboard       │
│    POST /api/admin/nps/campaigns                        │
│  User checks for active campaign:                       │
│    GET /api/nps/active → { active, campaign }           │
│  NPS survey shown when campaign is active:              │
│    POST /api/nps → nps_responses (with campaign_id)     │
│  Admin stops campaign early:                            │
│    PATCH /api/admin/nps/campaigns                       │
│                                                         │
│  Admin views:                                           │
│    GET /api/admin/nps?campaign_id=X → filtered results  │
│    └─→ Score, breakdown, trend, responses, campaigns    │
└─────────────────────────────────────────────────────────┘
```

### Data Models

**Feedback on messages** (existing `MessageFeedback` — now actually used):
```typescript
interface MessageFeedback {
  rating: 'positive' | 'negative';
  reason?: string;
  comment?: string;
  submitted_at: Date;
  submitted_by?: string;
}
```

**NPS Campaign** (new collection `nps_campaigns`):
```typescript
interface NPSCampaign {
  _id: ObjectId;
  name: string;
  starts_at: Date;
  ends_at: Date;
  created_by: string;
  created_at: Date;
  stopped_by?: string;   // set when admin stops early
  stopped_at?: Date;
}
```

**NPS Response** (new collection `nps_responses`):
```typescript
interface NPSResponse {
  _id: ObjectId;
  user_email: string;
  score: number;          // 0–10
  comment?: string;
  campaign_id?: string;   // linked to campaign
  created_at: Date;
}
```

### Components Affected
- [x] UI (`ui/`) — FeedbackButton, admin page, NPS survey, API routes, config, middleware
- [ ] Agents (`ai_platform_engineering/agents/`)
- [ ] Multi-Agents (`ai_platform_engineering/multi_agents/`)
- [ ] MCP Servers
- [ ] Knowledge Bases (`ai_platform_engineering/knowledge_bases/`)
- [ ] Documentation (`docs/`)
- [ ] Helm Charts (`charts/`)

## Acceptance Criteria

- [x] User feedback (thumbs up/down) is persisted to MongoDB on the message document
- [x] Admin dashboard shows a "Feedback" tab with all feedback entries
- [x] Feedback tab shows: user, rating, reason, comment, message snippet, timestamp, chat link
- [x] Feedback tab supports filtering by rating (positive/negative/all)
- [x] Each feedback entry links to the source conversation so admins can view the full chat
- [x] Clicking a chat link opens the conversation in read-only audit mode for admins
- [x] Read-only mode displays an audit banner and disables message input
- [x] "Back to Feedback" button navigates to `/admin?tab=feedback`
- [x] Admin page supports `?tab=` query param for deep linking
- [x] Feedback is an optional feature controlled by `FEEDBACK_ENABLED` env var (default: on)
- [x] NPS is an optional feature controlled by `NPS_ENABLED` env var
- [x] NPS survey appears only when an admin-created campaign is active
- [x] NPS survey displays the campaign name
- [x] NPS survey question: "How well does \{appName\} help you get your work done?"
- [x] NPS survey shows subtle disclaimer: "Responses are tied to your account to help us follow up."
- [x] Feedback popover shows subtle disclaimer: "Feedback is shared with your admin team to help improve the experience."
- [x] NPS survey collects 0–10 score and optional comment
- [x] NPS responses are stored in `nps_responses` collection linked to campaign
- [x] Admins can create, list, and stop NPS campaigns
- [x] Overlapping campaigns are prevented
- [x] Campaign stop uses inline confirmation (no browser popup)
- [x] Admin can filter NPS analytics by specific campaign
- [x] Admin NPS tab shows: overall NPS score, breakdown, 30-day trend, recent responses, campaigns
- [x] POST messages blocked for admin_audit and shared_readonly access levels (403)
- [x] Sharing dialog supports "Can view" / "Can edit" permission per user and team
- [x] Permission can be changed after sharing via PATCH endpoint
- [x] Public shares default to read/write; owner can switch to read-only via permission dropdown
- [x] Public share permission stored in `sharing.public_permission` (default: comment)
- [x] Legacy shares (without permission records) default to full access for backward compatibility
- [x] Team shares store per-team permission in `sharing.team_permissions`
- [x] All new code has comprehensive tests (83 suites, 2026 tests pass)
- [x] Linting passes

## Implementation Plan

### Phase 1: Feedback Persistence to MongoDB
- [x] Update `ChatPanel.tsx` to call `apiClient.updateMessage()` with feedback data
- [x] Ensure `PUT /api/chat/messages/[id]` stores `feedback.submitted_by`

### Phase 2: Admin Feedback API & Tab
- [x] Create `GET /api/admin/feedback` endpoint with pagination and filtering
- [x] Batch-fetch conversation titles for chat links
- [x] Add "Feedback" tab to admin dashboard

### Phase 3: Read-Only Admin Audit & Sharing Permissions
- [x] Extend `requireConversationAccess` to return `{ conversation, access_level }`
- [x] Add `admin_audit` and `shared_readonly` access levels
- [x] Block POST messages for `admin_audit` and `shared_readonly` access
- [x] Add `readOnly` and `readOnlyReason` props to `ChatPanel` with contextual banners
- [x] Return `access_level` from `GET /api/chat/conversations/[id]`
- [x] Add permission dropdown ("Can view" / "Can edit") to ShareDialog for users and teams
- [x] Store per-team permissions in `sharing.team_permissions`
- [x] Add `PATCH /api/chat/conversations/[id]/share` for changing permissions
- [x] Default permission selector in ShareDialog for new shares (defaults to "Can edit")
- [x] Permission dropdown on "Share with everyone" row with `public_permission` storage

### Phase 4: Feature Flags & Config
- [x] Add `feedbackEnabled` to `Config` interface and `getServerConfig()` (default: true)
- [x] Gate `GET /api/admin/feedback` endpoint with `feedbackEnabled` check
- [x] Conditionally render Feedback tab in admin dashboard
- [x] Dynamically adjust tab grid columns based on enabled features
- [x] Add `npsEnabled` to `Config` interface and `getServerConfig()`
- [x] Gate all NPS endpoints and UI with `npsEnabled` check
- [x] Conditionally render NPS tab and NPSSurvey component

### Phase 5: Admin-Controlled NPS Campaigns
- [x] Create `nps_campaigns` collection and CRUD API
- [x] `POST /api/admin/nps/campaigns` — create campaign (with overlap prevention)
- [x] `GET /api/admin/nps/campaigns` — list with response counts and status
- [x] `PATCH /api/admin/nps/campaigns` — stop campaign early (inline confirmation)
- [x] Rewrite NPSSurvey to check `/api/nps/active` for active campaign
- [x] Display campaign name in survey popup
- [x] Link NPS responses to campaign_id

### Phase 6: Campaign-Specific Analytics
- [x] Add `campaign_id` query param filter to `GET /api/admin/nps`
- [x] Clickable campaign rows in admin NPS tab to filter results
- [x] "Clear filter" banner when viewing campaign-specific data

### Phase 7: Admin Tab Deep Linking
- [x] Add `useSearchParams` for `?tab=` query param support
- [x] "Back to Feedback" navigates to `/admin?tab=feedback`

### Phase 8: Testing
- [x] `admin-feedback.test.ts` — 11 tests (auth, authz, feedback disabled guard, pagination, filtering, structure)
- [x] `nps-submit.test.ts` — 19 tests (submit validation, active campaign detection)
- [x] `nps-campaigns.test.ts` — 30 tests (create, list, stop, overlap, status computation)
- [x] `admin-nps.test.ts` — 11 tests (analytics, campaign filtering, NPS calculation)
- [x] `admin-audit-access.test.ts` — 11 tests (access levels, conversation route)
- [x] `chat-messages.test.ts` — +3 tests (write blocking for audit access)
- [x] `chat-sharing-readonly.test.ts` — 20 tests (permission-based access, PATCH, backward compat, public permission)
- [x] Updated `config.test.ts` with `feedbackEnabled` default, env var override, and key presence tests
- [x] Updated `admin-page.test.tsx` for new config keys and mocks
- [x] Updated `chat-sharing-public.test.ts` for `shared_readonly` access level
- [x] Updated `chat-sharing-teams.test.ts` for permission-aware access levels

## Testing Strategy

### Automated Tests (2026 tests, 83 suites — all pass)
- API route tests: auth, authz, MongoDB guard, feature flag guard, validation, business logic
- Middleware tests: `requireConversationAccess` access levels
- Config tests: `feedbackEnabled` and `npsEnabled` defaults, env var overrides, key presence
- Admin page tests: fetch mock coverage for new endpoints

### Manual Verification
- Submit feedback → verify in admin Feedback tab
- Click chat link → verify read-only audit mode
- "Back to Feedback" → verify deep link to feedback tab
- Enable NPS → create campaign → verify survey appears for users
- Stop campaign → verify survey stops appearing
- Filter NPS by campaign → verify scoped results

## Rollout Plan

1. Merge to `prebuild/feat/admin-feedback-nps` branch
2. Requires MongoDB (same as existing admin features)
3. Feedback is enabled by default; opt-out via `FEEDBACK_ENABLED=false`
4. NPS is opt-in via `NPS_ENABLED=true` environment variable
5. No infrastructure changes needed beyond existing MongoDB

## Related

- ADR: [2026-03-03-admin-feedback-nps-dashboard](../077-admin-feedback-nps-dashboard/architecture.md)
- Related ADR: [2026-01-30-admin-dashboard-with-oidc-group-rbac](../053-admin-dashboard-with-oidc-group-rbac/architecture.md)
