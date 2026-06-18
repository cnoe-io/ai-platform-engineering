# Feature Specification: Unified Group-Based Access Control for Shareable Resources

**Feature Branch**: `2026-06-03-unified-shareable-resource-rbac`
**Created**: 2026-06-03
**Status**: Draft
**Input**: User description: "Unify group-based access control across all shareable platform resources (agents, RAG knowledge_base/data_source, custom mcp_tool), matching the agent owner-team + share-with-teams pattern. Build a shared module that DRYs up all five layers so any new entity gets access control by composition; split an audit-only `creator` relation from functional `owner`/team `manager`; add an ownership transfer flow; adopt A2 parent_kb inheritance for RAG data_source; dual-write persistence (config = source of truth, OpenFGA = derived projection); and bring custom MCP tools to full parity (owner/share UI, BFF reconcile on create/update/delete, can_call enforcement on invoke)."

## Context: How Access Control Works Today

The platform already has a mature group-based access-control pattern, but **only the agent subsystem implements it completely**. Three subsystems each re-derive parts of it inconsistently, and one (custom MCP tools) is missing it almost entirely.

**The agent reference pattern (complete):**

- A dynamic agent has exactly **one owner team**, chosen at create time and immutable afterward, plus a mutable **`shared_with_teams[]`** list.
- Both are persisted in the agent's MongoDB document (`owner_team_slug`, `shared_with_teams`) — that document is the **source of truth**.
- On every create/update, `reconcileAgentRelationships` writes the OpenFGA tuples that **enforce** access: for each effective team, `team:<slug>#member → user` and `team:<slug>#admin → manager`; for the creator, `user:<sub> → owner`. The reconciler diffs a **previous set** (read from Mongo) against the next set so unsharing a team genuinely **revokes** its grant.
- The agent editor UI presents an owner `TeamPicker` (disabled on edit), a `TeamMultiPicker` for sharing, and an effective-access preview, saved with an explicit button.
- Runtime enforcement checks `agent#can_use` at the supervisor / gateway / Slack layers.

**Where the other subsystems diverge:**

| Layer | Agent | RAG (knowledge_base + data_source) | Custom MCP tool |
|---|---|---|---|
| OpenFGA model | single `agent` type | **two** types (`knowledge_base` + `data_source`), 1:1 by id, **no inheritance** between them | single `mcp_tool` type (already agent-shaped) |
| Owner/shared persistence | Mongo (source of truth) | **not persisted** — recovered by scanning OpenFGA tuples; owner indistinguishable from shared | **not persisted at all** |
| Reconciler | bespoke `reconcileAgentRelationships` | `reconcileKnowledgeBaseRelationships` + a separate `data_source` mirror | `buildMcpToolRelationshipTupleDiff` exists but is only partly wired |
| Share UI | full (owner + multi-select + preview) | partial (KB multi-select; owner never populated) | **none** |
| Transfer ownership | not exposed (plumbing exists, unused) | no | no |
| Delete cleanup | yes | yes | **no — leaves orphan tuples** |
| Invocation enforcement | `can_use` enforced | datasource filter injected by BFF | **none — `/v1/mcp/invoke` is auth-only** |

Two structural problems compound the drift:

1. **`owner` is overloaded.** Every type's `owner` relation is referenced by `can_manage` / `can_read`, so the creator's personal `user:<sub> owner` tuple grants live management authority forever — even after a team transfer, even if the person leaves. There is no separate provenance marker; `owner` is doing double duty as "who made it" and "who controls it."
2. **No shared module.** The same five-layer pattern (model block, reconciler, route orchestration, persistence fields, UI controls) is hand-copied per resource. There are already 9 owner+team+shared types in the model — well past the Rule-of-Three threshold — and each copy is an opportunity to get the revoke-diff subtly wrong (which is exactly how RAG shipped a "see-but-not-search" bug).

This feature makes the agent pattern **canonical and reusable**, fixes the two structural problems, and brings RAG and MCP tools to full parity.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One Reusable Access-Control Module for Any Resource (Priority: P1)

As a platform engineer adding a new shareable resource type, I want a single shared module that provides the OpenFGA relation template, the reconciler, the route orchestration helper, the persistence fields, and the UI controls, so that I get correct group-based access control by composition instead of re-deriving five layers by hand.

**Why this priority**: This is the foundation. Every other story is expressed through this module; building it first means RAG, MCP tools, transfer, and the creator split are all implemented once, consistently, rather than copied. It directly addresses the Rule-of-Three duplication and the class of revoke-diff bugs.

**Independent Test**: Can be tested by refactoring the existing agent and knowledge_base paths onto the shared reconciler core and confirming their existing test suites still pass unchanged — proving the abstraction faithfully reproduces the reference behavior — and by a unit test that drives a hypothetical new resource type through the module end to end.

**Acceptance Scenarios**:

1. **Given** the shared reconciler core, **When** it is given `{objectType, objectId, creatorSubject, ownerTeamSlug, previousOwnerTeamSlug, nextSharedTeamSlugs, previousSharedTeamSlugs, extraMemberRelations}`, **Then** it emits the same owner-team + shared-team write/delete tuples that the existing agent and KB reconcilers emit for the equivalent inputs.
2. **Given** the agent and knowledge_base reconcilers are refactored to call the shared core, **When** their existing unit and route test suites run, **Then** they pass without behavioral change.
3. **Given** a developer adds a new resource type, **When** they inherit the persistence mixin, mount the UI component, call the route helper, and add the model template block, **Then** the resource has owner-team ownership, share-with-teams, revoke-on-unshare, and an effective-access preview with no bespoke access-control code.

---

### User Story 2 - Provenance Without Lingering Authority (Priority: P1)

As a security reviewer, I want the person who created a resource to be recorded permanently for audit, but I do **not** want that personal record to grant ongoing management authority once a team owns the resource, so that control follows the team and an individual cannot retain hidden power after a transfer or departure.

**Why this priority**: This fixes a latent privilege-retention issue and is a prerequisite for a safe transfer flow. It must land with (or before) transfer so transfers don't strand live personal-owner tuples.

**Independent Test**: Can be tested by creating a resource, confirming an immutable audit record of the creator exists, and confirming that management authority is satisfied via the owner team's admin relationship rather than the creator's personal record — i.e., revoking the creator's team membership removes their ability to manage, while the audit record remains.

**Acceptance Scenarios**:

1. **Given** a user creates a team-owned resource, **When** creation completes, **Then** an audit-only `creator` record of that user is written and is **not** referenced by any `can_*` permission.
2. **Given** a team-owned resource, **When** authorization for management is evaluated, **Then** it is satisfied by the owner team's admin relationship (and org-admin bypass), not by the creator's personal record.
3. **Given** a resource is transferred to another team, **When** the transfer completes, **Then** the `creator` audit record is unchanged and the former creator has no management authority unless they are an admin of the new owner team.
4. **Given** an auditor inspects a resource, **When** they query its provenance, **Then** the original creator is still discoverable regardless of how many times ownership has transferred.

---

### User Story 3 - Transfer Ownership to Another Team (Priority: P2)

As a current owner-team admin (or an org admin), I want to transfer a resource's ownership to a different team, with a clear confirmation if I am not a member of the destination team, so that resources can move between teams as organizations evolve without orphaning or silent lockout.

**Why this priority**: A frequently requested capability whose enabling plumbing (`previousOwnerTeamSlug` in the reconciler) already exists but is never invoked. Depends on Stories 1 and 2; valuable but not required for parity, hence P2.

**Independent Test**: Can be tested by transferring a resource from team A to team B and confirming team A loses management grants, team B gains them, the creator audit record is retained, and a non-member transferor is warned before the change is applied.

**Acceptance Scenarios**:

1. **Given** a resource owned by team A, **When** a team-A admin transfers it to team B, **Then** team A's owner grants are deleted, team B's owner grants are written, and the change is persisted to the resource's config.
2. **Given** a transferor who is not a member of destination team B, **When** they initiate the transfer, **Then** the UI presents an explicit "you are not a member of this team" confirmation before the change is applied.
3. **Given** a user who is neither a current owner-team admin nor an org admin, **When** they attempt a transfer, **Then** the request is denied.
4. **Given** a transfer is applied, **When** the reconciler runs, **Then** it receives the previous owner team and the new owner team so stale grants are revoked rather than left dangling.

---

### User Story 4 - RAG Datasource Access That Actually Enforces (Priority: P1)

As a user querying a knowledge base, I want the access I am granted on a knowledge base to govern what an agent can actually retrieve from its data source, so that being granted read on a KB means I can search it — and being denied means I cannot — with no gap between discovery and enforcement.

**Why this priority**: Closes the existing "see-but-not-search" gap (KB grant doesn't imply data_source grant) and removes the fragile mirror that duplicates every grant onto a second object. It is core to the parity goal and to user-visible correctness.

**Independent Test**: Can be tested by granting a team read on a knowledge base and confirming a member of that team can both discover and query the corresponding data source, while a non-member can do neither — without any separate data_source grant being written.

**Acceptance Scenarios**:

1. **Given** a team is granted read on `knowledge_base:<id>`, **When** a member queries the corresponding `data_source:<id>`, **Then** the read permission is satisfied through inheritance from the knowledge base, with no mirrored data_source tuples required.
2. **Given** the inheritance model is active, **When** existing datasources created before this change are evaluated, **Then** a backfilled inheritance edge makes their pre-existing KB grants effective on the data source.
3. **Given** the public-datasources mechanism, **When** a datasource is marked public, **Then** all authenticated users can read it, consistent with the prior behavior.
4. **Given** the mirror reconciliation that previously duplicated KB grants onto data_source, **When** this feature ships, **Then** that mirror is retired and no longer writes duplicate tuples.

---

### User Story 5 - Datasource Ownership and Sharing Parity (Priority: P2)

As a user who creates a RAG datasource, I want to choose an owning team at creation and manage a share-with-teams list afterward, exactly as I do for agents, so that datasource access is managed with the same model and UI I already know.

**Why this priority**: Brings the RAG end-user experience to agent parity and makes owner-vs-shared distinguishable (today the owner is never populated). Builds on Stories 1 and 4.

**Independent Test**: Can be tested by creating a datasource with an owner team, sharing it with a second team, unsharing that team, and confirming the persisted config and the effective access both reflect each step.

**Acceptance Scenarios**:

1. **Given** the datasource creation flow, **When** a user creates a datasource, **Then** they select an owner team that is persisted as the source of truth and is immutable on subsequent edits (except via the transfer flow).
2. **Given** an existing datasource, **When** its owner-team admin opens the sharing UI, **Then** the current owner team and current shared teams are shown accurately (not blank).
3. **Given** a team is removed from the share list and saved, **When** the change is applied, **Then** that team's grant is revoked rather than left dangling.

---

### User Story 6 - Custom MCP Tool Access Parity (Priority: P2)

As a user who creates a custom MCP tool, I want to own it via a team, share it with other teams, and have those grants actually govern who may call the tool, so that custom tools follow the same access model as agents and datasources instead of being effectively unguarded.

**Why this priority**: Custom MCP tools are the largest gap — no sharing UI, no persistence, no delete cleanup, and crucially **no invocation enforcement**. Closing this prevents tools from being callable by anyone authenticated. Builds on Story 1.

**Independent Test**: Can be tested by creating a tool with an owner team, confirming a member of that team can call it while a non-member is denied at invoke time, sharing with a second team, deleting the tool, and confirming no orphan grants remain.

**Acceptance Scenarios**:

1. **Given** the custom MCP tool create/edit dialog, **When** a user creates or edits a tool, **Then** they can set an owner team and a share-with-teams list using the same controls as the agent editor.
2. **Given** a tool owned by team A and shared with team B, **When** a member of A or B invokes the tool, **Then** the invocation is allowed; **When** a non-member invokes it, **Then** the invocation is denied by a call-permission check.
3. **Given** a tool is created or updated, **When** the operation completes, **Then** owner/shared grants are reconciled into OpenFGA and persisted to the tool config.
4. **Given** a tool is deleted, **When** the delete completes, **Then** its OpenFGA grants are removed so no orphan tuples remain.

---

### Edge Cases

- **Creator is removed from the owner team**: management authority is lost (correct); the audit `creator` record remains. The resource is still managed by remaining owner-team admins / org admins.
- **Transfer to a team the transferor does not belong to**: allowed for an authorized transferor (owner-team admin or org admin) but only after explicit confirmation; the transferor may lose their own access as a result, which the confirmation must make clear.
- **Owner team equals a shared team**: deduplicated — a single grant, never double-written and never deleted by a subsequent reconcile.
- **Public datasource + team grants coexist**: the `user:*` public reader and team grants are independent; removing one does not remove the other.
- **Pre-existing datasources with no inheritance edge**: a backfill must add the edge; until backfilled, their KB grants would not enforce on the data source.
- **Reconciliation disabled (kill switch / outage)**: the config remains the source of truth and the UI shows correct state; enforcement falls back to the documented behavior when OpenFGA writes are unavailable.
- **Invalid or unknown team slug in a share list**: silently dropped, consistent with the existing reconciler behavior.
- **Concurrent edits to the same resource's sharing**: the previous-set is read from the persisted config at reconcile time, so a last-writer-wins update still produces a consistent diff against the stored state.
- **Custom MCP tool invoked by an agent (not a user)**: the call-permission check must account for agent subjects, consistent with how the tool type already permits an `agent` caller.

## Requirements *(mandatory)*

### Functional Requirements

**Shared module (Story 1)**

- **FR-001**: The system MUST provide a single shared reconciler that, given a resource type, id, creator subject, owner team, previous owner team, and next/previous shared-team lists, emits the correct OpenFGA write and delete tuples for owner and shared teams.
- **FR-002**: The shared reconciler MUST support per-type member-relation extension (e.g. an `ingestor` relation for knowledge bases, a `user` relation for tools) without forking the core logic.
- **FR-003**: The existing agent and knowledge_base reconcilers MUST be refactored to use the shared core, preserving their current externally observable behavior.
- **FR-004**: The system MUST provide a route-orchestration helper that performs validate-membership → capture-creator → read-previous-set-from-config → reconcile → persist, so resource routes do not re-implement this sequence.
- **FR-005**: The system MUST provide a reusable persistence mixin exposing `creator_subject`, `owner_subject`, `owner_team_slug`, and `shared_with_teams` for resource config models.
- **FR-006**: The system MUST provide a reusable UI control bundle (owner picker, share multi-select, effective-access preview, not-a-member transfer confirmation) usable by any resource editor.
- **FR-007**: The system MUST provide a canonical OpenFGA relation/permission template for a shareable resource and a means (test or generator) to detect when a "shareable" type drifts from it.

**Creator / owner split (Story 2)**

- **FR-008**: The OpenFGA model MUST define an audit-only `creator` relation on shareable resource types that is NOT referenced by any `can_*` permission.
- **FR-009**: On resource creation, the system MUST record the creating user as `creator` and MUST NOT rely on a personal `owner` grant to convey management authority for team-owned resources.
- **FR-010**: Management authority for a team-owned resource MUST be satisfied by the owner team's admin relationship (and the org-admin bypass), not by the creator's personal record.
- **FR-011**: The `creator` record MUST be preserved unchanged across ownership transfers and team-membership changes.
- **FR-012**: For existing resources that currently rely on a personal `user:<sub> owner` tuple, the migration MUST backfill a `creator` tuple from each existing personal `owner` and MUST retain the existing `owner` tuple (non-breaking — no access removed). *Resolved: research.md Decision FR-012 (option b). Dropping stale personal `owner` tuples is a deliberate later cleanup, not part of this migration.*

**Ownership transfer (Story 3)**

- **FR-013**: The system MUST allow transferring a resource's owner team to a different team.
- **FR-014**: A transfer MUST be authorized only for a current owner-team admin or an org admin.
- **FR-015**: When the transferor is not a member of the destination team, the UI MUST require an explicit confirmation before applying the transfer.
- **FR-016**: On transfer, the system MUST pass the previous owner team and the new owner team to the reconciler so the previous team's owner grants are revoked and the new team's are written.
- **FR-017**: On transfer, the system MUST persist the new owner team to the resource's config as the new source of truth.

**RAG inheritance (Story 4)**

- **FR-018**: The OpenFGA model MUST make `data_source` read, ingest, and manage permissions inherit from its parent `knowledge_base` via an inheritance edge.
- **FR-019**: On datasource creation, the system MUST establish the inheritance edge linking the data source to its knowledge base.
- **FR-020**: The system MUST retire the mirror mechanism that previously duplicated knowledge_base grants onto data_source.
- **FR-021**: The system MUST preserve the existing public-datasources (`user:*` read) capability under the new model.
- **FR-022**: The system MUST backfill the inheritance edge for datasources created before this change so their existing KB grants enforce on the data source.

**RAG persistence & UI (Story 5)**

- **FR-023**: The datasource config model MUST persist `creator_subject`, `owner_subject`, `owner_team_slug`, and `shared_with_teams`.
- **FR-024**: The datasource sharing read path MUST return the actual owner team and shared teams from the persisted config rather than a null owner.
- **FR-025**: The datasource creation UI MUST let the user choose an owner team (immutable on edit except via transfer) and the sharing UI MUST manage the shared-team list with revoke-on-unshare.

**MCP tool parity (Story 6)**

- **FR-026**: The custom MCP tool config model MUST persist `creator_subject`, `owner_subject`, `owner_team_slug`, and `shared_with_teams`.
- **FR-027**: The custom MCP tool create/edit UI MUST provide the owner picker and share multi-select controls.
- **FR-028**: The system MUST reconcile owner/shared grants for custom MCP tools on create and update, and MUST remove all grants on delete.
- **FR-029**: The system MUST enforce a call-permission check on the MCP tool invocation path so that only principals with call permission (member of owner/shared team, owner, org admin, or an authorized agent) may invoke a custom tool.

**Cross-cutting**

- **FR-030**: All new and changed permission edges, enforcement layers, and auth-path files MUST be reflected in the RBAC living documentation.
- **FR-031**: The OpenFGA model authored form and the deployed (chart) form MUST remain in parity, verified by the existing parity check.
- **FR-032**: Sequencing relative to open PR #1703 — the recommendation is to amend #1703 to introduce `parent_kb` inheritance directly so the mirror never ships; if #1703 has already merged, this feature lands afterward and FR-020 *deletes* the mirror instead of preventing it. *Resolved with a recommendation in research.md; the final sequencing call is **pending the other committer's sign-off** (consistent with verifying A2 with them). This is a process decision, not a code dependency — the phases work under either path.*

### Key Entities

- **Shareable Resource**: any platform object governed by group-based access control. Has exactly one owner team (source of truth), a set of shared teams, an audit-only creator, and a derived set of OpenFGA grants. Concrete instances: agent, knowledge_base, data_source, mcp_tool (and future types).
- **Creator record**: an immutable, audit-only association between a resource and the user who created it. Carries no authority.
- **Owner team**: the single team whose admins manage the resource and whose members can use it. Changeable only via transfer.
- **Shared team**: an additional team granted use/read (and per-type extras) on the resource; freely added and removed.
- **Inheritance edge (data_source → knowledge_base)**: the relationship that lets a data source's read/ingest/manage permissions resolve through its knowledge base.
- **OwnedResourceMixin**: the persisted field set (`creator_subject`, `owner_subject`, `owner_team_slug`, `shared_with_teams`) attached to a resource's config record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new shareable resource type can be given full group-based access control (ownership, sharing, revoke, preview, enforcement) without writing bespoke reconciler, route-orchestration, or persistence logic — only composing the shared module and adding the model template block.
- **SC-002**: Granting a team read on a knowledge base lets its members query the corresponding data source, and revoking it removes that ability, with zero mirrored data_source tuples written.
- **SC-003**: A custom MCP tool invocation by a principal without call permission is denied at the invocation path; previously such invocations were allowed for any authenticated caller.
- **SC-004**: Deleting a custom MCP tool leaves no residual OpenFGA grants.
- **SC-005**: The original creator of a resource remains discoverable after one or more ownership transfers, while no transferred-away creator retains management authority solely by virtue of having created the resource.
- **SC-006**: The agent and knowledge_base subsystems exhibit no behavioral regression after being refactored onto the shared module (existing test suites pass unchanged).
- **SC-007**: Owner team and shared teams are displayed accurately in every resource's sharing UI, with the owner distinguishable from shared teams.
- **SC-008**: The OpenFGA authored model and deployed model remain in parity, and the RBAC living documentation reflects every new edge, enforcement layer, and file.
