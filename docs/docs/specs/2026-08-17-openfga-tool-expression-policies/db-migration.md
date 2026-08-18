---
sidebar_label: Migration Notes
title: CAIPE Authorization Service - Data and Model Migration
description: Additive persistence, OpenFGA model, audit, and rollback migration rules.
---

# Data and Model Migration

## Summary

The runtime migration does not require a new routing database or a second
OpenFGA store. It uses:

- Deployment-owned rollout configuration.
- The current OpenFGA store with explicit model IDs.
- Additive MongoDB policy/schema metadata.
- The existing Audit Service with additive event schemas.
- A new local Authz audit outbox.

No tuple is copied merely to deploy or shadow caipe-authz.

## Migration Routing

Routing revisions live in version-controlled Helm/deployment values. They are
not editable through the public API or Admin UI in v1.

- The initial revision defaults every scope to LEGACY.
- Invalid or ambiguous configuration fails readiness.
- Activating a revision emits authz_migration_revision.
- Rollback applies a previous reviewed revision.
- Routing rollback never changes OpenFGA or MongoDB policy data.

## OpenFGA Model

Use an additive-first sequence:

1. Pin the OpenFGA image and expression cost limit.
2. Generate and verify the model JSON from deploy/openfga/model.fga.
3. Add versioned condition definitions and conditional_caller.
4. Keep existing unconditional relations valid.
5. Publish the model and record its ID/hash in the active descriptor.
6. Upgrade every checker/writer to pass an explicit compatible model ID.
7. Do not write conditional tuples until Authz is authoritative for the scope.
8. Measure manager-derived invocation before removing can_manage from can_call.

The model update alone creates no grant. Existing unconditional tuples remain
unchanged through shadow migration.

## MongoDB

### Resource schema catalog

Extend the current tool catalog document additively:

~~~text
sanitized_input_schema
input_schema_sha256
policy_eligible_fields
schema_status
schema_last_seen_at
~~~

Old documents without these fields remain readable and are treated as
policy-ineligible until refreshed.

### Expression policies

Add an authz_expression_policies collection with the fields in data-model.md.
Recommended indexes:

- Unique policy_id.
- Unique active tuple intent on resource_type, resource_id, action, subject_ref.
- Lookup on resource_type, resource_id, action, status.
- Reconciliation scan on status, updated_at.
- Schema-drift scan on input_schema_sha256, status.

An ACTIVE state is written only after tuple verification. Updates use optimistic
versioning. A reconciliation failure retains enough previous state for
compensation and operator diagnosis.

## Audit Service

Add authz_decision, authz_migration_comparison, authz_migration_revision,
authz_policy_change, and authz_relationship_change as new schema-versioned event
families.

Do not rewrite historical cas_* records. The query layer maps old and new
records into one display model. Dashboards distinguish historical legacy events
from new authoritative and comparison events.

The local outbox schema includes stable event ID, payload, attempt count,
next-attempt time, and checksum. Outbox changes are forward/backward compatible
across the rollback-retention release set.

## Backfill

- No rollout-config backfill.
- No OpenFGA tuple backfill for dark or shadow operation.
- Schema catalog records may be lazily refreshed from MCP discovery.
- Existing unconditional tool grants are inventoried, not automatically
  converted.
- Conditional tuple creation is an explicit audited policy operation.

## Rollback

| Change | Rollback |
|---|---|
| Authz deployment | Stop routing shadow traffic; retain legacy authority |
| Routing revision | Apply reviewed LEGACY or SHADOW revision |
| OpenFGA additive model | Continue using the previous explicit model ID while no new tuple requires the new model |
| Conditional tuple | Delete to revoke; restore unconditional access only by separate audited grant |
| Mongo policy schema | Keep additive fields/collection; older code ignores them |
| Audit event schema | Keep historical records; deploy a compatible producer/query adapter |

Destructive schema cleanup and removal of old model/template versions occur only
after AUTHZ_ONLY retention expires and no active tuple or supported release
references them.
