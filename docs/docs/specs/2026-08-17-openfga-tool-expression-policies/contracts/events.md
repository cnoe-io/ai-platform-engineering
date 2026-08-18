---
sidebar_label: Event Contracts
title: CAIPE Authorization Service - Audit Event Contracts
description: Normalized decision, migration, policy, and relationship events.
---

# Audit Event Contracts

## Common Envelope

Every event uses the existing Audit Service ingestion path:

~~~http
POST /v1/audit/events
~~~

~~~json
{
  "event_id": "example-event-id",
  "event_type": "authz_decision",
  "occurred_at": "2026-08-17T12:00:00Z",
  "producer": "caipe-authz",
  "schema_version": "1",
  "correlation_id": "example-correlation-id",
  "payload": {}
}
~~~

event_id is the idempotency key. Audit Service must accept a retried event
without creating a second logical record.

## authz_decision

One event exists for a single decision and for each batch item.

Required payload:

~~~text
decision_id
surface
transport
subject_hash
action
resource_ref
outcome
reason_code
authoritative_path
provider
authorization_model_id
rollout_revision
duration_ms
~~~

Optional payload:

~~~text
policy_binding_revision
template_id
context_field_names[]
context_field_types[]
trace_id
~~~

The event never includes raw subject credentials, tokens, request bodies,
argument values, canary seed, or raw policy source.

## authz_migration_comparison

Emitted only when both paths were attempted. At most one exists per decision.

~~~json
{
  "decision_id": "example-decision-id",
  "rollout_revision": "authz-rollout-001",
  "surface": "bff",
  "scope": {
    "resource_type": "tool",
    "action": "invoke"
  },
  "authoritative_path": "LEGACY",
  "legacy": {
    "outcome": "ALLOW",
    "reason_code": "ALLOW_RELATIONSHIP",
    "duration_ms": 3.1
  },
  "authz": {
    "outcome": "DENY",
    "reason_code": "DENY_NO_RELATIONSHIP",
    "duration_ms": 4.0
  },
  "mismatch_class": "ALLOW_DENY"
}
~~~

Stable classes are NONE, ALLOW_DENY, DENY_ALLOW, ERROR_RESULT, REASON_ONLY, and
LATENCY.

## authz_migration_revision

Emitted when a deployment activates a different rollout revision:

~~~text
revision
previous_revision
config_sha256
changed_scopes[]
approved_by
activated_at
deployment_ref
~~~

The event contains no canary seed. It records routing intent only and never
mutates relationships or policies.

## authz_policy_change

Emitted for create, update, disable, revalidate, reconcile, and delete:

~~~text
operation_id
actor_hash
policy_id
resource_ref
subject_ref_hash
operation
before_revision
after_revision
template_id
expression_sha256
input_schema_sha256
status
failure_reason?
~~~

Literals and raw expressions are excluded.

## authz_relationship_change

Emitted for grant, revoke, replacement, verification, compensation, and
migration:

~~~text
operation_id
actor_hash
tuple_key_hash
relation
object_ref
condition_name?
condition_context_sha256?
authorization_model_id
operation
status
failure_reason?
~~~

Condition constants are hashed or redacted according to classification.

## Delivery Semantics

1. Authz appends to a bounded durable local outbox.
2. The publisher sends batches with stable event IDs.
3. Retry uses bounded exponential backoff.
4. Successfully acknowledged records are retired from the outbox.
5. Backlog age, capacity, retry count, and failed delivery are metrics.

A remote Audit Service outage does not synchronously change decisions while the
outbox can journal. In strict production mode, inability to journal an allow
turns it into a deny. An existing deny remains deny. A policy/relationship
mutation is not successful until both state and durable audit intent succeed or
are compensated.

## Historical Compatibility

Legacy cas_decision and cas_grant records remain queryable. Query/UI adapters
map their historical fields into the normalized display model; stored history is
not rewritten destructively. New producers emit only authz_*.
