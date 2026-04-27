# RBAC Audit Log Shipping

Spec 102 Phase 11.3.

## Overview

Every RBAC authorization decision is written to MongoDB
(`authz_decisions` collection). For centralized observability —
SIEM ingestion, dashboards, anomaly alerts — operators usually
want the same stream in their log pipeline.

Setting `AUDIT_STDOUT_ENABLED=true` on any service that calls
`log_authz_decision` (supervisor, dynamic-agents, ui BFF future) makes
each decision additionally write a single line to stdout in the form:

```
AUDIT {"userId":"u-123","userEmail":"alice@example.com","resource":"rag","scope":"query","allowed":true,"reason":"OK","source":"py","service":"supervisor","ts":"2026-04-22T15:34:12.482103+00:00","route":"POST /tasks","pdp":"keycloak"}
```

The `AUDIT ` marker prefix is grep-friendly and lets log aggregators
filter cheaply before parsing.

## Enabling

Add to docker-compose env (or k8s deployment env) for any service that
imports `ai_platform_engineering.utils.auth.audit`:

```yaml
environment:
  - AUDIT_STDOUT_ENABLED=true
```

Mongo writes still happen — the stdout sink is **additive**.

## Fluent Bit example

`fluent-bit.conf` in this directory shows a minimal parser/filter chain
that strips the `AUDIT ` prefix, parses the JSON payload, and tags the
record `audit.rbac` so it can be routed independently of regular app
logs.

## Schema

Each line conforms to the same schema as the MongoDB document — see
`docs/docs/specs/102-comprehensive-rbac-tests-and-completion/contracts/audit-event.schema.json`.
The TS writer (`ui/src/lib/rbac/audit.ts`) and the Python writer
(`ai_platform_engineering/utils/auth/audit.py`) emit identical payloads;
the only difference is the `source` field (`"py"` vs `"ts"`).

## Failure modes

- Mongo down → stdout sink still fires.
- Stdout broken (very rare; container ate the FD) → Mongo write still
  succeeds.
- Both sinks fail → the authorization decision still proceeds
  unaffected (FR-007 — audit must NEVER block authz).
