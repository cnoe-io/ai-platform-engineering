# Feature Specification: Unified Projects Platform

**Feature Branch**: `2026-06-07-unified-projects-platform`
**Created**: 2026-06-07
**Status**: Draft
**Input**: User description: "Unified Projects platform — executive dashboard, label-based discovery (Domains / BHAGs / Initiatives / Swim Lanes), app tiles deep-linking to T3 / Context Graph / Agent Mesh / FinOps, and budget-aware onboarding; unify the two overlapping project models into one source of truth."

## Overview

Today the platform has **two overlapping representations of a "project"**: a rich project record (onboarding state, catalog sync, integration links) and a separate hierarchy of catalog entities (domain → sub-domain → system → component). Labels, dashboards, app tiles, and budgets all need a **single source of truth**. This feature unifies them, then layers on label-based discovery, an executive dashboard, per-project app tiles, and budget-aware onboarding.

Standing up the Outshift Context Graph service locally and wiring it to the edge deployment is **explicitly out of scope** here (separate infrastructure spec); this feature only needs a deep-link target for the Context Graph tile.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover projects by labels (Priority: P1)

A platform owner opens Projects and filters by any combination of **Domain**, **BHAG / Initiative**, and **Swim Lane** labels (e.g. "Domain = Platform" + "Initiative = Agentic-2026") and gets the matching projects, with the active labels visible on each result.

**Why this priority**: Discovery across the org's labelling scheme is the foundation every other view (dashboard, tiles, budgets) reads from. Without it there is no way to slice the portfolio.

**Independent Test**: Seed projects carrying different label combinations; apply single- and multi-label filters and free-text search; verify only matching projects return and every applied label is displayed on results.

**Acceptance Scenarios**:

1. **Given** projects labelled across several Domains and Initiatives, **When** a user filters by one Domain and one Initiative, **Then** only projects carrying both labels are returned.
2. **Given** a free-text query, **When** the user searches, **Then** results match on project name, title, description, and label values.
3. **Given** a label that no project carries, **When** the user filters by it, **Then** an empty result with a clear "no matches" state is shown.

---

### User Story 2 - Executive dashboard (Priority: P1)

An executive opens a dashboard that rolls the project portfolio up by label dimension — counts and status by Domain, by BHAG / Initiative, and by Swim Lane — with budget health surfaced at a glance (on-track / at-risk / over).

**Why this priority**: The primary business outcome — a leadership-facing portfolio view. Delivers value the moment labels and budgets exist.

**Independent Test**: With a seeded portfolio, load the dashboard and verify each dimension's rollup counts and budget-health indicators reconcile exactly with the underlying project records.

**Acceptance Scenarios**:

1. **Given** a portfolio of labelled projects, **When** the dashboard loads, **Then** projects are grouped by each label dimension with accurate counts and status breakdowns.
2. **Given** projects with budgets, **When** the dashboard loads, **Then** each group shows aggregate budget health (allocated vs. consumed) and flags groups that are over threshold.
3. **Given** a user clicks a dashboard segment (e.g. a Domain), **When** the drill-down opens, **Then** the filtered project list for that segment is shown.

---

### User Story 3 - App tiles on the project view (Priority: P2)

From a project's detail page, a member sees tiles for the apps relevant to that project — **T3**, **Outshift Context Graph**, **Agent Mesh**, **FinOps** — and clicking a tile opens that app in the correct context for the project.

**Why this priority**: Turns the project page into a launchpad, but depends on a project existing and being discoverable (US1) first.

**Independent Test**: Configure the app-tile registry, open a project, verify the expected tiles render and each link resolves to the app deep-linked with that project's identifying context.

**Acceptance Scenarios**:

1. **Given** the app-tile registry is configured, **When** a member opens a project, **Then** a tile is shown for each enabled app.
2. **Given** a project with slug/labels, **When** a member clicks an app tile, **Then** the destination opens parameterized for that project.
3. **Given** an app is disabled or unconfigured, **When** the project opens, **Then** its tile is hidden (no broken links).

---

### User Story 4 - Budget-aware onboarding (Priority: P2)

When onboarding a project, an owner sets a budget allocation and alert thresholds. A dedicated budget view then shows allocation, consumption, remaining, and threshold status for the project (and feeds the dashboard's budget health).

**Why this priority**: Adds financial governance to onboarding. High value, but builds on the unified project + dashboard.

**Independent Test**: Onboard a project with a budget and thresholds; open the budget view; verify allocation/consumption/remaining and threshold state render and that crossing a threshold is reflected as at-risk/over.

**Acceptance Scenarios**:

1. **Given** onboarding, **When** an owner enters a budget allocation and thresholds, **Then** the project's budget record is created and persisted independently of the project record.
2. **Given** a project with recorded consumption above a threshold, **When** the budget view loads, **Then** it is flagged at-risk or over per the threshold.
3. **Given** onboarding that fails partway, **When** the owner returns, **Then** prior budget input is retained and onboarding can resume.

---

### User Story 5 - Unify the two project models (Priority: P1, enabler)

An administrator runs a one-time reconciliation so existing project records and existing catalog entities collapse into a single canonical project model, with no data loss and Backstage-compatible export preserved.

**Why this priority**: Enabler for everything else — labels/dashboard/tiles/budgets must attach to one model. Without it the data is split.

**Independent Test**: With both legacy collections populated (including overlapping records), run reconciliation; verify each canonical project carries the union of fields, conflicts resolve by the documented rule, and Backstage export still validates.

**Acceptance Scenarios**:

1. **Given** records existing only in one collection, **When** reconciliation runs, **Then** each becomes a canonical project preserving all its fields.
2. **Given** records representing the same project in both collections, **When** reconciliation runs, **Then** they merge into one canonical project with the documented conflict-resolution outcome and no duplicates.
3. **Given** reconciliation completes, **When** a project's catalog representation is exported, **Then** it still matches the Backstage entity format.

---

### Edge Cases

- A project carries multiple values in one label dimension (e.g. two Initiatives) — discovery and dashboard rollups must count it under each.
- A label value is renamed or retired — existing projects must remain discoverable and the dashboard must not double-count or orphan them.
- A project has no budget — dashboard budget health treats it as "unbudgeted," not "over."
- Reconciliation conflict where both collections disagree on title/owner/domain — resolved by the documented rule, with the discarded value recorded for audit.
- An app-tile deep-link template references a label the project lacks — the tile is hidden or degrades gracefully rather than producing a broken link.
- Budget consumption data is stale or missing — the budget view shows "last updated" and an unknown-state indicator rather than implying $0 spend.

## Requirements *(mandatory)*

### Functional Requirements

#### Unified model & migration
- **FR-001**: System MUST represent every project as a single canonical record that is the sole source of truth for labels, dashboard, app tiles, and budget association.
- **FR-002**: System MUST provide a one-time, re-runnable (idempotent) reconciliation that merges the two legacy representations into the canonical model without data loss.
- **FR-003**: System MUST preserve a Backstage-compatible export of each project's catalog representation after unification.
- **FR-004**: System MUST resolve reconciliation conflicts by a single documented precedence rule and record discarded values for audit.

#### Labels & discovery
- **FR-005**: System MUST let each project carry label dimensions for **Domain**, **BHAG / Initiative**, and **Swim Lane**.
- **FR-006**: System MUST let users search and filter projects by any combination of label dimensions plus free text, returning only matching projects.
- **FR-007**: System MUST display the labels carried by each project in list and detail views.
- **FR-008**: System MUST treat `domain` as **both** a structural hierarchy parent **and** a label/facet: the structural parent remains the source of truth and is denormalized onto each project as a Domain label so the dashboard can facet by it. When a project's structural domain changes, the denormalized Domain label MUST stay in sync.
- **FR-009**: System MUST allow **free-form** label values for BHAG/Initiative and Swim Lane (no controlled vocabulary). To keep dashboard rollups meaningful, the system MUST normalize values for grouping (case- and whitespace-insensitive) and surface the distinct normalized values it is grouping by.

#### Executive dashboard
- **FR-010**: System MUST present a dashboard that groups projects by each label dimension with accurate counts and status breakdowns.
- **FR-011**: System MUST surface aggregate budget health per group (allocated vs. consumed, with at-risk/over flags).
- **FR-012**: Users MUST be able to drill down from any dashboard segment to the filtered project list for that segment.

#### App tiles
- **FR-013**: System MUST render, on a project's detail view, a tile per enabled app from a configurable registry (initially T3, Outshift Context Graph, Agent Mesh, FinOps).
- **FR-014**: System MUST build each tile's link from a per-app template parameterized by the project's identifying context (e.g. slug and/or labels).
- **FR-015**: System MUST hide tiles for apps that are disabled or whose link cannot be resolved for the project.

#### Budget-aware onboarding
- **FR-016**: System MUST capture, during onboarding, a budget allocation and alert thresholds for the project.
- **FR-017**: System MUST persist onboarding state and budget data in a dedicated store separate from the canonical project record.
- **FR-018**: System MUST provide a dedicated budget view showing allocation, consumption, remaining, and threshold status per project.
- **FR-019**: System MUST source budget consumption through a **pluggable consumption interface** with two providers: a **manual provider** (consumption entered/managed in-app), active this phase, and a **FinOps-feed provider** (stub/contract only this phase) that a future infrastructure effort can implement. The budget view and dashboard MUST be agnostic to which provider supplies the numbers. (Standing up the FinOps service itself remains out of scope.)
- **FR-020**: System MUST retain partially entered onboarding/budget input so a failed or abandoned onboarding can resume.

#### Access & consistency
- **FR-021**: System MUST allow any authenticated user to read projects, the dashboard, tiles, and budget views, while restricting create/update/delete and reconciliation to organization administrators.
- **FR-022**: System MUST keep dashboard and budget rollups reconcilable to the underlying project/budget records (no divergence between summary and detail).

### Key Entities *(include if feature involves data)*

- **Project (canonical)**: The unified source of truth for an initiative. Carries identity (name, slug, title, description, owner/team), the label dimensions (Domain, BHAG/Initiative, Swim Lane), lifecycle status, and a Backstage-compatible catalog representation. Associated with components and a budget.
- **Catalog Entity**: The Backstage-style structural representation (domain / sub-domain / system / component) tied to a canonical Project, used for export and hierarchy.
- **Label**: A typed key/value pair on a project across the three dimensions; the unit of discovery and dashboard grouping.
- **App Tile (registry entry)**: A configurable launchpad item — app name, enablement, and a deep-link template parameterized by project context.
- **Onboarding & Budget Record**: A per-project record (separate store) holding onboarding step state plus budget allocation, thresholds, consumption, and derived health.
- **Reconciliation Outcome**: An audit record of how a project was merged from the legacy collections, including any discarded conflicting values.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can find all projects matching a multi-label filter (e.g. one Domain + one Initiative) in under 5 seconds, with 100% precision against the labelled data set.
- **SC-002**: The executive dashboard's per-dimension counts and budget-health flags reconcile to the underlying records with zero discrepancies.
- **SC-003**: After reconciliation, 100% of legacy project and catalog records are represented as canonical projects with no data loss and no duplicates.
- **SC-004**: From a project page, a user reaches the correct in-context app (T3 / Context Graph / Agent Mesh / FinOps) in one click, for every enabled, resolvable tile.
- **SC-005**: An owner can complete budget-aware onboarding (allocation + thresholds) for a new project in under 3 minutes.
- **SC-006**: Every budget shows an unambiguous health state (on-track / at-risk / over / unbudgeted / unknown) with no project mis-flagged as "over" when it is merely unbudgeted or stale.

## Assumptions

- The canonical project is the merge target; catalog entities and legacy project records both fold into it. Default conflict precedence: the most recently updated record wins per field, with discarded values retained for audit (revisited if FR-004 clarification changes it).
- Backstage compatibility means the `backstage.io/v1alpha1` entity shapes already produced continue to validate after unification.
- Existing platform conventions are reused: project APIs under the projects namespace, the standard data store and response envelope, and the existing authentication/authorization model (reads authenticated, writes org-admin).
- The dedicated onboarding/budget store is a new collection; budgets are 1:1 with a canonical project.
- App-tile destinations are URLs/deep-links only; this spec does not run or deploy any of those apps.
- **Resolved decisions** (from clarification): `domain` is both structural and a denormalized label (FR-008); BHAG/Initiative and Swim Lane labels are free-form with normalized grouping (FR-009); budget consumption uses a pluggable interface with a manual provider now and a FinOps-feed provider stub for later (FR-019).

## Out of Scope

- Standing up Outshift Context Graph locally and wiring it to the edge deployment (`platform-apps-deployment` / caipe edge) — separate infrastructure spec. Here, the Context Graph tile needs only a deep-link target.
- Building or operating T3, Agent Mesh, or FinOps services; this feature only links to them.
- Real-time cost metering infrastructure (unless FR-019 is clarified toward an external feed, in which case only the *consumption interface* is in scope, not the metering system).
- Writing back to any external Backstage/Git source of truth.
