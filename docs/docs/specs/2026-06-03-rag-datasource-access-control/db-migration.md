# Migration: `parent_kb` backfill (OpenFGA tuple store)

**Storage**: OpenFGA tuple store (persisted). This change requires a migration — it is **not** a no-op.

## Required vs no-op

**Required.** Two things must happen in order:

1. **Publish the new authorization-model version** (the `data_source.parent_kb` relation + inherited `can_*`). Until the new model is live, `parent_kb` tuples reference an unknown relation.
2. **Backfill** one `data_source:<id> parent_kb knowledge_base:<id>` edge per existing KB-backed datasource.

No application DB (Mongo/SQL) changes. No index changes.

## Schema / model changes

See `contracts/openfga-model.md`. New OpenFGA model version adds the `parent_kb` relation and three `tupleToUserset` branches on `data_source`. Linked types: `data_source` (changed), `knowledge_base` (unchanged).

## Data movement (the backfill)

- **What**: for each datasource id `X` that has a corresponding knowledge base, write `data_source:X parent_kb knowledge_base:X`.
- **Source of pairing**: the shared `<datasource_id>` (1:1). Enumerate from one of:
  - existing `knowledge_base:<id>` tuples in the store, and/or
  - the RAG server `/v1/datasources` list (already used by the catalog route).
- **Idempotency**: writes go through the existing `writeOpenFgaTuples`, which pre-checks each tuple and skips ones already present → safe to re-run (INV-5 / US2 SC-002).
- **Batching**: respects the existing OpenFGA per-call write cap (chunking already implemented in `openfga.ts`). Datasource counts are small, so typically a single chunk.
- **Framework**: add as a new entry in `ui/src/lib/rbac/migrations/registry.ts` following the strictly-additive pattern of `data_source_grants_backfill_v1` (which this eventually retires). Suggested id: `data_source_parent_kb_backfill_v1`. Deletes: none.

## Ordering & mirror cushion (see research R5 — DECISION NEEDED)

Recommended:

1. Deploy new model version.
2. Run `data_source_parent_kb_backfill_v1`.
3. **Keep** the mirror (`mirrorKnowledgeBaseDiffToDataSource`) writing for one release as rollback insurance.
4. Follow-up: remove the mirror + its call sites; retire `data_source_grants_backfill_v1`.

## Rollback

- **Revert the model version** to the prior one. Because direct `data_source` access tuples are still present (written by the create path historically + the retained mirror during the cushion), effective access is unchanged by the revert.
- `data_source:<id> parent_kb knowledge_base:<id>` tuples are **inert** under the old model (the relation no longer exists in the model) and can be left in place or swept by a reverse backfill later. They grant nothing on their own.
- No data loss: the migration only adds tuples.

## Environments

- Helm and local Docker Compose load the **same** chart JSON model, so there is one artifact to version. No per-environment divergence. Apply the model version + backfill in each environment's OpenFGA store.

## Verification

- After backfill: `ListObjects(member, can_read, data_source)` returns the same or a superset of pre-migration results for a representative user set (no access lost — SC-002).
- Spot-check: a datasource with only `team#member reader knowledge_base:<id>` (no `data_source` tuple) now passes `Check(member, can_read, data_source:<id>) = true` (SC-001).
- See `quickstart.md` for concrete commands.
