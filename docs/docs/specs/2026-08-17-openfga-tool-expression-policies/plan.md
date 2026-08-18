---
sidebar_label: Implementation Plan
title: CAIPE Authorization Service and Expression Policies - Implementation Plan
description: Incremental plan to run caipe-authz beside today's authorization paths and migrate by bounded cohort.
---

# Implementation Plan: CAIPE Authorization Service and Expression Policies

- **Branch:** `prebuild/docs/openfga-tool-expression-policies`
- **Date:** 2026-08-17
- **Spec:** [spec.md](./spec.md)
- **Architecture:** [architecture.md](./architecture.md)
- **Research:** [research.md](./research.md)
- **Data model:** [data-model.md](./data-model.md)
- **HTTP and gRPC contracts:** [contracts/rest-api.md](./contracts/rest-api.md)
- **Event contracts:** [contracts/events.md](./contracts/events.md)
- **Migration notes:** [db-migration.md](./db-migration.md)
- **Validation guide:** [quickstart.md](./quickstart.md)
- **Execution tasks:** [tasks.md](./tasks.md)

## Outcome

Deliver one standalone CAIPE Authorization Service, `caipe-authz`, with:

- HTTP and batch HTTP for BFF, Dynamic Agents, RAG, bots, and services.
- Envoy `ext_authz` v3 gRPC for AgentGateway.
- One canonical decision core and trusted-context pipeline.
- OpenFGA for relationships and OpenFGA-native CEL for v1 conditions.
- Typed, versioned expression templates.
- Durable audit delivery and bounded OpenFGA inspection APIs.
- Disabled extension points for future Cedar and OPA providers.

The service runs beside the current BFF decision engine and gateway bridge.
Existing behavior remains authoritative until a scoped rollout revision promotes
an approved cohort. Exact MCP tool arguments are the first conditional-policy
slice, but the Authz Service contract applies to every CAIPE resource type.

## Constitution Check

| Gate | Plan response |
|---|---|
| Incremental change | Deploy dark, shadow, canary, then cut over per surface/resource/action cohort. |
| Simple v1 | One runtime provider and one shared OpenFGA store; no new policy engine or tuple replication. |
| Security first | Fail closed, no caller-selected routing/provider, no automatic fallback, no raw expression authoring. |
| Test before implementation | Golden, contract, replay, integration, and rollback tests precede each implementation slice. |
| Backward compatibility | Current endpoints and evaluators remain available through the rollback-retention window. |
| Observable operation | Stable reason/mismatch codes, normalized audit events, outbox metrics, and promotion dashboards. |
| Documentation | Spec Kit artifacts and component READMEs are updated with each slice. |

No constitution violation is required. Cedar, OPA, policy composition, a dynamic
rollout database, and a second OpenFGA store are deferred under YAGNI.

## Normative Technical Decisions

| Layer | Choice |
|---|---|
| Universal entry point | One standalone Authz Service |
| Application transport | HTTP and batch HTTP |
| Gateway transport | Envoy `ext_authz` gRPC |
| Relationship authorization | OpenFGA |
| Conditional expressions | OpenFGA-native CEL |
| Context construction | Authz Service |
| Policy authoring | Typed, versioned templates |
| Migration authority | Deployment-owned router at the current enforcement boundary |
| Migration data | One shared OpenFGA store and explicit model descriptor |
| Cedar and OPA | Future optional providers, disabled in v1 |

## Migration Invariants

- Installing or starting `caipe-authz` changes no production decision.
- `LEGACY` and `SHADOW` always use the current result.
- `CANARY` is deterministic for subject, resource, action, and rollout revision.
- A caller cannot select a mode, cohort, revision, or provider.
- Once Authz is authoritative, legacy allow cannot override Authz deny, error,
  timeout, or missing context.
- Rollback is an explicit audited routing revision, never request-level fallback.
- Routing rollback does not mutate OpenFGA tuples or expression policies.
- Exactly one authoritative decision event and at most one comparison event are
  produced for each decision.
- Expression policies remain off until the resource's required caller and agent
  checks are Authz-authoritative.
- Legacy code is removed only after `AUTHZ_ONLY` and the rollback-retention
  window.

## Target Project Structure

```text
ai_platform_engineering/authz/
├── api/
│   ├── http.py
│   └── ext_authz.py
├── core/
│   ├── contract.py
│   ├── decision.py
│   ├── context.py
│   ├── registry.py
│   └── reasons.py
├── migration/
│   ├── config.py
│   ├── cohort.py
│   ├── comparator.py
│   └── events.py
├── audit/
│   ├── events.py
│   ├── outbox.py
│   └── publisher.py
├── providers/
│   ├── base.py
│   └── openfga.py
├── policy/
│   ├── templates.py
│   └── reconciliation.py
├── inspection/
│   ├── graph.py
│   ├── model.py
│   └── simulation.py
└── tests/
    ├── contract/
    ├── integration/
    └── conformance/

ui/src/lib/authz/                    # BFF migration router and Authz client
deploy/openfga/bridge/               # gateway migration router, then retired
charts/ai-platform-engineering/charts/caipe-authz/
docker-compose/
```

The ownership boundary is normative even if packaging changes: all transports
and migration adapters call one decision core, and only the provider talks to
OpenFGA for runtime decisions.

## Rollout Matrix

| Surface | Initial path | Shadow location | Canary authority | Final path |
|---|---|---|---|---|
| BFF routes | In-process BFF engine | BFF migration router calls Authz HTTP | Router selects Authz for approved cohorts | BFF uses Authz HTTP only |
| Dynamic Agents | Existing BFF decision API | BFF facade shadows by caller surface | BFF facade or client revision selects approved cohort | Authz HTTP, with compatibility facade retained temporarily |
| RAG, bots, services | Current service/BFF integration | Current enforcement wrapper calls Authz HTTP | Per-client/surface rollout revision | Authz HTTP |
| AgentGateway | Current Python `ext_authz` bridge | Bridge forwards a copy of `CheckRequest` to Authz | Bridge uses Authz result for selected cohorts | AgentGateway calls Authz `ext_authz` directly |

## Phase 0 - Freeze Current Behavior

### Work

1. Inventory every decision surface, resource/action mapping, rollout flag,
   timeout, cache rule, reason, and owner.
2. Freeze canonical request/result, batch, explanation, migration, and event
   contracts.
3. Capture neutral golden fixtures from the BFF engine and gateway bridge.
4. Define mismatch classes and normalization rules.
5. Record the active OpenFGA store, model ID, model hash, and mapping revision.
6. Define promotion SLOs and an approved rollback observation window per surface.

### Exit

- HTTP and gRPC inputs normalize to the same canonical fixtures.
- Existing allow, deny, invalid, timeout, and unavailable behavior is covered.
- Every current check and flag has an owner and migration cohort.
- No runtime behavior changes.

## Phase 1 - Deploy `caipe-authz` Dark in `LEGACY`

### Work

1. Implement health/readiness, configuration, HTTP, batch HTTP, and Envoy v3
   gRPC listeners over one transport-neutral decision function.
2. Implement subject binding, trusted-context namespaces, stable reasons,
   bounded metrics, and the `openfga-cel` provider.
3. Add disabled Cedar and OPA identifiers that cannot be selected by clients.
4. Implement normalized events, durable audit outbox, and Audit Service delivery.
5. Package Helm and Docker Compose deployments without routing decision traffic.
6. Add deployment-owned, versioned migration configuration; default every scope
   to `LEGACY`.
7. Share the current explicit OpenFGA store/model descriptor; do not copy tuples.

### Exit

- Listener, contract, provider, audit-outbox, and fail-closed tests pass.
- Public provider/migration overrides are rejected.
- Starting or stopping Authz changes zero authoritative decisions.
- The service can be independently observed and rolled back.

## Phase 2 - Shadow the BFF Path

### Work

1. Add a temporary BFF migration router around the current decision wrapper.
2. Keep BFF routes and Dynamic Agents on their existing endpoints.
3. In `SHADOW`, invoke the BFF engine authoritatively and Authz HTTP
   non-authoritatively with bounded timeout and concurrency.
4. Normalize results and emit `authz_migration_comparison` without duplicating
   the authoritative decision event.
5. Build mismatch/error/latency dashboards and replay the golden suite.
6. Exercise explicit routing rollback from `SHADOW` to `LEGACY`.

### Exit

- Shadow failure or mismatch cannot alter BFF behavior or latency beyond budget.
- Required fixtures have zero unexplained semantic mismatches.
- Production observation meets the approved mismatch, error, and latency gates.
- No BFF runtime OpenFGA code has been removed.

## Phase 3 - Shadow the AgentGateway Path

### Work

1. Add an Authz shadow client to the current Python bridge.
2. Forward a bounded copy of the Envoy `CheckRequest` to Authz `ext_authz`.
3. Preserve current bridge authority while comparing gateway, agent, tool, JWT,
   signed-agent-context, request-body, and error cases.
4. Verify duplicate-key-safe JSON parsing and identical body-size limits.
5. Isolate gRPC shadow timeouts, concurrency, and saturation from legacy traffic.
6. Exercise explicit gateway rollback to `LEGACY`.

### Exit

- Existing bridge tests pass against both implementations.
- The migration matrix has zero unexplained semantic mismatches.
- AgentGateway still has one authoritative `ext_authz` response.
- The current bridge remains deployable.

## Phase 4 - Promote Bounded Authz Cohorts

### Work

1. Promote one low-risk BFF resource/action scope to deterministic `CANARY`.
2. Keep legacy evaluation for comparison; never use it as fallback.
3. Test `CANARY` to `SHADOW` rollback with an audited routing revision.
4. Expand independently across BFF, Dynamic Agents, RAG, bots, and services.
5. Promote a gateway resource/action cohort while the bridge remains the router.
6. Move a surface to `AUTHZ` only after all promotion gates pass.
7. Keep compatibility endpoints and legacy evaluators through retention.

### Exit

- Cohort membership is stable across replicas, restarts, and config reloads.
- No unexplained allow/deny mismatch exists in the approved observation window.
- Authz-authoritative errors deny and never fall back.
- Each surface can advance or roll back without a global switch.

## Phase 5 - Add Backward-Compatible OpenFGA Conditions

### Work

1. Pin OpenFGA and the CEL evaluation-cost limit.
2. Add reviewed, versioned condition templates and `tool#conditional_caller`.
3. Separate `can_manage` from invocation after measuring compatibility impact.
4. Generate chart model JSON and enforce DSL/JSON parity.
5. Add condition-aware tuple read/write and context-aware Check/BatchCheck.
6. Implement the active model descriptor and safe tuple replacement with
   verification and compensation.
7. Deploy the model before writing any conditional tuple.

### Exit

- Existing unconditional decisions remain unchanged.
- Model mismatch, condition error, and OpenFGA outage fail closed.
- Persisted constants override duplicate request context.
- No conditional tuple is created automatically.

## Phase 6 - Build Typed Policy Control Plane

### Work

1. Add a `(resource_type, action)` registry for context schema, allowed sources,
   provider binding, and revision.
2. Retain bounded sanitized MCP input schemas and canonical hashes.
3. Derive eligible RFC 6901 JSON Pointer fields.
4. Implement reviewed templates, canonical policy hashes, optimistic concurrency,
   reconciliation, and compensation.
5. Add schema/list/put/delete/evaluate/explain operations.
6. Add typed UI editors and additive/exclusive shadowing analysis.
7. Reject unsupported, secret, binary, ambiguous, deep, or oversized inputs.

### Exit

- Raw CEL, Cedar, and Rego have no executable authoring path.
- Active metadata corresponds to a verified conditional tuple.
- Schema drift fails closed and is visible.
- An exclusive save fails while a known broader allow path remains.

## Phase 7 - Complete Audit and Visualization

### Work

1. Complete idempotent batch delivery of decision, comparison, policy, and
   relationship events to Audit Service.
2. Preserve Audit Service ownership of retention, query, storage, and export.
3. Add privileged bounded model, relationship, graph, Check, policy, and
   simulation APIs to Authz.
4. Move direct OpenFGA reads from BFF admin routes behind Authz clients.
5. Extend the existing graph UI with conditions, revisions, drift, wildcard
   shadowing, additive/exclusive status, and migration comparison overlays.
6. Authorize and audit inspection, simulation, and export operations.
7. Isolate inspection/query concurrency from the runtime decision path.

### Exit

- Remote audit outage drains without duplicate events after recovery.
- Current graph state comes from OpenFGA, not audit replay.
- Unauthorized inspection is denied and audited.
- Large graphs paginate or truncate without affecting decision latency.
- No event or visualization exposes argument values or sensitive literals.

## Phase 8 - Shadow Expression Context

### Work

1. Project eligible arguments into typed maps and add server-derived time,
   schema hash, identity, and resource context.
2. Send byte-equivalent context to required caller and agent checks.
3. Create an explicit test policy/tuple only in a non-production fixture scope.
4. Record expression shadow results without changing the authoritative outcome.
5. Benchmark projection, HTTP, batch, gRPC, and OpenFGA latency.

### Exit

- Match, mismatch, missing, wrong-type, stale, malformed, truncated, deep, and
  oversized cases are covered.
- Context projection is below 2 ms p95 for the benchmark payload.
- Argument values never appear in logs or audit events.
- Production grants remain unchanged.

## Phase 9 - Enforce One Exact Tool Policy

### Preconditions

- Required caller and agent checks are Authz-authoritative for the exact scope.
- Signed agent context and caller-tool checking are mandatory.
- Model, schema, policy, audit, visualization, and rollback gates pass.

### Work

1. Select one exact, non-bulk mutation tool with one flat string argument.
2. Inventory direct, wildcard, manager-derived, and transitive grants.
3. Remove broader grants only for subjects requiring exclusive restriction.
4. Write and verify the conditional tuple.
5. Enable expression enforcement only for the selected exact resource/action.
6. Monitor deny reasons, provider errors, latency, schema drift, and audit.

### Exit

- Matching calls reach MCP and non-matching calls do not.
- No subject retains an unintended broader allow path.
- Routing rollback does not broaden grants.
- Policy rollback revokes the conditional grant without unsafe bypass.

## Phase 10 - Retire Legacy Paths

### Work

1. Move each completed cohort to `AUTHZ_ONLY` after its retention window.
2. Point AgentGateway directly at Authz `ext_authz` only after the gateway bridge
   has no remaining legacy cohort.
3. Remove the BFF in-process evaluator only after all BFF-backed callers are
   `AUTHZ_ONLY` or explicitly migrated.
4. Remove bridge policy logic, stale flags, and compatibility code in separate
   reviewable changes.
5. Retain historical event compatibility and migration runbooks.

### Exit

- No production caller depends on a legacy evaluator.
- Removal tests prove fail-closed behavior and endpoint compatibility.
- Operational rollback uses a previous compatible Authz release, not a hidden
  legacy decision path.

## Phase 11 - Future Provider Evaluation

Cedar or OPA requires a separate approved proposal covering use cases,
policy/schema distribution, entity/data synchronization, restrictive
composition, failure semantics, audit, sandboxing, latency, availability, and
conformance. An identifier in the provider registry is not permission to enable
a provider.

## Deployment-Owned Rollout Configuration

Illustrative configuration, versioned in Helm/deployment values:

```yaml
migration:
  revision: "authz-rollout-001"
  defaultMode: LEGACY
  canarySeedRef: caipe-authz-canary-seed
  shadowTimeoutMs: 50
  scopes:
    - surface: bff
      resourceType: tool
      action: invoke
      resources: ["issue_tracker/create_item"]
      mode: SHADOW
      canaryPercent: 0
```

- Configuration is not part of the public decision API.
- Exact allowlists take precedence over percentages.
- Percentage cohorts use a stable keyed hash of normalized scope inputs.
- Invalid or unknown configuration fails readiness; it never defaults to Authz.
- A routing revision change is audited and applies atomically to new requests.

## Promotion Gate

A scope may advance only when all are true:

- Contract/replay suites have zero unexplained semantic mismatches.
- Production shadow/canary has zero unexplained `ALLOW_DENY` or `DENY_ALLOW`
  mismatches for the approved window.
- Error, timeout, saturation, and latency objectives pass.
- OpenFGA store/model descriptors and context-schema revisions match.
- Comparison events are delivered and visible in the rollout dashboard.
- Rollback has been exercised without tuple mutation.
- The scope has an owner and approved rollout revision.

## Rollback

### Routing rollback

1. Apply an approved revision from `CANARY`/`AUTHZ` to `SHADOW` or `LEGACY`.
2. Verify the new revision and authoritative-path metric.
3. Preserve comparison/audit evidence.
4. Do not mutate policies or tuples.

### Expression-policy rollback

1. Stop authoring for the affected scope.
2. Return expression evaluation to shadow/off if safe and explicit.
3. Delete the conditional tuple to revoke its grant.
4. Restore an unconditional grant only through a separate audited change.

Rollback favors denial over temporary broad access. Neither path may silently
fall back from Authz to a legacy allow.

## Quality Gates

```bash
uv run ruff check ai_platform_engineering/authz
uv run pytest ai_platform_engineering/authz/tests
cd ui && npm run lint
cd ui && npm run build
cd docs && npm run build
```

Also require:

- At least 80% coverage for new Authz modules.
- HTTP/gRPC normalization conformance.
- BFF and bridge replay parity.
- Stable cohort tests across processes and replicas.
- No-fallback and rollback integration tests.
- OpenFGA DSL/JSON parity and pinned-image condition tests.
- Default-deny, timeout, malformed provider, and model-drift coverage.
- Audit outbox failure/retry/idempotency/recovery tests and secret scans.
- Inspection authorization, pagination, truncation, redaction, and isolation.

## Delivery Slices

| Slice | Deliverable | Independent value |
|---|---|---|
| A | Current-behavior inventory and golden fixtures | Freezes compatibility before extraction |
| B | Dark `caipe-authz` deployment in `LEGACY` | Proves packaging without changing access |
| C | BFF `SHADOW` router and comparisons | Measures application parity safely |
| D | Gateway `SHADOW` router and comparisons | Measures data-plane parity safely |
| E | One deterministic `CANARY` cohort | Proves authority transfer and rollback |
| F | Backward-compatible OpenFGA conditions | Adds native CEL without creating grants |
| G | Typed policy control plane | Enables safe, schema-bound authoring |
| H | Audit and visualization completion | Makes decisions and policy state operable |
| I | Expression-context shadow | Proves request semantics without enforcement |
| J | One exact-tool expression policy | Delivers the first conditional boundary |
| K | Cohort-by-cohort `AUTHZ_ONLY` cleanup | Retires duplicate decision code safely |

Each slice is independently reviewable. Provider experiments and broad legacy
removal must not be bundled with v1 extraction or the first expression policy.
