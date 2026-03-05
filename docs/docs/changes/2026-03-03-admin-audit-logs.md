---
title: "2026-03-03: Admin Audit Logs — All-Chats Compliance View"
---

# Admin Audit Logs — All-Chats Compliance View

**Date**: 2026-03-03
**Status**: Implemented
**Type**: Feature Addition

## Overview

Added an optional admin-only feature that allows platform administrators to browse, search, and export all conversations and full message content across all users. The feature is gated by the `AUDIT_LOGS_ENABLED` environment variable and disabled by default.

## Problem Statement

Administrators had no way to review user conversations with AI agents for compliance, auditing, or support purposes. The existing admin dashboard provided aggregate statistics (total conversations, message counts, top users) but no ability to inspect individual conversation content across users.

## Decision

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **New admin tab with env-var gate (chosen)** | Opt-in, no impact on existing deployments, reuses existing MongoDB collections | Requires env var configuration to enable | Selected |
| Always-on audit view | No configuration needed | Privacy concern; exposes all chats by default | Rejected |
| Separate audit service | Decoupled, scalable | Over-engineered for current needs; new infrastructure | Rejected |
| Database-level audit logs | Captures all mutations | Does not provide user-friendly browsing UI | Rejected — complementary, not replacement |

## Solution Architecture

### Feature Gate

The feature follows the same pattern as `workflowRunnerEnabled`:

```bash
AUDIT_LOGS_ENABLED=true  # Set to enable; omit or set false to disable
```

The gate is enforced at three levels:
1. **Env var**: `AUDIT_LOGS_ENABLED=true` must be set (disabled by default)
2. **UI**: The Audit Logs tab is only rendered when `auditLogsEnabled` is true AND the user is a full admin (`isAdmin`) — read-only admin viewers do not see the tab
3. **API**: All endpoints return HTTP 403 if the feature is disabled OR if the user is not a full admin (`requireAdmin`, not `requireAdminView`)

### API Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/admin/audit-logs` | GET | `requireAdmin` | List all conversations with filters and pagination |
| `/api/admin/audit-logs/[id]/messages` | GET | `requireAdmin` | Get paginated messages for a specific conversation |
| `/api/admin/audit-logs/export` | GET | `requireAdmin` | Download filtered conversations as CSV (up to 10,000 rows) |
| `/api/admin/audit-logs/owners` | GET | `requireAdmin` | Search distinct conversation owner emails (typeahead) |

### List Endpoint Filters

| Parameter | Type | Description |
|---|---|---|
| `owner_email` | string | Filter by conversation owner (case-insensitive substring) |
| `search` | string | Search in conversation titles (case-insensitive substring) |
| `date_from` | ISO date | Conversations created on or after this date |
| `date_to` | ISO date | Conversations created on or before this date |
| `status` | enum | `active`, `archived`, or `deleted` |
| `include_deleted` | boolean | Include soft-deleted conversations (default: false) |
| `page` | number | Page number (default: 1) |
| `page_size` | number | Items per page (default: 20, max: 100) |

### Export Endpoint

The export endpoint accepts the same filter parameters as the list endpoint but returns a CSV file instead of JSON. The response includes:
- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="audit-logs-&#123;timestamp&#125;.csv"`
- `Cache-Control: no-store`
- CSV columns: Conversation ID, Owner, Title, Status, Messages, Created, Updated, Last Message, Tags, Shared With, Shared With Teams, Is Public
- Maximum 10,000 rows per export

### Owners Endpoint

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Case-insensitive substring search on owner_id (optional) |

Returns up to 50 distinct owner emails sorted alphabetically. Used by the searchable owner dropdown in the UI.

### Data Flow

The feature queries existing MongoDB collections (`conversations` and `messages`) with no schema changes. The list and export endpoints use a `$lookup` aggregation to fetch the last message timestamp and derive conversation status from `deleted_at` and `is_archived` fields. The owners endpoint uses `$group` to extract distinct `owner_id` values.

### Configuration

```bash
# Enable audit logs (disabled by default)
AUDIT_LOGS_ENABLED=true
```

No additional configuration is required. The feature inherits MongoDB connection settings and admin authorization from the existing platform configuration. The env var is documented in `ui/.env.example`.

## Components Changed

### Config
- `ui/src/lib/config.ts` — Added `auditLogsEnabled: boolean` to Config interface, DEFAULT_CONFIG (false), and getServerConfig()
- `ui/.env.example` — Documented `AUDIT_LOGS_ENABLED` env var in Feature Flags section

### Types
- `ui/src/types/mongodb.ts` — Added `AuditConversation` (extends Conversation with `message_count`, `last_message_at`, `status`) and `AuditLogFilters`

### API Routes
- `ui/src/app/api/admin/audit-logs/route.ts` (new) — GET handler with feature-flag check, admin auth, MongoDB aggregation pipeline with filters and pagination
- `ui/src/app/api/admin/audit-logs/[id]/messages/route.ts` (new) — GET handler returning paginated messages with conversation metadata
- `ui/src/app/api/admin/audit-logs/export/route.ts` (new) — GET handler generating CSV export with filters, proper escaping, and security headers
- `ui/src/app/api/admin/audit-logs/owners/route.ts` (new) — GET handler returning distinct owner emails with optional search filter

### UI Components
- `ui/src/app/(app)/admin/page.tsx` — Conditionally renders Audit Logs tab when `auditLogsEnabled` is true and user is full admin
- `ui/src/components/admin/AuditLogsTab.tsx` (new) — Filter bar with searchable owner dropdown, results table, CSV download button, pagination, conversation UUID display with copy and chat link
- `ui/src/components/admin/ConversationDetailDialog.tsx` (new) — Dialog for viewing full conversation messages with scrollable layout, UUID display, copy-to-clipboard, and direct chat link

### Tests
- `ui/src/app/api/__tests__/admin-audit-logs.test.ts` (new) — 52 tests covering authentication, authorization, feature flag enforcement, filtering (including edge cases for archived, include_deleted, single date bounds, combined filters), pagination, sort order, CSV export (including null tags, empty results, status filters), and owner search across all 4 endpoints
- `ui/src/app/api/__tests__/admin-audit-access.test.ts` (new) — 8 tests for `requireConversationAccess` admin audit access levels
- `ui/src/lib/__tests__/config.test.ts` — 4 tests added for `auditLogsEnabled` env-var behavior (default false, true/false values, non-"true" values rejected)

## Security

- Triple-gated: env var + full admin role (`requireAdmin`) + UI visibility check
- Read-only admin viewers (`canViewAdmin`) cannot access audit logs — only full admins (`session.role === 'admin'`) can
- Server-side enforcement: all 4 API endpoints reject with 403 when feature is disabled or user is not a full admin
- Read-only: no mutation endpoints exposed
- MongoDB queries use parameterized aggregation pipelines
- CSV export response includes `Cache-Control: no-store` to prevent caching of sensitive data
- `AUDIT_LOGS_ENABLED` defaults to false — opt-in only

## Related

- Spec: `.specify/specs/admin-audit-logs.md`
- PR: [#894](https://github.com/cnoe-io/ai-platform-engineering/pull/894) (initial implementation)
- Tests: `ui/src/app/api/__tests__/admin-audit-logs.test.ts` (52 tests)
- Tests: `ui/src/app/api/__tests__/admin-audit-access.test.ts` (8 tests)
- Tests: `ui/src/lib/__tests__/config.test.ts` (4 `auditLogsEnabled` tests)
- Admin dashboard: `ui/src/app/(app)/admin/page.tsx`
- Config system: `ui/src/lib/config.ts`
