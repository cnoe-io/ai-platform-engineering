# MongoDB Migration: `teams.members[]` → `team_membership_sources`

Operator runbook for the one-shot data migration that accompanies the
[canonical-team-membership refactor](./spec.md).

## What it does

For every document in `db.teams`:

1. For each entry in the legacy `members[]` array, ensure a matching
   active row exists in `team_membership_sources`. The natural key is
   `(team_slug, lower(user_email), source_type="manual")`. If the row
   already exists (because the runtime helper
   [`upsertTeamMembershipSource`](../../../../../ui/src/lib/rbac/team-membership-source-store.ts)
   wrote it), the migration leaves it alone — strictly idempotent.
2. `$unset` the legacy `members` field so the array stops appearing
   on freshly-fetched documents.

After a successful apply, the post-condition is:

```js
> db.teams.findOne({ members: { $exists: true } })
null
```

The migration is safe to re-run. The second invocation is a no-op
(every membership_source row is already present; `$unset` against a
missing field is also a no-op).

## When to run it

You only need this in environments that existed before commit 6/8 of
the refactor landed. Fresh installs deployed on commit 6/8 or later
never write the `members[]` array in the first place, so there is
nothing to migrate.

In other words: run it once per long-lived environment as part of
the upgrade. Skip it for brand-new clusters.

## Prerequisites

- `MONGODB_URI` is set and points at the database you intend to
  migrate. The local dev convention is
  `mongodb://localhost:27017/ai_platform_engineering`.
- Optional: `MONGODB_DATABASE` if your database name differs from
  the default `ai_platform_engineering`.
- The CAIPE BFF (`caipe-ui` / `caipe-ui-prod`) is running on commit
  6/8 or later, so no writer is actively repopulating `members[]`
  between the time you dry-run and the time you apply.

## Dry-run (default)

```bash
make migrate-canonical-team-membership
```

The output is a JSON document of shape:

```json
{
  "migration": "canonical_team_membership_v1",
  "apply": false,
  "summary": {
    "teamsScanned": 567,
    "teamsWithLegacyMembers": 4,
    "rowsToBackfill": 0,
    "teamsToUnset": 4,
    "skipped": 0,
    "warnings": 0
  },
  "warnings": [],
  "skipped": []
}
```

Notable fields:

- **`teamsScanned`** — how many team documents the migration looked at.
- **`teamsWithLegacyMembers`** — how many of those still carry a
  non-empty `members[]` array.
- **`rowsToBackfill`** — how many `team_membership_sources` rows the
  apply step would upsert. **Will be `0` in a fully-dual-written
  environment** (the runtime already kept the canonical store in
  sync). A non-zero value here is normal in older environments where
  the canonical store was not yet present when the team was created.
- **`teamsToUnset`** — how many `$unset: { members: "" }` writes the
  apply step would perform. This is the number that will go to `0`
  on the second run (idempotency check).
- **`skipped`** — teams with no `slug` field. The migration can't
  write canonical rows without a slug; fix the slug and re-run.
- **`warnings`** — per-member explanations of every skipped row
  (non-string `user_id`, unrecognized `role`, etc.).

## Apply

When the dry-run looks correct, run it with `APPLY=1`:

```bash
APPLY=1 make migrate-canonical-team-membership
```

The output is the same JSON dry-run summary, followed by:

```json
{
  "migration": "canonical_team_membership_v1",
  "applied": {
    "backfilled": 0,
    "unsetTeams": 4
  }
}
```

If `backfilled` or `unsetTeams` is non-zero, the migration mutated
your database.

## Verify

After apply:

```js
// 1. No team docs carry the legacy field anymore.
> db.teams.countDocuments({ members: { $exists: true } })
0

// 2. The Admin UI Teams page Members badges match team_membership_sources counts.
//    Open Admin → Teams; the Members chip on every team card should equal:
> db.team_membership_sources.aggregate([
    { $match: { status: "active", team_slug: "<SLUG>" } },
    { $group: { _id: { $ifNull: ["$user_subject", { $toLowerCase: "$user_email" }] } } },
    { $count: "members" }
  ])
```

(The aggregation mirrors
[`loadTeamMemberCounts`](../../../../../ui/src/lib/rbac/team-membership-store.ts).)

## Roll back

The migration is one-way by design (the whole point is to demolish
the duplicated store). If a roll back is genuinely needed:

1. Restore the affected `teams` collection from your MongoDB backup
   taken before the apply. The Mongo Atlas / Operator backup
   convention at most installations is point-in-time, so this is a
   single-collection restore.
2. Re-deploy `caipe-ui-prod` from a commit that pre-dates 6/8 so
   live writers start populating `members[]` again.
3. The canonical-store rows written by the migration do **not** need
   to be undone — they are correct and will be kept up to date by
   the dual-write path on the rolled-back BFF.

For routine recovery from a botched apply, the simpler path is to
fix the input data (typically: missing slug, oddly-typed `user_id`)
and re-run the migration — it is idempotent.

## Unit tests

The pure planning function has unit-test coverage:

```bash
make migrate-canonical-team-membership-tests
```

The test exercises role normalization, idempotency against an
existing canonical store, case-insensitive email dedupe, slug
handling, and the no-team-no-op path. The Mongo glue
(`fetchExistingSources` / `applyMigration`) is a 20-line wrapper
around `find()` and `updateOne()` and is verified by the dry-run /
apply workflow above on a real database.
