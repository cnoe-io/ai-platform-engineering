# Feature Specification: Explicit Team-Scoped Search Capability

**Feature Branch**: `2026-06-03-explicit-search-capability` (spec authored on current working branch)  
**Created**: 2026-06-03  
**Status**: Draft  
**Input**: User observation: "two problems with mcp tools — when I stopped sharing caipe_kb with a team the Generic user was still able to see and search the default and caipe_kb, that would be a violation. The search itself should be enabled and disabled like ingestor enabled/disable."

## Context & Problem

The Knowledge Base **Search** feature (the built-in `search` / `fetch_document` MCP tools, custom search tools like `caipe_kb`, and the `/v1/query` + `/v1/mcp/invoke` data path) has **no explicit capability gate**. Anyone who clears the coarse `rag` route gate can reach search; the only protection is the per-datasource result filter (`constrainSearchBody` → readable `data_source` ids). Two concrete problems follow:

1. **No off switch.** There is no single, auditable capability that says "this principal may use search." Search is implicitly on for every user with RAG access. Built-in `search`/`fetch_document` have **no `mcp_tool` object at all**, so the `mcp_tool#can_call` gate never applies to them.
2. **Tool-share revocation does not fully revoke search.** A custom search tool (e.g. `caipe_kb`) shared org-wide writes `organization:<key>#member caller`, granting `can_call` to *every* org member. Un-sharing the tool from one *team* leaves that org-wide grant in place, so users retain access — perceived (correctly) as an authorization violation. Even absent the org-wide grant, a user could still call the un-gated built-in `search`.

This mirrors the gap the **explicit data source author capability** (`organization#can_ingest`, spec `2026-06-03-explicit-ingest-capability`) closed for *creating* data sources. Search needs the same treatment: an explicit, team-granted, admin-controlled capability.

## Goal

Introduce a dedicated, explicit, auditable capability — **organization-level `can_search`**, granted **to teams only** and **only by org admins (explicit opt-in, no backfill)** — that:

- Gates the **Search** sidebar tab via a single explicit capability check (no datasource enumeration).
- Gates the **data path** (`/v1/query` and `/v1/mcp/invoke`) at both the BFF and the RAG server, covering **built-in search tools AND custom search tools** (e.g. `caipe_kb`), so revoking the capability turns search off regardless of any per-tool share.
- Leaves the per-datasource result ACL (`data_source#can_read` / `constrainSearchBody`) and the per-tool `mcp_tool#can_call` gate intact as additional, narrower checks layered on top.

Per-tool `mcp_tool#can_call` continues to mean "may use *this specific* tool"; `can_search` means "may use the search feature at all."

## Default Posture (decided)

**Opt-in**, mirroring `can_ingest` exactly: `can_search = searcher or admin`, with `searcher` directly assignable to `team#member` / `team#admin` only. On day one, non-admins have **no** search access until an org admin opts their team in. Org admins retain implicit `can_search` (subject to the `RAG_ADMIN_BYPASS_DISABLED` kill switch). **No auto-backfill** — this is a deliberate behavior change so the prior over-broad default is closed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Org admin grants a team the search capability (Priority: P1)

An org admin opens a team in the Admin dashboard and toggles an explicit **"Allow this team to search knowledge bases"** control (sibling to the data-source-author toggle). Members of that team can now see and use Search; teams without the toggle cannot.

**Why this priority**: Core of the request — make search an explicit, admin-controlled on/off capability.

**Independent Test**: As org admin, enable the toggle for Team A and leave it off for Team B. A member of Team A sees the Search tab and can run a query; a member of only Team B sees a disabled tab and is denied at the data path.

**Acceptance Scenarios**:

1. **Given** a team with no search capability, **When** any member opens Knowledge Bases, **Then** the Search tab is hidden/disabled and `can_search` is false.
2. **Given** an org admin enables the search toggle for a team, **When** a member reloads, **Then** the Search tab appears and `can_search` is true.
3. **Given** a non-org-admin (including a team admin), **When** they attempt to toggle the capability, **Then** the request is rejected (403).
4. **Given** a user who can `can_call` a specific shared tool but whose teams lack `can_search`, **When** they invoke that tool, **Then** the data path denies the call (403) — `can_call` alone does not grant search.

---

### User Story 2 - Search data path enforces the capability (Priority: P1)

A member of a search-enabled team runs a query or invokes a search tool. The BFF and RAG server both confirm `organization#can_search` before executing; results are still filtered to the caller's readable datasources.

**Why this priority**: Without server-side enforcement, the capability is only cosmetic and the violation persists for direct API/agent callers.

**Independent Test**: With the capability on, a Team A member's `/v1/query` and `/v1/mcp/invoke` (built-in `search` and custom `caipe_kb`) succeed and are datasource-filtered. With it off, both return 403 regardless of tool shares.

**Acceptance Scenarios**:

1. **Given** a caller without `can_search`, **When** they POST `/v1/query`, **Then** the request is denied (403) before any retrieval.
2. **Given** a caller without `can_search`, **When** they POST `/v1/mcp/invoke` for the built-in `search` tool, **Then** the request is denied (403).
3. **Given** a caller without `can_search` but with `can_call` on a custom tool (org-wide or team share), **When** they invoke it, **Then** the request is still denied (403).
4. **Given** a caller with `can_search`, **When** they query, **Then** results are limited to datasources they can read (existing ACL unchanged).
5. **Given** an agent principal invoking search on a user's behalf, **When** the effective principal lacks `can_search`, **Then** the call is denied. *(Agent search authorization follows the same capability; see Assumptions.)*

---

### User Story 3 - Revoking the capability removes search (Priority: P2)

An org admin disables the search toggle for a team. Members lose the Search tab and are denied at the data path; data ownership and per-tool shares are untouched.

**Why this priority**: Capability lifecycle must be reversible without destroying tool ownership or datasource grants.

**Independent Test**: Disable the toggle for Team A; a member can no longer search, but existing tool ownership/shares and datasource grants remain.

**Acceptance Scenarios**:

1. **Given** a search-enabled team, **When** the org admin disables the toggle, **Then** the capability tuple is removed and members' `can_search` becomes false on reload.
2. **Given** the capability is revoked, **When** members access tools/datasources, **Then** existing `mcp_tool` shares and `data_source` grants are unaffected (they simply cannot search until re-granted).

### Edge Cases

- **`can_call` without `can_search`** (the reported violation): a tool shared org-wide grants `can_call`, but the data path additionally requires `can_search`; lacking it, the invoke is denied. This is the primary regression test.
- **Built-in `search`/`fetch_document`** (no `mcp_tool` object): now gated by `can_search` at the data path even though they have no per-tool object.
- **Org-admin kill switch** (`RAG_ADMIN_BYPASS_DISABLED=true`): org-admin implicit search is disabled along with other bypasses; admins must then be members of a search-enabled team.
- **OpenFGA unavailable**: gate fails closed (Search tab hidden); server/BFF data path fails closed (deny), never fail-open.
- **Stale session**: a user granted the capability while logged in must refresh/re-login (gates re-fetch) before the tab appears.
- **Graph tools** (`graph_*`): out of scope for this iteration unless they route through `/v1/query` or `/v1/mcp/invoke`; if they do, they are gated identically.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The OpenFGA model MUST define an organization-level search capability: `organization#searcher` (directly assignable to `team#member` and `team#admin` only) and `organization#can_search = searcher or admin`.
- **FR-002**: Granting/revoking the capability MUST be restricted to org admins and MUST write/delete the tuple `team:<slug>#member → searcher → organization:<key>`.
- **FR-003**: The Admin Team dialog MUST expose an explicit, clearly-labeled toggle to enable/disable the search capability for a team, reflecting current state and separate from the data-source-author and per-KB assignment controls.
- **FR-004**: The Search tab gate (`/api/rbac/kb-tab-gates`) MUST be computed from an explicit `can_search` check on `organization:<key>`.
- **FR-005**: The RAG server MUST enforce `organization#can_search` on `/v1/query` and `/v1/mcp/invoke` for **both built-in and custom** tools, before retrieval, in addition to existing per-datasource and per-tool checks.
- **FR-006**: The BFF RAG proxy MUST enforce `organization#can_search` on the same paths before forwarding (defense in depth + early 403), with org-admin bypass under the existing convention.
- **FR-007**: `mcp_tool#can_call` MUST remain a *narrower* per-tool check; holding `can_call` MUST NOT, by itself, permit search when `can_search` is absent.
- **FR-008**: The system MUST NOT auto-backfill the new capability; teams gain it only by explicit admin opt-in (deliberate behavior change).
- **FR-009**: All authorization paths MUST remain fail-closed on OpenFGA error (deny / hide), never fail-open.
- **FR-010**: A new endpoint MAY return per-team capability state for the admin toggle (GET), mirroring the ingest-capability route.
- **FR-011**: The stale org-wide grant on `mcp_tool:caipe_kb` (`organization:<key>#member reader/user/caller`) MUST be removed (one-time remediation) and the tool re-scoped to its owning team. *(Completed during diagnosis; recorded here for traceability.)*
- **FR-012**: The RBAC reference documentation MUST be updated (per the repository's RBAC living-documentation rule) to record the new capability, grant flow, gate, data-path enforcement, and new files.

### Key Entities

- **Organization search capability**: `organization#searcher` / `organization#can_search` — the explicit "may use search" capability, team-granted.
- **Search-enabled team set**: teams a user is a member of that hold the search capability; drives the Search tab gate and data-path authorization.
- **Data path**: `/v1/query` and `/v1/mcp/invoke` (built-in + custom tools) — the enforcement points for `can_search`.
- **Layered checks**: `can_search` (feature) ⊃ `mcp_tool#can_call` (per-tool) ⊃ `data_source#can_read` (per-datasource result filter).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the toggle off, **0** members of a team (with any tool shares, including org-wide) can search via UI, direct `/v1/query`, or `/v1/mcp/invoke`.
- **SC-002**: With the toggle on, **100%** of that team's members see the Search tab and can run a datasource-filtered query after a gate refresh.
- **SC-003**: A caller holding only `mcp_tool#can_call` (no `can_search`) is denied at the data path in **100%** of tested built-in and custom-tool cases — closing the reported violation.
- **SC-004**: The `kb-tab-gates` search decision performs a single capability check with **no** `/v1/datasources` enumeration for the search gate.
- **SC-005**: Revoking the capability hides/disables the tab on reload and denies the data path while leaving `mcp_tool` shares and `data_source` grants unchanged in **100%** of tested cases.

## Assumptions

- Teams are the only grantee for the search capability in this iteration (no direct user grants).
- The organization object key is the existing singleton resolved by `organizationObjectId()`.
- Agent-initiated search is authorized by the same `can_search` capability resolved for the effective principal; if agents require a distinct posture, it is tracked separately.
- The org-admin super-grant and `RAG_ADMIN_BYPASS_DISABLED` kill switch continue to apply.
- Existing per-datasource ACL (`constrainSearchBody`) and per-tool `can_call` gate semantics remain unchanged and continue to apply *after* the `can_search` check.

## Out of Scope

- Auto-backfilling the capability for existing users/teams (explicitly rejected — this is the intended behavior change).
- Direct (per-user) search grants.
- Re-architecting built-in tools to have `mcp_tool` objects.
- Changing retrieval/ranking or the search runtime.
- Graph-only tool paths that do not traverse `/v1/query` or `/v1/mcp/invoke`.
