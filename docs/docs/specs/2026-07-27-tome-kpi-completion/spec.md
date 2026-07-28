# Feature Specification: Complete Tome Admin KPI Dashboard

**Feature Branch**: `2026-07-27-tome-kpi-completion`
**Created**: 2026-07-27
**Status**: Implemented — pending review
**Input**: Complete GitHub issue #180 platform-level Tome KPI dashboard with real coverage, adoption, engagement, health, and BHAG aggregates.

## User Scenarios & Testing

### User Story 1 - Assess project coverage and adoption (Priority: P1)

A Tome administrator can see how many active projects have a data steward, connected sources, and recent Tome activity, including the number that are dormant.

**Why this priority**: This is the minimum leadership scorecard needed to decide whether Tome is being adopted and operated responsibly.

**Independent Test**: Seed projects with and without stewards, sources, and recent activity; the endpoint returns the corresponding aggregate counts and the UI renders them without project-user details.

**Acceptance Scenarios**:

1. **Given** active and archived projects, **When** an administrator opens Tome analytics, **Then** only active projects contribute to coverage and adoption totals.
2. **Given** projects with varied steward, source, chat, and ingest state, **When** analytics loads, **Then** it reports real covered, active, and dormant counts.

---

### User Story 2 - Assess engagement and source health (Priority: P2)

A Tome administrator can assess aggregate chat depth and whether project sources are fresh, aging, or stale.

**Why this priority**: Usage counts alone do not show whether teams return to Tome or whether the information being used is current.

**Independent Test**: Seed chat sessions and source/ingest timestamps across the freshness boundaries; verify aggregate engagement and freshness buckets.

**Acceptance Scenarios**:

1. **Given** repeated and one-off sessions, **When** analytics loads, **Then** it reports aggregate sessions, messages, and repeat-session usage without exposing identities.
2. **Given** projects with recent, aging, stale, and no source activity, **When** analytics loads, **Then** each project is counted in exactly one freshness bucket.

---

### User Story 3 - Assess BHAG rollup health (Priority: P3)

A Tome administrator can see the number of BHAGs, their child-project coverage, and the freshness of each BHAG's most recent synthesis.

**Why this priority**: A strategic rollup is only useful when it reflects current child-project information.

**Independent Test**: Seed BHAGs, labelled child projects, and synthesis ingest runs; verify the resulting count, child total, and freshness distribution.

**Acceptance Scenarios**:

1. **Given** BHAGs with labelled children, **When** analytics loads, **Then** it returns the real BHAG and child-project totals.
2. **Given** successful syntheses at different times, **When** analytics loads, **Then** it classifies them as fresh, aging, stale, or never synthesized.

---

### User Story 4 - Assess the Tome hierarchy in one metrics view (Priority: P1)

A Tome administrator can see the active BHAG, Area, and direct-project counts and how many child relationships connect each level, without using a separate Executive Dashboard.

**Why this priority**: Portfolio structure is only useful when it is measured together with the operational health metrics it governs.

**Independent Test**: Seed BHAG, Area, and direct-project label relationships using either stable slugs or display names; verify hierarchy totals and relation counts.

**Acceptance Scenarios**:

1. **Given** a BHAG containing Areas and direct projects, **When** analytics loads, **Then** it shows the BHAG/Area/project totals and relation counts.
2. **Given** the Executive Dashboard route and entry point, **When** the feature is deployed, **Then** neither remains available in the product navigation.

---

### User Story 5 - Assess onboarding, wiki maturity, reliability, and value (Priority: P1)

A Tome administrator can assess project onboarding growth, distinguish projects that have progressed beyond their initial greenfield ingest, see ingest reliability, compare engagement by project and BHAG, and see the measured cost per active project.

**Independent Test**: Seed dated projects, successful and failed ingest runs, greenfield and incremental ingest runs, recorded costs, sessions, and hierarchy labels; verify all aggregate and per-project values.

**Acceptance Scenarios**:

1. **Given** projects created over time, **When** analytics loads, **Then** it shows total onboarded, new projects in the trailing window, and a daily onboarding trend.
2. **Given** successful greenfield-only, incremental, and no-successful-ingest projects, **When** analytics loads, **Then** it classifies them as greenfield-only, real wiki, or empty shell respectively.
3. **Given** terminal source ingest runs, **When** analytics loads, **Then** it reports succeeded, failed, and success-rate counts for the trailing window.
4. **Given** recorded run completion cost, **When** analytics loads, **Then** it reports measured cost per active project and clearly identifies that historical runs without a cost are not included.

### Edge Cases

- MongoDB collections may be absent in a new installation; analytics returns zero/empty aggregates rather than failing the admin page.
- A synthesized project has no direct sources and must not reduce source-coverage percentages.
- A project with both source activity and a successful ingest uses the most recent timestamp for freshness.
- A BHAG with no successful synthesis is represented as `never`, not as fresh.

## Requirements

### Functional Requirements

- **FR-001**: The existing Tome-admin authorization gate MUST protect every new KPI aggregate.
- **FR-002**: The system MUST calculate coverage from active non-synthesized projects: data steward present and at least one configured source.
- **FR-003**: The system MUST calculate active versus dormant projects from a trailing 30-day chat-session or successful-ingest signal.
- **FR-004**: The system MUST expose aggregate chat sessions, messages, and repeat-session usage without returning user identifiers.
- **FR-005**: The system MUST classify each active non-synthesized project into exactly one source-health bucket using the latest source-event or successful-ingest timestamp.
- **FR-006**: The system MUST report BHAG count, labelled child-project count, and latest successful synthesis freshness without creating new persistent data.
- **FR-007**: The admin dashboard MUST label each metric with its data source and window so it cannot be mistaken for an inferred score.
- **FR-008**: The implementation MUST include focused unit tests for the pure aggregation and bucket-classification rules.
- **FR-009**: The system MUST report active BHAG, Area, and direct-project counts plus BHAG-to-Area, BHAG-to-project, and Area-to-project relationship counts in the Tome metrics view.
- **FR-010**: The system MUST accept either stable slugs or display names in existing hierarchy labels so legacy data is counted consistently.
- **FR-011**: The system MUST remove the separate Projects Executive Dashboard route, component, and Projects Hub entry point.
- **FR-012**: The system MUST report active direct-project onboarding totals, trailing-window growth, and a daily onboarding trend using `projects.created_at`.
- **FR-013**: The system MUST classify active direct projects as real wiki (a successful non-greenfield source ingest), greenfield-only (a successful greenfield ingest only), or empty shell (no successful source ingest).
- **FR-014**: The system MUST report source-ingest succeeded, failed, and success-rate totals over the trailing window; queued, running, review, and synthesis runs are excluded.
- **FR-015**: The system MUST return per-project aggregate engagement and a BHAG child-project breakdown without returning user identities.
- **FR-016**: The system MUST persist an agent-reported run completion cost when available and report the measured cost per active project, including coverage of runs with a recorded cost.

### Key Entities

- **Active project**: A project with `status: active`; synthesized project types are excluded from direct source coverage.
- **Project coverage**: Steward and configured-source presence across active non-synthesized projects.
- **Engagement aggregate**: Aggregate Tome chat session and message totals, including the count of sessions beyond a user's first session.
- **Source-health bucket**: Fresh, aging, stale, or never, based on the latest source event or successful ingest.
- **BHAG rollup**: A `bhag` project, its children identified by initiative labels, and its successful `/synthesize` ingest history.
- **Real wiki**: An active direct project with at least one successful non-greenfield source ingest.
- **Cost coverage**: The share of terminal source runs that included a numeric agent-reported completion cost; historic runs without that field remain visible as unmeasured rather than being treated as zero.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Administrators can load all #180 KPI aggregates from one protected endpoint without receiving any user identifiers.
- **SC-002**: Test fixtures covering each coverage, activity, freshness, and synthesis state produce deterministic expected totals.
- **SC-003**: Each active non-synthesized project and each BHAG is counted in exactly one applicable health bucket.
- **SC-004**: Existing adoption, satisfaction, performance, uptime, and consumption analytics remain available.
