---
sidebar_label: Validation Guide
title: CAIPE Authorization Service - Parallel Migration Validation
description: Review and test sequence for dark deployment, shadowing, canary, rollback, audit, and expressions.
---

# Parallel Migration Validation

This guide defines the implemented validation and rollout sequence. The default
configuration is non-authoritative and keeps both legacy paths available.

## Deploy Dark

Docker Compose starts `caipe-authz` with the `rbac` profile. The Helm parent
chart keeps `caipeAuthz.enabled: false` until an operator enables it.

~~~json
{
  "revision": "authz-dark-1",
  "default_mode": "LEGACY",
  "canary_seed": "replace-with-a-secret-seed",
  "scopes": []
}
~~~

Required production secrets:

- `AUTHZ_SERVICE_TOKEN` for BFF, bridge, and Envoy gRPC calls.
- `AUTHZ_ADMIN_TOKEN` for policy and inspection APIs.
- `CAIPE_AGENT_CONTEXT_HMAC_SECRET` when dynamic-agent identity is enforced.

Keep `AUTHZ_INSPECTION_ENABLED=false` until the Authz inspection projection is
approved as the UI tuple-graph source.

## 1. Freeze a Neutral Fixture Matrix

Create allow, deny, invalid, timeout, and unavailable fixtures for:

- A BFF-hosted resource check.
- A Dynamic Agents call through the existing BFF endpoint.
- AgentGateway gateway, agent-use, server, and exact-tool checks.
- User, service account, team userset, channel, and agent subjects.

Use only neutral names such as primary, secondary, example-user, and
example.test.

Expected result: the current implementation owns every result and each fixture
records its canonical request, result, reason, and active model descriptor.

## 2. Start Authz in LEGACY

Deploy caipe-authz with a rollout revision whose default and every explicit scope
are LEGACY.

Verify:

- HTTP and gRPC readiness are independently visible.
- No production decision request is sent to Authz.
- Stopping Authz changes no protected request outcome.
- The OpenFGA store/model descriptor matches the current paths.
- Invalid rollout configuration fails readiness without transferring authority.

## 3. Shadow One BFF Scope

Change one neutral test scope from LEGACY to SHADOW.

Verify:

- The existing BFF engine remains authoritative.
- Authz receives the same normalized subject/action/resource.
- A mismatch produces one authz_migration_comparison.
- A shadow timeout does not change the authoritative outcome.
- Exactly one authz_decision describes the authoritative result.
- Caller-supplied routing/provider fields are rejected or ignored safely and
  cannot affect selection.

## 4. Shadow One Gateway Scope

Keep AgentGateway pointed at the current bridge. Configure the bridge to forward
a bounded copy of CheckRequest to Authz.

Exercise:

- Valid and invalid JWT.
- Valid, invalid, and absent signed agent context.
- List and tool-call requests.
- Missing, malformed, duplicate-key, truncated, and oversized JSON.
- Exact and wildcard tool mappings.

Expected result: AgentGateway receives the legacy bridge response while
comparison telemetry shows normalized parity.

## 5. Promote and Roll Back a Canary

Promote only the neutral test scope to CANARY.

Verify:

- Cohort membership is identical across replicas and restarts.
- Authz is authoritative only inside the selected cohort.
- Legacy evaluation cannot override Authz deny/error/timeout.
- Other surfaces and resources remain in their previous modes.
- An explicit CANARY-to-SHADOW revision restores legacy authority.
- Rollback does not create, delete, or modify a tuple.

Example exact-tool canary:

~~~json
{
  "revision": "tool-canary-1",
  "default_mode": "LEGACY",
  "canary_seed": "replace-with-a-secret-seed",
  "scopes": [
    {
      "surface": "agentgateway",
      "resource_type": "tool",
      "action": "invoke",
      "exact_resources": ["issue_tracker/create_item"],
      "mode": "CANARY",
      "canary_percent": 5,
      "expression_mode": "off",
      "owner": "authorization-operations"
    }
  ]
}
~~~

## 6. Add Conditions Without Grants

Publish the backward-compatible OpenFGA model containing named conditions and
conditional_caller, but write no conditional tuple.

Verify:

- Golden unconditional decisions are unchanged.
- Both paths use the same explicit model descriptor.
- The model DSL and generated JSON match.
- Unknown or incompatible template versions fail closed.

## 7. Shadow Expression Context

In a non-production fixture scope, define a typed string allowlist policy for an
exact mutation tool.

Verify matching, non-matching, missing, wrong-type, stale-schema, malformed,
truncated, deep, and oversized arguments. Confirm that values do not appear in
logs, metrics, events, or visualization.

Expression shadowing must not invoke MCP or change the protected outcome.

## 8. Verify Audit and Visualization

Confirm:

- Audit Service shows one decision plus at most one comparison per request.
- A remote Audit Service outage queues and later drains idempotently.
- Strict outbox failure turns an allow into deny.
- The graph shows model, relationships, effective access, expressions, and
  history as distinct layers.
- Conditional edges show only sanitized metadata.
- Unauthorized, oversized, and truncated inspection cases are audited.

## 9. Enforce One Exact Tool

Proceed only after the caller and agent checks for the exact scope are
Authz-authoritative and promotion gates pass.

1. Inventory broader direct, wildcard, manager-derived, and transitive grants.
2. Remove only the grants that conflict with the intended exclusive policy.
3. Write and verify the conditional tuple.
4. Enable expression enforcement for the exact resource/action.
5. Confirm a matching call reaches MCP and a non-matching call does not.

The enforcing revision must use an exact scope:

~~~json
{
  "surface": "agentgateway",
  "resource_type": "tool",
  "action": "invoke",
  "exact_resources": ["issue_tracker/create_item"],
  "mode": "AUTHZ",
  "expression_mode": "enforce",
  "owner": "authorization-operations"
}
~~~

Also pin `OPENFGA_AUTHORIZATION_MODEL_ID` and configure the exact resource in
`CAIPE_TOOL_SCHEMA_HASHES_JSON`. Startup and Helm rendering fail when these
prerequisites are incomplete. Policy creation before this revision stores a
`DRAFT` and does not write OpenFGA.

## 10. Test Both Rollbacks

Routing rollback:

- Apply SHADOW or LEGACY.
- Verify legacy authority.
- Verify the conditional tuple is unchanged.

Policy rollback:

- Delete the conditional tuple.
- Verify the expression-derived grant is revoked.
- Do not restore an unconditional grant automatically.

The two rollback procedures must remain independent.

## Required Quality Commands

~~~bash
uv run ruff check ai_platform_engineering/authz
RUN_OPENFGA_E2E=1 uv run --project ai_platform_engineering/authz pytest \
  --cov=ai_platform_engineering.authz --cov-fail-under=80 \
  ai_platform_engineering/authz/tests
uv run --project deploy/openfga/bridge pytest deploy/openfga/bridge/tests
cd ui && npm run lint
cd ui && npm run build
cd docs && npm run build
helm lint charts/ai-platform-engineering/charts/caipe-authz \
  --set auth.allowInsecureHeaders=true
~~~
