# Feature Specification: RAG datasource access via `data_source → knowledge_base` inheritance

**Feature Branch**: `2026-06-03-rag-datasource-access-control`
**Created**: 2026-06-03
**Status**: Draft — for review by the PR 4 author (the `data_source`/`mcp_tool` types, 2026-05-27) before implementation
**Input**: Replace the runtime "mirror every `knowledge_base` grant onto `data_source`" approach with a single OpenFGA `parent_kb` inheritance edge, so access is written once on `knowledge_base` and `data_source` reads inherit it.

> **Why this spec exists.** A mirror-based fix is already merged (see *Current State*). It works, but it is a patch: every write path must remember to mirror, and one surface structurally cannot. This spec proposes the structural fix and exists to **get agreement from the author of the `data_source` type before we change a model that shipped ~a week ago.** It is deliberately scoped to the model/inheritance change only — the share-path fix, the `user:*` public mechanism, and the panel reorg are already done and are treated here as the baseline, not as part of this work.

## Background & Current State *(context, not the proposed change)*

The RBAC effort added OpenFGA + Keycloak. RAG knowledge bases are deny-by-default: an agent/user may read only datasources they have been granted (plus, now, any marked public).

Two OpenFGA object types model the same underlying datasource, **with no relationship between them**:

- `knowledge_base:<id>` — the parent feature resource. UI discovery / sidebar tab gates check `knowledge_base:<id>#can_read`.
- `data_source:<id>` — the datasource component. **Query-time enforcement** checks `data_source:<id>#can_read`: the RAG server's `inject_kb_filter` (`ai_platform_engineering/.../server/src/server/rbac.py`) and the BFF's `filterResourcesByPermission({type:'data_source'})` / `constrainSearchBody` (`ui/src/app/api/rag/[...path]/route.ts`).

Today a datasource id is **1:1** with its knowledge base — the RAG server uses the same `<datasource_id>` for both. The `data_source` type was introduced (PR 4, 2026-05-27) so that, in the future, an *ingest-only* grant could be given on a component without leaking KB read. That future need is not yet realized.

**The gap this created (and how it's currently patched):** several surfaces wrote `knowledge_base:<id>` tuples only, so a grant made a datasource *discoverable* but not *searchable* — the user saw it listed but got zero results. The current mitigation (merged) is a **mirror**: every `knowledge_base` grant is also written onto `data_source` via `mirrorKnowledgeBaseDiffToDataSource` (`ui/src/lib/rbac/openfga-owned-resources.ts`), wired into the create path, the Share-with-Teams route, and the team KB-assignment route. A one-time `data_source_grants_backfill_v1` migration mirrored existing tuples.

**Residual problem with the mirror (the motivation for this spec):**

- **It is per-write-site.** Each of the 3+ write paths must call the mirror. A 4th path that forgets reintroduces the see-but-not-search bug.
- **One surface structurally cannot mirror.** The Access Manager / Policy Graph (`/api/admin/openfga/relationship` + `OpenFgaRebacTab`) can write `team#member reader knowledge_base:<id>` directly, but **cannot write `data_source` tuples at all** — `data_source` is intentionally not a universal-catalog resource type (`ui/src/lib/rbac/resource-model.ts`), so that route's validator rejects it. An admin who grants KB read from the Policy Graph reproduces the original bug.
- **Two graphs to keep consistent.** Reads, lists, revokes, and audits must reason about both types staying in sync.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Granting KB read makes the datasource searchable, from any surface (Priority: P1)

An admin (or KB owner) grants a team read on a knowledge base — via the RAG Team Access panel, the Share-with-Teams page, the team KB-assignment API, **or the Access Manager / Policy Graph**. In every case, members of that team can immediately search the datasource and get results.

**Why this priority**: This is the whole point — it closes the see-but-not-search bug at the model level so no write path can reintroduce it. It is the MVP: shipping only this story already removes the bug class.

**Independent Test**: Write a single `team:<slug>#member reader knowledge_base:<id>` tuple through the Access Manager (the surface that cannot mirror today). Then call the RAG query path as a team member and confirm non-empty results gated to that datasource — with **no** `data_source:<id>` access tuple present.

**Acceptance Scenarios**:

1. **Given** a datasource with a `parent_kb` edge to its KB and no direct `data_source` access tuples, **When** `team:<slug>#member reader knowledge_base:<id>` is written by any surface, **Then** `check(user:<member>, can_read, data_source:<id>)` returns `true`.
2. **Given** the same, **When** the team member runs a RAG search, **Then** results from that datasource are returned (parity with a KB-discoverable datasource).
3. **Given** a KB read grant is later revoked, **When** `check(user:<member>, can_read, data_source:<id>)` is evaluated, **Then** it returns `false` (revocation flows through inheritance with no separate `data_source` delete).

### User Story 2 - Existing datasources keep working after the model change (Priority: P1)

Every datasource that is accessible today (via mirrored `data_source` tuples, owner tuples, or public `user:*`) remains accessible after the inheritance edge is introduced. No user loses access and no admin must re-grant.

**Why this priority**: A model change to a live ReBAC store is only acceptable if it is non-disruptive. Backfilling the `parent_kb` edge must be strictly additive and idempotent.

**Independent Test**: On a store seeded with today's mirrored tuples, run the backfill, then assert a representative set of `(user, can_read, data_source:<id>)` checks return the same boolean before and after.

**Acceptance Scenarios**:

1. **Given** a store with existing `data_source:<id>` access tuples, **When** the `parent_kb` backfill runs, **Then** it only adds `data_source:<id> parent_kb knowledge_base:<id>` edges and deletes nothing.
2. **Given** a datasource previously made public via `user:* reader data_source:<id>`, **When** the change ships, **Then** it remains world-readable.
3. **Given** the backfill is run twice, **When** the second run completes, **Then** it is a no-op (idempotent).

### User Story 3 - Ingest-only-on-component remains expressible (Priority: P2)

The reason the `data_source` type was split out — granting ingest/write on a component without conferring KB read — must still be possible after inheritance is added.

**Why this priority**: Preserves the forward-looking capability PR 4 was designed for; without it, this change would regress the type's reason to exist. Lower than P1 because no shipped feature uses it yet.

**Independent Test**: Write a `data_source:<id> ingestor team:<slug>#member` tuple with no KB read grant; confirm `can_ingest` is `true` and `can_read` is driven only by the inherited KB read (i.e., direct ingest does not leak read it shouldn't).

**Acceptance Scenarios**:

1. **Given** a direct `ingestor` grant on `data_source:<id>` and no KB read grant, **When** checks run, **Then** `can_ingest = true`.
2. **Given** the same, **When** evaluating `can_read`, **Then** it reflects only inherited KB read + direct `data_source` reader/owner — direct ingest alone does not grant read beyond what the model already says (`can_read = reader or can_manage or owner or inherited`).

### Edge Cases

- **Datasource with no `parent_kb` edge** (e.g., created before the backfill, or a future non-KB-backed data source): inheritance contributes nothing; access falls back to direct `data_source` tuples. Must not error.
- **KB deleted but data_source lingers** (or vice versa): a dangling `parent_kb` edge must not grant access to a non-existent parent; define cleanup on datasource deletion.
- **Org-admin super-grant** (`organization#admin → can_manage`, bypass via `bypassForOrgAdmin`) and the `RAG_ADMIN_BYPASS_DISABLED` kill switch must behave identically before/after.
- **Public `user:*`**: decide whether public is expressed once on `knowledge_base` (and inherited) or continues to be written on both. Inheriting from KB would let `user:* reader knowledge_base:<id>` alone make a datasource searchable — simpler, but verify `ListObjects` semantics with a wildcard through a tuple-to-userset.
- **`ListObjects` performance**: query enforcement enumerates readable `data_source` objects per request. Confirm tuple-to-userset (`can_read from parent_kb`) keeps `ListObjects` latency acceptable at the store's scale.
- **Model rollback**: if the new model version must be rolled back, direct `data_source` tuples (still written by the create path / retained mirror during transition) must keep access intact.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The OpenFGA model MUST add a `parent_kb` relation on `data_source` that references `knowledge_base`, in both `deploy/openfga/model.fga` and `charts/ai-platform-engineering/charts/openfga/authorization-model.json` (kept in sync; the helm-values parity test guards this).
- **FR-002**: `data_source.can_read` MUST inherit KB read, i.e. `can_read = reader or can_manage or owner or can_read from parent_kb`. `can_ingest` and `can_manage` MUST similarly include `... from parent_kb` so KB-level ingest/manage flow down.
- **FR-003**: On datasource creation, the system MUST write exactly one structural tuple `data_source:<id> parent_kb knowledge_base:<id>` (replacing the create-path dual-write of access tuples).
- **FR-004**: A strictly-additive, idempotent backfill migration MUST write `parent_kb` edges for every existing datasource that has a corresponding knowledge base, deleting nothing.
- **FR-005**: After this change, access-granting surfaces (RAG Team Access panel, Share-with-Teams, team KB-assignment API, **and Access Manager / Policy Graph**) MUST write grants on `knowledge_base:<id>` only; they MUST NOT need to write `data_source` access tuples to make a datasource searchable.
- **FR-006**: The mirror (`mirrorKnowledgeBaseDiffToDataSource`) and its call sites MUST be removed once inheritance is enforced and backfilled. [NEEDS CLARIFICATION: remove immediately, or keep dual-write through one release as a rollback cushion and delete in a follow-up?]
- **FR-007**: Direct per-datasource grants on `data_source` (`reader`, `ingestor`, `owner`, `manager`, and `user:*`) MUST continue to be honored, so component-only ingest grants and any non-KB-backed datasource still work.
- **FR-008**: Revoking a KB-level read/ingest/manage grant MUST remove the corresponding inherited access on the datasource with no separate `data_source` delete.
- **FR-009**: The change MUST preserve org-admin behavior (`organization#admin` manage edge + `bypassForOrgAdmin`) and the `RAG_ADMIN_BYPASS_DISABLED` kill switch exactly.
- **FR-010**: Datasource deletion MUST clean up the `parent_kb` edge (and any direct `data_source` tuples) so no dangling inheritance remains.
- **FR-011**: Per the RBAC living-doc rule, `docs/docs/security/rbac/architecture.md` and `file-map.md` MUST be updated in the same change; `scripts/validate-rbac-matrix.py` MUST pass.
- **FR-012**: [NEEDS CLARIFICATION: should `data_source` be promoted to a universal-catalog resource type (`resource-model.ts`) so the Access Manager can also write/inspect it directly — or is inheriting from `knowledge_base` sufficient, leaving `data_source` out of the universal catalog as today?]

### Key Entities

- **knowledge_base:`<id>`**: Parent RAG feature resource. Access is granted here (owner, reader, ingestor, manager; `user:*` reader for public). Source of truth for who-can-do-what on a datasource.
- **data_source:`<id>`**: Datasource component, 1:1 with its KB today. Gains a `parent_kb` edge to its `knowledge_base` and inherits `can_read` / `can_ingest` / `can_manage`. May still carry direct grants for component-only (e.g. ingest-only) cases.
- **`parent_kb` edge**: `data_source:<id> parent_kb knowledge_base:<id>` — the single structural tuple written at creation/backfill that wires inheritance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Granting `team:<slug>#member reader knowledge_base:<id>` from **any** surface — including the Access Manager — makes the datasource searchable for team members, verified by a non-empty RAG query result. (Closes the bug class.)
- **SC-002**: Zero access changes for existing users across a representative check set before vs. after the backfill (no regressions, no re-grants required).
- **SC-003**: Net code reduction: `mirrorKnowledgeBaseDiffToDataSource`, its call sites in the create/share/assign paths, and the `data_source_grants_backfill_v1` mirror migration are removed, replaced by one `parent_kb` write + one backfill. (Less code than the mirror approach.)
- **SC-004**: No write path needs to know about `data_source` to grant read access — demonstrated by the Access Manager (which cannot write `data_source`) now conferring searchable access via KB grant alone.
- **SC-005**: `ListObjects` for `data_source#can_read` on a representative store stays within current p95 latency budget after the tuple-to-userset change.
- **SC-006**: All RBAC quality gates pass — `make caipe-ui-tests`, ESLint, the OpenFGA model-parity test, and `scripts/validate-rbac-matrix.py`.

## Out of Scope

- The already-merged share-path `data_source` mirror, the `user:*` public-datasources mechanism, and the RAG Team Access panel reorganization. Those are the **baseline** this spec builds on; they are not re-litigated here. (This change *removes* the mirror once inheritance lands — see FR-006.)
- Per-document ACL (`doc_acl.py`, `__public__` tags) — orthogonal, unchanged.
- Multi-source knowledge bases (one KB → many data sources). Inheritance is designed to *support* this later, but no such KB exists today and none is built here.
