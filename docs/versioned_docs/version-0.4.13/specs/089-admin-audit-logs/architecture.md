---
sidebar_position: 1
id: 089-admin-audit-logs-architecture
sidebar_label: Architecture
---

# Architecture: Admin Audit Logs

## Decision

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **Read-only view over existing collections (chosen)** | No new collections, no data duplication, simple queries | Coupled to conversation schema | Selected |
| Separate audit log collection with write-ahead logging | Immutable audit trail, decoupled | Storage overhead, write amplification | Rejected (over-engineered) |
| External audit system (ELK/Splunk) | Enterprise-grade, existing tooling | Infrastructure dependency, complex setup | Deferred |

## Solution Architecture

### Triple-Gated Access Control

```
Request ──▶ AUDIT_LOGS_ENABLED env var?
  │
  ├── false ──▶ 403 "Audit logs are not enabled"
  └── true  ──▶ requireAdmin(session)?
                  │
                  ├── Not admin ──▶ 403
                  └── Admin ──▶ Process request
                                  │
                                  └── UI: auditLogsEnabled config?
                                        ├── false ──▶ Tab hidden
                                        └── true  ──▶ Tab visible
```

The feature is gated at three levels:
1. **Environment variable**: `AUDIT_LOGS_ENABLED=true` must be set (disabled by default)
2. **Server-side auth**: `requireAdmin` middleware (full admin only, not read-only viewers)
3. **UI visibility**: `auditLogsEnabled` config hides the tab when disabled

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/admin/audit-logs` | GET | List conversations with filters and pagination |
| `/api/admin/audit-logs/[id]/messages` | GET | Paginated messages for a specific conversation |
| `/api/admin/audit-logs/export` | GET | Download filtered conversations as CSV |
| `/api/admin/audit-logs/owners` | GET | Search distinct owner emails (typeahead) |

### MongoDB Aggregation Pipeline

The list endpoint uses a MongoDB aggregation pipeline with `$lookup` to enrich conversation documents:

```
conversations collection
  │
  ├── $match: filters (owner_email, search, date_range, status)
  ├── $lookup: messages collection ──▶ last_message_at, message_count
  ├── $sort: created_at descending
  ├── $skip / $limit: pagination
  └── $project: AuditConversation shape
```

### CSV Export

The export endpoint generates CSV with:
- Proper field escaping (double-quote wrapping, escaped internal quotes)
- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="audit-logs-YYYY-MM-DD.csv"`
- `Cache-Control: no-store` to prevent caching of sensitive data
- Maximum 10,000 rows to prevent memory exhaustion
- Respects active filters (same as list endpoint)

### Owner Search (Typeahead)

```
GET /api/admin/audit-logs/owners?q=john
  │
  └── db.conversations.aggregate([
        { $group: { _id: "$owner_id" } },
        { $match: { _id: { $regex: /john/i } } },
        { $limit: 20 }
      ])
```

## Components Changed

| File | Description |
|---|---|
| `ui/src/lib/config.ts` | Added `auditLogsEnabled` to Config interface and `getServerConfig()` |
| `ui/src/types/mongodb.ts` | Added `AuditConversation` and `AuditLogFilters` types |
| `ui/src/app/api/admin/audit-logs/route.ts` | List conversations with aggregation pipeline |
| `ui/src/app/api/admin/audit-logs/[id]/messages/route.ts` | Paginated messages for conversation detail |
| `ui/src/app/api/admin/audit-logs/export/route.ts` | CSV export with escaping and Cache-Control |
| `ui/src/app/api/admin/audit-logs/owners/route.ts` | Distinct owner email search with typeahead |
| `ui/src/app/(app)/admin/page.tsx` | Conditional Audit Logs tab rendering |
| `ui/src/components/admin/AuditLogsTab.tsx` | Filter/search/table component with export and owner search |
| `ui/src/components/admin/ConversationDetailDialog.tsx` | Message viewer dialog with scrolling |

## Related

- Spec: [spec.md](./spec.md)
