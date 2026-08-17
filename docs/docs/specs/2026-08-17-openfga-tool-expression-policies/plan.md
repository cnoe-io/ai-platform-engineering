---
sidebar_label: Implementation Plan
title: OpenFGA Tool Expression Policies - Implementation Plan
description: Phased implementation plan for typed, argument-aware MCP authorization in CAIPE.
---

# Implementation Plan: OpenFGA Tool Expression Policies

- **Branch:** `prebuild/docs/openfga-tool-expression-policies`
- **Date:** 2026-08-17
- **Spec:** [spec.md](./spec.md)
- **Architecture:** [architecture.md](./architecture.md)
- **Research:** [research.md](./research.md)

## Summary

Add argument-aware authorization to exact AgentGateway MCP tools by combining:

- Reviewed native OpenFGA condition templates.
- Conditional `tool#conditional_caller` tuples.
- Typed request context projected by the OpenFGA bridge.
- MCP schema-backed policy authoring in the Admin UI.
- Shadow-first, selected-tool rollout with fail-closed drift handling.

The first release supports bounded scalar templates and excludes arbitrary CEL,
wildcard conditions, and bulk mutation payloads.

## Technical Context

| Area | Technology |
|---|---|
| Authorization model | OpenFGA schema 1.1, CEL conditions, PostgreSQL datastore |
| Enforcement | AgentGateway ext_authz and Python OpenFGA bridge |
| Control plane | Next.js App Router, TypeScript, MongoDB, existing OpenFGA HTTP client |
| Schema source | MCP `tools/list`, existing `mcp_tool_catalog` |
| UI | React Admin Security and Policy surfaces |
| Audit | Existing audit service and OpenFGA ReBAC events |
| Tests | Jest, pytest, OpenFGA integration/model parity, Docusaurus build |

Constraints:

- No raw expression evaluation.
- No fail-open path.
- No real or deployment-specific identifiers in fixtures or examples.
- OpenFGA remains authoritative for effective access.
- Authored DSL and deployed chart JSON remain in parity.
- Existing unrelated grants are unchanged until explicit migration.

## Constitution and Repository Gate Check

| Principle | Assessment |
|---|---|
| Reading is as hard as writing | PASS - separate spec, research, architecture, and phased plan; diagrams for request flow. |
| Prefer diagrams and bullets | PASS - architecture carries control/data-plane diagrams; requirements are tabular or enumerated. |
| Security by default | PASS - typed templates, schema pinning, mandatory caller check, HMAC, and fail-closed errors. |
| OpenFGA source of truth | PASS - metadata is intent/status; effective grant must exist in OpenFGA. |
| Model parity | PASS planned - DSL and chart JSON updated and drift-tested together. |
| Test data neutrality | PASS - examples use `primary`, `example-user`, and reserved-style generic services. |
| CI gates | PASS planned - targeted Python/UI tests plus model and docs builds. |

## Project Structure

### Documentation in this change

```text
docs/docs/specs/2026-08-17-openfga-tool-expression-policies/
├── architecture.md
├── plan.md
├── research.md
└── spec.md
```

### Expected implementation touchpoints

```text
deploy/openfga/
├── model.fga
└── bridge/
    ├── main.py
    └── tests/test_grpc_bridge.py

charts/ai-platform-engineering/charts/
├── openfga/authorization-model.json
└── openfga-authz-bridge/
    ├── templates/deployment.yaml
    └── values.yaml

ui/src/lib/rbac/
├── openfga.ts
├── mcp-tool-catalog.ts
└── tool-expression-policy.ts              # new

ui/src/app/api/admin/tool-expression-policies/
├── route.ts                               # list, put, delete
├── schema/route.ts
└── evaluate/route.ts

ui/src/components/admin/security/
└── ToolExpressionPolicyEditor.tsx          # new

docs/docs/security/rbac/
├── architecture.md
└── workflows.md
```

## Data Changes

### MongoDB

Extend `mcp_tool_catalog`:

- `input_schema`
- `input_schema_hash`
- `policy_eligible_fields`
- `schema_status`

Add `tool_expression_policies`:

- Unique `binding_key` for subject plus exact tool.
- Canonical expression and hash.
- Schema hash and condition projection.
- Revision and reconciliation state.
- Actor and timestamps.

Indexes:

```text
unique(binding_key)
index(tool_ref, status)
index(schema_hash, status)
```

Mongo migration is additive. Existing catalog rows without a sanitized schema
remain usable for tool selection but cannot author an expression until the tool
is probed again.

### OpenFGA

- Add immutable named conditions.
- Add `tool#conditional_caller` type restrictions for supported subjects.
- Change target `tool#can_call` to `caller or conditional_caller`.
- Preserve all existing condition versions referenced by stored tuples.
- Store one conditional tuple per subject and exact tool policy.

No conditional tuple backfill occurs automatically.

## Phase 0 - Tests and Model Contracts

### Tasks

1. Pin or assert the minimum OpenFGA version that supports required condition
   types and conflict behavior.
2. Add condition templates to `deploy/openfga/model.fga`.
3. Generate/update chart authorization JSON.
4. Add `conditional_caller` to the runtime `tool` type.
5. Add an active model descriptor contract:
   - `store_id`
   - `authorization_model_id`
   - model SHA-256
   - template-registry version
6. Add model tests before changing runtime code.

### Required tests

- Authored DSL/chart JSON parity.
- Every condition name and parameter type matches the TypeScript registry.
- Default-deny for a subject with no tuple.
- Conditional direct-user allow/deny.
- Conditional team-userset allow/deny.
- Persisted constants override duplicate request keys.
- Schema-hash match and mismatch.
- CEL evaluation cost stays within the configured limit.

### Exit criteria

- Model is accepted by the pinned OpenFGA server.
- Existing unconditional model tests remain green.
- No tuple is migrated and no production decision changes.

## Phase 1 - OpenFGA Client Condition Support

### Tasks

1. Extend `OpenFgaTupleKey` with an optional relationship condition for writes
   and reads while keeping delete keys condition-free.
2. Add typed Check context to single and BatchCheck helpers.
3. Require an explicit authorization-model ID for condition writes and checks.
4. Add exact conditional tuple read-back verification.
5. Add a dedicated conditional tuple replacement helper:
   - Read and preserve previous tuple.
   - Delete old tuple.
   - Write replacement.
   - Verify.
   - Compensate on failure.
6. Ensure existing generic tuple diff code does not silently compare only the
   triple when condition context matters.

### Required tests

- Conditional tuple serialization and read parsing.
- Check and BatchCheck context serialization.
- Duplicate tuple conflict.
- Successful replacement.
- Replacement failure with successful compensation.
- Replacement and compensation failure state.
- Explicit model-ID mismatch.

### Exit criteria

- BFF can round-trip a conditional tuple without losing context.
- Existing unconditional tuple APIs remain backward compatible.

## Phase 2 - MCP Schema Catalog and Compiler

### Tasks

1. Sanitize and canonicalize MCP input schemas during tool probe.
2. Store bounded schema plus hash in `mcp_tool_catalog`.
3. Derive policy-eligible JSON Pointer fields.
4. Implement a TypeScript template registry mirroring OpenFGA conditions.
5. Implement canonical expression parsing and hashing.
6. Reject unsupported schemas, operators, secret fields, invalid pointers,
   excess fields, excess values, and unsafe sizes.
7. Implement schema-drift detection and affected-policy status updates.
8. Add an authenticated internal projection endpoint for the bridge.

### Required tests

- Stable canonical schema hashes across key-order differences.
- JSON Pointer escaping and normalization.
- Supported scalar field extraction.
- Secret/free-text/binary/union exclusion.
- CEL-like literal treated as data.
- Schema drift marks policies stale.
- Size, depth, field-count, and allowlist-count limits.

### Exit criteria

- Every authorable field maps to exactly one supported typed context shape.
- No secret fixture value appears in logs or serialized policy metadata.

## Phase 3 - Bridge Context Projection in Shadow Mode

### Tasks

1. Require AgentGateway to send a complete bounded `tools/call` body to
   ext_authz.
2. Parse JSON with duplicate-key detection and bounded nesting.
3. Project approved scalar values into typed maps keyed by JSON Pointer.
4. Add trusted server time and current schema hash.
5. Always send empty typed maps when no eligible argument exists.
6. Send identical context to caller and agent exact-tool checks.
7. Move caller exact-tool checking outside the branch that controls whether a
   separate agent check is needed.
8. Add shadow decision and timing telemetry without changing enforcement.

### Required tests

- Matching, non-matching, missing, and wrong-type arguments.
- Nested JSON Pointer.
- Malformed, duplicate-key, truncated, deep, and oversized bodies.
- Dynamic-agent and local-agent contexts.
- Caller and agent receive byte-equivalent normalized context.
- Cache hit, cache miss, stale hash, and policy-schema endpoint outage.
- Argument values absent from logs and audit payloads.

### Exit criteria

- Shadow results match expected OpenFGA condition decisions.
- Context projection is under 2 ms p95 for the benchmark payload.
- Existing authoritative decisions are unchanged.

## Phase 4 - Policy API and Reconciliation

### Tasks

1. Add Mongo schema and indexes for policy metadata.
2. Implement list/schema/put/delete/evaluate routes.
3. Bind caller identity and authorize tool plus target-subject management.
4. Add optimistic revision checks.
5. Detect known unconditional exact and wildcard conflicts.
6. Implement create, replacement, delete, read-back, and compensation flows.
7. Emit immutable policy mutation audits.
8. Add a drift reconciler and health status.

### Required tests

- Authentication and subject binding.
- Tool manager without subject authority is denied.
- Subject manager without tool authority is denied.
- Revision conflict.
- Additive policy save.
- Exclusive save accepted without conflict.
- Exclusive save rejected with exact or wildcard conflict.
- Evaluate endpoint never invokes MCP.
- OpenFGA failure, read-back mismatch, and compensation behavior.

### Exit criteria

- `ACTIVE` always corresponds to a verified conditional tuple.
- Delete is not reported complete until the tuple is absent.

## Phase 5 - Admin UI

### Tasks

1. Add exact tool selector backed by the catalog.
2. Add target-subject selector constrained by caller authority.
3. Render field/operator/value editors from template metadata.
4. Render a read-only human expression preview.
5. Show schema hash and stale-schema state.
6. Show additive/exclusive mode and every known shadowing path.
7. Add dry-run evaluation with clearly synthetic input.
8. Add reconciliation failure and retry controls.

### Required tests

- Keyboard-accessible field and operator controls.
- Unsupported fields never render.
- Stale schema blocks save until revalidation.
- Shadowing warnings cannot be dismissed as exclusive.
- Raw CEL text has no executable editor path.
- API errors preserve unsaved form state.

### Exit criteria

- An administrator can create and explain one exact-tool expression without
  understanding OpenFGA tuple JSON or CEL.

## Phase 6 - Selected-Tool Enforcement

### Preconditions

- Caller-tool checking is mandatory and no longer default-off.
- Agent-context HMAC is configured and bridge readiness verifies it.
- Active model descriptor is consistent across writer and bridge.
- Shadow telemetry is stable.
- Audit and rollback procedures are exercised.

### Tasks

1. Inventory exact, wildcard, manager-derived, and transitive grants for the
   selected tool.
2. Convert compatibility-required manager invocation to explicit caller grants.
3. Remove broader grants for subjects requiring exclusive restriction.
4. Write conditional exact grants.
5. Enable authoritative context-aware caller and agent checks for the selected
   tool.
6. Monitor denies, unavailable results, latency, and schema drift.

### Initial scope

- One exact mutation tool.
- One flat string argument.
- No batch or embedded-list mutations.
- No conditional wildcard.

### Exit criteria

- Matching calls reach MCP; non-matching calls never reach MCP.
- No subject retains an unintended broader path.
- Rollback can revoke the conditional grant without unsafe bypass.

## Phase 7 - Documentation and Operations

### Tasks

1. Update `docs/docs/security/rbac/architecture.md` with component ownership and
   configuration.
2. Update `docs/docs/security/rbac/workflows.md` with the context-aware sequence.
3. Document policy authoring, schema drift, shadowing, rollback, and audit.
4. Add dashboards and alerts for decision reasons and reconcile failures.
5. Document the provider-side defense-in-depth recommendation.

## Quality Gates

Run relevant checks from the repository root unless noted:

```bash
uv run ruff check deploy/openfga/bridge
uv run pytest deploy/openfga/bridge/tests
cd ui && npm run lint
cd ui && npm run build
cd docs && npm run build
```

Also run:

- OpenFGA DSL-to-JSON parity test.
- RBAC default-deny and coverage tests.
- Conditional Check integration suite against the pinned OpenFGA image.
- Focused policy API and UI Jest suites.
- Secret-value scan over test audit/log output.

## Rollout Controls

Proposed configuration:

```text
CAIPE_TOOL_EXPRESSION_POLICY_MODE=off|shadow|enforce
CAIPE_TOOL_EXPRESSION_ENFORCED_REFS=issue_tracker/create_item,...
CAIPE_TOOL_POLICY_SCHEMA_CACHE_TTL_SECONDS=60
CAIPE_TOOL_POLICY_MAX_BODY_BYTES=65536
CAIPE_TOOL_POLICY_MAX_CONTEXT_BYTES=16384
```

Rules:

- Default `off` until model, bridge, and caller checks are ready.
- `shadow` records but never changes the existing decision.
- `enforce` applies only to explicitly listed exact refs during rollout.
- Missing HMAC or caller-tool enforcement makes enforce readiness fail.
- The unsafe RBAC bypass is never a rollout or rollback mechanism.

## Rollback Plan

1. Stop new policy authoring.
2. Return selected refs to shadow or off mode.
3. Delete conditional tuples to revoke expression-derived grants.
4. Restore unconditional grants only through explicit audited change requests.
5. Keep condition definitions in the model while any tuple or rollback window
   references them.
6. Revert the active model descriptor only after compatibility validation.

Rollback favors denial over temporary broad access.

## Delivery Slices

| Slice | Deliverable | Independent value |
|---|---|---|
| A | Model templates and parity tests | Proves native OpenFGA feasibility. |
| B | Client tuple/context support | Enables condition round-trip and test tools. |
| C | Schema compiler and catalog | Enables safe policy validation. |
| D | Bridge shadow context | Proves real request extraction without enforcement risk. |
| E | Policy API and UI | Enables reviewed authoring and drift visibility. |
| F | One selected-tool enforcement | Delivers the first argument-aware security boundary. |

Each slice should be independently reviewable. Enforcement must not be bundled
with the first model/client refactor.
