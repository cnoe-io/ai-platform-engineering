# Spec: Centralized Authorization Service (CAS) — BFF-resident, PDP-agnostic

**Status:** Draft for review
**Date:** 2026-06-06
**Owner:** Sri Aradhyula
**Context:** [`problem-statement.md`](../2026-06-05-centralized-bff-authz-pdp-agnostic/problem-statement.md) · [`solution-architecture.md`](../2026-06-05-centralized-bff-authz-pdp-agnostic/solution-architecture.md)
**Tracking:** epic [#1742]; prerequisite [#1455]; security driver [#1730]

> This spec covers **only what gets built new**: `ui/src/lib/authz/` and `POST /api/authz/v1/*`. It is additive — no existing file is modified, no existing PEP is re-wired.

---

## 1. Summary

Introduce one **Authorization Decision Core** in the BFF (`ui/src/lib/authz/`) and expose it via a versioned HTTP API (`/api/authz/v1`). The service lands **standalone**: existing authz paths (DA `openfga_authz.py`, RAG `rbac.py`, BFF `resource-authz.ts`) keep running unchanged. Migration of those surfaces to consume CAS is a separate, incremental effort.

**Principle:** *One decision core. One PDP-agnostic contract. Zero changes to existing code.*

---

## 2. Goals / Non-goals

### Goals

- **G1** Single decision module: one place computes "may subject S do action A on resource R."
- **G2** PDP-agnostic contract: callers see `{subject, resource, action} → {decision, reason}`; OpenFGA internals are invisible except in the admin explain endpoint.
- **G3** HA OpenFGA adapter: warm store-id, pooled client, decision cache, circuit breaker.
- **G4** HTTP API for out-of-process callers: `POST /api/authz/v1/decisions`, `:batch`, `explain`.
- **G5** Verified caller token at every call: CAS validates JWT via JWKS; subject-binding enforced.
- **G6** Additive only: nothing existing is modified. Existing authz paths are untouched.

### Non-goals

- Migrating DA, RAG, bots, or the gateway bridge to consume CAS.
- Modifying `openfga_authz.py`, `rbac.py`, `resource-authz.ts`, or any existing authz file.
- Replacing OpenFGA as the relationship store.
- Routing `openfga-authz-bridge` through CAS (rejected — §7).
- Decision tokens / Transport C (future P5, gated on [#1458]).

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **CAS** | Centralized Authorization Service — the decision core + HTTP API. |
| **PDP** | Policy Decision Point — computes allow/deny. Here: core + OpenFGA adapter. |
| **PEP** | Policy Enforcement Point — calls PDP and enforces. CAS is a PDP; existing code has its own PEPs. |
| **Core** | `ui/src/lib/authz/` — the new module being built. |
| **Subject-binding** | A user caller may only evaluate `subject == token.sub`. |

---

## 4. Module — `ui/src/lib/authz/`

```text
ui/src/lib/authz/
  index.ts            # authorize(), authorizeMany(), authorizeOrThrow(), filterAccessible()
  contract.ts         # Subject, Resource, Action, Decision, ReasonCode
  reasons.ts          # ReasonCode → { retriable, userActionHint, httpStatusHint }
  engine.ts           # PolicyEngine interface
  compose.ts          # product policy layered over the PDP adapter
  engines/
    openfga.ts        # the only OpenFGA adapter: action→relation map, warm store-id, pooled client, cache
  domains/
    workflow.ts       # workflowDelegatesAgentUse, run-visibility
    slack-channel.ts
    webex-space.ts
  cache.ts            # bounded per-replica LRU, TTL-aware
  audit.ts            # one decision → one structured audit event
```

### 4.1 Public API (`index.ts`)

```ts
// Returns Decision; never throws for DENY
authorize(req: AuthorizeRequest): Promise<Decision>

// Batch: BatchCheck internally; returns one Decision per id
authorizeMany(
  subject: Subject,
  action: Action,
  resourceType: ResourceType,
  ids: string[]
): Promise<Map<string, Decision>>

// Guard variant: throws ApiError(403) on DENY, ApiError(503) on AUTHZ_UNAVAILABLE
authorizeOrThrow(req: AuthorizeRequest): Promise<void>

// List filter: returns only ids accessible to the subject
filterAccessible(
  subject: Subject,
  action: Action,
  resourceType: ResourceType,
  ids: string[]
): Promise<string[]>
```

### 4.2 PolicyEngine interface (`engine.ts`)

```ts
interface PolicyEngine {
  check(req: AuthorizeRequest): Promise<Decision>;
  batchCheck(
    subject: Subject,
    action: Action,
    resourceType: ResourceType,
    ids: string[]
  ): Promise<Map<string, Decision>>;
}
```

`compose.ts` wraps a `PolicyEngine` with product policy (workflow delegation, channel scoping) and returns a `PolicyEngine`. All product rules live here; the OpenFGA adapter has no product knowledge.

### 4.3 OpenFGA adapter (`engines/openfga.ts`)

| Concern | Design |
|---------|--------|
| Store id | resolved once at boot; cached in module scope; refreshed on 404 |
| HTTP client | one pooled keep-alive client; no per-call instantiation |
| HA | retries idempotent `check` ≤2×, 100ms between; upstream service-level replication |
| Decision cache | bounded LRU; TTL ≤15s read-class, ≤2s write-class |
| Batch | `BatchCheck` for ≤50 ids; bounded parallel for overflow |
| Circuit breaker | open ⇒ fail closed (`AUTHZ_UNAVAILABLE`); half-open probe every 30s |
| Consistency | `HIGHER_CONSISTENCY` for write-class checks; standard otherwise |
| Action→relation map | `use → can_use`, `call → can_call`, `manage → admin`, etc. — internal to adapter only |

---

## 5. Contract

### 5.1 Types

```ts
type SubjectType  = "user" | "service_account";

type ResourceType =
  | "agent" | "skill" | "mcp_tool" | "knowledge_base"
  | "data_source" | "task" | "slack_channel" | "webex_space";

type Action =
  | "discover" | "read" | "read-metadata" | "use"
  | "write" | "manage" | "share" | "delete"
  | "ingest" | "call" | "invoke" | "audit";

interface AuthorizeRequest {
  subject:  { type: SubjectType; id: string };
  resource: { type: ResourceType; id: string };
  action:   Action;
  context?: Record<string, unknown>; // may only NARROW a grant, never expand
}

type ReasonCode =
  | "OK"                  // ALLOW
  | "NO_CAPABILITY"       // DENY — no relationship        → contact_admin
  | "NOT_AUTHENTICATED"   // caller token missing/invalid  → sign_in
  | "AUTHZ_UNAVAILABLE"   // PDP error (retriable)          → retry
  | "INVALID_REQUEST";    // bad id / malformed             → fix_request

interface Decision {
  decision:    "ALLOW" | "DENY";
  reason:      ReasonCode;
  retriable:   boolean;
  ttl_seconds?: number;
}
```

OpenFGA relation strings (`can_use`, `can_call`, etc.) are **internal to `engines/openfga.ts`**. They do not appear in `Decision`, error bodies, or any API response except the admin `/explain` endpoint.

### 5.2 HTTP API

**Single decision**

```http
POST /api/authz/v1/decisions
Authorization: Bearer <caller-token>
Content-Type: application/json

{
  "subject":  { "type": "user", "id": "<sub>" },
  "resource": { "type": "agent", "id": "platform-engineer" },
  "action":   "use"
}

200  { "decision": "ALLOW", "reason": "OK",            "retriable": false, "ttl_seconds": 15 }
200  { "decision": "DENY",  "reason": "NO_CAPABILITY", "retriable": false }
```

**Batch**

```http
POST /api/authz/v1/decisions:batch
Authorization: Bearer <caller-token>

{
  "subject":       { "type": "user", "id": "<sub>" },
  "action":        "discover",
  "resource_type": "agent",
  "ids":           ["a", "b", "c"]
}

200 {
  "results": [
    { "id": "a", "decision": "ALLOW", "reason": "OK" },
    { "id": "b", "decision": "DENY",  "reason": "NO_CAPABILITY" }
  ]
}
```

**Admin explain** (only endpoint where OpenFGA detail appears)

```http
POST /api/authz/v1/explain
Authorization: Bearer <caller-token>   # requires can_audit scope

200 {
  "decision": "DENY",
  "reason":   "NO_CAPABILITY",
  "debug": {
    "engine":   "openfga",
    "relation": "can_use",
    "checked":  ["user:<sub> can_use agent:platform-engineer"],
    "store":    "<store-id>"
  }
}
```

### 5.3 HTTP status semantics

> **A DENY is not an error.** Evaluation succeeded; the answer is "no" ⇒ `200` with body. HTTP status codes are reserved for meta-failures only.

| Status | Meaning |
|--------|---------|
| `200` | evaluation succeeded (`ALLOW` or `DENY` in body) |
| `401` | caller token missing or invalid (`NOT_AUTHENTICATED`) |
| `403` | subject-binding violation — caller may not evaluate this subject |
| `400` | malformed request (`INVALID_REQUEST`) |
| `503` | PDP unavailable (`AUTHZ_UNAVAILABLE`, `retriable: true`) |

PEPs translate `decision: "DENY"` into their own 403 responses. Deny-reasoning stays in the body, not in status codes.

### 5.4 Error envelope

```json
{
  "error":     "human-readable message safe to surface",
  "code":      "REASON_CODE",
  "retriable": false
}
```

No OpenFGA strings (`agent#use`, `pdp_denied`, tuple strings) appear in error envelopes. These are adapter-internal and surface only in `/explain`.

---

## 6. Security model

CAS is a trust boundary. It assumes callers may be hostile.

| # | Threat | Control |
|---|--------|---------|
| 1 | **Forged subject** | A `user` caller may only evaluate `subject.id == token.sub`. Cross-subject requires `can_audit` scope. Mismatch ⇒ `403`. |
| 2 | **Service account impersonation** | `service_account` callers must present a verified client-credentials token and hold a `can_impersonate` tuple. No trusted `delegated_subject` body field. |
| 3 | **Unsigned/forgeable identity** ([#1730]) | CAS validates JWT signature / `exp` / `aud` / `iss` via cached JWKS on every request. Header/body subject is only the *target*; binding is then checked per #1 and #2. |
| 4 | **PDP outage → silent allow** | Fail closed: open circuit ⇒ `DENY` + `AUTHZ_UNAVAILABLE` + `retriable: true` + `503` + audit event. Break-glass is explicit env flag, time-boxed, and audited per request. |
| 5 | **Cache stale-allow** | TTL ≤15s read-class, ≤2s write-class; revocation tolerated within TTL (documented bound). |
| 6 | **`context` expansion** | `context` may only *narrow* a grant. Server-evaluated delegation (workflow run-authorizer) lives inside `compose.ts`, not in caller-supplied context. |
| 7 | **Enumeration / info leak** | Coarse `ReasonCode` only in public responses; no tuple strings outside `/explain`; per-caller rate limit; every decision audited with `correlation_id`. |
| 8 | **New write surface** | v1 API is **evaluate only**. No tuple writes. Standing up CAS grants no new mutation capability. |

---

## 7. The `openfga-authz-bridge` — not in scope

The existing `openfga-authz-bridge` is the data-plane PEP for MCP routing. AgentGateway fires a per-route `ext_authz` gRPC Check at a 200ms timeout. Routing those decisions through the BFF would put the BFF in the hot path of every MCP tool call. Rejected.

The bridge is not touched by this spec. Aligning its vocabulary, adapter semantics, and audit schema to match the contract defined here is a separate, incremental step.

---

## 8. Audit

CAS writes one event per decision to `audit_events`.

```json
{
  "audit_event_id": "<uuid>",
  "ts":             "<iso8601>",
  "type":           "cas_decision",
  "tenant_id":      "<tenant>",
  "subject_hash":   "sha256:<salted-hash>",
  "resource_type":  "agent",
  "resource_id":    "<id>",
  "action":         "use",
  "decision":       "ALLOW",
  "reason_code":    "OK",
  "pdp":            "openfga",
  "source":         "cas",
  "correlation_id": "<uuid>",
  "trace_id":       "<otel-trace-id>",
  "span_id":        "<otel-span-id>"
}
```

**Metrics**

| Metric | Labels |
|--------|--------|
| `authz_decision_total` | `resource_type, action, decision, reason` |
| `authz_pdp_latency_ms` | `resource_type, action, cache_hit` |
| `authz_cache_hit_ratio` | `resource_type` |
| `authz_circuit_state`  | `state: closed\|open\|half_open` |

---

## 9. Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `OPENFGA_HTTP` | — | OpenFGA HTTP base URL (required) |
| `OPENFGA_STORE_ID` | — | Explicit store id; skips store-list lookup when set |
| `OPENFGA_STORE_NAME` | `caipe-openfga` | Store name for lookup when id is unset |
| `AUTHZ_DECISION_CACHE_TTL_MS` | `15000` | Read-class cache TTL |
| `AUTHZ_DECISION_CACHE_WRITE_TTL_MS` | `2000` | Write-class cache TTL |
| `AUTHZ_BREAK_GLASS` | unset | Fail-open for non-prod emergencies; alarmed + audited per request |
| `AUDIT_SUBJECT_SALT` | — | Salt for subject hash in audit events (required) |
| `AUTHZ_TRACING_ENABLED` | `false` | OTLP span export for decision calls |

---

## 10. Tasks

All new files. No existing file is modified.

**Core**

1. `contract.ts` — types: `Subject`, `Resource`, `Action`, `Decision`, `ReasonCode`.
2. `reasons.ts` — `ReasonCode → { retriable, userActionHint, httpStatusHint }`.
3. `engine.ts` — `PolicyEngine` interface (`check`, `batchCheck`).
4. `engines/openfga.ts` — adapter: warm store-id, pooled client, action→relation map, cache, circuit breaker.
5. `cache.ts` — bounded LRU; read/write TTL split.
6. `audit.ts` — structured decision event writer (§8 shape).
7. `compose.ts` + `domains/workflow.ts` — product policy layer; workflow delegation.
8. `index.ts` — `authorize`, `authorizeMany`, `authorizeOrThrow`, `filterAccessible`.

**HTTP routes**

9. `POST /api/authz/v1/decisions` — JWKS verification, subject-binding, single decision.
10. `POST /api/authz/v1/decisions:batch` — subject-binding, batch result.
11. `POST /api/authz/v1/explain` — `can_audit` guard; OpenFGA debug block.
12. Shared `v1ErrorResponse` builder — no OpenFGA strings in public envelopes.
13. OpenAPI schema for `/api/authz/v1`.

**Guards**

14. ESLint `no-restricted-imports`: `engines/openfga` and `lib/rbac/openfga` are import errors outside `lib/authz/**`.

**Tests**

15. Unit: decision matrix (direct, team-union, deny, PDP error, invalid id); subject-binding accept/reject; cache TTL + write-class bypass; circuit breaker open/close.
16. Contract: request/response schema; `200-DENY` vs `401/403/400/503`; no OpenFGA strings outside `explain`.
17. Security regression: forged-subject `403`; unsigned token rejected ([#1730]); PDP-down ⇒ `DENY/503`; break-glass audited.

---

## 11. Acceptance criteria

- [ ] `ui/src/lib/authz/` exists with all modules in §4; `engines/openfga` imports restricted by lint rule.
- [ ] `POST /api/authz/v1/decisions` (+ `:batch`, `explain`) live; caller JWT verified via JWKS; subject-binding enforced.
- [ ] `DENY` returns `200` with `ReasonCode`; meta-failures return correct status codes (§5.3).
- [ ] No `agent#use`, `pdp_denied`, or FGA tuple strings in any non-`explain` response.
- [ ] Adapter: store-id cached at boot; pooled client; circuit breaker; read/write TTL split.
- [ ] Every decision produces one audit event with the shape in §8.
- [ ] OpenAPI schema published; contract tests green.
- [ ] No existing file was modified; no existing test was broken.

---

<!-- assisted-by claude code claude-sonnet-4-6 -->
