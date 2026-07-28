# Tasks: Complete Tome Admin KPI Dashboard

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Specification and foundation

- [x] T001 Document the aggregate-only, admin-gated KPI requirements in `docs/docs/specs/2026-07-27-tome-kpi-completion/spec.md`.
- [x] T002 Document the existing-collection implementation design in `docs/docs/specs/2026-07-27-tome-kpi-completion/plan.md`.

## Phase 2: User Story 1 - Coverage and adoption

- [x] T003 [US1] Add active-project coverage and activity aggregation types/helpers in `ui/src/lib/tome/analytics.ts`.
- [x] T004 [P] [US1] Add unit tests for configured sources, active/dormant boundaries, and synthesized-project exclusion in `ui/src/lib/tome/__tests__/analytics.test.ts`.
- [x] T005 [US1] Include coverage/adoption data in `ui/src/app/api/tome/admin/analytics/route.ts`.
- [x] T006 [US1] Render coverage and active/dormant KPI cards in `ui/src/components/tome/admin/TomeAnalyticsTab.tsx`.

## Phase 3: User Story 2 - Engagement and source health

- [x] T007 [US2] Add aggregate engagement and source-health bucketing in `ui/src/lib/tome/analytics.ts`.
- [x] T008 [P] [US2] Add unit tests for engagement arithmetic and freshness boundaries in `ui/src/lib/tome/__tests__/analytics.test.ts`.
- [x] T009 [US2] Render engagement and source-health KPI cards in `ui/src/components/tome/admin/TomeAnalyticsTab.tsx`.

## Phase 4: User Story 3 - BHAG rollup health

- [x] T010 [US3] Add BHAG child and successful-synthesis aggregation in `ui/src/lib/tome/analytics.ts`.
- [x] T011 [P] [US3] Add unit tests for child association and synthesis freshness in `ui/src/lib/tome/__tests__/analytics.test.ts`.
- [x] T012 [US3] Render the BHAG rollup KPI card in `ui/src/components/tome/admin/TomeAnalyticsTab.tsx`.

## Phase 5: Validation and handoff

- [x] T013 [US4] Add BHAG/Area/project relation counts and legacy-label matching in `ui/src/lib/tome/analytics.ts`.
- [x] T014 [P] [US4] Add hierarchy aggregation regression coverage in `ui/src/lib/tome/__tests__/analytics.test.ts`.
- [x] T015 [US4] Render the hierarchy relationship metrics in `ui/src/components/tome/admin/TomeAnalyticsTab.tsx`.
- [x] T016 [US4] Remove the Executive Dashboard component, route, and Projects Hub entry point.
- [x] T017 Run focused Jest tests, TypeScript check, lint, and production build from `ui/`.
- [x] T018 Review the protected response to verify it contains only aggregate metrics and no user identifiers.

## Phase 6: User Story 5 - Onboarding, maturity, reliability, and value

- [x] T019 [US5] Extend the specification with onboarding, maturity, reliability, engagement-breakdown, and measured-cost requirements.
- [x] T020 [US5] Persist agent-reported completion cost and turns on each ingest run in `ui/src/lib/tome/ingest-runner.ts` and `ui/src/types/tome.ts`.
- [x] T021 [US5] Add onboarding, wiki maturity, ingest success, per-project engagement, BHAG child breakdown, and cost aggregations in `ui/src/lib/tome/analytics.ts`.
- [x] T022 [P] [US5] Add unit coverage for maturity, reliability, cost, and hierarchy engagement aggregation in `ui/src/lib/tome/__tests__/analytics.test.ts`.
- [x] T023 [US5] Add onboarding trend data to `ui/src/app/api/tome/admin/analytics/route.ts` and render the added scorecard and trend UI.
- [x] T024 [US5] Run focused Jest tests, TypeScript check, lint, and production build from `ui/`.
