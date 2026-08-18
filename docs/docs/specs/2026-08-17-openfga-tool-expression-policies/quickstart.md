---
sidebar_label: Validation Guide
title: CAIPE Authorization Service - Parallel Migration Validation
description: Review and test sequence for dark deployment, shadowing, canary, rollback, audit, and expressions.
---

# Parallel Migration Validation

This guide defines the required implementation validation sequence. Commands and
configuration names are illustrative until the corresponding tasks land.

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
uv run pytest ai_platform_engineering/authz/tests
cd ui && npm run lint
cd ui && npm run build
cd docs && npm run build
~~~
