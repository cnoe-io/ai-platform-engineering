# Feature Specification: Canonical Team Membership Store

**Feature Branch**: `prebuild/feat-canonical-team-membership`
**Created**: 2026-05-26
**Status**: SHIPPED (commits 1–8 of 8 merged; commit 8 conservative — see [tasks.md](./tasks.md#commit-8--schema-cleanup--eslint-guard-phase-3b) for the deferred schema-lockdown follow-up that fires once the migration is confirmed applied in every environment)
**Input**: User description: "Why do we need to maintain two membership stores in CAIPE — `team_membership_sources` (audit/source-of-truth) and `teams.members[]`? As the owner of this repo, what is the most optimal solution to avoid code duplication?"

## Summary

CAIPE currently maintains team membership in three independent stores that must agree at all times:

1. **`teams.members[]`** — embedded array on each team document (`{ user_id, role, added_at, added_by }`).
   Originally the only membership store. Read by the Admin UI's member-count badge, by auth gates (`team-admin-guards.ts`, `login-openfga-bootstrap.ts`), and by half a dozen API routes.
2. **`team_membership_sources`** — sibling collection with full provenance per row (`provider_id`, `external_group_id`, `sync_rule_id`, `source_type`, `status`, timestamps, etc.).
   Added with the identity-group-sync feature; needed to record *why* a user is in a team. Currently the canonical source-of-truth for OIDC-claim memberships.
3. **OpenFGA tuples** — `team:<slug>#{member,admin}@user:<sub>`.
   The actual authorization layer. Every permission check goes here.

The three stores are kept in sync by ad-hoc per-call-site code. There is no single function responsible for cross-store consistency. Drift bugs are inevitable: a recent example surfaced when 560 teams created via OIDC group sync showed "0 MEMBERS" in the Admin UI even though `team_membership_sources` and OpenFGA were fully populated, because the reconciler never updated the embedded array.

This feature consolidates the Mongo side onto a single canonical store: **`team_membership_sources`** becomes the only Mongo collection that records team membership, and `teams.members[]` is removed. OpenFGA remains the authorization layer; nothing about the authz path changes.

## Motivation

**Why now:**
- The drift bug just hit production: the Admin → Teams page rendered 561 teams with "0 MEMBERS" badges even though every team had real membership in the audit collection and in OpenFGA. The badge is reading the embedded array, which the OIDC-claim reconciler doesn't write to.
- We are about to add more identity providers (Slack via `slack_user_id` attributes, Keycloak group sync, future SAML connectors). Every new provider would have to remember to triple-write or repeat the same drift bug.
- This crosses the project constitution's **Rule of Three** threshold: we have three independent membership stores (`teams.members[]`, `team_membership_sources`, OpenFGA tuples) all carrying overlapping data with separate write paths. The constitution says "tolerate duplication until the third occurrence, then refactor." We're at the third occurrence and the duplication is now causing user-visible bugs.

**What this is not:**
- It is not a change to the authorization model. OpenFGA tuples remain the only source of truth for "can user X do operation Y on team Z."
- It is not a change to the OIDC group sync feature. The reconciler already writes the canonical store correctly; this feature removes the *other* store.
- It is not a Keycloak / OpenFGA migration. Both layers stay as-is.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin sees accurate team member counts after auto-sync (Priority: P1)

As a CAIPE admin viewing the Admin → Teams page after a user has logged in via OIDC and triggered identity-group-sync, I see the same member count on every team card whether the user was added via OIDC sync, manual admin action, or any other provenance. The number reflects exactly the number of active membership rows for that team.

**Why this priority**: This is the primary symptom that prompted the feature. The Admin UI has been lying about membership state for any team populated via the reconciler.

**Independent Test**: Log in as a user with multiple OIDC group claims that match auto-create rules. Open Admin → Teams. Each auto-created team's member-count badge shows "1" (the logged-in user), not "0".

**Acceptance Scenarios**:

1. **Given** a clean CAIPE database, **When** a user with N matching OIDC group claims logs in (causing N teams to be auto-created), **Then** the Admin → Teams page shows N teams each with member count "1" without any backfill or manual repair step.
2. **Given** an admin manually adds a user to a team via the Admin UI, **When** the page refreshes, **Then** that team's member count increases by 1.
3. **Given** an admin removes a user from a team, **When** the page refreshes, **Then** that team's member count decreases by 1.
4. **Given** a user is removed from an upstream OIDC group and re-logs in, **When** the reconciler runs, **Then** the affected team's member count decreases accordingly.

---

### User Story 2 - Authorization gates resolve from the canonical store (Priority: P1)

As any authenticated user accessing a team-scoped resource (a KB, an agent, a chat sharing target), the auth gate that decides whether I am a member or admin of the team consults a single, consistent membership store. There is no scenario where my OpenFGA tuples say "yes" but a Mongo-side check says "no" because of stale embedded-array state.

**Why this priority**: Several auth gates currently read `teams.members[]` (`team-admin-guards.ts`, `login-openfga-bootstrap.ts`, multiple `api/admin/teams/[id]/*` routes). If these reads disagree with OpenFGA, users see inconsistent authorization decisions across screens.

**Independent Test**: Add a user to a team via the OIDC reconciler (writes only to `team_membership_sources` + OpenFGA). Without modifying `teams.members[]`, exercise every auth gate and admin endpoint that performs a membership check; all return "yes."

**Acceptance Scenarios**:

1. **Given** a user is in `team_membership_sources` for team T with `relationship: "admin"` and `status: "active"`, **When** they call any admin endpoint guarded by `requireTeamAdmin(T)`, **Then** they pass the gate without `teams.members[]` containing their entry.
2. **Given** a user has an OpenFGA `team:T#member@user:<sub>` tuple, **When** the login bootstrap runs, **Then** the bootstrap path resolves the user's role correctly without reading `teams.members[]`.
3. **Given** a user has been removed via `markTeamMembershipSourceRemoved`, **When** they call any team-scoped endpoint, **Then** all gates deny consistently within the standard auth-cache TTL.

---

### User Story 3 - Manual member add/remove writes one Mongo collection (Priority: P1)

As an admin using the Admin → Team Details → Members panel to add or remove a user, the change is recorded in the canonical store with `source_type: "manual"`, the OpenFGA tuple is written/deleted, and no other Mongo collection is touched. Re-running the same add is idempotent.

**Why this priority**: The manual member route currently writes to both `teams.members[]` and `team_membership_sources` with subtly different semantics (the embedded array uses `user_id: email`, the source row uses `user_subject: <keycloak-sub>` plus `user_email`). Consolidating to one write path eliminates a class of drift between the two.

**Independent Test**: Use the Admin UI to add a user to a team. Inspect Mongo: only `team_membership_sources` has a new active row; `teams.members[]` is absent or empty. Re-run the add — the row's `last_applied_at` updates but no duplicate is inserted. OpenFGA tuple is present and the user can use the team's resources.

**Acceptance Scenarios**:

1. **Given** team T has 0 active membership-source rows, **When** the admin adds user U with role "member", **Then** `team_membership_sources` has one new active row `{team_slug: T, user_email: U.email, user_subject: U.sub, source_type: "manual", relationship: "member", status: "active"}` and OpenFGA has the corresponding `team:T#member@user:<U.sub>` tuple. The team document has no `members[]` array.
2. **Given** that row already exists, **When** the same add is repeated, **Then** the row's `last_applied_at` updates but no duplicate row is inserted and OpenFGA write is a no-op (tuple already exists).
3. **Given** user U is removed via the Admin UI, **When** the change is committed, **Then** the row's `status` flips to "removed", the OpenFGA tuple is deleted, and the user can no longer access the team's resources.

---

### User Story 4 - Operators run a one-shot migration to retire the legacy array (Priority: P1)

As a CAIPE operator upgrading to this version, I run a documented migration script that:
1. Verifies every entry in any team's `teams.members[]` already has a corresponding active row in `team_membership_sources` (creating `source_type: "manual"` rows for any that don't).
2. Removes the `members` field from every team document.
3. Reports the counts of (a) rows backfilled, (b) entries already covered, (c) team documents updated.

The migration is idempotent — re-running it on a converted database is a no-op.

**Why this priority**: Existing CAIPE deployments have `teams.members[]` populated from years of admin actions. Without migration, those memberships would be silently dropped on upgrade, locking users out.

**Independent Test**: Run the migration on a database with mixed-source memberships (some only in `members[]`, some only in `team_membership_sources`, some in both). After the script: `team_membership_sources` is the union of both stores, no team document has a `members` field, and `db.teams.findOne({members: {$exists: true}})` returns null.

**Acceptance Scenarios**:

1. **Given** team T has `members: [{user_id: "alice@x.com", role: "admin"}]` but no matching active source row, **When** the migration runs, **Then** a new source row is created with `source_type: "manual"`, `user_email: "alice@x.com"`, `relationship: "admin"`, `created_by: "migration:2026-05-26-canonical-team-membership"`, and the team document's `members` field is removed.
2. **Given** team T has both `members: [{user_id: "bob@x.com"}]` and a matching active source row, **When** the migration runs, **Then** no new source row is created and the team document's `members` field is removed.
3. **Given** the migration has already run, **When** it runs again, **Then** it reports `team documents updated: 0` and exits cleanly.

---

### Edge Cases

- **Team with `members: []` but no source rows**: nothing to migrate; the field is simply removed.
- **Source row pointing to a team that no longer exists**: leave the source row marked `removed`; do not resurrect a deleted team.
- **Source row with a `user_email` that no Keycloak user matches**: keep the row (it might be a manually-added external email); count queries still include it.
- **Two source rows for the same (team, user) pair from different providers**: count once per `(team, user_email)`, not twice. The denormalized count is "distinct users in the team," matching the Admin UI semantics today.
- **OpenFGA contains a tuple for which no source row exists**: the tuple is the source of truth for *authorization*; the source row is the source of truth for *Mongo-side queries* (e.g. "list members of team T"). They can disagree transiently if the reconciler crashed mid-write; the existing drift-detection job should catch this.
- **Concurrent admin edit + OIDC sync**: both write to the same collection; the natural-key index on `(team_slug, user_subject, source_type, provider_id, external_group_id, sync_rule_id)` plus `upsert` semantics in `upsertTeamMembershipSource` make this safe.
- **Soft-delete vs hard-delete**: removed rows stay in the collection with `status: "removed"` for audit. The "list active members" reader filters on `status: "active"`.

## Requirements *(mandatory)*

### Functional Requirements

**FR-1 — Single canonical Mongo store**: All team membership reads MUST resolve from `team_membership_sources`. The `teams.members[]` field MUST NOT be read by any code path after this feature ships.

**FR-2 — Single canonical Mongo write**: All team membership writes (add, remove, update) MUST write to `team_membership_sources` only. The `teams.members[]` field MUST NOT be written by any code path after this feature ships.

**FR-3 — Member-count badge accuracy**: The Admin → Teams list endpoint (`GET /api/admin/teams`) MUST include a `member_count` field per team computed from `team_membership_sources` (filter `status: "active"`, distinct on `user_subject` || `user_email`). The Admin UI MUST consume this field.

**FR-4 — Auth gate consistency**: `requireTeamAdmin`, `requireTeamMember`, and the login-bootstrap path MUST consult `team_membership_sources` (or OpenFGA, where appropriate) and not the embedded array. Behavior MUST be observably identical to the current behavior for any team whose two stores currently agree.

**FR-5 — Manual add/remove API**: `POST /api/admin/teams/[id]/members` MUST upsert a `source_type: "manual"` row. `DELETE /api/admin/teams/[id]/members` MUST flip the row's `status` to `"removed"`. Both MUST update OpenFGA in lockstep using the existing helpers (`writeTeamMembershipTuples`).

**FR-6 — One-shot migration**: A migration script MUST be provided that backfills `team_membership_sources` from any `teams.members[]` entries lacking a source row, then unsets the `members` field on every team document. The script MUST be idempotent and reversible (a separate "rollback" script restores `members[]` from active source rows for emergencies).

**FR-7 — Performance**: The `member_count` aggregation on `GET /api/admin/teams` MUST complete in under 500ms for a database with up to 10,000 teams and 100,000 active membership-source rows. This requires a compound index on `team_membership_sources({team_slug: 1, status: 1})`.

**FR-8 — Backwards compatibility window**: For one minor release, the migration script's rollback path MUST work; after that, the rollback is unsupported. This gives operators a recovery window if the migration causes unexpected issues in their environment.

**FR-9 — Tests**: Every consumer site that currently reads or writes `teams.members[]` MUST have its test fixture migrated. No test in the suite may rely on the embedded array being populated after this feature ships.

### Non-Functional Requirements

**NFR-1**: No regression in observable Admin UI behavior. The Teams page, Team Details dialog, and member add/remove flows must look and behave identically before and after, with the sole exception that member counts on auto-sync'd teams now show the correct number instead of 0.

**NFR-2**: No change to the OpenFGA model, no change to Keycloak realm configuration, no change to any external API contract.

**NFR-3**: Auth-critical code paths (login bootstrap, admin gates) must be migrated under explicit test coverage so changes are visible at PR review time.

## Out of Scope

- Replacing OpenFGA as the authorization engine. OpenFGA stays.
- Changing the schema of `team_membership_sources`. New fields may be added but no existing field is renamed or removed.
- Removing the `team_membership_sources` collection or merging it into `teams`. Two collections (teams + their memberships) is the right relational shape; this feature consolidates the membership side onto exactly one collection.
- Building a UI for managing membership-source rows directly. The existing Admin → Team Details → Members panel stays as the only UI; it just reads from a different place.
- Migrating Slack channel membership, Webex space membership, or any other non-team membership store. These have their own collections and are unaffected.
- Performance optimizations beyond the `member_count` aggregation index. The `GET /api/admin/teams` endpoint may add other improvements opportunistically, but they are not requirements of this spec.

## Open Questions

1. **Soft-delete vs hard-delete for the migration's `members[]` removal**: Should we `$unset` the field (leaves the team doc otherwise unchanged) or rewrite the doc without it (creates a small storage win)? Default: `$unset`, simpler and reversible.
2. **Distinct-by what when computing `member_count`**: `user_subject` is the strongest natural key but isn't always populated for synthetic / external rows. Fallback to `user_email`. Should the count be by the union or by `user_subject` only? Default: `COALESCE(user_subject, user_email)` — matches existing UI semantics.
3. **Cache strategy for `member_count`**: Cache server-side (per-request memo, since the Admin Teams endpoint is the only consumer) or read-fresh every call? Default: per-request memo, no longer-lived cache; counts must be fresh.
4. **`teams.members[]` in stale serialized snapshots**: Any code path that takes a `Team` JSON snapshot (e.g. for export) currently includes `members[]`. Should the export format change too, or do we maintain a back-compat projection? Default: change the export format and bump its version.

## Dependencies

- Spec [098-enterprise-rbac-slack-ui](../098-enterprise-rbac-slack-ui/spec.md) — established the `team_membership_sources` collection and the OIDC claim reconciler.
- Spec [102-comprehensive-rbac-tests-and-completion](../102-comprehensive-rbac-tests-and-completion/spec.md) — the test suite that exercises auth gates end-to-end. The migration's auth-gate changes must be covered by spec 102's matrix.
- No new external dependencies. No Keycloak / OpenFGA / docker-compose changes.

## Rollout

1. **Phase 1 — Code change**: ship the migrated reads, writes, and the new `member_count` field on the list endpoint. The embedded array stays in the schema; nothing reads it.
2. **Phase 2 — Migration**: the one-shot script runs in operator-driven mode (a Make target) before the next deploy. It is safe to run with the application live because the reads are already migrated; only the writes are still dual.
3. **Phase 3 — Strip writes**: a follow-up commit removes the dual-write code paths now that the migration has run. Schema-level `members` field is fully gone.
4. **Phase 4 — Observability**: a one-week monitoring window confirms no auth-gate or admin-UI regressions.

The phasing means the application is correct after Phase 1; Phase 2-3 are purely cleanup.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Auth gate regression after migrating a reader | Medium | High | Migrate auth-critical readers first, with explicit test coverage on the spec-102 matrix. Run the full RBAC e2e suite before any commit that changes a gate. |
| Migration script corrupts a team doc on a corner-case schema | Low | High | Write the script with a dry-run mode (default) that prints the diff, and require an `--apply` flag for the destructive run. Snapshot the affected teams before update. |
| Performance regression from per-team count aggregation | Low | Medium | Add the compound index up front; benchmark the list endpoint with 10k teams before merging. |
| Slack-bot or other downstream service reads the old `members` array via a Mongo pipe | Low | Medium | Audit the slack-bot and rag-server services for direct `teams` collection reads before Phase 3. None observed in the current grep, but worth a final pass. |
| Test churn introduces a flake | Medium | Low | Migrate test fixtures in dedicated commits (one per file area), running the suite after each. |

## Acceptance — Definition of Done

- [ ] All readers and writers of `teams.members[]` migrated; ESLint rule prevents future use of the field.
- [ ] `GET /api/admin/teams` returns `member_count` per team; UI renders it.
- [ ] Admin UI Teams page shows correct counts after a fresh `make caipe-ui-prod` from a clean Mongo with OIDC sync run.
- [ ] All unit + integration tests pass; spec-102 RBAC matrix runs green.
- [ ] Migration script documented in `docs/docs/security/rbac/migrations.md` (new sub-page) and runnable via `make migrate-canonical-team-membership`.
- [ ] One-week prod-parity bake on a representative deployment with no auth-related incident reports tied to the migration.
- [ ] Spec 098 and spec 102 reference docs updated to reflect the consolidated store.
