# Tasks: Canonical Team Membership Store

**Branch**: `prebuild/feat-canonical-team-membership` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Status**: SHIPPED (commits 1–8 merged on `prebuild/feat-canonical-team-membership`). Commit 8 ships conservatively — the ESLint guard and TypeScript `members?` removal are deferred to a follow-up that fires after the [`migrate-canonical-team-membership` runbook](./mongodb-migration.md) has been applied in every environment (per the gating note in the Dependencies section).

Each numbered task is one commit. Tasks are sequential — never reorder. Each commit must be green (`npm test` + `npm run lint` in `ui/`) before moving to the next.

Acceptance command (run after every commit):

```bash
cd ui && npm test --silent -- --no-coverage 2>&1 | tail -5
```

Conventional Commits + DCO sign-off + `Assisted-by: Cursor claude-opus-4-7` trailer on every commit.

---

## Commit 1 — Canonical reader helper (Phase 0)

**Title**: `feat(rbac): add canonical team-membership reader helper`

**Scope**: Add the helper. No callers. No behavior change.

### Files
- **NEW** `ui/src/lib/rbac/team-membership-store.ts`
  - `loadActiveTeamMembers(team_slug): Promise<CanonicalTeamMember[]>`
  - `countActiveTeamMembers(team_slug): Promise<number>`
  - `isUserInTeam(team_slug, user_email): Promise<boolean>`
  - `findUserRoleInTeam(team_slug, user_email): Promise<"admin" | "member" | null>`
  - `loadTeamMemberCounts(team_slugs[]): Promise<Map<slug, number>>` (for the list endpoint in Commit 4)
  - All readers filter `status: "active"` and dedupe by `COALESCE(user_subject, user_email)`. Role escalation is `admin > member`.
- **NEW** `ui/src/lib/rbac/__tests__/team-membership-store.test.ts`
  - Empty team → 0 members.
  - Single membership-source row → 1 member, correct role.
  - Two rows for the same user (different `provider_id`) → 1 member (deduped).
  - One row with `role: "admin"`, one with `role: "member"`, same user → role resolves to `admin`.
  - Row with `status: "removed"` → excluded.
  - Row with `user_subject` set, `user_email` empty → still counted.
  - `loadTeamMemberCounts` over many team slugs → returns one entry per slug (deterministic, bounded query).

### Acceptance
- New helper has ≥95% line coverage in `team-membership-store.test.ts`.
- `npm test` green.
- No other source files modified.

---

## Commit 2 — Migrate auth-gate readers (Phase 1.a)

**Title**: `refactor(rbac): migrate auth gates to canonical membership store`

**Scope**: The two auth-critical readers. After this commit, these gates no longer consult `team.members[]`.

### Files
- `ui/src/lib/rbac/team-admin-guards.ts`
  - L10: replace `(team.members ?? []).some(...)` with `await findUserRoleInTeam(team.slug, email) === "admin"`.
  - Function becomes async if it is not already; update one or two call sites.
- `ui/src/lib/rbac/login-openfga-bootstrap.ts`
  - L63: replace `team.members?.find(...)` with `await findUserRoleInTeam(team.slug, normalizedEmail)`.

### Tests
- Run the existing `__tests__/login-openfga-bootstrap.test.ts` and any test that exercises `team-admin-guards`. Update fixtures to seed `team_membership_sources` rows instead of `team.members[]` where the test asserts membership.
- Add a regression test: a team with a populated `members[]` but no `team_membership_sources` rows must be treated as **empty** by these gates. (Confirms the new code reads only the canonical store.)

### Acceptance
- `npm test` green.
- `git grep "team\.members" ui/src/lib/rbac/team-admin-guards.ts ui/src/lib/rbac/login-openfga-bootstrap.ts` returns zero hits.

---

## Commit 3 — Migrate read-only API consumers (Phase 1.b)

**Title**: `refactor(api): migrate admin team API readers to canonical membership store`

**Scope**: Read paths in admin and dynamic-agents API routes. **Writes are still dual at this point.**

### Files
- `ui/src/app/api/admin/teams/[id]/roles/route.ts` (L245) — read members via `loadActiveTeamMembers`.
- `ui/src/app/api/admin/teams/[id]/resources/route.ts` (L323) — same.
- `ui/src/app/api/admin/teams/[id]/kb-assignments/route.ts` (L49) — `findUserRoleInTeam`.
- `ui/src/app/api/admin/teams/[id]/members/route.ts` (L198, L291, L300) — read paths only; **POST/DELETE bodies stay as-is** (Commit 6 migrates writes).
- `ui/src/app/api/admin/openfga/catalog/route.ts` (L115) — `loadActiveTeamMembers`.
- `ui/src/app/api/admin/openfga/baseline-profile/route.ts` (L235) — `findUserRoleInTeam`.
- `ui/src/app/api/dynamic-agents/teams/route.ts` (L30) — `findUserRoleInTeam`.
- `ui/src/app/api/auth/my-roles/route.ts` (L89) — `findUserRoleInTeam` (or `loadActiveTeamMembers` then filter, depending on response shape).
- `ui/src/app/api/admin/users/route.ts` — replace per-team `t.members ?? []` iteration with `loadActiveTeamMembers(t.slug)` per team (this is grouped admin reporting; profiling will tell us if a single aggregation is needed; default to per-team helper).
- `ui/src/components/admin/UserManagementTab.tsx` (L116) — same pattern; this is a server component / receives its data via props, so the change happens upstream in the route handler that feeds it. Verify which.

### Tests
- Update `__tests__/membership-sources.test.ts`, `__tests__/admin-teams.test.ts`, `__tests__/admin-write-routes.test.ts`, `__tests__/admin-team-resources.test.ts`, etc. — fixtures use `team_membership_sources` rows.
- Add one regression test per route: a team with stale `members[]` but no canonical rows yields an empty result through the API.

### Acceptance
- `npm test` green.
- `git grep "team\.members\|t\.members" ui/src/app/api ui/src/components` returns zero hits in non-write code paths (the only remaining hits should be the writer code in `[id]/members/route.ts`, which Commit 6 handles).

---

## Commit 4 — Member counts on the list endpoint (Phase 1.5)

**Title**: `feat(api): include team.member_count in GET /api/admin/teams`

**Scope**: One API change, one schema bump, one new index.

### Files
- `ui/src/app/api/admin/teams/route.ts`
  - GET handler: after fetching teams, call `loadTeamMemberCounts(slugs[])` and merge `member_count` into each team object in the response.
  - Schema: response type now includes `member_count: number`.
- `ui/src/lib/rbac/team-membership-store.ts`
  - Add the index creation in the same module's bootstrap (or wherever `team_membership_sources` is initialized): `team_membership_sources({team_slug: 1, status: 1})`. **Idempotent** — safe to run on every startup.
- `ui/src/app/api/admin/teams/__tests__/admin-teams.test.ts` (or the closest existing test file)
  - Asserts `member_count` is the count of distinct active members per team.
  - Tests dedupe behavior: two rows for the same user are counted as one.

### Acceptance
- `npm test` green.
- `GET /api/admin/teams` response now contains `member_count` for every team.
- The new index is created on first request after deploy (verified manually in the smoke step).

---

## Commit 5 — Admin UI consumes member_count (Phase 1.c)

**Title**: `refactor(ui): consume team.member_count on Admin Teams page`

**Scope**: All four call sites of `team.members.length` / `team.members.map(m => m.user_id)` in `(app)/admin/page.tsx`.

### Files
- `ui/src/app/(app)/admin/page.tsx`
  - L1596: `count={team.members.length}` → `count={team.member_count ?? 0}`.
  - L824, L838, L1861, L2474: `team.members.map(m => m.user_id)` / `team.members.forEach(...)` → fetch the member list on demand from `GET /api/admin/teams/[id]/members` (which returns canonical-store rows).
  - The "list of all users in any team" iteration (L824/838) should use a new helper hook or a single `GET /api/admin/users?teams=...` call rather than N+1 per-team lookups. Acceptable interim: server-side join in the page-level data loader.
- `ui/src/components/admin/TeamDetailsDialog.tsx`
  - Drop the `team.members[]` fallback (L1xx — confirm with grep when editing).
- `ui/src/app/(app)/admin/__tests__/admin-page.test.tsx`
  - Update fixtures to provide `member_count` instead of `members[]`.

### Tests
- Page renders with correct counts when teams have only `team_membership_sources` rows (no `members[]`).

### Acceptance
- `npm test` green.
- Manual smoke: log into the dev UI, open the Teams page. Auto-provisioned teams now show their real member counts.
- `git grep "team\.members\|t\.members" ui/src/app/\(app\) ui/src/components` returns zero hits.

---

## Commit 6 — Migrate write paths (Phase 2)

**Title**: `refactor(rbac): drop teams.members[] writes from all paths`

**Scope**: Stop writing the legacy field. After this commit, every write goes only to `team_membership_sources` (+ OpenFGA).

### Files
- `ui/src/lib/rbac/identity-group-sync-reconciler.ts`
  - Remove `syncTeamEmbeddedMember` and `unsyncTeamEmbeddedMember` (the temporary denorm fix added today).
  - Remove the embedded-member rollback branches in `rollbackPhase2`.
- `ui/src/app/api/admin/teams/[id]/members/route.ts`
  - POST (manual member add): replace `$push: { members: ... }` with `upsertTeamMembershipSource({source_type: "manual", ...})`.
  - DELETE: replace `$pull: { members: ... }` with `markTeamMembershipSourceRemoved`.
- `ui/src/app/api/admin/users/[id]/teams/route.ts` — same pattern.
- `ui/src/app/api/admin/teams/route.ts` — POST team creation: drop `members: []` initialization. Creator-as-admin is recorded via `upsertTeamMembershipSource` immediately after team insert.
- Update tests in `__tests__/admin-write-routes.test.ts`, `__tests__/team-creation-openfga-sync.test.ts`, `__tests__/manual-team-source.test.ts`, etc.

### Tests
- Existing tests that asserted on `team.members[]` shape must be migrated to assert on `team_membership_sources` rows (or removed if they were testing the legacy dual-write).
- Regression: creating a team and adding a manual member produces exactly one `team_membership_sources` row, no `team.members[]` mutation.

### Acceptance
- `npm test` green.
- `git grep "\\\$push.*members\\|\\\$pull.*members\\|members:\\s*\\[" ui/src` returns zero hits in production code.
- `git grep "team\\.members\\|t\\.members" ui/src` returns zero hits outside of `__tests__/` and the migration script.

---

## Commit 7 — Migration script (Phase 3.a)

**Title**: `chore(scripts): add canonical-team-membership migration script + Make target`

**Scope**: One-shot migration that backfills missing membership_sources from `teams.members[]` and `$unset`s the field. **The script does not run automatically**; this commit only adds it.

### Files
- **NEW** `scripts/migrate-canonical-team-membership.ts`
  - Connects to Mongo using the same env conventions as `seed-config.ts`.
  - Args: `--dry-run` (default) and `--apply`.
  - For each team doc with non-empty `members[]`:
    - For each member entry, check whether an active `team_membership_sources` row already exists for that user (by `user_email` or `user_subject`).
    - If not, the script reports it (dry-run) or upserts a row with `source_type: "manual"`, `created_by: "migration:2026-05-26-canonical-team-membership"`, `provider_id: "manual"` (apply).
  - After all backfills, `$unset: { members: "" }` on every team doc that had the field.
  - Idempotent: re-running is a no-op (the source rows already exist; `$unset` of a non-existent field is a no-op).
  - Exit code 0 on success; non-zero with structured stderr on failure.
- `Makefile`
  - Target: `migrate-canonical-team-membership` runs the script in dry-run by default; `APPLY=1 make migrate-canonical-team-membership` applies.
- **NEW** `docs/docs/specs/2026-05-26-canonical-team-membership/mongodb-migration.md`
  - Operator runbook.
  - "How to dry-run", "how to apply", "how to verify", "how to roll back".

### Tests
- A unit test for the script's pure functions (the diff calculation), if practical.
- Otherwise, manual verification on a copy of dev data is acceptable; documented in `mongodb-migration.md`.

### Acceptance
- `npm test` green (no production code changed).
- `make migrate-canonical-team-membership` runs and produces a sensible dry-run output against the local Mongo. (User-driven manual smoke; not automated in CI for this commit.)

---

## Commit 8 — Schema cleanup + ESLint guard (Phase 3.b)

**Title**: `chore(rbac): remove members[] from team schema and add lint guard`

**Scope**: Remove the `members[]` field from the TS type definitions. Add a lint rule that fails any future PR that re-introduces it.

### Files
- `ui/src/lib/rbac/identity-group-sync-reconciler.ts` (and any other module that defines `IdentitySyncTeam` or `Team`):
  - Remove `members?: TeamMember[]` from the type.
  - Remove the `as any` casts that were workarounds for `$push`/`$pull` on the embedded array.
- `ui/src/lib/rbac/types.ts` (or wherever the canonical Team type lives) — same field removal.
- `ui/src/lib/rbac/__tests__/migrations/registry.test.ts` and `ui/src/lib/rbac/migrations/registry.ts` (L385) — adapt or remove the migration that iterates `team.members ?? []`.
- **NEW** `ui/eslint.config.mjs` (or `.eslintrc.cjs` — match the repo's existing config)
  - Custom rule (no-restricted-properties or grep-based pre-commit hook):
    - Disallow `team.members`, `t.members`, and `teamDoc.members` reads.
    - Disallow `$push: { members: ... }`, `$pull: { members: ... }`, `$addToSet: { members: ... }` writes.
    - Allow only in `scripts/migrate-canonical-team-membership.ts`.

### Tests
- Lint rule fires on a deliberately-bad fixture in a `__tests__/lint-fixtures/` directory and is silent on the production code.
- Full Jest suite green.
- `npm run lint` green.

### Acceptance
- `npm test` and `npm run lint` both green.
- `git grep "members:\\s*TeamMember" ui/src` returns zero hits outside `migrate-canonical-team-membership.ts` and tests.
- Spec docs updated: `spec.md` and `plan.md` get a "Status: SHIPPED" header line.

---

## Dependencies

```text
Commit 1 — no deps
Commit 2 — needs Commit 1
Commit 3 — needs Commit 1
Commit 4 — needs Commit 1, parallel-safe with 2 and 3 but commit AFTER 3 because the same test files are touched
Commit 5 — needs Commit 4
Commit 6 — needs Commit 5 (no reader of legacy field remains)
Commit 7 — needs Commit 6 (so the script's "no readers, only $unset" assumption holds)
Commit 8 — needs Commit 7 to have been APPLIED in dev/prod (gated on the migration actually running)
```

## Verification After Final Commit

1. `cd ui && npm test --silent -- --no-coverage` — all green.
2. `cd ui && npm run lint` — all green, including the new guard.
3. `make migrate-canonical-team-membership` — dry-run output looks correct.
4. `APPLY=1 make migrate-canonical-team-membership` — applies cleanly. Re-run is a no-op.
5. Rebuild `caipe-ui-prod`, log in as a user with OIDC group claims that triggers auto-create-teams. Open the Admin → Teams page. Auto-provisioned teams display correct counts. Open Team Details for one — members are listed correctly.
6. `db.teams.findOne({ members: { $exists: true } })` returns `null`.
7. spec-102 RBAC matrix (`make test-rbac-*`) passes if the local environment supports it; otherwise capture in the PR description as a follow-up smoke.

## Out of Scope (deferred)

- The Phase 4 bake/observability work; it is operational, not implementation.
- Any Slack-bot / RAG-server side membership reads — those services already query `team_membership_sources` via the BFF and inherit the fix.
