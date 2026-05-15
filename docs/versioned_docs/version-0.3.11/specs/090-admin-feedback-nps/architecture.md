---
sidebar_position: 1
id: 090-admin-feedback-nps-architecture
sidebar_label: Architecture
---

# Architecture: Admin Feedback Visibility & NPS Score Dashboard

## Decision

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **MongoDB-backed feedback + campaign-based NPS (chosen)** | Leverages existing MongoDB, no new infrastructure, admin-controlled campaigns | Requires NPS campaign management | Selected |
| Langfuse-only analytics | Already integrated | No admin dashboard, limited filtering, no NPS | Rejected |
| Third-party survey tool (Typeform, Delighted) | Purpose-built NPS | External dependency, data fragmentation, cost | Rejected |
| Always-on NPS (no campaigns) | Simpler implementation | Survey fatigue, no time-bounded measurement | Rejected |

## Solution Architecture

### Feedback Flow

Feedback is persisted to MongoDB alongside the existing Langfuse path:

```
User clicks thumbs up/down
  │
  ├── POST /api/feedback ──▶ Langfuse (existing, unchanged)
  │
  └── PUT /api/chat/messages/[id] ──▶ MongoDB messages collection
        └── $set: { feedback: { rating, reason, comment, submitted_at, submitted_by } }
```

Admin reads feedback from the `messages` collection where `feedback.rating` exists:

```
GET /api/admin/feedback?rating=negative&page=1&page_size=20
  │
  └── db.messages.find({ "feedback.rating": { $exists: true } })
        ├── $lookup: conversations ──▶ conversation title, owner
        ├── $sort: feedback.submitted_at descending
        └── $skip / $limit: pagination
```

### NPS Campaign System

NPS surveys are controlled by admin-created campaigns:

```
Admin creates campaign
  POST /api/admin/nps/campaigns
    └── { name, starts_at, ends_at }
    └── Overlap check: no two campaigns can be active simultaneously

User checks for active campaign
  GET /api/nps/active
    └── db.nps_campaigns.findOne({
          starts_at: { $lte: now },
          ends_at: { $gte: now },
          stopped_at: { $exists: false }
        })
    └── Returns: { active: boolean, campaign: { name, id } }

User submits NPS response
  POST /api/nps
    └── { score: 0-10, comment?, campaign_id }
    └── Stored in nps_responses collection

Admin stops campaign early
  PATCH /api/admin/nps/campaigns
    └── $set: { stopped_by, stopped_at }
    └── Inline confirmation in UI (no browser popup)
```

### NPS Score Calculation

```
GET /api/admin/nps?campaign_id=X
  │
  ├── Score = (% Promoters) - (% Detractors)
  │     Promoters: score 9-10
  │     Passives:  score 7-8
  │     Detractors: score 0-6
  │
  ├── 30-day trend: daily NPS scores for sparkline chart
  │
  └── Per-campaign filtering via campaign_id query param
```

### Feature Gating

Two independent feature flags control visibility:

| Feature | Env Var | Default | Controls |
|---|---|---|---|
| Feedback | `FEEDBACK_ENABLED` | `true` (on) | Feedback tab, feedback API |
| NPS | `NPS_ENABLED` | `false` (off) | NPS tab, NPS survey, campaign API |

The admin page dynamically adjusts tab grid columns based on which features are enabled.

### Read-Only Admin Audit Access

When admins click feedback chat links, they access conversations in read-only mode:

```
requireConversationAccess() returns access_level: "admin_audit"
  │
  └── ChatPanel renders with readOnly=true
        ├── Audit banner: "You are viewing this conversation in read-only mode"
        ├── Message input disabled
        └── "Back to Feedback" navigates to /admin?tab=feedback
```

### MongoDB Collections

| Collection | Purpose | Key Fields |
|---|---|---|
| `messages` (existing) | Feedback data on message documents | `feedback.rating`, `feedback.reason`, `feedback.submitted_by` |
| `nps_responses` (new) | NPS survey responses | `user_email`, `score`, `comment`, `campaign_id`, `created_at` |
| `nps_campaigns` (new) | Admin-created NPS campaigns | `name`, `starts_at`, `ends_at`, `created_by`, `stopped_at` |

## Components Changed

| File | Description |
|---|---|
| `ui/src/lib/config.ts` | Added `feedbackEnabled` (default true) and `npsEnabled` (default false) config flags |
| `ui/src/app/api/admin/feedback/route.ts` | GET endpoint for paginated feedback with rating filter and conversation lookup |
| `ui/src/app/api/admin/nps/route.ts` | GET endpoint for NPS analytics with score calculation and 30-day trend |
| `ui/src/app/api/admin/nps/campaigns/route.ts` | POST/GET/PATCH for campaign CRUD with overlap prevention |
| `ui/src/app/api/nps/route.ts` | POST for submitting NPS responses |
| `ui/src/app/api/nps/active/route.ts` | GET to check for active campaign |
| `ui/src/app/(app)/admin/page.tsx` | Conditional Feedback and NPS tabs with deep-linkable `?tab=` support |
| `ui/src/lib/api-middleware.ts` | `admin_audit` and `shared_readonly` access levels; write blocking for both |
| `ui/src/components/chat/ChatPanel.tsx` | `readOnly` and `readOnlyReason` props with contextual banners |

## Related

- Spec: [spec.md](./spec.md)
