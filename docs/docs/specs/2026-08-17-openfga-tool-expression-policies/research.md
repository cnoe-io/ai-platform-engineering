---
sidebar_label: Research
title: OpenFGA Tool Expression Policies - Research
description: Findings and decisions behind CAIPE argument-aware MCP tool authorization.
---

# Research: OpenFGA Tool Expression Policies

- **Status:** Complete for specification
- **Date:** 2026-08-17

## Decision Summary

Use a constrained CAIPE policy document that selects a reviewed template. Map
the template to a versioned native OpenFGA condition and store its constants on
a conditional relationship tuple. At call time, the bridge projects selected
MCP arguments into typed OpenFGA Check context.

Do not evaluate raw expressions, generate a new authorization model for every
policy, or fork OpenFGA.

## Current Repository Findings

### Runtime object type

- AgentGateway authorization checks `tool:<server>/<tool>`.
- `deploy/openfga/model.fga` defines `tool#caller` and
  `tool#can_call = caller or can_manage`.
- `mcp_tool` is intentionally separate and represents RAG custom MCP tools.
- A design that modifies only `mcp_tool` would not constrain AgentGateway's
  normal MCP tool-call path.

### Bridge behavior

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
- Deployment ordering that upgrades model and bridge compatibility before
  writing a tuple that uses the new template.

## Options Considered

| Option | Benefits | Costs and risks | Decision |
|---|---|---|---|
| Reviewed native condition templates | One PDP, typed, bounded, testable | New template requires release | Selected |
| Raw CEL authored in UI | Flexible | Injection, hard review, unsafe cost, schema ambiguity | Rejected |
| Store `$expression` on tuple | Simple-looking data model | OpenFGA cannot execute it | Rejected |
| Generate model condition per policy | Native execution | Global model churn, growth, rollback complexity | Deferred |
| Evaluate CEL in Python bridge | Highly dynamic | Second PDP, semantic drift, new runtime dependency | Rejected |
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

The bridge creates separate typed maps:

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

The bridge projects only catalog-approved fields. It supplies empty typed maps
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
compares the persisted expected hash with the current bridge-provided hash.
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

The bridge caches policy-eligible field projections and current schema hashes
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
- The bridge and policy writer use the same explicit model descriptor.
- Exact and wildcard results are audited separately.

## Resolved Questions

| Question | Resolution |
|---|---|
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
- [Architecture](./architecture.md)
- [Specification](./spec.md)
- [Implementation plan](./plan.md)
