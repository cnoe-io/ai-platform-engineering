# Implementation Plan: Complete Tome Admin KPI Dashboard

**Branch**: `2026-07-27-tome-kpi-completion` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

## Summary

Extend the protected Tome admin analytics endpoint with MongoDB-backed, aggregate-only coverage, engagement, source-health, hierarchy, and BHAG synthesis metrics. Render the KPI groups in the existing admin analytics tab and remove the duplicate Projects Executive Dashboard route and entry point. Preserve the existing Prometheus-backed performance and uptime metrics.

## Technical Context

**Language/Version**: TypeScript, Next.js App Router, React
**Primary Dependencies**: MongoDB driver, existing Next.js UI components, Recharts
**Storage**: Existing `projects`, `tome_chat_sessions`, `tome_chat_messages`, and `tome_ingest_runs` collections
**Testing**: Jest unit tests in `ui/src/lib/tome/__tests__/analytics.test.ts`; TypeScript check, lint, production build
**Target Platform**: CAIPE UI server
**Project Type**: Web application
**Performance Goals**: One bounded aggregate request per collection; no per-project chat-user payloads
**Constraints**: Admin-only, aggregate-only, no secrets or schema migration, best-effort when collections are absent
**Scale/Scope**: One existing endpoint and dashboard tab; active projects only for coverage/adoption metrics

## Constitution Check

- Simplicity: extend the existing analytics module and endpoint rather than introducing a reporting service.
- YAGNI: no historical snapshots, background jobs, or new collections; calculate current aggregates from existing records.
- Security: preserve `isTomeAdmin`; do not expose user IDs, email addresses, or project-level user activity.
- CI: add deterministic unit coverage before merge and run UI quality gates.

## Project Structure

```text
ui/
├── src/lib/tome/analytics.ts                         # aggregate builders and Mongo queries
├── src/lib/tome/__tests__/analytics.test.ts          # pure aggregation and bucketing tests
├── src/app/api/tome/admin/analytics/route.ts         # protected response composition
└── src/components/tome/admin/TomeAnalyticsTab.tsx     # KPI rendering

docs/docs/specs/2026-07-27-tome-kpi-completion/
├── spec.md
├── plan.md
└── tasks.md
```

**Structure Decision**: Keep all logic in the existing server-only Tome analytics module. The API route composes independent metrics in parallel; the client only receives aggregate numbers and renders cards.

## Database migrations

N/A — this feature reads existing fields and collections only. It creates no collections, indexes, fields, or backfill work.

## Implementation Steps

1. Add pure helpers and types for project source counting, activity/freshness bucketing, and BHAG/Area/project hierarchy aggregation.
2. Add one server-only function that fetches active project metadata plus aggregate session/message/ingest data and returns the new KPI model.
3. Include the model in the existing authenticated analytics response.
4. Render compact coverage, engagement, source-health, hierarchy, and BHAG cards in the existing analytics tab with clear windows and data-source labels.
5. Remove the standalone Executive Dashboard component, route, and Projects Hub button.
6. Add focused unit tests for boundaries and aggregate arithmetic, then run UI lint, tests, type-check, and build.
