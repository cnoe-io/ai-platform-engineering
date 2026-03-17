---
sidebar_position: 2
sidebar_label: Specification
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


## Motivation

User feedback was collected via `FeedbackButton` (thumbs up/down + reasons) but only sent to Langfuse. It was never persisted to MongoDB, so the admin dashboard's `feedback_summary` in the Statistics tab always showed zeros. Admins had no visibility into individual feedback entries or satisfaction trends.

Additionally, there was no mechanism for measuring Net Promoter Score — a standard product health metric used to gauge user loyalty and satisfaction. NPS should be admin-controlled (not automatic) so that admins decide when to launch surveys.


## Testing Strategy

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


## Related

- Architecture: [architecture.md](./architecture.md)
