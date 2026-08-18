---
sidebar_label: API Contracts
title: CAIPE Authorization Service - HTTP and gRPC Contracts
description: Normative application, gateway, administration, and migration boundaries.
---

# HTTP and gRPC Contracts

## Contract Rules

- All transports normalize to the same canonical request and result.
- Authenticated transport context binds the subject; a body cannot override it.
- Public requests cannot set provider, migration mode, cohort, authority, model
  descriptor, or server time.
- Unknown fields are rejected for security-sensitive request objects.
- Dependency timeout, malformed output, or indeterminate provider result denies.
- Argument values and credentials never appear in responses, diagnostics, or
  audit events.

## POST /v1/decisions

Application decision endpoint for BFF, Dynamic Agents, RAG, bots, and services.

~~~json
{
  "action": "invoke",
  "resource": {
    "type": "tool",
    "id": "issue_tracker/create_item"
  },
  "context": {
    "request": {
      "arguments": {
        "project_key": "PRIMARY"
      }
    }
  }
}
~~~

Successful response:

~~~json
{
  "decision_id": "example-decision-id",
  "allowed": true,
  "reason_code": "ALLOW_RELATIONSHIP",
  "provider": "openfga-cel",
  "authorization_model_id": "example-model-id",
  "policy_binding_revision": "7"
}
~~~

The server may omit optional revisions. It must not return provider internals or
raw expression source.

### Status mapping

| Condition | HTTP |
|---|---|
| Valid allow or deny | 200 with allowed |
| Invalid canonical request | 400 |
| Missing/invalid caller authentication | 401 |
| Caller not permitted to use decision API | 403 |
| Unsupported contract version | 409 |
| Authz dependency unavailable | 503, fail-closed decision reason in trusted compatibility facades |

Compatibility facades may preserve an existing status contract, but they must
preserve the canonical decision semantics and reason mapping.

## POST /v1/decisions:batch

~~~json
{
  "items": [
    {
      "item_id": "item-1",
      "action": "view",
      "resource": {"type": "example", "id": "primary"}
    }
  ]
}
~~~

~~~json
{
  "items": [
    {
      "item_id": "item-1",
      "decision_id": "example-decision-id",
      "allowed": false,
      "reason_code": "DENY_NO_RELATIONSHIP"
    }
  ]
}
~~~

- Limits apply to item count, aggregate input, concurrency, and response size.
- Each item has one canonical result and one authoritative decision event.
- Invalid items do not broaden or cancel other items unless the entire envelope
  is invalid.

## Envoy ext_authz v3 gRPC

AgentGateway calls:

~~~text
envoy.service.auth.v3.Authorization.Check(CheckRequest) -> CheckResponse
~~~

The adapter:

1. Binds verified JWT/workload identity.
2. Verifies signed agent context when present.
3. Parses bounded, duplicate-key-safe MCP JSON.
4. Maps gateway, agent-use, server, and exact-tool gates.
5. Projects only policy-eligible arguments.
6. Calls the canonical decision core.
7. Returns one Envoy allow/deny response.

Missing body, truncation, malformed JSON, invalid agent context, required
context absence, provider error, or timeout follows the stable fail-closed reason
contract. AgentGateway never calls the BFF on this hot path.

## Migration Contract

Migration routing is not a public API.

- BFF and the current gateway bridge load a trusted, versioned rollout config.
- Shadow calls carry a service-authenticated internal evaluation role that is
  injected by the router and stripped/rejected from untrusted traffic.
- An implementation may use a separate internal listener or
  POST /v1/internal/shadow-decisions; either way, only allowlisted workload
  identity can access it.
- The shadow response is never returned directly to the protected caller.
- The router, not Authz, chooses the authoritative result until direct cutover.

The internal shadow endpoint uses the decision request/result schemas above and
adds only:

~~~json
{
  "rollout_revision": "authz-rollout-001",
  "comparison_decision_id": "example-decision-id"
}
~~~

These fields correlate evaluation; they cannot change policy/provider selection.

## Policy Administration

Illustrative versioned operations:

~~~http
GET    /v1/admin/schemas/{resource_type}/{resource_id}
GET    /v1/admin/policies?resource_type=tool&resource_id=...
PUT    /v1/admin/policies/{policy_id}
DELETE /v1/admin/policies/{policy_id}
POST   /v1/admin/policies:validate
POST   /v1/admin/policies:explain
~~~

- The server accepts typed template documents, never CEL/Cedar/Rego source.
- Mutations require authority over the resource and target subject.
- If-Match or an equivalent optimistic version is required for updates.
- Mutation success requires verified OpenFGA state plus durable audit intent.

## Inspection

~~~http
GET  /v1/admin/model
GET  /v1/admin/graph
GET  /v1/admin/relationships
GET  /v1/admin/policies/{resource_type}/{resource_id}
POST /v1/admin/check
POST /v1/admin/simulate
~~~

All inspection endpoints are privileged, paginated, bounded, redacted, and
audited. Responses declare truncated true and a continuation token when a
complete projection cannot be returned. Simulation is read-only and cannot
invoke a protected resource.

## Compatibility and Versioning

- /v1 additions are backward-compatible.
- A breaking canonical contract requires /v2 and a dual-version migration.
- Legacy BFF endpoints remain compatibility facades until their callers reach
  AUTHZ_ONLY.
- A model/template version is never removed while an active tuple references it.
