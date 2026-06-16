# MongoDB Migration: Service Accounts

**Required or no-op**: **No operator action required.** Additive only. The new `service_accounts`
collection and its indexes are created automatically on first connection via the existing
`createIndexes()` path in `ui/src/lib/mongodb.ts` (same mechanism as every other collection in the
repo). No DDL, no `renameCollection`, no Alembic/Flyway-style migration.

## Schema / index changes

New collection: **`service_accounts`**. Document shape and rationale in
[data-model.md](./data-model.md).

Indexes to add to `createIndexes()` (mirroring how `catalog_api_keys` and others are registered):

```ts
safeCreateIndex(db, 'service_accounts', { sa_sub: 1 }, { unique: true });
safeCreateIndex(db, 'service_accounts', { client_id: 1 }, { unique: true });
safeCreateIndex(db, 'service_accounts', { owning_team_id: 1, status: 1 });
safeCreateIndex(db, 'service_accounts', { owning_team_id: 1, name: 1, status: 1 });
safeCreateIndex(db, 'service_accounts', { created_by: 1 });
```

Query patterns justifying each:
- `{ sa_sub }` unique — auth/detail lookup by OpenFGA subject; one SA per Keycloak SA user.
- `{ client_id }` unique — Keycloak client uniqueness + admin lookups.
- `{ owning_team_id, status }` — the list endpoint (active SAs for the caller's teams).
- `{ owning_team_id, name, status }` — name-uniqueness check among active SAs (FR-002a).
- `{ created_by }` — audit / "created by me".

## Data movement

**None.** No backfill, no dedupe, no batch jobs. Existing deployments start with an empty
collection; SAs appear only as users create them.

## Rollback

- Drop the `service_accounts` collection (`db.service_accounts.drop()`).
- OpenFGA tuples (`service_account:*`) and Keycloak SA clients are **independent** of the Mongo
  collection. If rolling the feature back fully, also: revoke each SA (deletes its Keycloak client +
  OpenFGA tuples) before dropping the collection, OR clean up orphaned Keycloak clients
  (`clientId` prefix `caipe-sa-`) and tuples manually. Dropping Mongo alone leaves those orphaned but
  harmless (no UI path to them).

## Environments

No environment-specific differences. Dev (docker-compose) and prod (Helm) both create indexes on
first connect. The Keycloak admin credential (`KEYCLOAK_ADMIN_CLIENT_ID/SECRET`, already present for
existing admin reconciliation) must be configured — verified that `caipe-platform` holds
`manage-clients`.

## OpenFGA model deploy (related, not a Mongo migration)

The `service_account` ownership relation (R-1) requires recompiling `deploy/openfga/model.fga` into
`charts/ai-platform-engineering/charts/openfga/authorization-model.json` and re-seeding via
`deploy/openfga/init/seed.py`. This is additive (new relation on an existing type); existing tuples
and checks are unaffected. Tracked in WS-A, not here.
