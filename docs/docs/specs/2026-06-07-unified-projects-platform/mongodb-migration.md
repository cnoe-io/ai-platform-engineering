# MongoDB Migration: Project Labels

**Required?** No hard migration — `labels` is additive/optional. Reads tolerate absence (empty). New code writes `labels` on create/update.

## Schema change
- Add optional `labels: { domain?, initiatives?: string[], swimlanes?: string[] }` to `projects` documents. No change to existing fields.

## Indexes (added in `ui/src/lib/mongodb.ts` `createIndexes`)
```
projects: { "labels.domain": 1 }
projects: { "labels.initiatives": 1 }
projects: { "labels.swimlanes": 1 }
```
All non-unique → created idempotently via the existing `safeCreateIndex` helper. No dedup risk.

## Optional backfill (one-time, safe)
Set `labels.domain` from the existing top-level `domain` for legacy docs:
```js
db.projects.updateMany(
  { "labels.domain": { $exists: false }, domain: { $exists: true } },
  [ { $set: { "labels.domain": "$domain" } } ]
)
```
Idempotent; can be run anytime (or skipped — the API can read top-level `domain` as a fallback for `labels.domain`).

## Rollback
- Drop the three indexes; ignore/strip the `labels` field. No data loss to existing fields.
