# Feature Specification: Explicit Team-Scoped Data Source Author Capability

**Feature Branch**: `2026-06-03-explicit-ingest-capability` (spec authored on current working branch)  
**Created**: 2026-06-03  
**Status**: Draft  
**Input**: User observation: "It did work, but seems odd to multiplex `can_ingest` on a single data source as the gate to ingest other data sources. Can we make this explicit?"

## Context & Problem

The Knowledge Base **Ingest** UI lets a user *create a brand-new data source* (a web URL or Confluence space → a new `datasource_id`). Whether that UI appears is gated on `can_ingest`, which today is derived heuristically:

```
can_ingest = (number of existing KBs where the user holds per-KB `ingestor`) > 0
```

This conflates two genuinely different capabilities:

1. **Per-KB `ingestor`** — "may push documents *into* this specific, existing knowledge base." A property of an existing KB, granted via the Team → Knowledge Bases assignment (Read / Ingest / Admin).
2. **Authoring new data sources** — "may *create* new data sources in the system." What the Ingest form actually does.

Because (1) is used to infer (2), a user who can push into one KB is implicitly allowed to author unlimited new, unrelated data sources. The gate is implicit and non-auditable, and there is no single place that says "this principal may author data sources."

A second, server-side gap compounds this: the create endpoints authorize the new (not-yet-existing) `datasource_id` via `check_datasource_access(..., "ingest")`, which has no tuple for a brand-new id and is not org-admin → it **denies**. So a non-org-admin creating a genuinely new source is rejected server-side; the UI gate only appears to "work" when the new id collides with an already-granted KB. New data sources also get no team ownership tuples written at creation time.

## Goal

Introduce a dedicated, explicit, auditable capability — **organization-level `can_ingest` ("data source author")**, granted **to teams only** and **only by org admins (explicit opt-in, no backfill)** — that:

- Gates the create UI via a single explicit capability check (no datasource enumeration).
- Gates the server-side create path.
- Requires every new data source to be **owned by a team chosen at creation**, scoped to the teams the user is allowed to author for, with ownership tuples written at creation so per-KB checks work thereafter.

Per-KB `ingestor` returns to meaning exactly "push into KB X."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Org admin grants a team the author capability (Priority: P1)

An org admin opens a team in the Admin dashboard and toggles an explicit **"Allow this team to create / ingest new data sources"** control. Members of that team can now see and use the Ingest UI; teams without the toggle cannot, regardless of their per-KB grants.

**Why this priority**: This is the core of the request — make the capability explicit and admin-controlled.

**Independent Test**: As org admin, enable the toggle for Team A and leave it off for Team B. A member of Team A sees the Ingest UI; a member of only Team B does not.

**Acceptance Scenarios**:

1. **Given** a team with no author capability, **When** any member opens Knowledge Bases, **Then** the Ingest UI is hidden and `can_ingest` is false.
2. **Given** an org admin enables the author toggle for a team, **When** a member reloads, **Then** the Ingest UI appears and `can_ingest` is true.
3. **Given** a non-org-admin (including a team admin), **When** they attempt to toggle the capability, **Then** the request is rejected (403).
4. **Given** a team that only has per-KB `ingestor` grants but no author capability, **When** a member opens Knowledge Bases, **Then** the Ingest UI is still hidden (per-KB ingest no longer implies authoring).

---

### User Story 2 - Authoring a new data source is team-scoped (Priority: P1)

A member of an author-enabled team creates a new web/Confluence data source. They must choose an **owning team** (from the teams they may author for); the new source is created owned by that team, and the team's members immediately get the correct per-KB access.

**Why this priority**: Without scoping + ownership writes, create either fails server-side or produces an unowned/personal source, defeating team-based management.

**Independent Test**: As a member of author-enabled Team A, create a new URL with owning team = A. The job is accepted, the source is owned by A, and Team A members can read/ingest it.

**Acceptance Scenarios**:

1. **Given** a non-org-admin author, **When** they open the create form, **Then** an owning-team selection is required and lists only teams they may author for.
2. **Given** a valid owning team is selected, **When** they submit, **Then** the server authorizes the create (capability + team membership), creates the source, and writes ownership tuples (team `ingestor` on the KB, the `parent_kb` data_source edge, and author as manager/creator).
3. **Given** an org admin, **When** they create a source, **Then** they may optionally leave owning team unset (personal/admin-owned) and the create still succeeds.
4. **Given** the same create flow, **When** the source is Confluence rather than web, **Then** identical authorization and ownership behavior applies.

---

### User Story 3 - Revoking the capability removes authoring (Priority: P2)

An org admin disables the author toggle for a team. Members lose the Ingest UI; previously created data sources remain owned by the team and continue to work.

**Why this priority**: Capability lifecycle must be reversible without destroying existing data ownership.

**Independent Test**: Disable the toggle for Team A; a member no longer sees the Ingest UI, but existing Team A sources remain readable/ingestable per their KB grants.

**Acceptance Scenarios**:

1. **Given** an author-enabled team, **When** the org admin disables the toggle, **Then** the capability tuple is removed and members' `can_ingest` becomes false on reload.
2. **Given** the capability is revoked, **When** members access previously created sources, **Then** existing per-KB grants are unaffected.

### Edge Cases

- **Author with no eligible owning team** (capability removed mid-session): create is blocked client-side (no selectable team) and rejected server-side (no membership in an author-enabled team).
- **Org-admin kill switch** (`RAG_ADMIN_BYPASS_DISABLED=true`): org-admin implicit authoring is disabled along with other bypasses; admins must then be members of an author-enabled team like anyone else.
- **OpenFGA unavailable**: gate fails closed (Ingest UI hidden); server create fails closed (503/deny), never fail-open.
- **Per-KB ingest only** (no author capability): user can still push into KBs they hold `ingestor` on via existing flows, but cannot author new sources.
- **Stale session**: a user granted the capability while logged in must refresh/re-login (gates re-fetch) before the UI appears.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The OpenFGA model MUST define an organization-level author capability: `organization#ingestor` (directly assignable to `team#member` and `team#admin` only) and `organization#can_ingest = ingestor or admin`.
- **FR-002**: Granting/revoking the capability MUST be restricted to org admins (`admin_ui:admin`) and MUST write/delete the tuple `team:<slug>#member → ingestor → organization:<key>`.
- **FR-003**: The Admin Team dialog MUST expose an explicit, clearly-labeled toggle to enable/disable the author capability for a team, reflecting current state and separate from per-KB assignment.
- **FR-004**: The `can_ingest` gate (`/api/rbac/kb-tab-gates`) MUST be computed from an explicit `can_ingest` check on `organization:<key>`, NOT from counting per-KB `ingestor` grants.
- **FR-005**: Per-KB `ingestor` grants MUST NOT, by themselves, grant authoring; they retain only "push into KB X" semantics.
- **FR-006**: The system MUST NOT auto-backfill the new capability; teams gain it only by explicit admin opt-in.
- **FR-007**: The create form MUST require non-org-admins to select an **owning team** from the teams they may author for (members of author-enabled teams); org admins MAY omit it.
- **FR-008**: A new endpoint MUST return the set of teams a user may author for (teams the user is a member of that hold the org author capability).
- **FR-009**: The server create endpoints (web `POST /v1/ingest/webloader/url` and the Confluence create path) MUST authorize creation iff: org admin, OR the caller holds org `can_ingest` AND is a member of the supplied owning team (which itself holds the capability).
- **FR-010**: On successful create, the server MUST write ownership tuples for the new data source so subsequent per-KB checks pass: team `ingestor` on `knowledge_base:<id>`, the `parent_kb` `data_source` inheritance edge, and the author as manager/creator.
- **FR-011**: All authorization paths MUST remain fail-closed on OpenFGA error (deny / hide), never fail-open.
- **FR-012**: The RBAC reference documentation MUST be updated (per the repository's RBAC living-documentation rule) to record the new capability, grant flow, gate, and new files.

### Key Entities

- **Organization author capability**: `organization#ingestor` / `organization#can_ingest` — the explicit "may author new data sources" capability, team-granted.
- **Owning team**: the team selected at creation that becomes the owner of the new data source.
- **Authorable team set**: teams a user is a member of that hold the author capability; drives the create form's owning-team picker and server create authorization.
- **Data source ownership tuples**: the per-KB `ingestor`, `parent_kb` data_source edge, and creator/manager tuples written at creation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the toggle off, **0** members of a team (with any number of per-KB ingest grants) see the Ingest UI.
- **SC-002**: With the toggle on, **100%** of that team's members see the Ingest UI after a gate refresh.
- **SC-003**: A non-org-admin author creating a new source with a valid owning team succeeds and the owning team's members can read/ingest it **without further admin action**.
- **SC-004**: A non-org-admin without the capability is rejected at the server create endpoint in **100%** of tested web and Confluence cases (no reliance on the UI gate alone).
- **SC-005**: Revoking the capability hides the UI on reload and leaves existing sources' access unchanged in **100%** of tested cases.
- **SC-006**: The `kb-tab-gates` ingest decision performs a single capability check with **no** `/v1/datasources` enumeration for the ingest gate.

## Assumptions

- Teams are the only grantee for the author capability in this iteration (no direct user grants).
- The organization object key is the existing singleton resolved by `organizationObjectId()`.
- Existing per-KB assignment UI and semantics remain unchanged.
- The org-admin super-grant and `RAG_ADMIN_BYPASS_DISABLED` kill switch continue to apply.

## Out of Scope

- Auto-backfilling the capability for teams with existing per-KB ingest (explicitly rejected).
- Direct (per-user) author grants.
- Per-KB `DELETE` capability for non-admins (tracked separately).
- Changing how documents are chunked/ingested or the ingestor runtime.
