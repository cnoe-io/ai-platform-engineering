# Spec: Centralized Authorization Service (CAS) — BFF-resident, PDP-agnostic

**Status:** Draft for review
**Date:** 2026-06-05
**Owner:** Sri Aradhyula
**Companions:** [`problem-statement.md`](./problem-statement.md) (why) · [`solution-architecture.md`](./solution-architecture.md) (critique + design rationale)
**Tracking:** epic [#1742]; prerequisite [#1455]; security driver [#1730]; dual-gate ADR [#1458]

> This is the implementation spec. It is self-contained: the architecture doc holds the critique and trade-off rationale; this doc holds **what to build, in what order, and how we prove it's safe**.

---

## 1. Summary

Introduce one **Authorization Decision Core** in the BFF (`ui/src/lib/authz/`) and expose it through **four transports** that all share one PDP-agnostic contract. Collapse today's **three OpenFGA reimplementations** (`openfga.ts`, DA `openfga_authz.py`, RAG `rbac.py`), the **fourth at the gateway** (`openfga-authz-bridge`), the **two duplicate BFF agent-use algorithms**, and the **three error envelopes** into that one core. Ship it **standalone** (touching nothing), then migrate each Policy Enforcement Point (PEP) under **shadow mode** with measured decision parity before any flip.

**Principle:** *One decision core. Four transports. One optional claim. Shadow-first migration.*

---

## 2. Goals / Non-goals

### Goals
- **G1** Single decision authority: exactly one module computes "may subject S do action A on resource R."
- **G2** PDP-agnostic public contract: callers send/receive `{subject, resource, action} → {decision, reason}`; OpenFGA relation names/tuples never cross the boundary except in the admin explain tier.
- **G3** No policy MongoDB in Dynamic Agents (drop `workflow_execution_authz.py`, the `workflow_config_id` bypass, and DA-side authz audit writes).
- **G4** Common HTTP AuthZ API for all out-of-process callers (DA, RAG, bots) = the [#1455] runtime endpoints.
- **G5** HA OpenFGA behind one pooled adapter (warm store-id, decision cache, batch, circuit breaker).
- **G6** Build standalone; migrate slowly via shadow mode without touching existing enforcement until each surface flips.
- **G7** Security: verify every token at the boundary; bind decisions to who may ask; fail closed; audited break-glass — closes [#1730].

### Non-goals
- Replacing OpenFGA as the relationship store.
- Moving the gateway `ext_authz` decision into the BFF (rejected — §7).
- Migrating skills to an owner-team model (#1708) or the #1755 UI-DRY hook (independent).
- Rewriting the AgentGateway routing/credential-injection logic (only its OpenFGA contract converges).

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **CAS** | Centralized Authorization Service — the decision core + its transports. BFF-resident. |
| **PDP** | Policy Decision Point — computes allow/deny. Here: the core + OpenFGA adapter. |
| **PEP** | Policy Enforcement Point — calls the PDP and enforces. There are 4 (§4.1). |
| **Core** | `ui/src/lib/authz/` — the one reusable decision module. |
| **Bridge / "OpenFGA Proxy"** | `openfga-authz-bridge` — Envoy `ext_authz` PDP adapter for the AgentGateway MCP data plane. |
| **Decision token** | Short-lived, audience-bound signed claim minted by CAS so a downstream PEP can verify offline. |
| **Shadow mode** | A PEP consults CAS observe-only while legacy stays authoritative; decisions compared for parity. |

---

## 4. Architecture

### 4.1 Component overview

```text
                          ┌───────────────────────────────────────────────┐
                          │   Authorization Decision Core  (lib/authz)      │
                          │   contract · reasons · compose(domain) ·        │
                          │   ONE OpenFGA adapter · cache · audit           │
                          └───┬──────────┬───────────────┬──────────────┬───┘
        A: in-process call    │          │ B: HTTP        │ C: token mint│ D: adapter contract
        ┌─────────────────────┘          │                │              └──────────────┐
        ▼                                 ▼                ▼                              ▼
  BFF route handlers          POST /api/authz/v1/...   decision tokens          openfga-authz-bridge
  (PEP #1, no hop)            (PEP #2/#3/#4 consume)    (attached by engine)     (PEP #4, data plane)
                                   ▲      ▲      ▲                                      ▲
                          Dynamic Agents  RAG   Slack/Webex bots             AgentGateway ext_authz
                          (PEP #2)      (PEP #3) (bots)                       (per-MCP-call enforce)
```

**Four PEPs, one contract, one adapter:**

| PEP | Layer | Transport | Today | Target |
|-----|-------|-----------|-------|--------|
| #1 BFF routes | app (in-proc) | A | `resource-authz.ts` + 2 agent-use algos | call `authorize()` |
| #2 Dynamic Agents | app (HTTP) | B (+C) | own OpenFGA client + Mongo | thin PEP → CAS; no OpenFGA/Mongo |
| #3 RAG server | app (HTTP) | B | `rbac.py` (roles+OpenFGA+Mongo) | thin PEP → CAS; coarse role = local pre-filter |
| #4 AgentGateway bridge | data plane | D | bespoke OpenFGA Check + Mongo audit | shared adapter contract + audit schema |

### 4.2 The decision core — `ui/src/lib/authz/`

```text
ui/src/lib/authz/
  index.ts        # authorize(), authorizeMany(), authorizeOrThrow(), filterAccessible()
  contract.ts     # Subject, Resource, Action, Decision, ReasonCode  (public vocabulary)
  reasons.ts      # reason codes → {retriable, userActionHint, httpHint}
  engine.ts       # PolicyEngine interface
  compose.ts      # product policy layered OVER the PDP (workflow visibility, channel scope)
  engines/
    openfga.ts    # the ONLY OpenFGA adapter (wraps lib/rbac/openfga transport; action→relation map)
  domains/
    workflow.ts   # workflowDelegatesAgentUse, run visibility
    slack-channel.ts · webex-space.ts
  cache.ts        # short-TTL decision cache
  audit.ts        # one decision → one audit event (CAS owns the write)
```

- Folds `requireAgentUsePermission` **and** `evaluateAgentAccess` into one direct+team-union implementation.
- `resource-authz.ts`'s action→relation map (`use → can_use`) moves into `engines/openfga.ts`. The `action` vocabulary is already PDP-agnostic; only relation strings are FGA-specific.
- `compose.ts` is the home product policy never should have left (kills DA's Mongo visibility duplication).

### 4.3 Transports

- **A — in-process** (PEP #1): `authorize()/authorizeOrThrow()/filterAccessible()`. No network hop. Existing `require*Permission` become thin wrappers.
- **B — HTTP** (PEP #2/#3/bots): `POST /api/authz/v1/decisions` (+ `:batch`, `explain`). The [#1455] runtime API. §5.
- **C — decision tokens** (optional, P5): short-lived audience-bound signed claims; PEP verifies offline → removes the duplicate hop for workflow step execution.
- **D — data-plane adapter** (PEP #4): the bridge conforms to the same contract + OpenFGA adapter semantics; keeps a direct OpenFGA path (no per-request BFF hop). §7.

### 4.4 PDP adapter, HA OpenFGA, caching

| Concern | Today (4× duplicated) | CAS |
|---------|------------------------|-----|
| Store id | re-resolved per call (DA, RAG, bridge) | resolved once at boot, cached, refresh-on-miss |
| HTTP client | new client per call | one pooled keep-alive client |
| HA | single OpenFGA assumed | replicated behind a Service; adapter retries idempotent `check` |
| Hot path | every check hits OpenFGA | decision cache ≤15s read / ≤2s write-class; per-replica bounded LRU |
| List filter | N sequential checks | `:batch` → `BatchCheck`/bounded-parallel |
| Outage | each PEP improvises | one circuit breaker; open ⇒ fail closed |
| Consistency | n/a | `HIGHER_CONSISTENCY` for write-class; TTL bounds staleness otherwise |

---

## 5. The contract

### 5.1 Vocabulary

```ts
type SubjectType  = "user" | "service_account";
type ResourceType = UniversalRebacResourceType;          // agent, skill, mcp_tool, knowledge_base, data_source, task, slack_channel, …
type Action       = "discover" | "read" | "read-metadata" | "use" | "write"
                  | "manage" | "share" | "delete" | "ingest" | "call" | "invoke" | "audit";

interface AuthorizeRequest {
  subject:  { type: SubjectType; id: string };
  resource: { type: ResourceType; id: string };
  action:   Action;
  context?: Record<string, unknown>;                     // advisory only; never EXPANDS a grant
}

type ReasonCode =
  | "OK"                 // ALLOW
  | "NO_CAPABILITY"      // DENY — no relationship       → contact_admin
  | "NOT_AUTHENTICATED"  // missing/invalid caller auth  → sign_in
  | "AUTHZ_UNAVAILABLE"  // PDP timeout/error (retriable) → retry
  | "INVALID_REQUEST";   // bad id / malformed           → fix_request

interface Decision { decision: "ALLOW" | "DENY"; reason: ReasonCode; retriable: boolean; ttl_seconds?: number; token?: string; }
```

This **extends** the existing `rebac-policy-api.md` draft (same `{subject, action, resource}` shape, same per-type action catalog) into two tiers: runtime/decision (new, agnostic) and admin/explain (drafted, FGA-visible).

### 5.2 HTTP API — `/api/authz/v1`

**Single decision**
```http
POST /api/authz/v1/decisions
Authorization: Bearer <caller-token>     # VERIFIED by CAS (JWKS); user or service_account
{ "subject": {"type":"user","id":"<sub>"}, "resource": {"type":"agent","id":"platform-engineer"}, "action":"use",
  "context": {"workflow_run_id":"wr-123"} }
→ 200 { "decision":"ALLOW", "reason":"OK", "retriable":false, "ttl_seconds":15 }
→ 200 { "decision":"DENY",  "reason":"NO_CAPABILITY", "retriable":false }
```
Optional `?mint_token=true` (or `Accept: application/decision-token+jwt`) ⇒ include `token` (Transport C).

**Batch (list filtering)**
```http
POST /api/authz/v1/decisions:batch
{ "subject": {...}, "action":"discover", "resource_type":"agent", "ids":["a","b","c"] }
→ 200 { "results":[ {"id":"a","decision":"ALLOW"}, {"id":"b","decision":"DENY","reason":"NO_CAPABILITY"} ] }
```

**Admin explain (only place FGA detail leaks)**
```http
POST /api/authz/v1/explain        # requires can_audit / admin_ui#view
→ 200 { "decision":"DENY","reason":"NO_CAPABILITY",
        "debug": {"engine":"openfga","relation":"can_use","checked":["user:… can_use agent:…"],"store":"…"} }
```

### 5.3 Status code semantics (deliberate)

> **A DENY is not an HTTP error.** The evaluation succeeded; the answer is "no" ⇒ **200 with body**. HTTP status is reserved for **meta** failures:

| Status | Meaning |
|--------|---------|
| `200` | evaluation succeeded (`ALLOW` **or** `DENY` in body) |
| `401` | caller token missing/invalid (`NOT_AUTHENTICATED`) |
| `403` | caller may not ask about this subject (subject-binding, §6 #1) |
| `400` | malformed (`INVALID_REQUEST`) |
| `503` | PDP unavailable (`AUTHZ_UNAVAILABLE`, `retriable:true`) |

PEPs translate `decision:"DENY"` into their own 403. Keeps deny-reasoning out of status codes.

### 5.4 Error envelope migration (one shared builder, all surfaces)

| Current (leaky, ×3) | Public v1 | Admin/explain only |
|---------------------|-----------|--------------------|
| `code:"agent#use"` | `reason:"NO_CAPABILITY"` | `debug.relation:"can_use"` |
| `reason:"pdp_denied"` | `reason:"NO_CAPABILITY"` | |
| `reason:"pdp_unavailable"` | `reason:"AUTHZ_UNAVAILABLE"` | |
| `pdp:"openfga"` in body | omitted | audit log only |
| tuple strings in messages | omitted | `/explain` only |

---

## 6. Security model (threats → controls)

CAS is a trust boundary; it assumes callers are hostile-capable.

| # | Threat | Control |
|---|--------|---------|
| 1 | **Forged subject** | A *user* token may only evaluate `subject == token.sub`. Cross-subject needs `can_audit` (admin/explain). Mismatch ⇒ `403`. |
| 2 | **Bot impersonation / OBO** | Require bot's verified client-credentials token **+** verified user assertion **+** real tuple `service_account:<id> can_impersonate user:*`. **Never** trust a bare `delegated_subject` body field. |
| 3 | **Forgeable identity** ([#1730], P1) | CAS **always** validates signature/`exp`/`aud`/`iss` via cached JWKS. Body/header identity is only the *target* subject, then authz'd per #1/#2. No unsigned `X-User-Context`, no trusted upstream hop. |
| 4 | **PDP outage → silent allow** | Fail closed: `DENY` + `AUTHZ_UNAVAILABLE` + `retriable` + `503` + audit. Break-glass = explicit env flag, time-boxed, alarmed, audited per request. |
| 5 | **Decision-token theft/replay** | `aud` = one downstream, `res`+`act` bound, `exp ≤ 60s`, `jti`, signed. PEP verifies offline. |
| 6 | **Cache stale-allow** | TTL ≤15s read / ≤2s write-class; per-replica bounded LRU; revocation tolerated within TTL (documented). |
| 7 | **Confused deputy via `context`** | `context` may only *narrow*, never *expand* a grant — except server-evaluated delegation computed inside the core (workflow run-authorizer). |
| 8 | **Enumeration / info leak** | coarse DENY reasons; no tuple strings outside `/explain`; per-caller rate limit; every decision audited w/ correlation id. |
| 9 | **New mutation surface** | v1 API is **read/evaluate only**. No tuple writes. Reconcile/ownership stay in current modules ⇒ standing up CAS grants no new write capability. |

---

## 7. The OpenFGA Proxy (`openfga-authz-bridge`) — convergence

The bridge is the **data-plane PEP** for MCP routing: AgentGateway validates JWT (`jwtAuth: strict`, JWKS) then fires a per-route `extAuthz` gRPC Check (`failureMode.denyWithStatus: 403`) → bridge → OpenFGA Check (`can_call` / `mcp_gateway:*`).

**Decision: it stays in the data plane; it does NOT route through the BFF.**

- The BFF is not on the AgentGateway→MCP path; a per-call BFF hop would put the BFF in the availability/latency envelope of every tool call (`ext_authz` fires once per MCP route on listing, 200ms timeout). Rejected.
- The bridge is already the **model** thin-PEP: edge JWT validation, no forgeable header, fail-closed.

**What converges (Transport D):**
1. **Vocabulary** — bridge maps Envoy `CheckRequest` → `{subject, resource, action}`; stop using bespoke relation/object strings as the contract.
2. **Adapter semantics** — same action→relation map, warm store-id, decision cache, retry/circuit-breaker behavior as `engines/openfga.ts`; validated by the **same CI coverage tests**.
3. **Audit schema** — same `audit_events` shape/salt the core emits (resolves [#1733]-style coupling consistently).
4. **No new OpenFGA reimplementation** — if the bridge ever needs wire-level PDP-agnosticism, it consumes the shared adapter **library**, not an HTTP call to the BFF.

**Scope:** out of scope for "no Mongo in DA / BFF-resident decisions" (it's neither DA nor BFF); **in scope** for "PDP-agnostic + one vocabulary + reusable adapter."

> **Decision point D-1:** keep bridge OpenFGA-direct + contract-aligned (default, this spec) vs. route through CAS HTTP. Default chosen for data-plane latency/availability. Revisit only if a non-OpenFGA PDP lands.

---

## 8. Standalone build + shadow migration

### 8.1 Shadow mode

Per-surface flag: `AUTHZ_CENTRAL_MODE = off | shadow | enforce` (surfaces: `da_agent_use`, `da_workflow`, `rag_kb`, `rag_search`, `slack`, `webex`, …).

- **off** — legacy only (today).
- **shadow** — call CAS best-effort/time-boxed; compare to legacy; emit `authz_parity{surface,legacy,central,agree}`. **Legacy authoritative.** No user-visible change. *This is "standalone, touch nothing."*
- **enforce** — CAS authoritative; legacy code deleted.

```text
request ─▶ legacy check ─▶ (authoritative) ─▶ response
              └─(shadow)─▶ CAS /decisions ─▶ parity metric   ✗ cannot change outcome
```

Flip `shadow→enforce` per surface only at **~100% parity over N days**; roll back by setting `shadow`.

### 8.2 Phases & tasks

| Phase | Scope | Touches behavior? | Exit gate |
|-------|-------|:-----------------:|-----------|
| **P0** Core extraction | build `lib/authz`; refactor 2 agent-use algos + `resource-authz` to call it | No (pure) | golden-decision parity; existing tests green |
| **P1** Standalone service | `/api/authz/v1/{decisions,:batch,explain}` over core; caller-token verify + subject-binding; v1 envelope | No (unused) | contract + parity tests. **Ships alone.** = [#1455] |
| **P2** Shadow | DA, RAG, bots consult CAS in `shadow` | No (observe) | parity dashboard ~100%/surface |
| **P3** Workflow enforce | flip `da_workflow`; delete `workflow_execution_authz.py` + `workflow_config_id` bypass; delegation via core run-authorizer (§9) | Yes (1 surface) | DA reads no workflow/team Mongo |
| **P4** Agent-use + RAG enforce | flip `da_agent_use`, `rag_*`; DA drops OpenFGA client + Mongo audit; `rbac.py`→thin PEP; bridge→Transport D | Yes (per surface) | no OpenFGA client / policy Mongo in DA/RAG; bridge contract-aligned |
| **P5** (optional) Decision tokens | engine attaches tokens; PEP verifies offline | Yes | duplicate hop [#1731] gone; [#1458] ADR |

**P0 task list**
1. `contract.ts` + `reasons.ts`.
2. `engines/openfga.ts` — wrap transport; warm store-id; pooled client; cache hook.
3. `index.ts` — `authorize/authorizeMany/authorizeOrThrow/filterAccessible`; fold both agent-use algos.
4. Refactor `requireResourcePermission`/`requireAgentUsePermission`/`evaluateAgentAccess` → core (no behavior change).
5. `domains/workflow.ts` — move visibility/`workflowDelegatesAgentUse`.
6. golden-decision parity harness (legacy vs core).

**P1 task list**
7. routes `decisions`, `decisions:batch`, `explain`; caller-token verification (JWKS) + subject-binding.
8. shared `error-responses` v1 builder; switch BFF authz throws.
9. ESLint import boundary (`engines/openfga` only inside `lib/authz/**`).
10. contract tests; OpenAPI for `/api/authz/v1`.

---

## 9. Workflow delegation (PR #1751)

**Runtime-scoped delegation, not persistent pre-grants.**

| Operation | Owner | Mechanism |
|-----------|-------|-----------|
| CRUD config + runs | BFF | existing routes |
| "can user run workflow?" | core `domains/workflow.ts` | `workflowDelegatesAgentUse` (agent∈steps AND run visibility) wired at `POST /api/workflow-runs` |
| Step agent-use | core run-authorizer | delegated set computed at run start; step carries run-scoped decision/token; **DA reads no `workflow_configs`** |
| DA workflow tools | DA→BFF `WorkflowApiClient` | unchanged (correct) |

**Flag:** PR #1751's modal pre-grants persistent `team#can_use agent` tuples ⇒ standing access *outside* the workflow (over-grant). Replace with runtime delegation; if product wants standing access, make it an explicit separate admin grant.

---

## 10. RAG & DA convergence

- **RAG** → thin PEP over `POST /api/authz/v1/decisions` (+ `:batch` for `inject_kb_filter`). CAS owns the channel→team lookup; RAG stops reading `channel_team_mappings`/`teams`. A shared **Python policy lib is rejected** (would be reimplementation #5).
- **Coarse roles** (`READONLY/INGESTONLY/ADMIN`) demoted to a **local pre-filter**: client-credentials/automation short-circuit before CAS; all human/per-resource decisions go to CAS.
- **DA** drops `openfga_authz.py` OpenFGA client + per-call store discovery + Mongo audit + `workflow_execution_authz.py`. `require_agent_use_permission` → `require_authorization(resource, action)` (CAS HTTP, or token verify in P5).

---

## 11. CI enforcement

| Guard | Blocks |
|-------|--------|
| ESLint `no-restricted-imports` | `engines/openfga`/`lib/rbac/openfga` outside `lib/authz/**` |
| `validate-authz-boundaries.py` (new) | `workflow_configs`/`teams`/OpenFGA-client imports in `dynamic_agents/**` (and RAG) once surface = `enforce` |
| extend `validate-fga-create-paths.py` | new BFF routes reach OpenFGA only via core |
| `fga-enforcement-manifest.ts` | add `task`/workflow + `/api/authz/v1/*` + bridge `mcp_gateway` surfaces |
| parity test (new) | CAS == legacy on golden fixtures (gates each `shadow→enforce` flip) |
| bridge contract test | bridge's relation map/audit schema == core adapter |

---

## 12. Observability & audit

- **CAS owns the decision audit write** (unified `audit_events`); PEPs stop writing their own ⇒ resolves [#1733] coupling and DA/bridge duplicate audit.
- Every decision: `correlation_id`, `subject_hash` (salted), `reason_code`, `pdp`, `source`, optional trace.
- Metrics: `authz_decision_total{surface,decision,reason}`, `authz_parity{surface,agree}`, `authz_pdp_latency_ms`, `authz_cache_hit_ratio`, `authz_circuit_state`.

---

## 13. Rollout & flags

| Flag | Default | Purpose |
|------|---------|---------|
| `AUTHZ_CENTRAL_MODE.<surface>` | `off` | off / shadow / enforce per PEP |
| `AUTHZ_DECISION_CACHE_TTL_MS` | `15000` | read-class cache TTL |
| `AUTHZ_BREAK_GLASS` | unset | time-boxed, alarmed, audited fail-open (non-prod posture mirrors `CAIPE_UNSAFE_RBAC_BYPASS`) |
| `AUTHZ_DECISION_TOKEN_ENABLED` | `false` | Transport C |

Additive + versioned ⇒ **no breaking change**; existing clients keep working until their surface flips.

---

## 14. Acceptance criteria

- [ ] One module computes agent-use; `requireAgentUsePermission` and `evaluateAgentAccess` are gone/wrappers.
- [ ] No `dynamic_agents/**` authz path reads `workflow_configs`/`teams`; `workflow_execution_authz.py` + `workflow_config_id` bypass removed.
- [ ] DA holds no OpenFGA client and writes no authz audit to Mongo (CAS owns it).
- [ ] `POST /api/authz/v1/decisions` (+ `:batch`, `explain`) live, versioned, OpenAPI-documented; verifies caller token + subject-binding.
- [ ] Public errors use §5.4 reason codes; no `agent#use`/`pdp_denied` in user-facing responses.
- [ ] RAG, Slack, Webex consume CAS (HTTP) — not admin rebac routes.
- [ ] `rbac.py` is a thin PEP; coarse role is a local pre-filter only.
- [ ] Bridge conforms to the shared contract + adapter semantics + audit schema (Transport D); CI bridge-contract test green.
- [ ] `workflowDelegatesAgentUse` wired at run start; runtime-scoped delegation; modal pre-grant removed/justified.
- [ ] Shadow→enforce gated on ~100% parity per surface; rollback to shadow verified.
- [ ] CI: import boundary + authz-boundary + parity guards green.
- [ ] [#1458] ADR documents dual-gate retirement before any DA OpenFGA removal.

---

## 15. Test plan

- **Unit:** core decision matrix (direct, team-union, deny, PDP error, invalid id); reason/`retriable` mapping; subject-binding; OBO accept/reject; cache TTL + write-class bypass.
- **Contract:** `/api/authz/v1` request/response schema; 200-DENY vs 401/403/400/503 meta-status; envelope has no FGA strings outside `explain`.
- **Parity (gating):** golden fixtures evaluated by legacy and CAS must agree before each flip; per-surface dashboard.
- **Security:** forged-subject 403; unsigned/forged token rejected (regression for [#1730]); PDP-down ⇒ DENY/503; decision-token aud/exp/replay; break-glass audited.
- **Integration:** DA chat shadow→enforce; RAG query/ingest; bot channel-scoped; AgentGateway ext_authz allow/deny via bridge.
- **Perf:** `:batch` list filtering vs N checks; cache hit ratio; ext_authz p99 within 200ms budget.

---

## 16. Open decisions

| ID | Decision | Default |
|----|----------|---------|
| D-1 | Bridge OpenFGA-direct + contract-aligned vs route via CAS | **Direct + aligned** (§7) |
| D-2 | Decision-token signing: symmetric (in-boundary) → JWKS later | symmetric to start |
| D-3 | Workflow `task` visibility: product layer over FGA vs fold into FGA | product layer for now; revisit post-P4 |
| D-4 | Standing team→agent access: drop modal pre-grant vs keep as explicit admin grant | drop; explicit grant if product needs it |
| D-5 | Parity bar + soak window before enforce | ~100% over N days (set N per surface) |

---

## 17. Epic [#1742] mapping

| Spec phase | Closes / enables |
|------------|------------------|
| P1 (CAS + HTTP API) | **#1455** (prereq); enables **#1730**; sets up #1733 (CAS owns audit), #1736 (CAS owns cached channel→team) |
| P3–P4 (convergence) | #1730, #1731, #1733 (DA); #1734/#1735/#1736 (RAG); #1737/#1739/#1741 (Slack — bots shed Keycloak-Admin/Mongo blast radius) |
| P5 (tokens) | #1731 capstone; gated on **#1458** |

**Correction:** the "facade then runtime-API as separate phases" sequencing is the *problem statement's §8*, not the epic. #1742 makes the runtime API (#1455) a **prerequisite** — supporting "ship the service first." #1755 is **not** in scope (narrow skills-UI DRY); keep it independent.

---

<!-- assisted-by claude code claude-opus-4-8 -->
