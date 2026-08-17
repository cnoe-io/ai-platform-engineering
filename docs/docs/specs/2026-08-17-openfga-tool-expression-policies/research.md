---
sidebar_label: Research
title: CAIPE Authorization Service and Expression Policies - Research
description: Findings behind a standalone CAIPE authorization service and its policy-provider model.
---

# Research: CAIPE Authorization Service and Expression Policies

- **Status:** Complete for specification
- **Date:** 2026-08-17

## Decision Summary

Extract authorization decisions from the BFF into the standalone CAIPE
Authorization Service (`caipe-authz`, or Authz Service) with HTTP, batch HTTP,
and Envoy `ext_authz` gRPC adapters over one decision core. Refactor the direct
OpenFGA bridge into its gRPC adapter.

Use a constrained CAIPE policy document that selects a reviewed template. Map
the template to a versioned native OpenFGA condition and store its constants on
a conditional relationship tuple. At call time, the Authz Service projects
selected MCP arguments into typed OpenFGA Check context.

Define a policy-provider contract, but implement only `openfga-cel` in v1.
Cedar and OPA remain disabled future providers. Provider composition, if added,
is restrictive and can never broaden OpenFGA access.

Do not evaluate raw expressions, generate a new authorization model for every
policy, or fork OpenFGA.

## Current Repository Findings

### Split decision architecture

- `ui/src/lib/authz/` contains the current authorization contract and an
  in-process OpenFGA decision engine.
- `ui/src/app/api/authz/v1/decisions/` exposes the BFF-hosted decision API.
- Dynamic Agents already call that HTTP API as a thin enforcement point.
- AgentGateway calls `deploy/openfga/bridge/main.py` over `ext_authz`; the bridge
  evaluates OpenFGA directly instead of using the BFF-hosted decision core.
- The existing centralized-BFF proposal intentionally keeps BFF off the
  AgentGateway hot path, but that leaves two decision implementations.

The standalone service resolves both concerns: AgentGateway does not call BFF,
and BFF plus gateway traffic share one decision core.

### Runtime object type

- AgentGateway authorization checks `tool:<server>/<tool>`.
- `deploy/openfga/model.fga` defines `tool#caller` and
  `tool#can_call = caller or can_manage`.
- `mcp_tool` is intentionally separate and represents RAG custom MCP tools.
- A design that modifies only `mcp_tool` would not constrain AgentGateway's
  normal MCP tool-call path.

### Bridge behavior to migrate

- `deploy/openfga/bridge/main.py` parses MCP `tools/call` requests.
- It extracts the MCP target from the path and tool name from `params.name`.
- It ignores `params.arguments`.
- `_check_openfga` sends only `tuple_key` to `/check`.
- Agent exact and wildcard checks are available when signed agent context is
  configured.
- Direct caller-to-tool checking is behind
  `CAIPE_CALLER_TOOL_CHECK_ENABLED`, which defaults off in Compose and the bridge
  chart.
- Per-tool processing currently occurs inside the agent-context HMAC branch.

### TypeScript OpenFGA client

- `ui/src/lib/rbac/openfga.ts` represents tuple keys as only `user`, `relation`,
  and `object`.
- Check and BatchCheck requests provide no `context`.
- Tuple reads do not model the returned relationship condition.
- OpenFGA tuple identity is the `(user, relation, object)` triple; changing only
  the condition conflicts with the existing tuple and requires replacement.

### Tool schema catalog

- `ui/src/lib/rbac/mcp-tool-catalog.ts` stores server, tool, display metadata,
  and an input-schema hash.
- The sanitized schema itself is not retained.
- Probe routes already receive `inputSchema` from MCP `tools/list` and can feed
  an extended catalog.

### Existing policy UI

- Current team and service-account flows select tools and write unconditional
  exact or wildcard relationships.
- There is no field/operator/value policy editor.
- The OpenFGA workbench is suitable for inspection but should not become a raw
  CEL editor.

## OpenFGA Capability Findings

### Native conditions are sufficient for reviewed templates

[OpenFGA conditions](https://openfga.dev/docs/modeling/conditions) provide:

- CEL expressions defined in an immutable authorization model.
- Typed parameters including strings, integers, booleans, timestamps,
  `list<T>`, and `map<T>`.
- Conditional relationship tuples with persisted condition context.
- Request-time context on Check and ListObjects.
- A merge where persisted tuple values take precedence over request context.
- A configurable expression-evaluation cost limit.

This supports the required split:

```text
tuple context:   field, allowed values, expected schema hash
request context: typed argument maps, current schema hash, server time
```

Because persisted values win, the caller cannot replace policy constants by
supplying keys with the same names.

### OpenFGA does not evaluate an expression stored as data

The model can reference a named condition, but a tuple cannot carry arbitrary
CEL source and ask OpenFGA to execute it. A model entry such as
`user with $expression` is not standard OpenFGA syntax.

There is also no standard `/store/<id>/condition-schema` endpoint in the
[OpenFGA API](https://openfga.dev/api/service). Tool-schema validation belongs
in CAIPE's policy control plane.

### Contextual tuples are a different feature

[Contextual tuples](https://openfga.dev/docs/modeling/contextual-time-based-authorization)
temporarily add relationships to a Check. They are useful for request-scoped
relationships, but they do not evaluate tool arguments by themselves.

This feature needs condition context, not a contextual tuple, for values such
as `arguments.project_key`.

### Conditions remain allow-only

A conditional relationship is one possible allow path. Another unconditional
or computed path can still allow the request. Native conditions do not provide
a deny override.

This is the most important product constraint: a policy cannot be described as
exclusive until broader exact, wildcard, and computed paths are removed.

### Tuple updates are replacements

OpenFGA tuple uniqueness is based on `(user, relation, object)`. Writing the
same key with a different condition is a conflict. The control plane must:

1. Preserve the previous tuple.
2. Delete it.
3. Write and verify the replacement.
4. Restore the previous tuple on failure.

A brief fail-closed deny is preferable to a temporary broad allow.

### Models are immutable and versioned

Conditions live in authorization models. A template change requires a new model
and model ID. Safe activation requires:

- Versioned condition names.
- Retention of condition versions referenced by active tuples.
- One active model descriptor shared by writers and checkers.
- Explicit model IDs on Write and Check.
- Deployment ordering that upgrades model and Authz Service compatibility before
  writing a tuple that uses the new template.

## CAIPE Authorization Service Deployment Decision

### One logical service, multiple transports

Envoy `ext_authz` is a transport protocol, not a policy engine. The same Authz
Service can expose:

- HTTP for single application decisions.
- Batch HTTP for filtering and list views.
- Envoy v3 authorization gRPC for AgentGateway.

Every adapter must call one canonical function after transport-specific
authentication and parsing. One binary may serve both listeners. Production may
scale them separately to isolate gateway latency from application batch load.

Routing AgentGateway through BFF HTTP was rejected because it couples the MCP
data plane to the UI/BFF availability and latency envelope. Keeping the direct
bridge indefinitely was also rejected because it preserves duplicated mapping,
context, error, and audit semantics.

### BFF extraction

The extraction unit is the decision behavior, not merely the HTTP routes. The
Authz Service must receive:

- Subject binding and canonical resource/action mapping.
- Trusted-context rules.
- OpenFGA store/model selection and Check/BatchCheck behavior.
- Stable reasons, explanations, audit, timeouts, and cache rules.

The BFF retains session authentication, UI orchestration, and compatibility
routes. It becomes an Authz Service client and no longer serves as a PDP.

## Policy Provider Findings

### OpenFGA-native CEL

OpenFGA already evaluates typed CEL conditions as part of relationship graph
resolution. Therefore `openfga-cel` is one provider, not an OpenFGA provider
followed by a second Authz Service CEL evaluator. This gives v1 one PDP, one
context merge, and one policy revision.

### Cedar

Cedar provides `permit` and `forbid` policies, default deny, and forbid-overrides-
permit semantics. It is attractive for future explicit guardrails, but adding it
would introduce a second policy store, entity projection, schema lifecycle,
explanation model, and operational dependency.

### OPA

OPA can evaluate Rego over structured input and is suitable for broad contextual
or compliance guardrails. It also requires a defined bundle lifecycle, data
synchronization, output schema, decision logging, and evaluation limits.

### Provider composition

| Option | Result | Decision |
|---|---|---|
| OpenFGA-native CEL only | OpenFGA evaluates ReBAC and conditions together | Selected for v1 |
| Standalone CEL in Authz Service plus OpenFGA | Duplicate evaluators and context semantics | Rejected |
| Cedar or OPA instead of OpenFGA for selected bindings | Possible future provider migration | Deferred |
| OpenFGA plus required Cedar/OPA guardrail | `allow = OpenFGA AND all guardrails` | Deferred |
| OpenFGA OR another provider | A secondary engine can broaden access | Rejected |

Provider selection must come from a server-owned, versioned resource/action
binding. A public request must never select a provider or composition rule.
Timeout, malformed output, `INDETERMINATE`, or outage from a required provider
must fail closed.

## Options Considered

| Option | Benefits | Costs and risks | Decision |
|---|---|---|---|
| Reviewed native condition templates | One PDP, typed, bounded, testable | New template requires release | Selected |
| Standalone Authz Service with HTTP and gRPC adapters | One decision core, transport-specific SLOs | New service and migration | Selected |
| Route AgentGateway through BFF-hosted authorization | Reuses current HTTP API | BFF on data-plane hot path | Rejected |
| Keep BFF-hosted authorization and direct bridge | Lowest migration effort | Two decision implementations persist | Rejected target state |
| Raw CEL authored in UI | Flexible | Injection, hard review, unsafe cost, schema ambiguity | Rejected |
| Store `$expression` on tuple | Simple-looking data model | OpenFGA cannot execute it | Rejected |
| Generate model condition per policy | Native execution | Global model churn, growth, rollback complexity | Deferred |
| Evaluate CEL directly in Authz Service | Highly dynamic | Second PDP, semantic drift, new runtime dependency | Rejected |
| Cedar provider | Explicit forbid and rich attributes | Second policy/entity lifecycle | Future optional |
| OPA provider | Flexible Rego guardrails | Bundle/data/output lifecycle and second PDP | Future optional |
| Evaluate expression inside every MCP server | Strong local context | Duplicated policy and inconsistent UX | Defense in depth only |
| Fork OpenFGA for schema/expression APIs | Full control | Permanent upstream maintenance burden | Rejected |

## Expression Representation Decision

The public API uses a versioned template instance:

```json
{
  "version": "1",
  "template": "string_argument_in",
  "field": "/project_key",
  "values": ["PRIMARY", "SECONDARY"]
}
```

Reasons:

- JSON Pointer is unambiguous for nested MCP arguments.
- Literals remain data and can be canonicalized.
- Schema type determines available templates.
- A finite registry can be security reviewed and performance tested.
- The UI can render a human-readable expression without exposing source code.

Boolean composition is intentionally bounded. The first release supports a
small set of compound templates instead of a recursive user-authored AST.

## Trusted Context Decision

The Authz Service creates separate typed maps:

```text
string_arguments
integer_arguments
boolean_arguments
request_time
schema_hash
```

Reasons:

- Avoid `any` for the common path.
- Preserve OpenFGA parameter type validation.
- Avoid sending the full MCP argument object.
- Permit field-level privacy controls.
- Make wrong-type and missing-value behavior explicit.

The Authz Service projects only catalog-approved fields. It supplies empty typed maps
when no eligible values exist so unconditional graph paths can still evaluate
while conditional paths return false.

## Schema Validation Decision

Extend the existing MCP tool catalog rather than add an OpenFGA API.

The catalog will retain:

- A bounded sanitized input schema.
- Canonical schema hash.
- Policy-eligible field descriptors.
- Source, timestamps, and drift status.

Each policy stores the hash used at validation. Every argument condition also
compares the persisted expected hash with the current Authz Service-provided hash.
This makes drift fail closed immediately, even before a reconciler deletes or
marks the stale policy.

## Grant Semantics Decision

Use a separate `conditional_caller` relation and change target runtime semantics
to:

```text
can_call = caller OR conditional_caller
```

Do not inherit invocation from `can_manage`.

Reasons:

- Management and data-plane execution are different capabilities.
- Existing unconditional grants remain easy to inspect.
- Conditional tuples are distinguishable during read, reconcile, and audit.
- Migration can measure manager-derived invocation before changing behavior.

This does not create deny precedence. Known broader grants must be removed for
exclusive behavior.

## Control-Plane Persistence Decision

- OpenFGA is authoritative for effective access.
- MongoDB stores expression authoring, schema pin, revision, and reconciliation
  metadata.
- A metadata row without a verified OpenFGA tuple is not an active grant.
- The UI displays drift instead of inferring success from MongoDB.

This follows the repository pattern where domain configuration can be the
reconciliation intent while OpenFGA remains the authorization truth.

## Runtime Dependency Decision

The Authz Service caches policy-eligible field projections and current schema hashes
from an authenticated internal endpoint.

- Cached metadata is bounded and asynchronously refreshed.
- Missing trusted metadata yields empty context and an empty schema hash.
- Conditional checks therefore fail closed.
- Unconditional checks do not need the schema service.
- Policy revocation remains immediate through OpenFGA tuple deletion.

## Privacy Decision

- Never project declared secrets, credentials, passwords, tokens, binaries, or
  unrestricted free text.
- Never record argument values in audit, traces, metrics, or errors.
- Record only field names, scalar types, template ID, schema hash, expression
  hash, and decision.
- Keep tuple and Check contexts well below OpenFGA request limits.

## Enforcement Preconditions

Expression enforcement is not safe when the current default-off paths remain.
Production readiness therefore requires:

- AgentGateway forwards the complete bounded request body to ext_authz.
- Caller-to-tool checking is mandatory.
- Caller checking is outside the branch that controls the separate agent check.
- Agent-context HMAC signing is configured and required for dynamic-agent calls.
- The Authz Service and policy writer use the same explicit model descriptor.
- Exact and wildcard results are audited separately.

## Resolved Questions

| Question | Resolution |
|---|---|
| Is the Authz Service the same for applications and AgentGateway? | Yes; HTTP and `ext_authz` gRPC call one standalone decision core. |
| Does AgentGateway call the BFF? | No; it calls the `caipe-authz` gRPC listener. |
| What is the v1 provider? | `openfga-cel`; OpenFGA evaluates relationships and native CEL conditions. |
| Are Cedar and OPA implemented in v1? | No; the contract permits future adapters, but they remain disabled. |
| Can a caller select a provider? | No; a trusted versioned resource/action binding selects it. |
| How would multiple providers compose? | Restrictive `AND`; any required deny, error, or indeterminate result denies. |
| Where are expressions evaluated? | OpenFGA only. |
| Can administrators write CEL? | No. |
| Which resource type is enforced? | Exact runtime `tool`. |
| Where is tool schema validated? | CAIPE policy control plane and schema catalog. |
| Can a condition override a wildcard? | No; remove the broader grant. |
| How are schema changes handled? | Hash comparison plus stale-policy reconciliation. |
| How are policy edits made safe? | Optimistic concurrency, tuple replacement, compensation, read-back verification. |
| How are conditions versioned? | Immutable condition names plus active model descriptor. |
| Are tool arguments logged? | No values; names and types only. |
| Are bulk tools included initially? | No. |

No research item remains in `NEEDS CLARIFICATION` state.

## References

- [OpenFGA conditions](https://openfga.dev/docs/modeling/conditions)
- [OpenFGA MCP authorization](https://openfga.dev/docs/modeling/agents/mcp-authorization)
- [OpenFGA Check](https://openfga.dev/docs/getting-started/perform-check)
- [OpenFGA contextual authorization](https://openfga.dev/docs/modeling/contextual-time-based-authorization)
- [Envoy external authorization](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_authz_filter.html)
- [Cedar authorization](https://docs.cedarpolicy.com/auth/authorization.html)
- [OPA policy language](https://www.openpolicyagent.org/docs/policy-language)
- [Architecture](./architecture.md)
- [Specification](./spec.md)
- [Implementation plan](./plan.md)
