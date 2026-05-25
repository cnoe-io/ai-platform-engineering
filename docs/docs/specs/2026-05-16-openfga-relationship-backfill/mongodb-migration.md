# MongoDB Migration Notes: OpenFGA Relationship Backfill

## Required or No-Op

Required data migration/backfill. No destructive MongoDB schema migration is required.

The implementation must:

- Read existing `teams`.
- Read `platform_config` for the persisted default-agent setting.
- Upsert `team_membership_sources` for mapped team members.
- Upsert `rebac_relationships` for migrated team/resource/default-agent provenance.
- Write a durable migration-status record for repeat protection and auditability.
- Write corresponding OpenFGA tuples.

## Schema and Index Changes

### Migration Status Collection

Introduce a stable migration record in a MongoDB collection such as `rbac_migrations`.

Recommended document id:

```text
openfga_relationship_backfill_v1
```

Recommended supporting index:

```text
{ _id: 1 } unique
```

If the implementation reuses an existing migration-status collection, document that choice in code comments and RBAC docs.

### Relationship Provenance

Existing `rebac_relationships` indexes already support subject/resource/source queries. If implementation adds a dedicated uniqueness index for deterministic migration upserts, it must not break existing non-migration relationship records.

Recommended uniqueness, if added:

```text
{
  "subject.type": 1,
  "subject.id": 1,
  "subject.relation": 1,
  action: 1,
  "resource.type": 1,
  "resource.id": 1,
  source_type: 1,
  source_id: 1
}
```

### Team Membership Sources

Existing indexes cover team and user lookup. The migration must avoid requiring a destructive index rebuild.

## Data Movement

### Inputs

- Active teams and their members/resources.
- Stable user subjects from existing membership source records or identity data.
- Default agent from `platform_config.default_agent_id`, then `DEFAULT_AGENT_ID`.

### Outputs

- Team membership source records for mapped users.
- ReBAC relationship provenance records.
- OpenFGA tuples for team membership/resource grants.
- OpenFGA typed wildcard tuple for default-agent access when a default dynamic agent exists.
- Migration status record with counts.

### Idempotency Rules

- Use deterministic tuple and provenance keys.
- Treat duplicate OpenFGA tuple writes as success.
- Upsert MongoDB provenance records instead of inserting duplicates.
- Do not delete unrelated manual, bootstrap, identity-sync, or policy-created relationships.
- Skip apply when a completed migration record exists unless `FORCE=true`.

## Rollback

Preferred rollback is a MongoDB backup/restore plus OpenFGA tuple cleanup for migration-created tuples.

Minimum rollback procedure:

1. Stop any repeated migration execution.
2. Inspect the migration record counts and source id.
3. Remove OpenFGA tuples whose tuple keys match the migration output for the recorded source id.
4. Mark migration-created `rebac_relationships` and `team_membership_sources` as revoked or remove them according to operator policy.
5. Mark the migration record as rolled back or failed with the operator and timestamp.

Rollback must not remove relationships whose source is not this migration.

## Environments

- **Development**: Dry-run first; apply against local OpenFGA and MongoDB.
- **Staging**: Dry-run, review counts, then apply and validate graph visualization plus default-agent authorization.
- **Production**: Take a MongoDB backup or snapshot, dry-run, review counts, apply once, verify migration record and sampled authorization checks.
