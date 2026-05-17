# Database Migration Notes: Dynamic Agent PDP Gate

## Required or No-op

No database migration is required for this feature.

The feature uses existing relationship authorization data:

- Existing OpenFGA store and authorization model.
- Existing `agent` resource type.
- Existing `can_use` relation.
- Existing team-to-agent tuple writers from Team Resources.

## Schema / Index Changes

No schema or index changes are required.

The data model in [data-model.md](./data-model.md) describes authorization entities, but those entities map to existing identity, Dynamic Agent, and OpenFGA relationship records.

## Data Movement

No backfill is required as part of this feature.

Operators must ensure the expected `can_use` tuples already exist for users or teams that should be able to run Dynamic Agents. Existing Team Resources workflows already write `team:<slug>#member can_use agent:<agent_id>` tuples.

## Rollback

Rollback is code/configuration only:

1. Revert the BFF and Dynamic Agents authorization gates.
2. Revert documentation and validation changes.
3. Keep OpenFGA tuples intact; deleting tuples is not required and could remove valid Team Resources policy.

## Environments

- Development: no database migration; verify local OpenFGA is seeded and reachable.
- Staging: no database migration; verify existing Team Resources tuples cover test personas.
- Production: no database migration; deploy as code/configuration change with standard rollback.
