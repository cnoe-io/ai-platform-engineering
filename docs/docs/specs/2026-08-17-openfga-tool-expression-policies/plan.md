---
sidebar_label: Implementation Plan
title: Central Authorization Service and Expression Policies - Implementation Plan
description: Phased plan to extract CAS from the BFF and add OpenFGA-native expression policies.
---

# Implementation Plan: Central Authorization Service and Expression Policies

- **Branch:** `prebuild/docs/openfga-tool-expression-policies`
- **Date:** 2026-08-17
- **Spec:** [spec.md](./spec.md)
- **Architecture:** [architecture.md](./architecture.md)
- **Research:** [research.md](./research.md)

## Outcome

Deliver one standalone Central Authorization Service (CAS) with:

- HTTP and batch HTTP for BFF, Dynamic Agents, RAG, bots, and services.
- Envoy `ext_authz` v3 gRPC for AgentGateway.
- One canonical decision core and trusted-context pipeline.
- A provider registry with `openfga-cel` as the only v1 runtime provider.
- Typed, versioned expression templates compiled to OpenFGA-native CEL.
- Disabled extension points for future Cedar and OPA providers.

Exact MCP tool arguments are the first conditional-policy slice. The CAS
contract applies to every CAIPE resource type; expressions are enabled per
`(resource_type, action)` registry entry.

## Technical Decisions

| Layer | Choice |
|---|---|
| Universal entry point | One standalone CAS |
| Application transport | HTTP and batch HTTP |
| Gateway transport | Envoy `ext_authz` gRPC |
| Relationship authorization | OpenFGA |
| Conditional expressions | OpenFGA-native CEL |
| Context construction | CAS |
| Policy authoring | Typed, versioned templates |
| Cedar | Future optional provider, not v1 |
| OPA | Future optional provider, not v1 |

Constraints:

- No caller-selected provider.
- No standalone CEL evaluator in CAS.
- No permissive `OR` composition across providers.
- No fail-open authorization path.
- No raw CEL, Cedar, or Rego authoring in the Admin UI.
- Existing decisions remain authoritative until shadow parity gates pass.

## Target Project Structure

```text
ai_platform_engineering/cas/
├── api/
│   ├── http.py                     # decision and batch HTTP
│   └── ext_authz.py                # Envoy v3 gRPC adapter
├── core/
│   ├── contract.py                 # canonical request/result
│   ├── decision.py                 # one decision pipeline
│   ├── context.py                  # trusted context construction
│   ├── registry.py                 # resource/action bindings
│   └── reasons.py                  # stable reason codes
├── providers/
│   ├── base.py                     # provider protocol
│   └── openfga.py                  # v1 OpenFGA + native CEL
├── policy/
│   ├── templates.py                # typed template registry
│   └── reconciliation.py
└── tests/
    ├── contract/
    ├── integration/
    └── conformance/

charts/ai-platform-engineering/charts/caipe-cas/
docker-compose/
ui/src/lib/authz/                    # CAS client after extraction
deploy/openfga/bridge/               # temporary parity oracle, then removed
```

The exact module layout may follow repository packaging conventions during
implementation. The ownership boundary is normative: transports and providers
must call one decision core.

## Phase 0 - Contract and Decision Inventory

### Tasks

1. Freeze canonical subject, action, resource, context, decision, batch, and
   explanation schemas.
2. Inventory every BFF, Dynamic Agents, RAG, bot, and gateway check.
3. Record action-to-relation and resource-to-object mappings.
4. Define stable allow, deny, invalid-request, and unavailable reason codes.
5. Capture golden decision fixtures from the BFF engine and current bridge.
6. Define the provider protocol and server-owned resource/action binding.

### Tests and exit criteria

- Golden fixtures contain no real or deployment-specific identifiers.
- HTTP and gRPC requests can normalize to the same canonical fixture.
- Existing callers and rollout flags have an explicit migration owner.
- No authoritative runtime behavior changes.

## Phase 1 - Standalone CAS Skeleton

### Tasks

1. Create the CAS service, health/readiness endpoints, and configuration model.
2. Add single and batch HTTP APIs.
3. Add the Envoy v3 `Authorization/Check` gRPC listener.
4. Implement one transport-neutral decision function.
5. Add subject binding, trusted-context namespaces, stable reasons, audit, and
   bounded metrics.
6. Add a provider registry with only `openfga-cel` enabled.
7. Add disabled Cedar and OPA provider identifiers that return configuration
   errors if selected without an installed implementation.
8. Add Helm and Docker Compose packaging without routing production traffic.

### Tests and exit criteria

- HTTP, batch, and gRPC contract tests pass.
- Equivalent HTTP and gRPC inputs yield identical normalized provider inputs.
- A public provider override is rejected.
- Unknown, Cedar, and OPA providers cannot affect a v1 decision.
- Listener readiness and saturation are independently observable.

## Phase 2 - Extract the BFF Decision Engine

### Tasks

1. Move OpenFGA mapping, model selection, Check/BatchCheck, reasons, audit, and
   cache semantics from `ui/src/lib/authz/` into CAS.
2. Implement the BFF CAS HTTP and batch client.
3. Preserve current BFF API routes as a temporary compatibility facade.
4. Shadow-call standalone CAS and compare decisions, reasons, and revisions.
5. Migrate Dynamic Agents and other current CAS consumers to the stable CAS
   service address.
6. Remove the BFF in-process evaluator after parity and availability gates.

### Tests and exit criteria

- Existing BFF authorization tests run as CAS client/provider conformance tests.
- Shadow mismatch rate is zero for required golden and integration cases.
- BFF routes cannot directly invoke the runtime OpenFGA decision adapter.
- CAS outage fails closed with a stable retriable reason.

## Phase 3 - Refactor the Gateway Bridge into CAS

### Tasks

1. Move JWT binding, signed agent-context verification, MCP parsing, gateway
   gates, and tool mapping from the bridge into the CAS `ext_authz` adapter and
   decision registry.
2. Configure AgentGateway to call CAS gRPC.
3. Run the existing bridge and CAS in shadow comparison mode.
4. Verify bounded request-body forwarding and duplicate-key-safe JSON parsing.
5. Define independent gRPC timeout, concurrency, and fail-closed readiness.
6. Remove the direct OpenFGA bridge after parity, latency, and rollback gates.

### Tests and exit criteria

- Existing bridge tests pass against the CAS gRPC adapter.
- CAS and the old bridge produce identical decisions for the migration matrix.
- AgentGateway does not call BFF on the authorization hot path.
- AgentGateway and BFF now use the same CAS decision core.

## Phase 4 - OpenFGA Condition and Client Support

### Tasks

1. Pin the OpenFGA version and CEL evaluation-cost limit.
2. Add reviewed condition templates to `deploy/openfga/model.fga`.
3. Generate the chart authorization-model JSON and enforce parity.
4. Add `tool#conditional_caller` and separate invocation from management.
5. Add condition-aware tuple read/write and context-aware Check/BatchCheck to
   the CAS OpenFGA provider.
6. Add an active descriptor containing store ID, model ID, model hash, and
   template-registry version.
7. Implement safe conditional-tuple replacement, verification, and
   compensation.

### Tests and exit criteria

- DSL and generated model JSON are identical.
- Direct user and team-userset condition tests pass.
- Persisted constants override duplicate request context keys.
- Model mismatch, condition error, and OpenFGA outage fail closed.
- No conditional tuple is created automatically.

## Phase 5 - Resource Schema and Typed Policy Compiler

### Tasks

1. Define a registry keyed by `(resource_type, action)` with context schema,
   allowed sources, provider binding, and revision.
2. Extend the MCP tool catalog with bounded sanitized input schemas and hashes.
3. Derive policy-eligible RFC 6901 JSON Pointer fields.
4. Implement the reviewed template registry and canonical policy hashing.
5. Reject unsupported, secret, binary, ambiguous, deep, or oversized inputs.
6. Implement schema-drift detection and stale-policy status.
7. Keep CEL source server-owned; public policies contain template plus literals.

### Tests and exit criteria

- Schema hashing is stable across key ordering.
- JSON Pointer escaping and normalization are covered.
- CEL-like text in a literal is treated only as data.
- No secret fixture appears in logs, audit, or policy metadata.
- Every authorable field maps to one typed OpenFGA context shape.

## Phase 6 - Context-Aware Shadow Evaluation

### Tasks

1. Project eligible MCP arguments into typed context maps in CAS.
2. Add trusted server time, schema hash, identity, and resource context.
3. Send byte-equivalent context to caller and dynamic-agent checks.
4. Record conditional shadow results without changing enforcement.
5. Benchmark HTTP, batch, gRPC, context projection, and OpenFGA Check latency.

### Tests and exit criteria

- Matching, non-matching, missing, wrong-type, stale, malformed, truncated,
  deep, and oversized cases are covered.
- Context projection is below 2 ms p95 for the benchmark payload.
- Argument values never appear in logs or decision events.
- Existing authoritative decisions remain unchanged.

## Phase 7 - Policy API and Admin UI

### Tasks

1. Add policy metadata, indexes, optimistic concurrency, and reconciliation.
2. Add schema, list, put, delete, evaluate, and explain operations.
3. Require authority over both resource and target subject.
4. Detect unconditional exact, wildcard, and known computed shadowing paths.
5. Add typed field/operator/value editors and read-only previews.
6. Show additive/exclusive, stale schema, policy/provider revision, and
   reconciliation state.
7. Ensure dry-run calls CAS but never invokes the protected resource.

### Tests and exit criteria

- Raw CEL, Cedar, and Rego have no executable authoring path.
- Exclusive policy save fails while a known broader path remains.
- Active metadata always corresponds to a verified OpenFGA tuple.
- Delete is not complete until the tuple is absent.

## Phase 8 - Selected-Tool Enforcement

### Preconditions

- BFF and AgentGateway use standalone CAS.
- The old BFF engine and gateway decision bridge are removed or disabled.
- Caller-tool checking is mandatory.
- Signed agent context, active model descriptor, audit, and rollback are ready.
- Shadow parity and latency objectives are met.

### Tasks

1. Select one exact, non-bulk mutation tool with one flat string argument.
2. Inventory exact, wildcard, manager-derived, and transitive grants.
3. Remove broader grants for subjects requiring exclusive restriction.
4. Write and verify the conditional tuple.
5. Enable authoritative expression evaluation for the selected resource/action.
6. Monitor denies, unavailable results, latency, and schema drift.

### Exit criteria

- Matching calls reach MCP; non-matching calls do not.
- No subject retains an unintended broader allow path.
- Rollback revokes the conditional grant without unsafe bypass.

## Phase 9 - Future Provider Evaluation

Cedar or OPA work requires a separate approved proposal. It must include:

- Concrete use cases that OpenFGA-native CEL cannot safely satisfy.
- Policy and schema storage, distribution, versioning, and rollback.
- Trusted entity/data synchronization.
- Restrictive composition and failure semantics.
- Explanation and audit normalization.
- Evaluation limits, sandboxing, latency, availability, and conformance tests.

No future provider may be enabled merely because its identifier exists in the
CAS registry.

## Rollout Controls

```text
CAIPE_CAS_MODE=shadow|enforce
CAIPE_CAS_HTTP_ENABLED=true
CAIPE_CAS_EXT_AUTHZ_ENABLED=true
CAIPE_CAS_PROVIDER=openfga-cel
CAIPE_TOOL_EXPRESSION_POLICY_MODE=off|shadow|enforce
CAIPE_TOOL_EXPRESSION_ENFORCED_REFS=issue_tracker/create_item,...
CAIPE_TOOL_POLICY_MAX_BODY_BYTES=65536
CAIPE_TOOL_POLICY_MAX_CONTEXT_BYTES=16384
```

- Provider selection is deployment policy, not a request parameter.
- `shadow` records comparisons but does not alter the authoritative result.
- Expression enforcement applies only to listed exact resources during rollout.
- Required dependency failure denies.
- Unsafe RBAC bypass is never a rollout or rollback mechanism.

## Rollback

1. Stop new expression-policy authoring.
2. Return selected expression bindings to shadow or off.
3. Delete conditional tuples to revoke expression-derived grants.
4. Restore unconditional grants only through explicit audited changes.
5. During CAS migration, restore the previous transport target only while its
   decision implementation remains version-compatible and tested.
6. Never fall back silently from CAS to an older independent evaluator.

Rollback favors denial over temporary broad access.

## Quality Gates

```bash
uv run ruff check ai_platform_engineering/cas
uv run pytest ai_platform_engineering/cas/tests
cd ui && npm run lint
cd ui && npm run build
cd docs && npm run build
```

Also require:

- CAS HTTP/gRPC normalization conformance.
- BFF-to-CAS and bridge-to-CAS migration parity.
- OpenFGA DSL-to-JSON parity.
- Conditional Check integration against the pinned OpenFGA image.
- Default-deny, provider-error, and timeout coverage.
- Audit/log secret-value scan.

## Delivery Slices

| Slice | Deliverable | Independent value |
|---|---|---|
| A | Canonical CAS contract and golden fixtures | Freezes behavior before extraction |
| B | Standalone HTTP/gRPC CAS skeleton | Proves one multi-transport core |
| C | BFF extraction | Removes the UI process as PDP |
| D | Gateway bridge migration | Unifies application and gateway decisions |
| E | OpenFGA CEL model and provider support | Proves native conditions |
| F | Schema compiler and typed authoring | Enables safe policy creation |
| G | Shadow context evaluation | Proves real request semantics |
| H | One selected-tool enforcement | Delivers the first conditional boundary |

Each slice is independently reviewable. Provider experiments must not be bundled
with v1 CAS extraction or expression enforcement.
