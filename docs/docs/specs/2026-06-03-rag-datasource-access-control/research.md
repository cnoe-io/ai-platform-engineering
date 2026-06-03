# Phase 0 Research: `data_source → knowledge_base` inheritance

Resolves the unknowns and `NEEDS CLARIFICATION` markers from the spec/plan. Each item: Decision · Rationale · Alternatives considered. Items still needing the PR 4 author's input are marked **DECISION NEEDED**.

## R1. Inheritance mechanism — tuple-to-userset on a `parent_kb` relation

- **Decision**: Add `define parent_kb: [knowledge_base]` to `data_source`, and union `... or can_read from parent_kb` into `can_read` (likewise `can_ingest`, `can_manage`). One structural tuple `data_source:<id> parent_kb knowledge_base:<id>` wires each datasource to its KB.
- **Rationale**: This is OpenFGA's canonical "component-in-container" pattern (the docs' folder→document example). Reads/grants live on the parent; the leaf inherits. It collapses two synchronized graphs into one source of truth and makes the Access-Manager surface "just work" (it already writes `knowledge_base` grants).
- **Alternatives considered**:
  - *Status quo mirror* — rejected: per-write-site, one surface can't mirror, two graphs to keep in sync (the problem this spec exists to remove).
  - *Make enforcement read `knowledge_base#can_read` directly and drop `data_source`* — rejected: throws away the ingest-only-on-component capability PR 4 was built for (Story 3 / FR-007).
  - *Computed relation without a parent tuple (alias)* — rejected: OpenFGA can't alias across object types without a relation edge; the `parent_kb` tuple is required.

## R2. Which permissions inherit

- **Decision**: `can_read`, `can_ingest`, and `can_manage` inherit from `parent_kb`. Direct `data_source` `reader`/`ingestor`/`owner`/`manager` remain and union with the inherited branch.
- **Rationale**: Mirrors today's effective semantics (KB read/ingest/manage already implied datasource read/ingest/manage via the mirror). Keeping direct relations preserves component-only grants (Story 3).
- **Alternatives considered**: *Inherit read only* — rejected: KB-level ingest/manage grants (e.g., a team admin managing a KB) would silently lose datasource ingest/manage, a regression vs. the mirror.

## R3. `ListObjects` performance with tuple-to-userset

- **Decision**: Acceptable; proceed. Validate with a quickstart check on a representative store; capture p95 for `ListObjects(user, can_read, data_source)` before/after (SC-005).
- **Rationale**: Datasource cardinality is small (tens–low hundreds). Tuple-to-userset adds one resolution hop from `data_source → knowledge_base`; OpenFGA optimizes `ListObjects` for exactly this shape. The per-query RAG scoping call already does a `ListObjects`/list-filter, so we are changing its derivation, not adding a new call.
- **Alternatives considered**: *Precompute/denormalize readable datasource ids* — rejected as premature (YAGNI); revisit only if SC-005 fails.

## R4. Public datasources under inheritance (`user:*`)

- **Decision**: Write `user:* reader knowledge_base:<id>` only and let `data_source` inherit it. Update the public-datasources route to write/delete the KB tuple (not both types).
- **Rationale**: One tuple, consistent with the single-source-of-truth goal; "public KB ⇒ public datasource" matches the 1:1 reality. Removes the dual-write the current public route does.
- **Alternatives considered**: *Keep writing `user:*` on both types* — rejected: reintroduces the dual-write the spec is eliminating. **Caveat to verify in quickstart**: confirm a typed-wildcard subject (`user:*`) resolves correctly *through* a tuple-to-userset in `Check` and `ListObjects` (R3); if any edge case fails, fall back to writing `user:*` on `data_source` too (documented exception).

## R5. FR-006 — when to remove the mirror

- **DECISION NEEDED** (recommend: **one-release cushion**). Recommended sequence:
  1. Ship the model change + `parent_kb` backfill. **Keep** `mirrorKnowledgeBaseDiffToDataSource` writing for one release.
  2. Verify in prod that KB-only grants confer searchable access (SC-001) and no regressions (SC-002).
  3. Follow-up PR removes the mirror + its call sites and retires `data_source_grants_backfill_v1`.
- **Rationale**: The cushion keeps direct `data_source` access tuples present, making a model-version rollback safe (R7). Aligns with "Worse is Better" — ship the safe increment, delete dead code once proven.
- **Alternatives considered**: *Remove the mirror in the same PR* — viable and simpler in code, but a model rollback would then strip access for grants made after the switch. Defer to the PR 4 author's risk tolerance.

## R6. FR-012 — promote `data_source` to the universal catalog?

- **DECISION NEEDED** (recommend: **No / not now**). With inheritance, no surface needs to *write* `data_source` access tuples — KB grants suffice — so the Access Manager doesn't need `data_source` in `resource-model.ts`. Keeping it out preserves the deliberate "no UI picker for data_source" choice from PR 4.
- **Rationale**: YAGNI. The only reason to promote it would be to grant *component-only* `ingestor` from the UI, which no shipped feature does. Promotion can be a separate spec if/when multi-source KBs arrive.
- **Alternatives considered**: *Promote now* — rejected: adds catalog surface area and a `data_source` picker with no current consumer.

## R7. Rollout & rollback safety

- **Decision**: Forward: publish new model version → backfill `parent_kb` (idempotent) → (cushion) → remove mirror. Rollback: revert to prior model version; direct `data_source` tuples (retained during the cushion) keep access; `parent_kb` edges are inert under the old model and can be left or swept later.
- **Rationale**: Every step is additive or reversible; no step strips access. Matches the existing migration framework's strictly-additive pattern (`data_source_grants_backfill_v1`).
- **Alternatives considered**: *Big-bang switch with mirror removal* — see R5.

## R8. Datasource deletion cleanup (FR-010)

- **Decision**: On datasource delete, remove the `parent_kb` edge alongside any direct `data_source` tuples. Where deletion already cascades tuple cleanup, extend it to include `parent_kb`.
- **Rationale**: Prevents dangling inheritance edges to a deleted KB. Low effort; co-located with existing delete handling.
- **Alternatives considered**: *Leave edges (harmless if KB also gone)* — rejected: leaves store cruft and risks surprising `ListObjects` output if a KB id is later reused.

## Open questions to confirm with the PR 4 author

1. **R5** — one-release mirror cushion, or remove immediately?
2. **R6** — keep `data_source` out of the universal catalog (recommended), or promote?
3. **R4 caveat** — comfortable expressing "public" once on `knowledge_base` and inheriting, pending the wildcard-through-userset verification?
4. Any planned **multi-source KB** work that should shape the `parent_kb` relation now (e.g., naming, or allowing multiple parents)?
