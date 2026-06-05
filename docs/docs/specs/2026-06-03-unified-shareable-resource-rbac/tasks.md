# Tasks: Unified Group-Based Access Control for Shareable Resources

**Input**: Design documents from `docs/docs/specs/2026-06-03-unified-shareable-resource-rbac/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, db-migration.md

**Tests**: INCLUDED. This is RBAC/security code; the spec mandates them — SC-006
(existing agent/KB suites pass unchanged), FR-007 (drift check), FR-031 (model
parity), plus per-story acceptance tests. Write/adjust tests alongside each phase.

**Organization**: Phases follow plan.md Phases A–G (the dependency order), each
mapped to its user story. Phase A (the shared module) is both **User Story 1**
and the **foundational blocker** for every later phase.

## Format: `[ID] [P?] [Story] Description with file path`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[Story]**: US1–US6 from spec.md
- All paths are repo-relative to `/Users/kkantesa/ai-platform-engineering/`

## Story → Plan-Phase → Priority map

| Story | Plan phase | Priority | Theme |
|---|---|---|---|
| US1 | A | P1 | Shared module (foundational) |
| US2 | B | P1 | Creator/owner split |
| US4 | C | P1 | RAG parent_kb inheritance |
| US5 | D | P2 | RAG persistence + UI |
| US6 | E | P2 | MCP tool parity + can_call |
| US3 | F | P2 | Ownership transfer |
| — | G | — | Migration, tests, RBAC docs (polish) |

---

## Phase 1: Setup

**Purpose**: Confirm the working environment and baselines before changes.

- [ ] T001 Confirm branch `2026-06-03-unified-shareable-resource-rbac` is checked out and based on `main`; run `git status` clean.
- [ ] T002 [P] Establish UI test baseline: run `make caipe-ui-tests` and record the passing suite list (for SC-006 regression comparison) — note results in the PR description later.
- [ ] T003 [P] Establish OpenFGA model baseline: run the model-parity test and `scripts/validate-rbac-matrix.py`; record green state.
- [ ] T004 [P] Build RAG `common` venv if needed (`ai_platform_engineering/knowledge_bases/rag/common`) per CLAUDE.md worktree rules, so pytest can run on the Python model changes.

**Checkpoint**: Baselines captured; any later regression is attributable to this work.

---

## Phase 2 (Plan Phase A): User Story 1 — Shared Access-Control Module (Priority: P1) 🎯 MVP + FOUNDATIONAL

**Goal**: One reusable module (reconciler core, route helper, persistence mixin,
UI component, model template + drift check) that any resource composes for
group-based access control. Agent + KB are refactored onto it with no behavior
change.

**Independent Test**: Existing agent + KB reconciler/route/UI suites pass
unchanged after refactor (SC-006); a unit test drives a hypothetical new type
through the core and gets the expected tuple diff.

**⚠️ CRITICAL**: No later phase may begin until this phase is complete — every
other phase consumes this module.

### Tests for User Story 1 (write/extend first)

- [ ] T005 [P] [US1] Add unit tests for the generalized reconciler core in `ui/src/lib/rbac/__tests__/shareable-resource.test.ts`: owner+shared writes, revoke deletes on unshare, `previousOwnerTeamSlug` transfer deletes, `creator` written-once and never deleted, `parentKnowledgeBaseId` edge, `extraMemberRelations`, dedup/idempotency, invalid-slug drop.
- [ ] T006 [P] [US1] Add unit tests for `handleShareableResourceWrite` (route helper) covering: creator set-once from session, owner-immutability rejection when `allowOwnerTransfer` is false, previous-set read from config, persist called with next state.
- [ ] T007 [P] [US1] Add a shareable-type drift test in `ui/src/lib/rbac/__tests__/` (or `scripts/`): for each shareable type, assert `creator: [user]` present and absent from every `can_*`, and authored/chart parity for that type (FR-007 / contract C5).

### Implementation for User Story 1

- [ ] T008 [US1] Generalize `buildOwnedResourceWithSharedTeamsDiff` into `buildShareableResourceTupleDiff` + `reconcileShareableResource` in `ui/src/lib/rbac/openfga-owned-resources.ts` per contract `reconciler-and-route.md` R1: add `creatorSubject`, `previousOwnerTeamSlug`, `parentKnowledgeBaseId`; keep `extraMemberRelations`.
- [ ] T009 [US1] Refactor `buildKnowledgeBaseRelationshipTupleDiff` to delegate to the core (preserve its `reader`+`ingestor`+`manager` member set) in `ui/src/lib/rbac/openfga-owned-resources.ts`.
- [ ] T010 [US1] Refactor `buildAgentRelationshipTupleDiff` to delegate to the core in `ui/src/lib/rbac/openfga-agent-tools.ts`, keeping agent-specific `globalUserAccess` (`user:*`) and `tool` `caller` edges layered on top (depends on T008).
- [ ] T011 [US1] Create the route-orchestration helper `handleShareableResourceWrite` in `ui/src/lib/rbac/shareable-resource.ts` per contract R2 (validate membership → capture creator → load previous from config → reconcile → persist; reject owner change unless `allowOwnerTransfer`).
- [ ] T012 [P] [US1] Create the Pydantic `OwnedResourceMixin` (`creator_subject`, `owner_subject`, `owner_team_slug`, `shared_with_teams`) in `ai_platform_engineering/knowledge_bases/rag/common/src/common/models/rag.py` (or a shared module it imports) with validation/normalization.
- [ ] T013 [P] [US1] Create the `<TeamOwnershipFields>` React component in `ui/src/components/rbac/TeamOwnershipFields.tsx` per contract `ui-component.md` (owner picker disabled-on-edit, share multi-select, effective-access preview, not-a-member transfer confirm, read-only creator display; controlled, button-save).
- [ ] T014 [US1] Refactor `DynamicAgentEditor` to render `<TeamOwnershipFields>` instead of its inline owner/share controls in `ui/src/components/dynamic-agents/DynamicAgentEditor.tsx`; confirm no UX/behavior change (depends on T013).
- [ ] T015 [US1] Document the canonical shareable-type model template as a comment block / reference in `deploy/openfga/model.fga` (and note it in the RBAC docs later) so new types start from it (contract C-template).
- [ ] T016 [US1] Run the agent + KB existing suites (`make caipe-ui-tests` targeted) and confirm zero behavioral change vs. the T002 baseline (SC-006).

**Checkpoint**: Shared module exists and is proven faithful; later phases compose it.

---

## Phase 3 (Plan Phase B): User Story 2 — Provenance Without Lingering Authority (Priority: P1)

**Goal**: Audit-only `creator` relation on shareable types; team `manager`
carries authority; creator written on create, never in any `can_*`.

**Independent Test**: Creating a resource writes a `creator` tuple; revoking the
creator's team membership removes their management ability while the `creator`
record remains; no `can_*` resolves via `creator`.

### Tests for User Story 2

- [ ] T017 [P] [US2] Extend the drift test (T007) to assert `creator` is present on `agent`, `knowledge_base`, `data_source`, `mcp_tool` and referenced by no permission.
- [ ] T018 [P] [US2] Add an OpenFGA model assertion test: `Check(user:C, can_manage, <type>:X)` is FALSE when only `user:C creator <type>:X` exists (creator grants nothing).

### Implementation for User Story 2

- [ ] T019 [US2] Add `define creator: [user]` to `agent`, `knowledge_base`, `data_source`, `mcp_tool` in `deploy/openfga/model.fga` (contract C1); ensure it appears in no `can_*`.
- [ ] T020 [US2] Mirror the `creator` relation into `charts/ai-platform-engineering/charts/openfga/authorization-model.json` for the same 4 types, keeping parity (FR-031).
- [ ] T021 [US2] Ensure `reconcileShareableResource` writes `user:<creatorSubject> creator <type>:<id>` on create and the route helper passes `session.sub` as creator on first write (verify against T005/T006; wire any missing call site in `ui/src/lib/rbac/shareable-resource.ts`).
- [ ] T022 [US2] Run model-parity + drift tests; confirm green.

**Checkpoint**: Provenance recorded; authority is team-based; creator is inert in authz.

---

## Phase 4 (Plan Phase C): User Story 4 — RAG Datasource Access That Enforces (Priority: P1)

**Goal**: `data_source` read/ingest/manage inherit from `knowledge_base` via
`parent_kb`; the inheritance edge is written on create; the PR #1703 mirror is
retired; `user:*` public read preserved.

**Independent Test**: Grant a team read on a KB; a member can query the
corresponding data source (inheritance) with no mirrored data_source tuples; a
non-member cannot.

### Tests for User Story 4

- [ ] T023 [P] [US4] Add OpenFGA assertion test: `Check(team-member, can_read, data_source:X)` is TRUE when only `team:t#member reader knowledge_base:X` + `data_source:X parent_kb knowledge_base:X` exist (inheritance), and likewise `can_ingest`/`can_manage` from the matching KB grants.
- [ ] T024 [P] [US4] Add a parity test confirming the `X from Y` (tuple-to-userset) form round-trips between `model.fga` and the chart JSON (contract C2 verification).
- [ ] T025 [P] [US4] Update reconciler tests to assert the `parent_kb` edge is written on datasource create and that **no** per-team `data_source` reader/manager tuples are written (mirror retired).

### Implementation for User Story 4

- [ ] T026 [US4] Add `parent_kb: [knowledge_base]` and rewrite `can_read`/`can_ingest`/`can_manage` with `... or <perm> from parent_kb` on `data_source` in `deploy/openfga/model.fga` (contract C2).
- [ ] T027 [US4] Mirror the `data_source` changes (parent_kb relation + tupleToUserset children) into `charts/ai-platform-engineering/charts/openfga/authorization-model.json` (FR-031).
- [ ] T028 [US4] Ensure `user:*` reader is present on `knowledge_base` and `data_source` (contract C3); if PR #1703 has not merged, add it here.
- [ ] T029 [US4] Write the `data_source:<id> parent_kb knowledge_base:<id>` edge on datasource creation in `ui/src/app/api/rag/[...path]/route.ts` (via the shared reconciler `parentKnowledgeBaseId`).
- [ ] T030 [US4] Retire the mirror: remove `mirrorKnowledgeBaseDiffToDataSource` usage and the `reconcileDataSourceRelationships` per-team-grant calls from `ui/src/app/api/rag/[...path]/route.ts`, `ui/src/app/api/rag/kbs/[id]/sharing/route.ts`, and `ui/src/app/api/admin/teams/[id]/kb-assignments/route.ts` (FR-020); delete now-dead mirror code in `ui/src/lib/rbac/openfga-owned-resources.ts`.
- [ ] T031 [US4] Update/remove mirror-specific tests (e.g. `openfga-kb-shared-teams.test.ts` mirror assertions, sharing-route + kb-assignments data_source mirror assertions) to reflect inheritance.
- [ ] T032 [US4] Verify the BFF datasource query/invoke filter (`ui/src/app/api/rag/[...path]/route.ts` `loadReadableDatasourceIds`/`constrainSearchBody`) resolves `data_source#can_read` through inheritance (no code change expected; add a test if feasible).

**Checkpoint**: KB grants enforce on data sources via inheritance; mirror gone.

---

## Phase 5 (Plan Phase D): User Story 5 — Datasource Ownership & Sharing Parity (Priority: P2)

**Goal**: Persist owner/shared/creator on `DataSourceInfo`; the sharing GET
returns the real owner; owner picker at create (immutable on edit); sharing UI
uses the shared component with revoke-on-unshare.

**Independent Test**: Create a datasource with an owner team, share with a second
team, unshare it — persisted config and effective access reflect each step;
owner is shown (not blank).

### Tests for User Story 5

- [ ] T033 [P] [US5] Add pytest for `DataSourceInfo` (de)serialization with the new mixin fields and backward-compat defaults in `ai_platform_engineering/knowledge_bases/rag/common/.../tests/`.
- [ ] T034 [P] [US5] Update `ui/src/app/api/rag/kbs/__tests__/sharing-route.test.ts`: GET returns real `owner_team_slug` + `creator_subject`; PUT accepts `owner_team_slug` on first-set and rejects owner change (non-transfer).
- [ ] T035 [P] [US5] Update `ui/src/components/rag/__tests__/` panel tests for the shared `<TeamOwnershipFields>` (owner shown, share add/remove, button save).

### Implementation for User Story 5

- [ ] T036 [US5] Add `OwnedResourceMixin` to `DataSourceInfo` in `ai_platform_engineering/knowledge_bases/rag/common/src/common/models/rag.py`; persist/read the fields in `metadata_storage.py`.
- [ ] T037 [US5] Populate owner from config in the sharing GET (replace the `loadOwnerTeamSlug → null` stub) and return `creator_subject` in `ui/src/app/api/rag/kbs/[id]/sharing/route.ts` (contract A1).
- [ ] T038 [US5] Accept `owner_team_slug` on the sharing PUT and route it through `handleShareableResourceWrite` (first-set only; transfer handled in Phase F) in `ui/src/app/api/rag/kbs/[id]/sharing/route.ts`.
- [ ] T039 [US5] Capture `owner_team_slug` + `creator_subject` at datasource creation and persist to config in `ui/src/app/api/rag/[...path]/route.ts` (contract A2).
- [ ] T040 [US5] Add the owner `TeamPicker` to the datasource create flow and render `<TeamOwnershipFields>` in `ui/src/components/rag/IngestView.tsx` and refactor `ui/src/components/rag/KbSharingPanel.tsx` to consume it (contract U4).

**Checkpoint**: Datasources have agent-parity ownership/sharing with accurate display.

---

## Phase 6 (Plan Phase E): User Story 6 — Custom MCP Tool Parity (Priority: P2)

**Goal**: Persist owner/shared/creator on `MCPToolConfig`; owner/share UI in the
tool dialog; BFF reconcile on POST/PUT/DELETE; enforce `can_call` on invoke.

**Independent Test**: Create a tool with owner team A, share with B; a member of
A/B can invoke, a non-member is denied at invoke; delete leaves no orphan tuples.

### Tests for User Story 6

- [ ] T041 [P] [US6] Add pytest for `MCPToolConfig` (de)serialization with mixin fields + defaults.
- [ ] T042 [P] [US6] Add BFF route tests: POST/PUT reconcile owner/shared; DELETE removes all `mcp_tool:<id>` grants (no orphans); `can_call` gate denies a non-member invoke and allows a member/agent invoke (contract A4/A5).
- [ ] T043 [P] [US6] Add/extend `mcp_tool` reconciler tests for owner+shared (`reader`+`user` member relations) and creator.

### Implementation for User Story 6

- [ ] T044 [US6] Add `OwnedResourceMixin` to `MCPToolConfig` in `models/rag.py`; persist/read in `metadata_storage.py`.
- [ ] T045 [US6] Add owner picker + share multi-select via `<TeamOwnershipFields>` to `ToolFormDialog` in `ui/src/components/rag/MCPToolsView.tsx` (contract U4).
- [ ] T046 [US6] Wire create (POST) to capture owner/creator, validate membership, persist, and reconcile in `ui/src/app/api/rag/[...path]/route.ts` (contract A4).
- [ ] T047 [US6] Wire update (PUT) to read previous from config and reconcile the diff in `ui/src/app/api/rag/[...path]/route.ts`.
- [ ] T048 [US6] Add DELETE reconciliation removing all `mcp_tool:<id>` grants (owner, shared, creator) in `ui/src/app/api/rag/[...path]/route.ts` (FR-028 — closes the orphan-tuple gap).
- [ ] T049 [US6] Add the `mcp_tool#can_call` Check on the invoke path before forwarding to `/v1/mcp/invoke` in `ui/src/app/api/rag/[...path]/route.ts`, handling both `user:<sub>` and `agent:<id>` principals; deny with a tool-specific 403 (contract A5, FR-029).

**Checkpoint**: Custom MCP tools have full parity and enforced invocation.

---

## Phase 7 (Plan Phase F): User Story 3 — Ownership Transfer (Priority: P2)

**Goal**: Transfer owner team via the shared helper, guarded by owner-team
admin/org admin, with a not-a-member UI confirmation; creator retained.

**Independent Test**: Transfer A→B as a team-A admin; A loses grants, B gains
them, creator unchanged; non-member transferor is warned; unauthorized caller
denied.

### Tests for User Story 3

- [ ] T050 [P] [US3] Reconciler test: transfer (previousOwnerTeamSlug ≠ ownerTeamSlug) deletes old-owner grants, writes new-owner grants, leaves `creator` untouched (extend T005).
- [ ] T051 [P] [US3] Route test: transfer authorized for owner-team admin / org admin, denied otherwise; persists new owner (contract A3).
- [ ] T052 [P] [US3] Component test: `<TeamOwnershipFields>` requires the not-a-member confirmation before `onTransfer(..., true)` (FR-015).

### Implementation for User Story 3

- [ ] T053 [US3] Add the transfer path in `handleShareableResourceWrite` / a dedicated transfer handler: `allowOwnerTransfer: true`, pass `previousOwnerTeamSlug`, guard with `can_manage` or `bypassForOrgAdmin` (`isOrgAdmin`) in `ui/src/lib/rbac/shareable-resource.ts` + `resource-authz.ts` (contract A3/R3).
- [ ] T054 [US3] Expose transfer on the datasource sharing route and the MCP tool PUT route (`owner_team_slug` change + `?transfer`/`confirm_not_member`) in `ui/src/app/api/rag/...`; and enable it for agents in `ui/src/app/api/dynamic-agents/route.ts` (read `body.owner_team_slug`, pass new + previous to the reconciler).
- [ ] T055 [US3] Wire the transfer affordance + not-a-member confirm in `<TeamOwnershipFields>` and surface it in all three editors (agent, datasource, MCP tool).

**Checkpoint**: All three resource types support guarded ownership transfer via one path.

---

## Phase 8 (Plan Phase G): Polish — Migration, Tests, RBAC Docs (Cross-Cutting)

**Purpose**: Backfills, full-suite verification, and mandatory RBAC living-doc
updates.

- [ ] T056 [P] Write the idempotent `parent_kb` backfill script (one edge per existing datasource, enumerated from the RAG metadata store) per db-migration §3, in `scripts/`.
- [ ] T057 [P] Write the idempotent `creator`-from-`owner` backfill script (write `creator`, retain `owner`) per db-migration §4 (research FR-012 option b), in `scripts/`.
- [ ] T058 [P] Extend `scripts/validate-rbac-matrix.py` (and the shareable-type drift check) to cover the new relations/permissions.
- [ ] T059 Update RBAC living docs (FR-030): `docs/docs/security/rbac/architecture.md` (data_source inheritance, `creator`, mcp_tool `can_call`, transfer), `workflows.md` (inheritance + transfer + invoke-gate sequences), `file-map.md` (new files: `shareable-resource.ts`, `TeamOwnershipFields.tsx`, backfills) and `index.md` if the big-picture/threat model changes.
- [ ] T060 Run full gates: `make lint`, `make test`, `make caipe-ui-tests`, model-parity, `scripts/validate-rbac-matrix.py`, `scripts/validate-rbac-doc.py`; confirm green and no SC-006 regression vs. T002 baseline.
- [ ] T061 [P] Execute the quickstart.md verification walkthroughs (RAG inheritance, MCP parity, transfer+provenance) as manual acceptance.

**Checkpoint**: Feature complete, migrated, fully tested, documented.

---

## Dependencies & Execution Order

**Hard ordering** (each blocks the next):

```
Phase 1 Setup
   └─► Phase 2 / US1 (shared module) ── FOUNDATIONAL, blocks all below
          ├─► Phase 3 / US2 (creator)          [needs core + model]
          ├─► Phase 4 / US4 (parent_kb)        [needs model; independent of US2]
          │       └─► Phase 5 / US5 (RAG persist+UI)   [needs US4 + mixin]
          ├─► Phase 6 / US6 (MCP parity)        [needs core + mixin; independent of RAG]
          └─► Phase 7 / US3 (transfer)          [needs core + at least one resource wired]
                  └─► Phase 8 / G (migration, docs, full gates)
```

- **US2 and US4 are independent** (both P1, both only need Phase 2) — can run in parallel.
- **US6 (MCP) is independent of US4/US5 (RAG)** — can run in parallel once Phase 2 is done.
- **US3 (transfer)** should land after the core + at least the agent path are wired (it reuses the agent reconciler's existing `previousOwnerTeamSlug`).
- **Phase 8** is last (backfills assume the model is live; docs/gates verify the whole).

## Parallel Opportunities

- **Within Phase 2**: T005/T006/T007 (tests) ∥; T012 (Python mixin) ∥ T013 (React component) ∥ the TS reconciler work (T008).
- **Across stories after Phase 2**: a RAG track (US4→US5) and an MCP track (US6) can proceed concurrently by different contributors; US2 (creator) can land alongside either.
- **Phase 8**: T056/T057/T058 (scripts) ∥; docs (T059) ∥ scripts.

## Implementation Strategy

- **MVP = Phase 2 (US1) + Phase 3 (US2) + Phase 4 (US4).** That delivers the
  reusable module, the provenance fix, and the RAG enforcement fix — the three
  P1 stories — and is independently shippable.
- **Increment 2 = US5 + US6** (P2 parity for RAG UI and MCP tools).
- **Increment 3 = US3** (transfer) + **Phase 8** (backfills, docs, full gates).
- Honor the FR-032 sequencing note: if PR #1703 is still open, prefer amending it
  to introduce `parent_kb`; if merged, Phase 4/T030 *deletes* the mirror instead.
