# Implementation Plan: Unified Projects Platform — Labels & Executive Dashboard

**Branch**: `2026-06-07-unified-projects-platform` | **Date**: 2026-06-08 | **Spec**: [spec.md](./spec.md)
**Scope of this plan**: the not-yet-built core — project **label dimensions** (Domain · BHAG/Initiative · Swim Lane), **label-based discovery**, and the **executive dashboard**. (App-tiles, budget consumption feed, and full unification migration are tracked separately.)

## Summary

Add free-form, multi-value label dimensions to the existing `projects` MongoDB documents, expose label-faceted search on the projects API, and add a `/projects/dashboard` executive view that rolls projects up by Domain / BHAG / Swim Lane with status counts (and a budget-health placeholder). Domain is both the structural catalog parent *and* a denormalized label. Built in the existing Next.js UI; deployed via a `caipe-ui-prod` rebuild on the edge box.

## Technical Context

**Language/Version**: TypeScript (Next.js 15 App Router, React) + Node
**Primary Dependencies**: Next.js, MongoDB driver (`@/lib/mongodb`), existing `@/lib/api-middleware` (auth/envelope), `js-yaml`
**Storage**: MongoDB — existing `projects` collection (extend), `catalog` collection (domain source of truth)
**Testing**: Jest (unit + route tests, mongo mocked — existing pattern)
**Target Platform**: Web (caipe-ui-prod), deployed on the `caipe-edge-testing.outshift.io` docker-compose stack
**Project Type**: web application (Next.js full-stack)
**Performance Goals**: dashboard rollups reconcile exactly to records (SC-002); multi-label filter < 5s (SC-001) — trivial at expected scale
**Constraints**: reuse existing auth (reads authenticated, writes org-admin), `{success,data}` envelope, Backstage-compatible export preserved
**Scale/Scope**: tens–hundreds of projects per org; ~3 new API surfaces + 1 dashboard page + label editors

## Constitution Check

- **Spec-first**: this plan derives from the approved spec ✅
- **Tests**: add unit tests for label normalization/faceting + route tests for filter/facets (matches repo's 484-test pattern) ✅
- **Reuse over new**: extend `projects` collection + `/api/projects`, no new datastore ✅
- **No implementation leakage in spec**: spec stays tech-agnostic ✅
No violations.

## Key design decisions (from spec clarifications)

- **Domain** = structural catalog parent (in `catalog`) **denormalized** onto the project as a label for faceting (FR-008).
- **BHAG/Initiative** and **Swim Lane** = **free-form** string labels, **multi-value**; grouped case/whitespace-insensitive via a normalized key (FR-009).
- **Budget** = pluggable; dashboard shows `unbudgeted` until the manual provider lands (FR-019).

## Data model (delta to `ProjectDocument`)

Add a `labels` object (all optional, default empty):
```
labels: {
  domain?: string;          // denormalized; mirrors structural domain / spec.domain
  initiatives?: string[];   // BHAG / Initiative, free-form, multi-value
  swimlanes?: string[];     // Swim Lane, free-form, multi-value
}
```
- Normalization helper `normLabel(s) = s.trim().toLowerCase()` for grouping/dedup; display value preserved.
- `domain` stays the existing top-level field too (back-compat); `labels.domain` mirrors it.
- Indexes: `{ "labels.domain": 1 }`, `{ "labels.initiatives": 1 }`, `{ "labels.swimlanes": 1 }`.

See [data-model.md](./data-model.md) and [mongodb-migration.md](./mongodb-migration.md).

## Contracts (API)

1. **GET `/api/projects`** — add query params `domain`, `initiative`, `swimlane` (repeatable), `q` (free text over name/title/description/label values). AND across dimensions, OR within a dimension. RBAC unchanged (team-filtered for non-admins).
2. **GET `/api/projects/facets`** — returns `{ domains:[{value,count}], initiatives:[...], swimlanes:[...], total }` over the caller's visible projects (drives dashboard + filter chips).
3. **POST `/api/projects`** / **PATCH `/api/projects/[slug]`** — accept `labels` on create/update (org-admin).
4. Onboarding wizard create payload accepts `initiatives`/`swimlanes`.

## UI

- **`/projects/dashboard`** (new): three grouped sections (Domain, BHAG/Initiative, Swim Lane) — each a list of label values with project counts + status breakdown chips, click → `/projects?domain=…` (filtered hub). Budget-health column = placeholder badge. Link from the Projects hub.
- **Projects hub** (`ProjectsHub`): add label **filter chips** (from `/api/projects/facets`) + show each project's labels on its card.
- **Label editors**: onboarding wizard (initiatives/swimlanes inputs) + project detail edit.

## Phasing

- **Phase A (labels + filtering)**: model + migration + create/update/list filter + facets API + show labels on cards + filter chips + tests.
- **Phase B (dashboard)**: `/projects/dashboard` rollups + drill-down + nav link.
- **Phase C (editors)**: onboarding + detail label editing.
- Deploy each phase via `caipe-ui-prod` rebuild on the edge box.

## Database migrations

Storage = MongoDB. `labels` is **additive/optional** → **no backfill required** to read (absent = empty). Optional one-time backfill sets `labels.domain` from the existing `domain` field. New indexes are non-unique and safe. See [mongodb-migration.md](./mongodb-migration.md). Rollback = drop the new indexes + ignore the field.

## Complexity Tracking

No constitution violations; no extra projects/abstractions introduced (extends existing collection + routes).
