# Implementation Plan: RAG datasource access via `data_source → knowledge_base` inheritance

**Branch**: `2026-06-03-rag-datasource-access-control` (authored on `feat/rag-datasource-access-fixes`) | **Date**: 2026-06-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-06-03-rag-datasource-access-control/spec.md`

## Summary

Replace the runtime "mirror every `knowledge_base` grant onto `data_source`" patch with a single OpenFGA inheritance edge: `data_source` gains a `parent_kb` relation to `knowledge_base`, and `can_read` / `can_ingest` / `can_manage` inherit via tuple-to-userset (`... from parent_kb`). Access is then written **once** on `knowledge_base`; the datasource leaf inherits. This removes the entire see-but-not-search bug class (including from the Access Manager, which structurally cannot write `data_source` tuples), deletes the mirror code, and stores less data. Ships behind a strictly-additive `parent_kb` backfill so no existing access changes.

This plan is **for review by the PR 4 author before implementation** — it changes a model that shipped ~1 week ago.

## Technical Context

**Language/Version**: TypeScript (Next.js 16 / React 19) for BFF + admin UI; Python 3.13 for the RAG server enforcement path. OpenFGA DSL + JSON authorization model.
**Primary Dependencies**: OpenFGA (ReBAC PDP, tuple-to-userset / `X from Y`), tuple read/write/check via `ui/src/lib/rbac/openfga.ts`; FastAPI/Starlette RAG server (`server/rbac.py`).
**Storage**: OpenFGA tuple store (persisted). **Migration required** — additive `parent_kb` backfill. See *Database migrations*.
**Testing**: Jest (UI/BFF), pytest (RAG server + `deploy/openfga/bridge` model-parity), `scripts/validate-rbac-matrix.py` (CI guard).
**Target Platform**: Kubernetes/Helm (chart-packaged JSON model) and local Docker Compose (mounts the same chart JSON).
**Project Type**: Web application (Next.js BFF + admin UI) over a Python RAG service, with a shared OpenFGA authorization model.
**Performance Goals**: `data_source#can_read` `ListObjects` (run per RAG query to scope results) stays within current p95; tuple-to-userset adds one indirection.
**Constraints**: Non-disruptive to a live ReBAC store; idempotent backfill; preserve org-admin super-grant + `RAG_ADMIN_BYPASS_DISABLED`; two model artifacts (DSL + chart JSON) MUST stay in sync (helm-values parity test).
**Scale/Scope**: Datasource count is small (tens–low hundreds per org); tuple count dominated by team/membership grants, not datasources.

## Constitution Check

*GATE: must pass before Phase 0. Re-checked after Phase 1.*

- **I. Worse is Better / III. Rule of Three**: PASS — three+ write paths already duplicate the "also write data_source" concern; the mirror is the second occurrence and the Access-Manager gap is the third. Inheritance removes the duplication at the model layer rather than adding a fourth mirror call. Net code reduction.
- **II. YAGNI**: PASS with care — we are *not* building multi-source KBs; we add only the `parent_kb` edge the 1:1 case needs, which also happens to be forward-compatible. FR-007 keeps the existing ingest-only capability rather than speculatively extending it.
- **IV. Composition over Inheritance**: N/A to code structure — "inheritance" here is an OpenFGA relation graph (tuple-to-userset), the idiomatic ReBAC "component-in-container" pattern, not a class hierarchy.
- **V. Specs as Source of Truth**: PASS — spec/plan precede implementation.
- **VI. CI Gates**: PASS — gates enumerated in SC-006; nothing ships without them.
- **VII. Security by Default**: PASS — defense in depth preserved (BFF filter + RAG-server `inject_kb_filter` both still check `data_source#can_read`); change is additive and fail-safe (absent `parent_kb` edge → falls back to direct tuples, never opens access).

**No violations to justify** → Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-06-03-rag-datasource-access-control/
├── spec.md              # Feature specification (done)
├── plan.md              # This file
├── research.md          # Phase 0 — model/inheritance decisions, ListObjects, rollout
├── data-model.md        # Phase 1 — types, relations, parent_kb edge, derived perms
├── contracts/
│   └── openfga-model.md  # Phase 1 — before/after DSL + JSON relation contract
├── db-migration.md      # Phase 1 — parent_kb backfill (OpenFGA tuple store)
├── quickstart.md        # Phase 1 — verify inheritance + backfill locally
└── tasks.md             # Phase 2 — /speckit.tasks (NOT created here)
```

### Source Code (repository root)

```text
deploy/openfga/
├── model.fga                       # add `parent_kb` + inherited can_* on data_source
└── init/seed.py                    # (reference) how the model is loaded

charts/ai-platform-engineering/charts/openfga/
└── authorization-model.json        # keep in sync with model.fga (parity test)

ui/src/lib/rbac/
├── openfga-owned-resources.ts      # REMOVE mirrorKnowledgeBaseDiffToDataSource + data_source dual-writes
├── openfga.ts                      # tuple read/write/check helpers (unchanged API)
├── migrations/registry.ts          # ADD parent_kb backfill; retire data_source_grants_backfill mirror
└── resource-model.ts               # FR-012 decision: promote data_source to universal catalog? (open)

ui/src/app/api/rag/
├── [...path]/route.ts              # create path: write parent_kb edge, drop access dual-write
└── kbs/[id]/sharing/route.ts       # drop data_source mirror call (KB-only write again)

ui/src/app/api/admin/teams/[id]/kb-assignments/route.ts   # drop mirror call (KB-only write again)

ai_platform_engineering/knowledge_bases/rag/server/src/server/
└── rbac.py                         # no logic change — still checks data_source#can_read (now inherited)

docs/docs/security/rbac/
├── architecture.md                 # update model + supersede the mirror note
└── file-map.md                     # update affected files
```

**Structure Decision**: Web app (Next.js BFF/UI) + Python RAG service sharing one OpenFGA model. The change is concentrated in the shared model (two artifacts) and the TS write/reconcile layer; the Python enforcement path is unchanged because it already checks `data_source#can_read` — only how that relation *derives* changes.

## Database migrations

*Storage is the OpenFGA tuple store (persisted) → this section applies. Deliverable: `db-migration.md`.*

**Must cover**:

- **Required, not no-op**: a backfill writes one `data_source:<id> parent_kb knowledge_base:<id>` edge per existing KB-backed datasource. The new model version must be written to the store first.
- **Schema / model changes**: new `parent_kb` relation + `... from parent_kb` unions on `data_source` in both the DSL and chart JSON (see `contracts/openfga-model.md`). New OpenFGA authorization-model version.
- **Data movement**: idempotent tuple writes (`writeOpenFgaTuples` pre-checks each tuple, so re-runs are no-ops). Source of datasource→KB pairing: the shared `<datasource_id>` (1:1) — derive from `/v1/datasources` and/or existing `knowledge_base:` tuples.
- **Ordering & cushion**: (1) publish new model version; (2) backfill `parent_kb`; (3) [NEEDS CLARIFICATION FR-006] optionally keep the mirror dual-write for one release as rollback insurance; (4) remove mirror + retire `data_source_grants_backfill_v1`.
- **Rollback**: direct `data_source` access tuples remain present (written by create path / retained mirror during the cushion window), so reverting to the prior model version keeps access intact. `parent_kb` edges are inert under the old model.
- **Environments**: same model JSON for Helm and local Compose; no env-specific divergence.

## Complexity Tracking

> No constitution violations — section intentionally empty.
