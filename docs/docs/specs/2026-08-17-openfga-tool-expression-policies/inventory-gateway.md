---
sidebar_label: Gateway Inventory
title: Current AgentGateway Authorization Inventory
description: Frozen ext_authz behavior used for caipe-authz migration comparisons.
---

# Current AgentGateway Authorization Inventory

## Ordered checks

| Order | Subject | Relation and object | Applicability |
|---|---|---|---|
| 1 | caller | `can_call mcp_gateway:list` | Every request |
| 2 | caller | `can_invoke mcp_server:<target>` | Configured restricted servers |
| 3 | caller | Valid signed agent context | Tool calls when HMAC is configured |
| 4 | caller | `can_use agent:<id>` | Dynamic agent calls |
| 5 | agent | Exact then `can_call tool:<server>/*` | Dynamic agent tool calls |
| 6 | caller | Exact then `can_call tool:<server>/*` | Caller-tool rollout enabled |

An exact tool check may satisfy either an unconditional relationship or
`conditional_caller` using server-constructed schema and typed argument maps.
Wildcard checks never receive expression context.

## Identity, parsing, and failure behavior

- The verified subject comes from Envoy metadata; the gateway-consumed bearer
  token is only a fallback for direct diagnostics.
- `preferred_username=service-account-*` selects the `service_account` namespace.
- MCP bodies are duplicate-key-safe, UTF-8 JSON with a 64 KiB body ceiling and
  a 16 KiB projected-context ceiling.
- JSON scalar leaves use RFC 6901 pointers and preserve string/integer/boolean
  types. Arrays, floats, and null are excluded.
- Missing identity returns gRPC `UNAUTHENTICATED`; authorization denial returns
  `PERMISSION_DENIED`; OpenFGA dependency failure returns `UNAVAILABLE`.
- The bridge emits one final decision audit event. The Authz replacement must
  preserve that cardinality across exact/wildcard fallback.

## Deployment controls

| Variable | Purpose | Current safe default |
|---|---|---|
| `CAIPE_CALLER_TOOL_CHECK_ENABLED` | Caller-keyed exact/wildcard checks | Off |
| `CAIPE_RESTRICTED_MCP_SERVERS` | Server-level invoke checks | Empty |
| `CAIPE_AGENT_CONTEXT_HMAC_SECRET` | Trusted agent delegation | Unset |
| `CAIPE_TOOL_SCHEMA_HASHES_JSON` | Expression schema pinning | Empty |
| `OPENFGA_AUTHORIZATION_MODEL_ID` | Deterministic model evaluation | Unset |

The migration bridge remains authoritative in `LEGACY` and `SHADOW`; it becomes
a router in `CANARY` and `AUTHZ`, then is removed only after `AUTHZ_ONLY`
retention succeeds.
