# Implementation Plan: Canonical Team Membership Store

**Branch**: `prebuild/feat-canonical-team-membership` | **Date**: 2026-05-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-05-26-canonical-team-membership/spec.md`
**Status**: SHIPPED (commits 1–8 of 8). See [`mongodb-migration.md`](./mongodb-migration.md) for the operator runbook and [tasks.md commit 8](./tasks.md#commit-8--schema-cleanup--eslint-guard-phase-3b) for the deferred ESLint guard and type-removal work.

## Summary

Consolidate three Mongo+OpenFGA team-membership stores down to two: `team_membership_sources` (canonical Mongo) and OpenFGA (canonical authz). The legacy `teams.members[]` embedded array is removed.

The work is structured to keep authorization gates correct at every commit: we add the new canonical reader first, migrate readers under explicit test coverage, then migrate writers, then run the migration, then drop the field from the schema.

## Technical Context

**Language/Version**: TypeScript 5.x (Node 20+) for the UI service; one-shot Mongo migration script in TypeScript.
**Primary Dependencies**: Next.js 16 App Router, MongoDB driver, OpenFGA HTTP API, NextAuth, existing `team_membership_sources` collection helpers (`team-membership-source-store.ts`).
**Storage**: MongoDB. New compound index on `team_membership_sources({team_slug: 1, status: 1})`. No new collections. The `teams.members[]` field is removed in Phase 3.
**Testing**: Jest (unit + integration), spec-102 RBAC matrix (e2e), manual smoke through Admin UI.
**Target Platform**: Same as today — `caipe-ui` Next.js service running in Docker.
**Project Type**: Web service (Next.js BFF + React Admin UI).
**Performance Goals**: `GET /api/admin/teams` p95 ≤ 500ms with 10k teams + 100k active membership-source rows.
**Constraints**: Zero authorization regressions. Zero observable Admin UI behavioral changes (other than fixing the wrong member counts on auto-sync teams).
**Scale/Scope**: 14 production source files, ~20 test files, 1 Mongo migration. Single-branch implementation.

## Constitution Check

*Gate: must pass before implementation. Re-check after each phase.*

| Principle | Check |
|-----------|-------|
| **I. Worse is Better** | ✅ The canonical store and helpers already exist. We're removing a layer, not adding one. The implementation is "wire reads to the existing store and stop writing the legacy field" — concrete, simple, no new abstractions. |
| **II. YAGNI** | ✅ No speculative features. Every change is justified by a current bug or duplicated write path. |
| **III. Rule of Three** | ✅ This is the refactor at the third occurrence. The constitution explicitly endorses this. |
| **IV. Composition over Inheritance** | ✅ The reader helper is a pure function on `team_slug`, not a class. Existing helpers (`upsertTeamMembershipSource`, `markTeamMembershipSourceRemoved`) compose into the write path. |
| **V. Specs as Source of Truth** | ✅ This plan and the spec drive the work. |
| **VI. CI Gates Are Non-Negotiable** | ✅ Each commit must pass `npm run lint`, `npm test`, and (where touched) the spec-102 RBAC suite. Captured as task-level acceptance. |
| **VII. Security by Default** | ✅ Auth gates are migrated under explicit test coverage; defense-in-depth (OpenFGA + canonical Mongo store) is preserved. No secrets introduced. |

No constitution violations. No `NEEDS CLARIFICATION` markers.

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-05-26-canonical-team-membership/
├── spec.md              # Why and what (signed off)
├── plan.md              # This file — how
├── tasks.md             # Ordered, executable tasks (next)
├── data-model.md        # team_membership_sources schema reference
├── mongodb-migration.md # The one-shot migration script's contract
└── quickstart.md        # Operator runbook
```

### Source Code (repository root)

```text
ui/
├── src/
│   ├── lib/
│   │   ├── rbac/
│   │   │   ├── team-membership-store.ts            # NEW — canonical reader helper (loadActiveTeamMembers, countActiveTeamMembers)
│   │   │   ├── team-membership-source-store.ts     # EXISTING — write helpers stay here
│   │   │   ├── identity-group-sync-reconciler.ts   # MODIFY — drop teams.members[] writes (added in earlier commit; remove)
│   │   │   ├── team-admin-guards.ts                # MODIFY — read from canonical store
│   │   │   ├── login-openfga-bootstrap.ts          # MODIFY — read from canonical store
│   │   │   └── __tests__/team-membership-store.test.ts  # NEW
│   │   └── ...
│   ├── app/
│   │   ├── (app)/admin/page.tsx                    # MODIFY — consume team.member_count
│   │   ├── api/admin/
│   │   │   ├── teams/route.ts                      # MODIFY — drop members:[] init; project member_count on GET
│   │   │   ├── teams/[id]/members/route.ts         # MODIFY — drop teams.members[] writes; route writes only to source store
│   │   │   ├── teams/[id]/roles/route.ts           # MODIFY — read from canonical store
│   │   │   ├── teams/[id]/resources/route.ts       # MODIFY — read from canonical store
│   │   │   ├── teams/[id]/kb-assignments/route.ts  # MODIFY — read from canonical store
│   │   │   ├── users/[id]/teams/route.ts           # MODIFY — drop teams.members[] writes
│   │   │   └── openfga/{catalog,baseline-profile}/route.ts  # MODIFY — read from canonical store
│   │   └── api/dynamic-agents/teams/route.ts       # MODIFY — read from canonical store
│   └── components/admin/
│       ├── TeamDetailsDialog.tsx                   # MODIFY (light) — already mostly reads membership_sources; just drop fallback
│       └── ...
└── ...

scripts/
└── migrate-canonical-team-membership.ts            # NEW — one-shot migration with --dry-run / --apply
```

### Migration

```text
docs/docs/specs/2026-05-26-canonical-team-membership/
└── mongodb-migration.md  # Contract: backfill team_membership_sources from teams.members[], then $unset members
```

The Makefile gets a `migrate-canonical-team-membership` target that runs the script in `--dry-run` mode by default and only mutates with `APPLY=1 make migrate-canonical-team-membership`.

## Phased Approach

The implementation is staged across **four phases on the same branch**, each independently revertable:

### Phase 0 — Reader helper (no behavior change)

Add `lib/rbac/team-membership-store.ts` exposing two pure functions:

```typescript
// All overloads filter on status: "active" by default; pass {includeRemoved: true} for audit views.
export async function loadActiveTeamMembers(teamSlug: string): Promise<CanonicalTeamMember[]>;
export async function countActiveTeamMembers(teamSlug: string): Promise<number>;
export async function isUserInTeam(teamSlug: string, userEmail: string): Promise<boolean>;
export async function findUserRoleInTeam(teamSlug: string, userEmail: string): Promise<"admin" | "member" | null>;
```

The reader **deduplicates by `COALESCE(user_subject, user_email)`** and resolves `role` by collapsing all active source rows for the user (admin > member if both exist).

Tests cover: empty team, single member, dedupe across providers, role escalation, removed rows excluded, missing-email row included via `user_subject` only.

No callers yet. Just the helper + tests. **Commit 1 lands here. Application behavior is unchanged.**

### Phase 1 — Migrate readers (auth-critical first)

Auth gates first — they touch every request:
- `team-admin-guards.ts` — replace `team.members.find(...)` with `findUserRoleInTeam`.
- `login-openfga-bootstrap.ts` — replace `team.members?.find(...)` with `findUserRoleInTeam`.

Then the API routes that perform admin gates or list operations:
- `dynamic-agents/teams/route.ts`, `admin/teams/[id]/roles/route.ts`, `admin/teams/[id]/resources/route.ts`, `admin/teams/[id]/kb-assignments/route.ts`, `admin/teams/[id]/members/route.ts` (the *read* sides only — writes still dual at this point), `admin/openfga/catalog/route.ts`, `admin/openfga/baseline-profile/route.ts`.

Then the Admin UI:
- `(app)/admin/page.tsx` — replace `team.members.length` with `team.member_count` (new field on the Teams list response, see Phase 1.5).
- `(app)/admin/page.tsx` — replace `team.members.map(m => m.user_id)` with a member-list endpoint call (`GET /api/admin/teams/[id]/members`).
- `TeamDetailsDialog.tsx` — already reads `membership_sources`; drop the `team.members[]` fallback.

**Phase 1.5: list endpoint enrichment.** `GET /api/admin/teams` is updated to include `member_count` per team via a single aggregation:

```typescript
db.team_membership_sources.aggregate([
  { $match: { status: "active" } },
  { $group: { _id: "$team_slug", member_count: { $addToSet: { $ifNull: ["$user_subject", "$user_email"] } } } },
  { $project: { _id: 1, member_count: { $size: "$member_count" } } }
]);
```

Result is joined into the team list in application code (Mongo doesn't need a `$lookup` since both queries are cheap).

Each migrated file gets:
1. The migrated read code.
2. An updated unit test that fails if the migrated code falls back to `team.members[]`.
3. A spec-102 e2e regression run if the file is in the auth path.

**Commits 2-5 cover Phase 1, one per file area** (auth gates, admin API routes, dynamic-agents route, admin UI page).

### Phase 2 — Migrate writers (drop teams.members[] dual-write)

Now safe because no reader needs `teams.members[]` anymore.

- `identity-group-sync-reconciler.ts` — remove `syncTeamEmbeddedMember` / `unsyncTeamEmbeddedMember` (added today). Reconciler writes only to `team_membership_sources` + OpenFGA.
- `admin/teams/[id]/members/route.ts` — POST writes a `source_type: "manual"` row instead of `$push: { members: ... }`. DELETE flips `status` to `removed` instead of `$pull`.
- `admin/users/[id]/teams/route.ts` — same pattern (`$addToSet` becomes upsert; `$pull` becomes status flip).
- `admin/teams/route.ts` — team creation no longer initializes `members: []`. The team starts empty by absence; adding the creator-as-admin happens via the membership source store.

**Commit 6 covers Phase 2.**

### Phase 3 — Migration script + schema cleanup

Run the one-shot migration script (`scripts/migrate-canonical-team-membership.ts`) on the dev environment first, then production:

1. **Dry-run mode (default):** print the diff — for each team with non-empty `members[]`, list which entries already have a source row and which would be backfilled. Print "would unset members[] from N team docs."
2. **Apply mode (`APPLY=1`):** execute the diff. For each `members[]` entry without a matching active source row, insert one with `source_type: "manual"`, `created_by: "migration:2026-05-26-canonical-team-membership"`. Then `$unset` the `members` field on every team doc.

After successful migration, **commit 7** removes any remaining defensive code that handled the embedded-array case (e.g. ESLint rule prevents future `teams.members[]` reads/writes).

### Phase 4 — Bake + observability

One week of monitoring on a representative deployment. No code changes unless we find a regression.

## Test Strategy

| Layer | Tool | What's covered |
|-------|------|----------------|
| Unit | Jest | New `team-membership-store.ts` helpers; behavior changes in each migrated file |
| Integration | Jest (`*.test.ts` files in `app/api/.../__tests__/`) | API route migrations; member-count aggregation correctness |
| E2E (RBAC matrix) | spec 102's `make test-rbac-*` | Auth-gate consistency across the migration |
| Manual smoke | Admin UI walkthrough | Teams list, Team Details dialog, manual member add/remove, post-migration counts |

Test fixtures in 8+ test files currently have `members: []` baked in. Each must be migrated to use `team_membership_sources` rows when the test asserts on member-presence behavior, or simply omitted when the test doesn't care about membership. This is grunt work, but mechanical — list the fixtures with grep, replace pattern.

## Performance Notes

- The `member_count` aggregation is `$match → $group → $project`. With the new compound index `(team_slug: 1, status: 1)`, the `$match` is index-only. The `$group` is in-memory but bounded by the number of distinct team slugs. For 100k active rows across 10k teams, this is well under 100ms in our local benchmarks.
- The Admin Teams list endpoint already does ~5 other reads per response; adding one aggregation does not meaningfully change p95.
- Per-request memo cache (a `Map<team_slug, member_count>` populated at the start of the list request) is sufficient. No longer-lived cache.

## Risks & Mitigations

(See spec.md "Risks & Mitigations" — same set; nothing new at planning time.)

## Open Questions Resolved

The four open questions in the spec were defaulted at user sign-off:

1. **Members `$unset`** for the migration. Reversible; doesn't rewrite team docs unnecessarily.
2. **Distinct by `COALESCE(user_subject, user_email)`** for `member_count`. Matches existing UI semantics; tolerates external-email rows.
3. **Per-request memo cache only.** Counts must be fresh.
4. **Export format bumps version.** Any consumer of the team-export shape gets a clear signal that members are now resolved separately.

## Acceptance Gates

| Phase | Gate |
|-------|------|
| Phase 0 | New helper has 100% line coverage in unit tests; no other code changes. |
| Phase 1 | After all readers migrated, full Jest suite passes; spec-102 RBAC matrix passes; Admin UI Teams page shows correct counts in dev. |
| Phase 2 | Writers migrated; dual-write code removed; `git grep '\$push.*members\|teams\.members\[\]'` returns zero hits in production code. |
| Phase 3 | Migration runs dry-run cleanly on a copy of prod data; apply mode runs idempotently; post-migration `db.teams.findOne({members: {$exists: true}})` returns null. |
| Phase 4 | One week of monitoring; no auth-related incident reports tied to the migration. |

## Branch & Commit Discipline

Single branch: `prebuild/feat-canonical-team-membership`.

Commit boundaries (in order, each independently revertable):

1. `feat(rbac): add canonical team-membership reader helper` — Phase 0.
2. `refactor(rbac): migrate auth gates to canonical membership store` — `team-admin-guards`, `login-openfga-bootstrap`.
3. `refactor(api): migrate admin team API readers to canonical store` — admin/teams/[id]/* read paths.
4. `feat(api): expose team member_count on GET /api/admin/teams` + Phase 1 list-endpoint changes.
5. `refactor(ui): consume team.member_count on Admin Teams page` — final reader migration.
6. `refactor(rbac): drop teams.members[] writes from all paths` — Phase 2.
7. `chore(scripts): add canonical-team-membership migration script + Make target` — Phase 3 (does not run the migration).
8. `chore(rbac): remove dual-write defensive code, add ESLint rule` — Phase 3 cleanup.

Each commit conforms to Conventional Commits + DCO + `Assisted-by: Cursor claude-opus-4-7`.

## Tasks

See [tasks.md](./tasks.md) (next).
