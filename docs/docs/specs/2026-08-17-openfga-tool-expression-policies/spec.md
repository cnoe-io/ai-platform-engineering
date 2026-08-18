---
sidebar_label: Specification
title: CAIPE Authorization Service and Expression Policies - Specification
description: Requirements for a standalone CAIPE authorization service and typed expression policies.
---

# Feature Specification: CAIPE Authorization Service and Expression Policies

- **Feature branch:** `prebuild/docs/openfga-tool-expression-policies`
- **Created:** 2026-08-17
- **Status:** Draft
- **Input:** Extract authorization decisions from the BFF into the standalone
  `caipe-authz` service for application and gateway authorization. Add typed
  expressions so grants can depend on trusted resource and request context.

## Context and Problem

CAIPE authorization is currently split. The BFF exposes a central authorization
contract and in-process OpenFGA engine, Dynamic Agents call that BFF contract,
and AgentGateway uses a separate bridge that calls OpenFGA directly. This
creates two runtime decision implementations and makes shared context and
expression semantics difficult to guarantee.

CAIPE currently authorizes the identity of an MCP tool:

```text
user or agent can_call tool:<server>/<tool>
```

It does not authorize the values passed to that tool. A principal who may call
an issue-creation tool can therefore select any project accepted by the MCP
server and its provider credentials.

The current OpenFGA bridge receives the MCP request body, but it extracts only
the tool name. OpenFGA Check requests contain only `user`, `relation`, and
`object`; the authorization model defines no conditions.

This feature creates the CAIPE Authorization Service (`caipe-authz`, or Authz
Service) with HTTP, batch HTTP, and Envoy `ext_authz` gRPC transports. It owns
trusted context and provider routing. OpenFGA remains the v1 relationship PDP
and evaluates native CEL conditions. Cedar and OPA are future provider
extensions and are not enabled in v1.

## User Scenarios and Testing

### User Story 0 - Receive the same decision through `caipe-authz` (Priority: P1)

An application and AgentGateway submit equivalent authorization requests over
their native transports and receive the same decision, reason, and policy
revision from one Authz Service decision core.

**Why this priority:** A universal contract is not sufficient while BFF and
gateway traffic execute different decision implementations.

**Independent test:** Send one canonical request through Authz Service HTTP and
an equivalent Envoy `CheckRequest` through Authz Service gRPC. Assert that both
normalize to the same provider input and result.

**Acceptance scenarios:**

1. **Given** a BFF route, **when** it authorizes over HTTP, **then** the BFF does
   not evaluate OpenFGA policy in process.
2. **Given** an MCP call, **when** AgentGateway invokes `ext_authz`, **then** the
   Authz Service gRPC adapter calls the same decision core used by HTTP.
3. **Given** an unavailable required provider, **when** either transport calls
   the Authz Service, **then** it fails closed with a stable reason.
4. **Given** an untrusted request names `cedar`, `opa`, or another provider,
   **when** the Authz Service validates it, **then** it rejects that provider
   override.

### User Story 1 - Restrict a tool by an argument (Priority: P1)

An authorized administrator grants a team access to an exact mutation tool only
when a selected string argument belongs to an approved allowlist.

**Why this priority:** This is the core capability and closes the gap between
tool-level access and provider-resource scope.

**Independent test:** Configure a policy for
`tool:issue_tracker/create_item` where `/project_key` must equal `PRIMARY`.
Call once with `PRIMARY` and once with `OTHER`; only the first request reaches
the MCP server.

**Acceptance scenarios:**

1. **Given** a team member and a matching argument, **when** the member calls
   the exact tool, **then** OpenFGA returns allow.
2. **Given** the same member and a non-matching argument, **when** the member
   calls the tool, **then** Authz Service denies before proxying.
3. **Given** the required argument is missing or has the wrong type, **when**
   the member calls the tool, **then** Authz Service fails closed.
4. **Given** the caller uses a dynamic agent, **when** caller and agent policies
   are evaluated, **then** both receive the same trusted request context and
   both must allow.

### User Story 2 - Build a policy safely (Priority: P1)

An administrator selects a field, operator, and value from a typed UI generated
from the tool's MCP input schema.

**Why this priority:** Raw expression authoring would expose a code-injection
and policy-review surface that the platform should not create.

**Independent test:** Open the policy editor for a discovered tool and verify
that it offers only policy-eligible fields and compatible templates.

**Acceptance scenarios:**

1. **Given** a string field, **when** the editor opens, **then** it offers only
   reviewed string templates.
2. **Given** an unsupported, secret, binary, or ambiguous field, **when** the
   editor opens, **then** that field cannot be selected.
3. **Given** CEL-like text in a literal value, **when** the policy is saved,
   **then** the value is treated as data and is never executed.
4. **Given** the tool schema changed, **when** the administrator views the
   policy, **then** it is marked stale and requires explicit revalidation.

### User Story 3 - Understand whether a policy is effective (Priority: P1)

An administrator sees whether an unconditional exact, wildcard, or computed
grant already allows the same subject to invoke the tool.

**Why this priority:** OpenFGA is monotonic. A conditional allow cannot override
a broader allow, so an apparently restrictive policy can otherwise be
misleading.

**Independent test:** Give a team `caller` on `tool:issue_tracker/*`, then try to
save an exclusive exact-tool expression for the same team. The API rejects the
exclusive claim and identifies the wildcard path.

**Acceptance scenarios:**

1. **Given** no broader allow path, **when** a valid policy is saved as
   exclusive, **then** the UI reports it as exclusive.
2. **Given** a conflicting wildcard or unconditional exact grant, **when** the
   policy is saved as exclusive, **then** the API rejects it.
3. **Given** a valid broader path that remains intentionally, **when** the
   policy is saved, **then** it is labeled additive rather than restrictive.
4. **Given** a later team-membership change introduces a transitive allow,
   **when** effective access is inspected, **then** the new allow path appears.

### User Story 4 - Operate and audit expression policies (Priority: P2)

An operator can identify policy revisions, schema drift, reconciliation errors,
and call-time outcomes without seeing sensitive tool argument values.

**Why this priority:** Authorization policies are production security controls
and require reliable change and decision evidence.

**Independent test:** Create, update, exercise, and delete one policy. Confirm
that audit records contain the actor, target, template, hashes, revision, and
outcome, but no argument values.

**Acceptance scenarios:**

1. **Given** a policy mutation, **when** reconciliation completes, **then** an
   immutable audit event records the before/after status.
2. **Given** a call-time allow or deny, **when** Authz Service audits it, **then**
   only context field names and types are recorded.
3. **Given** an OpenFGA write failure during update, **when** compensation
   succeeds, **then** the previous policy remains effective.
4. **Given** reconciliation and compensation both fail, **when** the operation
   returns, **then** the policy is marked `RECONCILE_FAILED` and an operator is
   alerted.

### User Story 5 - Roll out without broadening access (Priority: P2)

An operator can deploy `caipe-authz` and model support before migrating any
existing grant, observe decisions, and enable selected exact tools incrementally.

**Why this priority:** Authorization changes must not silently remove or broaden
existing production access.

**Independent test:** Deploy phases 0 and 1 with no conditional tuples and
verify that existing decisions are unchanged; then migrate one exact tool and
verify only that tool uses expression enforcement.

**Acceptance scenarios:**

1. **Given** condition definitions exist but no conditional tuple exists,
   **when** existing tools are called, **then** behavior is unchanged.
2. **Given** shadow mode is enabled, **when** tools are called, **then** shadow
   decisions are recorded but do not enforce.
3. **Given** an exact tool is selected for enforcement, **when** its broader
   grants are removed and conditional tuple written, **then** only matching
   calls succeed.
4. **Given** rollback is required, **when** the conditional tuple is deleted,
   **then** the grant is revoked; restoration of an unconditional grant requires
   a separate explicit action.

## Edge Cases

- HTTP and gRPC requests normalize differently.
- The BFF compatibility facade and `caipe-authz` versions are temporarily
  incompatible.
- An untrusted caller attempts to select or skip a policy provider.
- A required provider times out, returns malformed output, or is unconfigured.
- A future guardrail provider denies while OpenFGA allows.
- Authz Service HTTP traffic is healthy while the `ext_authz` listener is saturated.
- Audit Service is unavailable while the local Authz outbox remains healthy.
- The Authz outbox is full or cannot journal an allow event.
- A batch decision partially succeeds and requires one event per item.
- A graph query exceeds tuple scan, node, edge, time, or response-size limits.
- An unauthorized viewer requests model, tuple, simulation, or audit history.
- Historical audit events disagree with current OpenFGA state.
- MCP body is absent, truncated, malformed, too large, or contains duplicate
  JSON keys.
- `params.name` is valid but `params.arguments` is not an object.
- A nested JSON Pointer is missing midway through traversal.
- A JSON number cannot be represented by the selected OpenFGA condition type.
- A schema uses `oneOf`, `anyOf`, or a union whose scalar type is ambiguous.
- A tool disappears from discovery and later returns with a different schema.
- A policy literal contains Unicode normalization variants.
- An administrator edits a policy from a stale UI revision.
- The same principal is allowed through multiple direct and transitive paths.
- An exact conditional check denies but a valid wildcard grant allows.
- A local caller has no separate agent identity.
- Agent context signing or caller-tool checking is not configured.
- OpenFGA has a newer authorization model than the Authz Service recognizes.
- OpenFGA or the policy-schema service is temporarily unavailable.
- Audit delivery fails after the authorization decision is complete.

## Functional Requirements

### CAIPE Authorization Service

- **FR-AUTHZ-001:** CAIPE MUST operate one logical Authz Service decision core
  outside the BFF process.
- **FR-AUTHZ-002:** The Authz Service MUST expose single-decision and
  batch-decision HTTP APIs.
- **FR-AUTHZ-003:** The Authz Service MUST expose Envoy `ext_authz` v3 gRPC for
  AgentGateway.
- **FR-AUTHZ-004:** Every transport MUST normalize to the same canonical subject,
  action, resource, and trusted-context contract.
- **FR-AUTHZ-005:** BFF routes MUST use the Authz Service client instead of an
  in-process OpenFGA decision engine after migration.
- **FR-AUTHZ-006:** The existing gateway bridge MUST be refactored into the
  Authz Service gRPC adapter and MUST NOT retain an independent policy decision
  path after migration.
- **FR-AUTHZ-007:** The Authz Service MUST own subject binding, action/relation
  mapping, active model selection, provider invocation, reasons, audit, and
  bounded caching.
- **FR-AUTHZ-008:** The Authz Service MUST support independent HTTP and gRPC
  readiness, saturation metrics, timeouts, and scaling.
- **FR-AUTHZ-009:** Provider errors and Authz Service dependency failures MUST
  fail closed.
- **FR-AUTHZ-010:** A transport compatibility facade MUST NOT alter decision
  semantics.

### Policy providers

- **FR-PROV-001:** The Authz Service MUST define an internal provider contract
  returning `ALLOW`, `DENY`, or `INDETERMINATE` plus bounded diagnostics and
  policy/model revisions.
- **FR-PROV-002:** Provider selection MUST come from a server-owned,
  versioned binding keyed by resource type and action.
- **FR-PROV-003:** Clients MUST NOT select, order, add, or bypass providers in a
  decision request.
- **FR-PROV-004:** The only v1 runtime provider MUST be `openfga-cel`.
- **FR-PROV-005:** `openfga-cel` MUST use OpenFGA for both relationship
  evaluation and native named CEL conditions.
- **FR-PROV-006:** The Authz Service MUST NOT evaluate general-purpose CEL
  separately in v1.
- **FR-PROV-007:** Cedar and OPA interfaces MAY be represented in the provider
  registry but MUST remain disabled until separate approved implementation and
  operational proposals exist.
- **FR-PROV-008:** Future multi-provider composition MUST be restrictive:
  OpenFGA and every configured guardrail provider must allow.
- **FR-PROV-009:** A `DENY`, `INDETERMINATE`, timeout, invalid result, or outage
  from any required provider MUST deny the final decision.
- **FR-PROV-010:** Provider results MUST NOT be combined using permissive `OR`.
- **FR-PROV-011:** The Authz Service MUST expose one normalized explanation
  containing bounded provider sub-decisions without sensitive context values.

### Trusted context

- **FR-CTX-001:** The Authz Service MUST construct separate trusted identity,
  request, and resource context.
- **FR-CTX-002:** Identity context MUST come from verified credentials or
  signed workload/agent identity.
- **FR-CTX-003:** Request context MUST come from the request observed by the
  enforcement point and Authz Service server time.
- **FR-CTX-004:** Resource context MUST come from trusted catalogs or resolvers.
- **FR-CTX-005:** Client-supplied advisory context MAY narrow but MUST NOT
  broaden a decision.
- **FR-CTX-006:** Each `(resource_type, action)` registry entry MUST declare its
  context schema, allowed sources, provider binding, and revision.

### Audit Service integration

- **FR-AUDIT-001:** The Authz Service MUST emit exactly one `authz_decision`
  event for each canonical single decision and each item in a batch decision.
- **FR-AUDIT-002:** Policy and relationship mutations MUST emit
  `authz_policy_change` or `authz_relationship_change` events.
- **FR-AUDIT-003:** Every event MUST include a unique event ID, correlation ID,
  resource/action, outcome, reason, provider, and applicable model and policy
  revisions.
- **FR-AUDIT-004:** Audit events MUST NOT contain credentials, tokens, raw
  request bodies, tool argument values, or raw policy source.
- **FR-AUDIT-005:** Runtime events MUST be appended to a bounded durable outbox
  before asynchronous batch delivery to CAIPE Audit Service.
- **FR-AUDIT-006:** A remote Audit Service outage MUST NOT add a synchronous
  network dependency to the decision path while the local outbox is healthy.
- **FR-AUDIT-007:** Strict production mode MUST fail an allow closed when its
  event cannot be journaled locally; an existing deny MUST remain deny.
- **FR-AUDIT-008:** Policy and relationship mutations MUST NOT report success
  until the mutation and durable outbox record commit or are compensated.
- **FR-AUDIT-009:** Audit Service MUST own event retention, local/S3 storage,
  querying, and export; it MUST NOT participate in authorization evaluation.
- **FR-AUDIT-010:** Legacy `cas_*` event types and sources MUST migrate to the
  normalized `authz_*` contract without losing historical query compatibility.

### OpenFGA visualization and inspection

- **FR-VIZ-001:** The Authz Service MUST expose privileged bounded APIs for the
  active model, relationships, graph projection, Check, and simulation.
- **FR-VIZ-002:** The BFF and Admin UI MUST NOT read OpenFGA directly after the
  Authz Service migration.
- **FR-VIZ-003:** Visualization MUST distinguish model, relationship,
  effective-access, expression, and audit-history layers.
- **FR-VIZ-004:** Current graph state MUST come from OpenFGA and active policy
  metadata, not from replaying Audit Service events.
- **FR-VIZ-005:** Effective-access edges MUST be labeled as derived decisions
  rather than provider proof traces.
- **FR-VIZ-006:** Graph, relationship, and simulation operations MUST be
  authorized and audited.
- **FR-VIZ-007:** Tuple reads and traversal MUST be paginated and bounded by
  scan, node, edge, time, and response-size limits.
- **FR-VIZ-008:** An incomplete graph response MUST declare truncation and
  provide a continuation mechanism where supported.
- **FR-VIZ-009:** Conditional edges MUST expose only sanitized template,
  condition, schema, revision, drift, and shadowing metadata.
- **FR-VIZ-010:** Simulation MUST NOT write a relationship or invoke a protected
  resource.
- **FR-VIZ-011:** Visualization and audit-query traffic MUST have concurrency
  and latency budgets separate from authorization decisions.

### Expression and schema

- **FR-001:** The public policy format MUST be versioned and declarative.
- **FR-002:** The API MUST NOT accept raw CEL or another executable expression
  language.
- **FR-003:** The initial template registry MUST support string equality, string
  allowlists, inclusive integer ranges, boolean equality, all-string equality,
  and server-derived time windows.
- **FR-004:** Every template MUST map to a reviewed, versioned OpenFGA condition.
- **FR-005:** Policy fields MUST use canonical RFC 6901 JSON Pointers relative
  to MCP `params.arguments`.
- **FR-006:** The API MUST validate fields, operators, and values against the
  sanitized MCP input schema.
- **FR-007:** Policy revisions MUST pin the input-schema hash used for
  validation.
- **FR-008:** A schema-hash mismatch MUST make an argument condition false until
  explicit revalidation.
- **FR-009:** Sensitive, free-form, binary, unbounded, and ambiguous fields MUST
  be ineligible by default.

### Authorization model and tuples

- **FR-010:** Runtime policies MUST target exact `tool:<server>/<tool>` objects,
  not the RAG custom-tool `mcp_tool` type.
- **FR-011:** The `tool` model MUST provide a `conditional_caller` base relation.
- **FR-012:** Runtime `can_call` MUST NOT be derived from `can_manage` in the
  target model.
- **FR-013:** A conditional tuple MUST store only administrator-controlled
  constants; request-derived values MUST be supplied in Check context.
- **FR-014:** Tuple reads and writes MUST preserve condition name and context.
- **FR-015:** Policy updates MUST replace the existing tuple and compensate on
  failure.
- **FR-016:** Condition names and parameter types MUST be immutable within a
  version.
- **FR-017:** Tuple writes and Check requests MUST use the same explicit active
  authorization-model ID.

### Runtime enforcement

- **FR-018:** AgentGateway MUST provide the complete bounded MCP `tools/call`
  body to the Authz Service `ext_authz` adapter.
- **FR-019:** Authz Service MUST derive identity only from verified JWT or trusted
  AgentGateway metadata.
- **FR-020:** Authz Service MUST derive agent identity only from a valid,
  non-expired HMAC-signed agent context.
- **FR-021:** Authz Service MUST project only policy-eligible values into typed
  context maps.
- **FR-022:** Authz Service MUST use server time for time conditions.
- **FR-023:** Caller and agent exact-tool checks MUST receive the same context.
- **FR-024:** Caller tool checking MUST be mandatory during expression
  enforcement and MUST NOT depend on whether a separate agent check applies.
- **FR-025:** Expression-enforcement readiness MUST fail when agent-context
  signing or caller-tool checking is disabled.
- **FR-026:** Missing, malformed, wrong-type, stale-schema, and unavailable
  context MUST fail closed.
- **FR-027:** Context normalization MUST have explicit body-size, depth, field,
  and value-count limits.

### Policy administration

- **FR-028:** Saving a policy MUST require tool-management authority and
  authority over the target subject.
- **FR-029:** The policy API MUST use optimistic concurrency.
- **FR-030:** There MUST be at most one active expression policy per OpenFGA
  `(subject, conditional_caller, exact tool)` tuple key.
- **FR-031:** The API MUST detect known unconditional exact and wildcard grants
  that shadow the proposed policy.
- **FR-032:** The API MUST reject exclusive mode while a known broader grant
  remains.
- **FR-033:** The UI MUST distinguish additive from exclusive policies.
- **FR-034:** Dry-run evaluation MUST call authorization only and MUST NOT invoke
  the MCP tool.
- **FR-035:** OpenFGA MUST remain authoritative for effective access; policy
  metadata records authoring intent and reconciliation state.

### Audit and operations

- **FR-036:** Policy mutations MUST emit actor, target, template, schema hash,
  expression hash, revision, and reconciliation outcome.
- **FR-037:** Call-time events MUST NOT log tool argument values.
- **FR-038:** Metrics MUST use bounded labels and MUST NOT contain user IDs,
  arguments, or policy IDs.
- **FR-039:** OpenFGA failures MUST deny with a stable retriable reason.
- **FR-040:** Schema discovery MUST never create or broaden a grant.
- **FR-041:** Removing an expression policy MUST revoke its tuple before the UI
  reports deletion complete.

## Key Entities

- **Expression template:** Reviewed mapping from a public typed policy shape to
  a versioned OpenFGA condition.
- **CAIPE Authorization Service:** Standalone service containing the canonical
  decision core, trusted-context construction, provider registry, transports,
  reasons, and audit.
- **Transport adapter:** HTTP, batch HTTP, or Envoy gRPC mapping into the same
  canonical Authz Service decision request.
- **Policy provider:** Internal evaluator selected by a trusted policy binding;
  `openfga-cel` is the only v1 implementation.
- **Policy binding:** Versioned server-owned mapping from resource/action to
  context schema, provider pipeline, and policy/model revisions.
- **Audit outbox:** Bounded durable Authz Service journal used to decouple
  authorization latency from Audit Service delivery.
- **Authorization audit event:** Normalized decision, policy-change, or
  relationship-change record correlated with model and policy revisions.
- **Inspection API:** Privileged bounded Authz Service read interface for model,
  relationship, graph, Check, and simulation data.
- **Authorization graph:** Layered projection of model, tuples, derived access,
  expression metadata, and separately queried audit history.
- **Expression policy:** Canonical field/operator/value document authored for
  one subject and one exact tool.
- **Conditional relationship tuple:** Effective OpenFGA grant containing a
  condition name and persisted constants.
- **Request context:** Trusted, typed argument maps and server-derived metadata
  constructed by the Authz Service and sent to OpenFGA.
- **Tool schema catalog entry:** Sanitized input schema, schema hash, eligible
  fields, source, and freshness.
- **Active model descriptor:** Store ID, authorization-model ID, model hash, and
  template-registry version shared by writers and checkers.
- **Policy metadata:** Revisioned authoring, drift, and reconciliation state;
  not an independent allow decision.

## Success Criteria

- **SC-001:** Matching and non-matching scalar policies produce the expected
  allow/deny result in 100% of the required end-to-end cases.
- **SC-AUTHZ-001:** Equivalent HTTP and gRPC requests produce identical canonical
  provider inputs, decisions, reasons, and revisions in all conformance cases.
- **SC-AUTHZ-002:** BFF and AgentGateway have no independent runtime policy
  evaluator after migration.
- **SC-AUTHZ-003:** No caller can select or bypass a provider through decision
  context or transport metadata.
- **SC-AUTHZ-004:** Cedar and OPA cannot affect an enforced v1 decision.
- **SC-AUDIT-001:** Every required decision and mutation produces exactly one
  normalized correlated audit event in end-to-end tests.
- **SC-AUDIT-002:** Remote Audit Service outage adds no remote call to decision
  latency while the local outbox accepts events.
- **SC-AUDIT-003:** Audit fixtures and exports contain zero tool argument values,
  credentials, tokens, or raw policy source.
- **SC-VIZ-001:** The Admin UI renders model, relationship, effective-access,
  expression, and history layers through Authz Service and Audit Service APIs.
- **SC-VIZ-002:** Oversized graph requests truncate or paginate without
  affecting decision-service latency objectives.
- **SC-VIZ-003:** Unauthorized inspection and simulation requests are denied and
  audited in all required cases.
- **SC-002:** Missing, wrong-type, stale-schema, malformed-body, and PDP-error
  cases fail closed in 100% of tests.
- **SC-003:** No UI or API path can submit executable CEL text.
- **SC-004:** The UI identifies known direct exact and wildcard shadowing before
  accepting exclusive mode.
- **SC-005:** Policy update failure either restores the prior tuple or exposes a
  persistent reconcile-failure state; it never silently broadens access.
- **SC-006:** Audit fixtures contain zero tool argument values.
- **SC-007:** Context projection adds less than 2 ms p95 under the benchmark
  payload and adds no second expression-evaluator network hop.
- **SC-008:** Phases 0 and 1 change zero authoritative decisions when no
  conditional tuple exists.
- **SC-009:** The Docusaurus build, Authz Service transport/provider conformance
  tests, OpenFGA model parity test, migration parity tests, and UI RBAC tests
  pass.

## Assumptions

- OpenFGA schema 1.1 and native conditions remain available in the pinned
  server version.
- AgentGateway can forward a bounded MCP request body to ext_authz.
- MCP tool discovery supplies JSON Schema for inputs.
- Provider credentials and MCP servers retain defense-in-depth authorization.
- Conditional grants are initially limited to exact tools and reviewed scalar
  fields.
- The initial Authz Service extraction preserves the existing public
  authorization contract and reason-code compatibility.

## Out of Scope

- Raw expression editing.
- Enabling Cedar, OPA, or a standalone CEL runtime in v1.
- Allowing policy-provider selection in public decision requests.
- Using permissive provider composition.
- Deny overrides or negative policies.
- Dynamic OpenFGA model generation per policy.
- An OpenFGA fork or `/condition-schema` extension.
- Conditional server wildcards.
- Output-based authorization.
- Automatically editing provider permissions.
- Bulk mutation tools whose payload embeds multiple independently scoped items.

## Companions

- [Architecture](./architecture.md)
- [Research](./research.md)
- [Implementation plan](./plan.md)
