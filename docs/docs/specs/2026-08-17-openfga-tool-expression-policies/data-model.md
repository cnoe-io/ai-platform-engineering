---
sidebar_label: Data Model
title: CAIPE Authorization Service - Data Model
description: Canonical decisions, migration routing, expression policies, and audit records.
---

# Data Model

## Ownership Summary

| Data | Authority | Persistence |
|---|---|---|
| Relationships and conditional tuples | OpenFGA | OpenFGA datastore |
| Active authorization model | Deployment plus OpenFGA | Versioned model files and OpenFGA model ID |
| Migration routing revision | Deployment configuration | Git/Helm values, not a runtime database |
| Expression authoring and reconciliation | Authz control plane | MongoDB |
| Sanitized tool schemas | Resource schema catalog | MongoDB |
| Current graph projection | Authz inspection API | Derived, bounded, not persisted |
| Authorization history | Audit Service | Existing local/S3 audit storage |
| Undelivered audit events | Authz Service | Bounded durable local outbox |

## Canonical Decision Request

~~~text
CanonicalDecisionRequest
├── decision_id: UUID
├── correlation_id: string
├── surface: bff | dynamic_agents | rag | bot | service | agentgateway
├── transport: http | batch_http | ext_authz
├── subject
│   ├── type: user | service_account | team | channel | agent
│   └── id: canonical string
├── action: canonical string
├── resource
│   ├── type: canonical string
│   └── id: canonical string
└── context
    ├── identity: trusted verified attributes
    ├── request: bounded request attributes
    ├── resource: trusted catalog attributes
    └── advisory: untrusted attributes that may only narrow
~~~

Transport adapters create this object. Public callers cannot set the provider,
migration mode, authoritative path, cohort, model descriptor, or server time.

## Canonical Decision Result

~~~text
CanonicalDecisionResult
├── decision_id
├── outcome: ALLOW | DENY
├── reason_code
├── provider: openfga-cel
├── authorization_model_id
├── policy_binding_revision?
├── context_schema_revision?
├── duration_ms
└── diagnostics: bounded, value-free metadata
~~~

INDETERMINATE is an internal provider result. The decision core maps it to a
fail-closed DENY with a stable reason before returning to a caller.

## Migration Routing Revision

The rollout configuration is immutable for a revision and deployment-owned.

~~~text
MigrationRoutingRevision
├── revision: unique string
├── default_mode: LEGACY
├── canary_seed_ref: secret/config reference
├── shadow_timeout_ms
├── approved_by
├── approved_at
└── scopes[]
    ├── surface
    ├── resource_type
    ├── action
    ├── exact_resources[]
    ├── subject_types[]
    ├── mode: LEGACY | SHADOW | CANARY | AUTHZ | AUTHZ_ONLY
    ├── canary_percent: 0..100
    └── comparison_thresholds
~~~

Selection uses the most-specific matching scope. Invalid or ambiguous
configuration fails readiness. An exact resource allowlist is evaluated before
a percentage cohort.

### State machine

~~~mermaid
stateDiagram-v2
    [*] --> LEGACY
    LEGACY --> SHADOW
    SHADOW --> CANARY
    CANARY --> AUTHZ
    AUTHZ --> AUTHZ_ONLY

    SHADOW --> LEGACY: explicit rollback revision
    CANARY --> SHADOW: explicit rollback revision
    CANARY --> LEGACY: emergency routing revision
    AUTHZ --> SHADOW: explicit rollback revision
    AUTHZ --> LEGACY: emergency routing revision
~~~

AUTHZ_ONLY is entered only after the legacy rollback-retention window. A
rollback from AUTHZ_ONLY uses a previous compatible Authz release; it does not
re-enable deleted legacy code implicitly.

## Canary Cohort

Canary membership is derived, not stored:

~~~text
bucket = keyed_hash(
  canary_seed,
  rollout_revision,
  surface,
  normalized_subject,
  resource_type,
  resource_id,
  action
) mod 10000
~~~

The cohort is selected when bucket is less than canary_percent multiplied by
100. The same inputs must return the same result across languages, replicas,
restarts, and config reloads. The seed value never appears in an event.

## Migration Comparison

~~~text
MigrationComparison
├── comparison_id
├── decision_id
├── rollout_revision
├── surface
├── scope
├── authoritative_path: LEGACY | AUTHZ
├── legacy_outcome
├── legacy_reason
├── legacy_duration_ms
├── authz_outcome
├── authz_reason
├── authz_duration_ms
└── mismatch_class
    ├── NONE
    ├── ALLOW_DENY
    ├── DENY_ALLOW
    ├── ERROR_RESULT
    ├── REASON_ONLY
    └── LATENCY
~~~

At most one comparison exists for a decision. Missing shadow output is
ERROR_RESULT; it never replaces the authoritative result.

## Active Model Descriptor

~~~text
ActiveModelDescriptor
├── openfga_store_id
├── authorization_model_id
├── model_sha256
├── resource_registry_revision
├── template_registry_revision
└── compatible_authz_versions[]
~~~

Both legacy and Authz paths must report the same descriptor before promotion.

## Expression Policy

~~~text
ExpressionPolicy
├── policy_id
├── resource_type
├── resource_id
├── action
├── subject_ref
├── mode: ADDITIVE | EXCLUSIVE
├── expression
│   ├── version
│   ├── template
│   ├── field(s)
│   └── typed literal(s)
├── canonical_sha256
├── input_schema_sha256
├── template_registry_revision
├── optimistic_version
├── status
│   ├── DRAFT
│   ├── RECONCILING
│   ├── ACTIVE
│   ├── STALE_SCHEMA
│   ├── SHADOWED
│   ├── DISABLED
│   └── RECONCILE_FAILED
└── openfga_tuple_key
~~~

An ACTIVE policy requires a verified OpenFGA tuple. MongoDB intent alone is
never an effective grant.

## Resource Schema

~~~text
ResourceSchema
├── resource_type
├── resource_id
├── sanitized_input_schema
├── input_schema_sha256
├── eligible_fields[]
│   ├── json_pointer
│   ├── scalar_type
│   ├── allowed_templates[]
│   └── sensitivity
├── source
├── last_seen_at
└── status: ACTIVE | STALE | INVALID
~~~

Schemas and examples must use neutral identifiers and must not retain secrets,
credentials, or provider-specific private values.

## Relationship Mutation

Conditional tuple identity remains the OpenFGA triple:

~~~text
(user, relation, object)
~~~

A condition change is a replacement:

1. Read and preserve the current tuple.
2. Delete it.
3. Write the replacement with condition name and constants.
4. Verify through an explicit model ID.
5. Restore the previous tuple if write or verification fails.

A brief deny is preferable to a temporary unconditional allow.
