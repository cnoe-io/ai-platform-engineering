# Implementation Plan: FGA-Projected Team Shares

**Spec**: [spec.md](./spec.md)  
**Contract**: [contracts/module-api.md](./contracts/module-api.md)  
**Status**: Draft — **do not implement until PR 2 is opened**

## Phase 0 — Prerequisite (separate track)

Ensure agent-skills FGA-only team shares are on `main`:

- Mongo strip + `$unset` on `agent_skills`
- PUT `previousTeamRefs` from FGA
- Hydrate on GET
- Migration `agent_skill_openfga_reconcile_v1` documented in admin UI

*This spec does not block on that merge but PR 2 should rebase on it.*

## Phase 1 — Generic module (PR 2)

1. Add `ui/src/lib/rbac/fga-projected-team-shares.ts` per contract P1–P5.
2. Move `resolveTeamSlugs` to `ui/src/lib/rbac/team-slug-resolve.ts` (or keep internal to module if YAGNI).
3. Move `extractTeamSlugsFromTuples` from `agent-skill-openfga-reconcile.ts`; re-export `teamSlugsFromSkillTuples` as deprecated alias or thin wrapper for migration planner.
4. Refactor `skill-team-grants.ts` to facade (FR-008).
5. Refactor `agent-skill-visibility.ts` hydrate (FR-009).
6. Replace local strip helpers in `configs/route.ts` with P4 helpers.
7. Unit tests: `fga-projected-team-shares.test.ts` + run existing skill suites.
8. Docs: short subsection under RBAC docs linking Model A vs B.

**Exit**: All tests in spec SC-002; no new Mongo `shared_with_teams` on skills.

## Phase 2 — Dynamic agents (PR 3)

1. Add `AGENT_DESCRIPTOR` to module.
2. PUT `/api/dynamic-agents`: `previousSharedTeamSlugs` from `readSharedTeamSlugsFromOpenFga` before `reconcileAgentRelationships` (or merge visibility/global into agent builder — **do not** duplicate global `user:*` in generic module).
3. Decision Q1: remove Mongo persistence of `shared_with_teams` + hydrate on GET, or dual-write during transition.
4. Regression test: stale FGA tuple revoked when Mongo list empty.
5. Optional admin migration `dynamic_agent_openfga_team_shares_v1` if production has drift.

**Exit**: SC-004; agent route-rbac tests updated.

## Phase 3 — Registry & coverage (PR 4, optional)

1. `export const FGA_PROJECTED_RESOURCE_DESCRIPTORS = [SKILL_DESCRIPTOR, ...]`.
2. Tie to `fga-enforcement-manifest` / projected-field lint (FR-004 in coverage spec).
3. Document in `2026-06-04-fga-coverage-guarantee` manifest.

## Verification commands (PR 2)

```bash
cd ui
npm test -- --testPathPatterns="fga-projected-team-shares|skill-team-grants|agent-skill-openfga|route-rbac|agent-skill-visibility|import-zip/route"
npm run lint
```

## Rollback

- Facade preserves old import paths; revert PR 2 by restoring `skill-team-grants` implementation without removing skills FGA-only behavior from routes.

## Estimated size

| PR | ~LOC | Risk |
|----|------|------|
| PR 2 | 400–600 | Low (refactor + tests) |
| PR 3 | 300–500 | Medium (agent global + tools edges) |
| PR 4 | 100–200 | Low |
