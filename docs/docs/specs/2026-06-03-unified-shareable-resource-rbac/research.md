# Phase 0 Research: Unified Shareable-Resource RBAC

This document resolves the design decisions and the two `NEEDS CLARIFICATION`
markers from `spec.md`. Each decision records what was chosen, why, and what
was rejected.

## Baseline facts established by code investigation

These were verified against the codebase on branch
`2026-06-03-unified-shareable-resource-rbac` (forked from `main`; PR #1703 is
**open, not merged**, so the `user:*` public-reader additions are not present in
the baseline model).

- **Agent is the only complete reference.** `reconcileAgentRelationships`
  (`ui/src/lib/rbac/openfga-agent-tools.ts`) writes, per effective team,
  `team:<slug>#member → user` and `team:<slug>#admin → manager`, plus
  `user:<sub> → owner`. It already accepts `previousOwnerTeamSlug` and
  `previousSharedTeamSlugs` for symmetric revoke diffs and a `globalUserAccess`
  toggle for `user:*`.
- **Agent persists in Mongo as source of truth.** The agent PUT route
  (`ui/src/app/api/dynamic-agents/route.ts`) reads the previous shared set and
  owner from the stored Mongo document, not from OpenFGA.
- **A partial shared core already exists.** `buildOwnedResourceWithSharedTeamsDiff`
  in `ui/src/lib/rbac/openfga-owned-resources.ts` is used by `data_source` and
  `mcp_tool` and accepts `extraMemberRelations`. The agent and knowledge_base
  builders do NOT use it — they are bespoke copies.
- **`owner` is functional, not audit.** Every shareable type's `can_read` and
  `can_manage` include `... or owner`. There is **no** `creator` relation
  anywhere today.
- **No tuple-to-userset exists yet.** `grep "from "` against `deploy/openfga/model.fga`
  finds only a comment. A `parent_kb`-style `X from Y` edge would be the model's
  first use of tuple-to-userset; the syntax is standard OpenFGA and supported by
  the deployed version (the chart model is the same schema version).
- **RAG ownership is not persisted.** `DataSourceInfo`
  (`ai_platform_engineering/knowledge_bases/rag/common/.../models/rag.py`) has no
  owner/team fields; the KB sharing route's `loadOwnerTeamSlug` returns `null`.
- **MCP tool config is not persisted with ownership.** `MCPToolConfig` (same
  models file) has only `tool_id`, `description`, searches, filters, `enabled`,
  timestamps. Stored in Redis via `metadata_storage.py`.
- **MCP invoke is unenforced.** `/v1/mcp/invoke` in the RAG server requires only
  `require_authenticated_user`; no `can_call` check. The BFF constrains the
  query body's `datasource_id` but performs no tool-level check.
- **MCP delete does not reconcile.** The BFF reconciles `mcp_tool` on PUT but not
  on DELETE, leaving orphan tuples.
- **Org-admin bypass helper exists.** `isOrgAdmin` / `bypassForOrgAdmin` in
  `ui/src/lib/rbac/resource-authz.ts` is the basis for the transfer guard.

---

## Decision 1 — Creator/owner split (resolves FR-008..FR-011)

**Decision**: Add an audit-only `creator: [user]` relation to every shareable
resource type. It is referenced by **no** `can_*` permission. Functional
management authority for team-owned resources flows through
`team:<slug>#admin → manager` (plus the org-admin bypass). The personal
`owner` relation is retained in the model (still needed for genuinely
personal/service-account-owned resources and backward compatibility) but is no
longer the mechanism the reconciler uses to convey a creator's authority over a
team-owned resource.

**Rationale**:
- Separates provenance from authority — the user's stated goal ("keep `creator`
  around so we can audit things if needed" while control follows the team).
- An audit-only relation cannot accidentally grant access because it is absent
  from every permission expression; this is enforceable by the model-template
  drift check (FR-007).
- Keeping `owner` in the type (rather than deleting it) avoids a breaking model
  change and preserves the personal-ownership path used elsewhere.

**Alternatives considered**:
- *Clear `owner` on transfer, no new relation* — simpler, but loses the audit
  trail the user explicitly asked to keep, and leaves "who made this" unanswerable.
- *Repurpose `owner` as audit-only* — would require removing `owner` from every
  `can_*`, a breaking change to existing tuples and to personal-ownership
  semantics across all 9 types.
- *Store creator only in the config (not OpenFGA)* — provenance would not be
  queryable through the same authorization graph used for audit tooling; keeping
  it as a tuple makes it visible to graph/audit views already built on OpenFGA.

---

## Decision 2 — RAG data_source inheritance (A2) (resolves FR-018..FR-022)

**Decision**: Adopt **A2 parent_kb inheritance**. Add
`define parent_kb: [knowledge_base]` to `data_source` and extend its permissions:

```
define can_read:   reader or can_manage or owner or can_read from parent_kb
define can_ingest: ingestor or can_manage or owner or can_ingest from parent_kb
define can_manage: manager or owner or can_manage from parent_kb
```

A single `data_source:<id> parent_kb knowledge_base:<id>` edge is written at
datasource creation. Team grants are made **once** on the knowledge base and the
data source inherits them. The PR #1703 mirror (`mirrorKnowledgeBaseDiffToDataSource`)
is retired.

**Rationale**:
- Eliminates the "see-but-not-search" gap structurally instead of papering over
  it by duplicating tuples.
- One grant set to keep correct instead of two kept in sync at write time — fewer
  ways for the data_source projection to drift from the KB.
- Matches the single-object spirit of the agent model as closely as the
  two-type split allows, without a disruptive type collapse.

**Alternatives considered**:
- *Keep the mirror (PR #1703)* — no model change, but every KB share writes a
  second tuple set; the drift risk and double-write remain. Rejected per the
  user's choice of A2.
- *Collapse to one type* — drop `data_source`, use `knowledge_base` for both
  discovery and query enforcement. Most disruptive: rewrites the Python
  enforcement path and migrates every existing `data_source` tuple. Rejected as
  out of proportion to the benefit.

**Note**: `parent_kb` is the model's first tuple-to-userset. The model-parity
test must be confirmed to handle the `X from Y` form in both authored (`.fga`)
and JSON chart representations.

---

## Decision 3 — Persistence (dual-write) (resolves FR-005, FR-023, FR-026)

**Decision**: Mirror the agent pattern exactly — **config is the source of
truth, OpenFGA is the derived enforcement projection.** Add an
`OwnedResourceMixin` exposing `creator_subject`, `owner_subject`,
`owner_team_slug`, and `shared_with_teams` to `DataSourceInfo` and
`MCPToolConfig` (both Redis-backed). Routes read the previous set from the
config to compute reconcile diffs.

**Rationale**:
- The user directed "we should follow the same pattern" as agents after
  confirming agents are a Mongo-authoritative dual-write.
- Solves the three concrete defects of OpenFGA-only storage observed in RAG:
  (a) owner vs. shared is indistinguishable from tuples, (b) the revoke
  previous-set has to be scraped from tuples, (c) the UI cannot show owner
  immutability without an FGA round-trip.
- Under A2, the data_source no longer carries its own team grants, so the
  authoritative owner/shared fields live in exactly one place per resource (the
  datasource config, which is 1:1 with the KB id) — cleaner than the mirror.

**Alternatives considered**:
- *OpenFGA-only* — less code, but reproduces exactly the owner/shared ambiguity
  and unreliable diffs this feature is meant to fix. Rejected.

**Storage impact**: Redis (RAG config). No relational/Mongo schema migration for
RAG; field additions are additive and backward-compatible (absent fields default
to null/empty). See `db-migration.md`.

---

## Decision 4 — Shared module boundaries (resolves FR-001..FR-007)

**Decision**: Build five composable pieces, each extracted from the proven agent
implementation rather than invented:

1. **`reconcileShareableResource` core** (TS) — generalizes
   `buildOwnedResourceWithSharedTeamsDiff` to also emit the `creator` tuple and to
   accept `previousOwnerTeamSlug`/`previousSharedTeamSlugs`. Agent and
   knowledge_base builders are refactored to delegate to it; agent-specific
   behavior (`globalUserAccess` / `user:*`, tool `caller` edges) layers on top.
2. **Route-orchestration helper** (TS) — `handleShareableResourceWrite` doing
   validate-membership → capture-creator → read-previous-from-config → reconcile →
   persist.
3. **`OwnedResourceMixin`** (Pydantic) — the four persisted fields (Decision 3).
4. **`<TeamOwnershipFields>`** (React) — owner `TeamPicker` (disabled on edit
   unless transferring) + `TeamMultiPicker` + effective-access preview +
   not-a-member transfer confirmation. Extracted from `DynamicAgentEditor`.
5. **Model template + drift check** — a documented canonical relation/permission
   block for a shareable type, plus a test that asserts each shareable type
   conforms (and that `creator` appears in no `can_*`).

**Rationale**:
- Constitution **Rule of Three**: 9 owner+team+shared types already exist — far
  past the threshold; extraction is justified, not premature.
- Constitution **Composition over Inheritance**: the module is composed pieces
  (a function, a helper, a mixin, a component, a template), not a class
  hierarchy.
- Refactoring agent + KB onto the core (FR-003) is the proof the abstraction is
  faithful; their unchanged test suites are the regression gate (SC-006).

**Alternatives considered**:
- *Leave the four bespoke copies, only add MCP/RAG wiring* — violates the
  feature's central DRY goal and leaves four diverging revoke-diff
  implementations. Rejected.
- *One mega class encapsulating all layers* — couples model/reconciler/route/UI,
  harder to test in isolation; rejected in favor of composition.

---

## Decision 5 — MCP tool invocation enforcement (resolves FR-029)

**Decision**: Enforce `mcp_tool#can_call` at the BFF on the invocation path
(the same layer that already constrains datasource queries), checking the
calling principal against `can_call` before forwarding to `/v1/mcp/invoke`. The
`can_call` permission already exists on the `mcp_tool` type and already permits
an `agent` caller, so agent-initiated invocations are covered.

**Rationale**:
- The BFF is the established Policy Enforcement Point for RAG (it already injects
  datasource filters); adding the tool-level check there is consistent and avoids
  duplicating OpenFGA client wiring into the RAG server.
- Uses an existing permission; no model change for enforcement.

**Alternatives considered**:
- *Enforce in the RAG server* — would require giving the RAG server an OpenFGA
  client and the request principal for tool checks; larger surface, and
  inconsistent with the existing BFF-as-PEP design. Considered as a possible
  follow-up for defense-in-depth but not required for this feature.

---

## Decision 6 — Transfer authorization & UX (resolves FR-013..FR-017)

**Decision**: A transfer is authorized when the caller is a **current
owner-team admin** (satisfies `can_manage` on the resource) **or an org admin**
(via the existing `bypassForOrgAdmin` path). The route, on detecting a changed
`owner_team_slug`, passes both the new owner and `previousOwnerTeamSlug` to the
shared reconciler and persists the new owner to the config. The `creator` tuple
is untouched. The UI surfaces a transfer action and, when the transferor is not
a member of the destination team, requires an explicit confirmation dialog
("you are not a member of this team…") before applying.

**Rationale**:
- Reuses the reconciler's existing `previousOwnerTeamSlug` revoke path (already
  built and tested for agents) — minimal new logic.
- The user explicitly accepted a UI confirmation as sufficient guard against
  self-lockout ("we could easily check for this with a UI prompt").

**Alternatives considered**:
- *Restrict transfer to org admins only* — safer but less useful; the user wants
  owner-team admins to be able to transfer.
- *Block transfer to teams the transferor isn't on* — rejected; the user wants it
  allowed behind a confirmation rather than forbidden.

---

## Clarification resolved — FR-012 (existing personal-owner migration)

**Question**: For existing resources relying on a personal `user:<sub> owner`
tuple, should migration (a) backfill `creator` and remove the functional
`owner`, (b) backfill `creator` and retain `owner`, or (c) only apply the split
to new resources?

**Decision**: **(b) — backfill a `creator` tuple from each existing personal
`owner` tuple, and retain the existing `owner` tuple.**

**Rationale**:
- Non-breaking: no existing access is revoked at migration time, so nothing that
  works today stops working (Worse-is-Better / least-disruptive).
- Establishes provenance immediately for historical resources (every current
  personal owner becomes a recorded creator), satisfying the audit goal.
- The behavioral change (authority via team, not personal owner) applies going
  forward and to transfers; legacy personal-owner grants are tightened
  opportunistically — e.g. a transfer of a legacy resource can drop the stale
  personal `owner` at that point, since a `creator` record now preserves the
  provenance.
- Avoids a risky bulk authority-removal across all 9 types in one migration.

**Alternatives considered**:
- *(a) remove `owner` on backfill* — cleanest end state but a bulk privilege
  revocation; high blast radius if any resource depends on personal-owner access
  that isn't yet covered by a team grant. Rejected for the initial migration;
  may be a later cleanup once team grants are verified complete.
- *(c) new resources only* — leaves historical resources with no provenance and
  no path to the new model; rejected.

---

## Clarification resolved — FR-032 (sequencing vs. PR #1703)

**Question**: Land after #1703 merges (then delete its mirror), or amend #1703 to
introduce `parent_kb` directly so the mirror never ships?

**Decision**: **Recommend amending PR #1703 to swap mirror → `parent_kb`
inheritance**, so the mirror never lands; this feature then builds on that base.
If #1703 has already merged by the time implementation starts, fall back to
landing this feature afterward and **deleting** the mirror as part of FR-020.

**Rationale**:
- Shipping the mirror only to delete it weeks later is churn (two model/reconciler
  changes, two doc updates, two migrations) for no user benefit.
- #1703's other contents (public-datasources `user:*`, the RagTeamAccessPanel
  reorg, local-dev support) are independent of the mirror and can stay.
- This is flagged for the other committer's call, consistent with the original
  intent to "verify the A2 stuff with the other committer."

**Operational note**: This is a process recommendation, not a code dependency —
the implementation phases below are written to work under either sequencing
(the only difference is whether FR-020 *prevents* or *removes* the mirror).

---

## Open items carried into design

None blocking. Both `NEEDS CLARIFICATION` markers are resolved above. The
`parent_kb` tuple-to-userset parity-test behavior (Decision 2 note) is a Phase 1
verification task, not an unresolved design question.
