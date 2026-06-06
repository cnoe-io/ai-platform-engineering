# Implementation Plan: Unified Group-Based Access Control for Shareable Resources

**Branch**: `2026-06-03-unified-shareable-resource-rbac` | **Date**: 2026-06-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-06-03-unified-shareable-resource-rbac/spec.md`

## Summary

Make the agent subsystem's group-based access-control pattern (one immutable
owner team + mutable shared-teams, config-as-source-of-truth with OpenFGA as the
derived enforcement projection) **canonical and reusable**, then bring RAG
datasources and custom MCP tools to full parity. Five composable pieces — an
OpenFGA model template, a shared reconciler core, a route-orchestration helper, a
Pydantic `OwnedResourceMixin`, and a `<TeamOwnershipFields>` React component —
let any future resource get correct access control by composition. Two structural
fixes ride along: an **audit-only `creator` relation** split from functional
`owner`/team-`manager` authority, and **A2 `parent_kb` inheritance** for
`data_source` (retiring the PR #1703 mirror). New capabilities: **ownership
transfer** (guarded, with a not-a-member confirmation) and **`can_call`
enforcement** on the MCP tool invocation path.

Approach is drawn directly from research: the agent reconciler already supports
the revoke diffs and `previousOwnerTeamSlug` transfer path; the partial shared
core (`buildOwnedResourceWithSharedTeamsDiff`) already serves data_source and
mcp_tool. This feature generalizes what exists rather than inventing new
mechanisms.

## Technical Context

**Language/Version**: TypeScript (Next.js 16, React 19) for the BFF/UI; Python
3.13 for the RAG server/common.
**Primary Dependencies**: OpenFGA (authorization model + tuples), Keycloak OIDC
(JWT `sub`), Next.js App Router + next-auth, Pydantic (RAG config models),
FastMCP/Starlette (RAG server), Zustand (UI state).
**Storage**: Redis (RAG `DataSourceInfo` / `MCPToolConfig` configs) + OpenFGA
tuple store. MongoDB for agents is unchanged. **Not N/A → see Database migrations.**
**Testing**: Jest (UI/BFF), pytest (RAG/Python), OpenFGA model-parity test,
`validate-rbac-matrix.py`.
**Target Platform**: Linux server (Kubernetes/Helm); local dev via compose.
**Project Type**: Web application (frontend BFF + Python backend services) plus a
shared authorization model.
**Performance Goals**: No regression to reconcile latency; transfer/share writes
are O(#teams) tuple writes as today. The `can_call` invoke gate adds one OpenFGA
`Check` per custom-tool invocation (same order as the existing datasource filter).
**Constraints**: OpenFGA authored (`.fga`) and chart (JSON) models MUST stay in
parity (existing test). Config writes must not fail when reconciliation is
disabled (config is source of truth). Backfills must be idempotent and remove no
existing access. Dev-auth shortcuts must remain production-safe.
**Scale/Scope**: 9 existing owner+team+shared OpenFGA types; this feature touches
4 (`agent`, `knowledge_base`, `data_source`, `mcp_tool`) and adds the reusable
path for future types. Spans the OpenFGA model, two Python config models + Redis
storage, several BFF routes, and three UI editors.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| **I. Worse is Better** | PASS. Generalizes the *working* agent code rather than designing a new abstraction from scratch. Migration is non-breaking (additive fields, additive relations, no access removed). |
| **II. YAGNI** | PASS with care. The shared module is built only for the 4 types that need it now; `creator` is added to a type only when its creation path is updated to write it (contract C4) — no speculative relations on types nobody writes. The transfer flow is requested, not speculative. |
| **III. Rule of Three** | PASS — the central justification. 9 owner+team+shared types already exist (far past 3); extracting the shared module is the prescribed refactor, not premature abstraction. |
| **IV. Composition over Inheritance** | PASS. The module is composed units (a function, a route helper, a mixin, a component, a template) — not a class hierarchy. `OwnedResourceMixin` is a Pydantic field mixin (composition of fields), and the UI is a mounted component, not a base class. |
| **V. Specs as Source of Truth** | PASS. This spec/plan precedes code; the other committer signs off on A2 + the model change. |
| **VI. CI Gates** | PASS. Lint, Jest, pytest, model-parity, and `validate-rbac-matrix.py` all gate; SC-006 makes the refactor's regression-freedom a gate (existing agent/KB suites unchanged). |
| **VII. Security by Default** | PASS — net improvement. Closes the unenforced MCP invoke path, removes lingering personal-owner authority, validates inputs at the route helper, and adds defense in depth (BFF `can_call` check). No secrets in source. |

**Initial gate: PASS.** No violations requiring Complexity Tracking.

**Post-Phase-1 re-check: PASS.** The design (Phase 1 artifacts) introduces no new
violations: the shared module composes rather than inherits, the model change is
additive, and `creator` remains audit-only by contract (C5 drift check).

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-06-03-unified-shareable-resource-rbac/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — decisions + resolved clarifications
├── data-model.md        # Phase 1 — entities, relations, tuple sets
├── quickstart.md        # Phase 1 — "add a new shareable resource" guide
├── contracts/           # Phase 1 — model, reconciler/route, http-api, ui-component
│   ├── openfga-model.md
│   ├── reconciler-and-route.md
│   ├── http-api.md
│   └── ui-component.md
├── db-migration.md      # Phase 1 — Redis fields + OpenFGA backfills
└── tasks.md             # Phase 2 — produced by /speckit.tasks (NOT this command)
```

### Source Code (repository root)

```text
deploy/openfga/
└── model.fga                       # creator relation; data_source.parent_kb + inheriting perms
charts/ai-platform-engineering/charts/openfga/
└── authorization-model.json        # parity-matched JSON form

ui/src/lib/rbac/
├── openfga-owned-resources.ts      # generalize → reconcileShareableResource core
├── openfga-agent-tools.ts          # refactor agent builder onto the core (keep user:*/caller)
├── shareable-resource.ts           # NEW: route-orchestration helper (handleShareableResourceWrite)
└── resource-authz.ts               # reuse isOrgAdmin/bypassForOrgAdmin for transfer guard

ui/src/app/api/
├── rag/kbs/[id]/sharing/route.ts   # owner from config; accept owner_team_slug; transfer
├── rag/[...path]/route.ts          # datasource create owner/creator; mcp tool POST/PUT/DELETE reconcile; can_call invoke gate
└── dynamic-agents/route.ts         # refactor onto shared helper (no behavior change); enable transfer

ui/src/components/
├── rbac/TeamOwnershipFields.tsx    # NEW: shared owner picker + share multi-select + preview + transfer confirm
├── dynamic-agents/DynamicAgentEditor.tsx   # consume TeamOwnershipFields
└── rag/{IngestView,KbSharingPanel,MCPToolsView}.tsx  # consume TeamOwnershipFields

ai_platform_engineering/knowledge_bases/rag/common/src/common/
├── models/rag.py                   # OwnedResourceMixin; add to DataSourceInfo + MCPToolConfig
└── metadata_storage.py             # persist/read the new fields

scripts/
├── (backfill) parent_kb edges + creator-from-owner   # idempotent migration scripts
└── validate-rbac-*.py              # extend matrix + shareable-type drift check

docs/docs/security/rbac/
├── architecture.md                 # data_source inheritance, creator, mcp_tool can_call, transfer
├── workflows.md                    # inheritance + transfer + invoke-gate sequences
└── file-map.md                     # new files (shareable-resource.ts, TeamOwnershipFields.tsx, backfills)
```

**Structure Decision**: Web-application layout with a shared authorization model.
The shared module is split by layer (TS reconciler + route helper in
`ui/src/lib/rbac/`, Pydantic mixin in RAG `common`, React component in
`ui/src/components/rbac/`, model template in `deploy/openfga/`) so each piece is
independently testable (Composition-over-Inheritance). No new top-level project.

## Database migrations

**Storage is not N/A** (Redis configs + OpenFGA tuples). Full plan in
[db-migration.md](./db-migration.md). Summary:

- **Redis config fields** — additive on `DataSourceInfo` / `MCPToolConfig`;
  **no-op migration** (backward-compatible defaults).
- **OpenFGA model push** — **required**, ordered before app rollout; additive
  relations/permissions, backward-compatible for existing tuples.
- **`parent_kb` backfill** — **required**, idempotent; one edge per existing
  datasource so pre-existing KB grants enforce on the data source.
- **`creator` backfill** — **required**, idempotent; write `creator` from each
  existing personal `owner` (retain `owner`; remove no access — research FR-012
  option b).
- **Mirror tuples (if #1703 merged)** — harmless under inheritance; leave for the
  initial release, optional cleanup later.
- **Rollback** — re-push prior model; delete backfilled tuples (none carried
  authority/were sole access), so fully reversible.

## Phase Breakdown (for /speckit.tasks)

Ordered by dependency; maps to the user stories.

1. **Phase A — Shared module foundation (US1, P1).** Generalize the reconciler
   core (+`creator`, `parentKnowledgeBaseId`); add the route helper, the
   `OwnedResourceMixin`, the `<TeamOwnershipFields>` component, and the model
   template + drift check. Refactor agent + KB onto the core; their existing
   suites must pass unchanged (SC-006).
2. **Phase B — Creator/owner split (US2, P1).** Add `creator` to the 4 types
   (model C1); write it on create via the helper; `creator` in no `can_*` (C5).
3. **Phase C — RAG inheritance (US4, P1).** Add `data_source.parent_kb` +
   inheriting perms (C2); write the edge on create; retire the mirror (FR-020);
   carry `user:*` public (C3).
4. **Phase D — RAG persistence & UI (US5, P2).** `OwnedResourceMixin` on
   `DataSourceInfo`; populate owner in the sharing GET; owner picker on create;
   `KbSharingPanel`/`IngestView` consume the shared component.
5. **Phase E — MCP tool parity (US6, P2).** `OwnedResourceMixin` on
   `MCPToolConfig`; owner/share UI in `ToolFormDialog`; BFF reconcile on
   POST/PUT/DELETE; `can_call` invoke gate (A5).
6. **Phase F — Transfer (US3, P2).** Enable owner change via the helper
   (`allowOwnerTransfer`), guarded by owner-team admin/org admin; UI confirm; one
   path serves all 3 resources.
7. **Phase G — Migration, tests, docs (cross-cutting).** Backfill scripts;
   reconciler/route/UI tests; parity + matrix + drift checks; RBAC living-doc
   updates (FR-030); quickstart verification steps.

## Complexity Tracking

No constitution violations to justify — the table is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_ | _The shared module is justified by Rule of Three (9 existing types), and uses composition, so it triggers no gate._ | — |
