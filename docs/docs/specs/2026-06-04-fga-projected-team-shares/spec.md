# Feature Specification: FGA-Projected Team Shares (Generic Module)

**Feature Branch**: `prebuild/feat/fga-projected-team-shares` (suggested)  
**Created**: 2026-06-04  
**Status**: Draft — **spec only; no implementation in this PR**  
**Depends on**: Agent-skills OpenFGA-only team shares (landed or in flight on `main`)  
**Related**:
- `docs/docs/specs/2026-06-03-unified-shareable-resource-rbac/` — **Model A** (config = source of truth)
- `docs/docs/specs/2026-06-04-fga-coverage-guarantee/` — registry / default-deny invariants
- Migration `agent_skill_openfga_reconcile_v1` — one-off heal for skills (separate from this module)

## Summary

Extract a **reusable TypeScript module** for resources whose **team-share list lives only in OpenFGA**, while Mongo (or upstream config) may still hold **display metadata** (e.g. `visibility`). The module centralizes:

1. Reading the current shared-team set from FGA (not persistence)
2. Reconciling next vs previous team slugs via existing `reconcileShareableResource`
3. Stripping legacy `shared_with_teams` from persistence writes
4. Hydrating `shared_with_teams` on API responses for editors

**Agent skills** are the reference implementation today (`skill-team-grants.ts`, route strip/hydrate, FGA read on PUT). This spec defines the **generic layer** and a **follow-up PR** that refactors skills onto it and optionally migrates **dynamic agents** (same orphan-tuple risk).

This is **not** a replacement for `shareable-resource.ts` (`handleShareableResourceWrite`), which implements **Model A**.

## Problem

Two persistence models coexist:

| Model | Source of truth for team shares | Route helper | Example |
|-------|----------------------------------|--------------|---------|
| **A — Config-as-truth** | Mongo / RAG config `shared_with_teams` | `handleShareableResourceWrite` | KB, MCP tool, (agents today) |
| **B — FGA-as-truth** | OpenFGA `team:<slug>#member → <relation> → <object>` | *Ad hoc per resource* | Agent skills (2026-06) |

Model B fixes a class of bugs Model A is prone to when config and FGA drift:

- PUT reconcile uses **Mongo `shared_with_teams` as `previousSharedTeamSlugs`** → if Mongo was cleared but FGA still has tuples, **revokes never run** and private/global visibility leaks via stale `team:*#member` grants.
- Gallery / discover checks FGA; editor shows Mongo → operators think sharing was removed when FGA still grants access.

Skills were fixed by reading **previous teams from FGA** and stopping Mongo writes. That logic is duplicated conceptually and should be **one module** parameterized by `objectType` + `memberRelations` (+ optional visibility → org-wide flags).

## Goals

- **G1**: One module (`fga-projected-team-shares` or similar) implements Model B operations without forking per resource.
- **G2**: Skills refactor onto the module with **no behavioral change** (existing tests green).
- **G3**: Document how dynamic agents (and optionally others) adopt Model B in **later PRs**, without mixing Model A and B in the same helper.
- **G4**: Preserve `reconcileShareableResource` as the single tuple-diff core (no second reconciler).

## Non-goals (this feature)

- Changing **Model A** resources (KB, MCP tool) to FGA-only persistence — they remain on `shareable-resource.ts` unless product explicitly requests it.
- Replacing `buildAgentRelationshipTupleDiff` (agent tool-caller edges, `user:*` global access).
- Chat `sharing.shared_with_teams`, skill hubs, or conversation sharing.
- New OpenFGA model types or permission renames.
- Implementing dynamic-agent migration in the **first** PR (skills refactor only; agents phased).

## Architecture

```text
                    ┌─────────────────────────────────────┐
                    │  reconcileShareableResource (core)   │
                    │  openfga-owned-resources.ts            │
                    └─────────────────┬───────────────────┘
                                      │
          Model A                     │                     Model B (this spec)
          ┌───────────────────────────┴───────────────────────────┐
          │                                                       │
  handleShareableResourceWrite                          fga-projected-team-shares
  (persist owner + shared to config)                    (read previous from FGA;
          │                                              strip shared from Mongo;
          │                                              hydrate API responses)
          ▼                                                       ▼
   KB, MCP tool, …                                          skill (refactor),
                                                            agent (future PR)
```

### Per-resource adapter

Each resource supplies a small **descriptor**:

```ts
interface FgaProjectedResourceDescriptor {
  objectType: string;           // e.g. "skill", "agent"
  memberRelations: readonly string[];  // e.g. ["user"], ["reader","user","caller"]
  /** Relations counted when listing shared team slugs from tuples (default: memberRelations) */
  teamShareRelations?: readonly string[];
}
```

Optional **visibility adapter** (skills only in v1):

```ts
interface VisibilityProjectedShares {
  next: "private" | "team" | "global";
  previous?: "private" | "team" | "global";
  /** Maps visibility → nextTeamRefs / org-wide flags for reconcileShareableResource */
}
```

## User Scenarios & Testing

### User Story 1 — Generic module (Priority: P1)

As a platform engineer, I want a single module for FGA-projected team shares so I do not re-implement read/hydrate/strip/reconcile wrappers for each resource type.

**Independent test**: Unit tests drive a fake `objectType: "skill"` descriptor through read → reconcile → hydrate; skill integration tests still pass after refactor.

**Acceptance**:

1. **Given** tuples `team:platform#member user skill:abc`, **When** `readSharedTeamSlugsFromOpenFga({ objectType: "skill", ... }, "abc")`, **Then** `["platform"]` is returned.
2. **Given** reconciliation disabled, **When** read is called, **Then** `[]` without throwing.
3. **Given** a document with `shared_with_teams` in the payload, **When** `stripProjectedFieldFromMongoDoc(doc, "shared_with_teams")`, **Then** the field is omitted and update helpers emit `$unset`.

---

### User Story 2 — Skills refactor (Priority: P1, same PR as module)

As an operator, I want agent-skills sharing behavior unchanged after the refactor so the skills gallery and editor remain correct.

**Acceptance**:

1. Existing suites pass: `skill-team-grants.test.ts`, `agent-skill-openfga-reconcile.test.ts`, `route-rbac.test.ts`, `agent-skill-visibility.test.ts`, import-zip tests.
2. `skill-team-grants.ts` becomes a thin facade (re-exports or delegates to generic module + skill visibility mapping).
3. No new Mongo writes of `shared_with_teams` on `agent_skills`.

---

### User Story 3 — Dynamic agents adoption (Priority: P2, **separate PR**)

As a platform engineer, I want dynamic agents to read **previous** shared teams from FGA on PUT so demoting visibility or un-sharing teams revokes stale tuples even when Mongo `shared_with_teams` is empty or stale.

**Acceptance** (future PR):

1. PUT `/api/dynamic-agents` passes `previousSharedTeamSlugs` from FGA read, not only Mongo.
2. Document whether Mongo `shared_with_teams` remains for UI cache or is dropped (product decision in that PR).
3. Regression test: skill/agent pattern — remove team from share list with empty Mongo field but FGA still has tuple → reconcile deletes tuple.

---

### User Story 4 — Documentation & drift guard (Priority: P2)

As a security reviewer, I can see which resources use Model A vs Model B and run a drift test so new routes do not persist `shared_with_teams` without opting into Model B strip/hydrate.

**Acceptance**:

1. RBAC living docs (`docs/docs/security/rbac/` or equivalent) add a "Persistence models" subsection.
2. Optional test: resources registered in `FGA_PROJECTED_RESOURCE_DESCRIPTORS` must not appear in a denylist of Mongo `shared_with_teams` writers (lint or static list).

## Functional Requirements

### Module (`ui/src/lib/rbac/fga-projected-team-shares.ts`)

- **FR-001**: Export `readSharedTeamSlugsFromOpenFga(descriptor, objectId)` — paginated `readOpenFgaTuples` on `object`, extract slugs from `team:<slug>#member` where `relation` is in `teamShareRelations` (default `memberRelations`).
- **FR-002**: Export `extractTeamSlugsFromTuples(descriptor, objectId, tuples)` — pure function; move logic from `teamSlugsFromSkillTuples` and generalize relation filter.
- **FR-003**: Export `reconcileProjectedTeamShares(input)` — resolve team refs (ObjectId/slug → slug via shared `resolveTeamSlugs` helper, dedupe with existing teams collection query), call `reconcileShareableResource` with `previousSharedTeamSlugs` / `nextSharedTeamSlugs` from resolved refs.
- **FR-004**: Support optional `visibility` block on reconcile input mapping to `nextTeamRefs = []` when not `team`, and `sharedWithOrg` / `previousSharedWithOrg` when `global` (skills parity).
- **FR-005**: Export `stripProjectedFieldFromMongoDoc` and `mongoUnsetProjectedField(fieldName)` for consistent `$unset` on updates.
- **FR-006**: Export `hydrateProjectedTeamShares(doc, descriptor, options)` — when `options.teamVisibilityValue` matches doc visibility (e.g. `"team"`), attach `shared_with_teams` from FGA; otherwise clear field on response.
- **FR-007**: `resolveTeamSlugs` MUST live in one place (move from `skill-team-grants.ts` or shared `team-slug-resolve.ts`) and be reused by bulk grant helpers.

### Skills facade

- **FR-008**: `reconcileSkillTeamShares` / `readSkillSharedTeamSlugsFromOpenFga` / `grantSkillsToTeams` remain as public API but delegate to FR-001–FR-003 (bulk grant may stay write-only).
- **FR-009**: `hydrateAgentSkillTeamShares*` delegate to FR-006.

### Safety

- **FR-010**: When `OPENFGA_RECONCILE_ENABLED` is false, read returns `[]` and reconcile is a no-op (existing behavior).
- **FR-011**: Invalid OpenFGA object ids MUST fail fast in reconcile (same as `buildShareableResourceTupleDiff`).
- **FR-012**: Module MUST NOT call `handleShareableResourceWrite` or persist `shared_with_teams` to config.

### Out of scope for implementation PR

- **FR-013** (future): Dynamic agents PUT FGA-read — User Story 3.
- **FR-014** (future): RAG KB FGA-only — requires upstream RAG API contract change.

## Edge Cases

- **Reconciliation disabled**: hydrate returns undefined/empty shares; reconcile no-op; routes still strip Mongo field on write.
- **Visibility `team` but FGA empty**: hydrate returns `undefined` or `[]`; editor may prompt user to re-select teams (existing UX).
- **Team ref is Mongo ObjectId**: resolved to slug before reconcile; unknown ref kept as literal slug (existing skill behavior).
- **Owner team on agents**: Model B module handles `ownerTeamSlug` + `previousOwnerTeamSlug` when descriptor includes them; agent-specific `user:*` and tool edges stay in `openfga-agent-tools.ts`.
- **Concurrent PUTs**: previous set read from FGA at start of reconcile (last writer wins on FGA, same as config-as-truth today).
- **Migration backfill**: remains per-resource (`agent_skill_openfga_reconcile_v1`); generic module does not replace admin migrations.

## Success Criteria

- **SC-001**: Adding a new Model B resource requires only a descriptor + route wiring (strip/hydrate/reconcile), not copy-paste of tuple pagination.
- **SC-002**: Zero behavioral diff for agent skills (automated tests + manual: private skill not discoverable by non-owner after demote).
- **SC-003**: `shareable-resource.ts` and `fga-projected-team-shares.ts` are both documented; no merged god-module.
- **SC-004**: Dynamic-agent stale-tuple regression test added in the **agents adoption PR** (not blocking skills refactor).

## PR Scope (recommended split)

| PR | Contents |
|----|----------|
| **PR 1** (this spec) | Spec + contracts only |
| **PR 2** | Implement module + refactor skills + tests + docs snippet |
| **PR 3** | Dynamic agents: FGA previous read, optional Mongo field removal, tests |
| **PR 4** (optional) | Admin migration generalization / registry entry in FGA coverage manifest |

## References (current code)

| Concern | Today | After PR 2 |
|---------|--------|------------|
| Tuple diff | `reconcileShareableResource` | unchanged |
| Skill reconcile | `skill-team-grants.ts` | facade → generic |
| Skill FGA read | `readSkillSharedTeamSlugsFromOpenFga` | generic read |
| Skill hydrate | `agent-skill-visibility.ts` | generic hydrate |
| Route strip | `configs/route.ts` local helpers | generic strip |
| Config-as-truth | `shareable-resource.ts` | unchanged |

## Open Questions

1. **Agents PR**: Drop Mongo `shared_with_teams` entirely or keep as read-only cache hydrated from FGA?
2. **Descriptor registry**: Const array `FGA_PROJECTED_DESCRIPTORS` for coverage manifest (tie to `2026-06-04-fga-coverage-guarantee`) — required in PR 2 or PR 4?
3. **Bulk import paths**: `grantSkillsToTeams` write-only — stay on skill facade or move to `writeOnlyTeamGrants(descriptor, ...)` in generic module?

*Resolved before implementation*: Product owner for agents persistence (Q1); default **FGA-only, hydrate on read** to match skills.
