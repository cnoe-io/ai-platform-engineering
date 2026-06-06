# Solution Architecture: Centralized Authorization Service (BFF-resident, PDP-agnostic)

**Status:** Second-opinion response to [`problem-statement.md`](./problem-statement.md)
**Date:** 2026-06-05
**Scope:** Architecture + security model + standalone migration. Companion to the problem statement; not yet a `/speckit` spec.

---

## 0. TL;DR — the decision

The problem statement frames five competing options. They are **not** competing — they are layers of one design. Collapse them:

> **One decision core. Two transports. One optional claim. Shadow-first migration.**

```text
                        ┌──────────────────────────────────────────────┐
                        │     Authorization Decision Core (lib/authz)    │
                        │  PDP-agnostic types · reason codes · domain    │
                        │  composition · ONE OpenFGA adapter behind it   │
                        └───────────────┬───────────────┬───────────────┘
            in-process call             │               │        HTTP (out-of-process PEPs)
        ┌───────────────────────────────┘               └────────────────────────────────┐
        ▼                                                                                  ▼
  BFF route handlers                                              POST /api/authz/v1/decisions
  (authorize / authorizeMany / authorizeOrThrow)                  POST /api/authz/v1/decisions:batch
  no network hop                                                  POST /api/authz/v1/explain  (admin)
                                                                  (optional) signed decision tokens
                                                                          ▲
                                       ┌──────────────────────────────────┼───────────────────────┐
                                       │                                   │                        │
                                  Dynamic Agents                       RAG server                Slack/Webex bots
                                  (thin PEP, no Mongo,                 (thin PEP, no Mongo,       (thin PEP)
                                   no OpenFGA client)                   no OpenFGA client)
```

Everything the four bullets ask for falls out of this shape:

| Your ask | How this delivers it |
|----------|----------------------|
| **No MongoDB in Dynamic Agents** | DA calls the HTTP API for decisions; the *service* owns workflow-visibility data and audit writes. DA keeps zero policy Mongo. |
| **Reusable authz modules** | The **core** is the one reusable module. BFF imports it in-process; DA/RAG/bots consume it over HTTP. No second/third reimplementation possible. |
| **Common PDP AuthZ APIs** | `POST /api/authz/v1/decisions` is the single contract for every out-of-process caller; the in-process `authorize()` is the same core. |
| **HA OpenFGA + PDP-agnostic API** | OpenFGA sits behind one pooled adapter with a warm store-id, decision cache, and circuit breaker; callers see `{decision, reason}`, never `can_use`/tuples. |

**Standalone, no resources touched, slow migration** is achieved by **shadow mode** (§5): the service ships and runs *observe-only* alongside the existing checks, which stay authoritative until each caller is flipped, one at a time, on measured decision parity.

---

## 1. Critique of the problem statement

### 1.1 What it gets right

- **Inventory is excellent.** The module table (§3.1), endpoint table (§3.1), and DA/RAG anti-pattern tables are accurate and rare in a problem doc.
- **Core diagnosis is correct.** Scattered policy + duplicate PDP hops + leaky abstraction + weak enforcement is the real disease.
- **Phasing instinct is right** (immediate cleanup → hygiene → facade → runtime → RAG).
- **Honest non-goals.** Not replacing OpenFGA; not ripping DA checks in v1.

### 1.2 Gaps to fix (these reshape the design)

1. **It understates the duplication.** This is not "different patterns" — it is **three full reimplementations** of the same OpenFGA transport + decision logic (`openfga.ts`, DA `openfga_authz.py`, RAG `rbac.py`), plus **two duplicate agent-use algorithms inside the BFF itself** (`requireAgentUsePermission` vs `evaluateAgentAccess`), plus **three error envelopes**. A *library* facade (Option 1) cannot fix the Python copies — only a **service** collapses all three. The doc admits Option 1 "does not alone fix DA/RAG" but never resolves it.

2. **"Facade vs Runtime API" is a false fork.** Option 1 (in-process) and Option 2 (HTTP) are the *same core* exposed two ways, not alternatives to mix. Treating them as separate phases invites two codebases drifting apart again — exactly the disease.

3. **The standalone / "don't touch resources" requirement is unaddressed.** Every migration path in the doc rewrites existing call sites. There is no **shadow / dual-run / decision-parity** mechanism. That mechanism is the *only* way to satisfy "build it standalone and migrate slowly" safely (§5). Biggest omission.

4. **Threat model is deferred to "open questions."** For a security-conscious central PDP, the answers must be in the design: token verification (DA currently base64-decodes the JWT and trusts upstream), subject-binding, OBO impersonation via real tuples (the doc's sketch trusts a `context.delegated_subject` body field — a spoofing hole), fail-closed + audited break-glass, decision-token replay. §4 answers all of these.

5. **`#1755` is mis-scoped.** Issue #1755 is a narrow tracking issue — skills RBAC UI parity + an *optional* `useShareableTeams` hook, explicitly "no further PR required." It is **not** the centralization mandate. The real mandate is Kevin's "RAG and agents must not diverge." Don't anchor the PDP architecture to #1755; it's a small UI-DRY cleanup that ships independently.

6. **Workflow delegation hides a least-privilege regression.** PR #1751's "pre-grant agent tuples on save" (the modal) writes **persistent** `team#can_use agent` tuples — the team can then use that agent *outside* the workflow forever. Runtime-scoped delegation (grant only for the duration of the run) is the least-privilege answer. The doc lists this as an open question; it should be a decision (§6).

7. **Performance/HA is hand-waved.** The DA and RAG OpenFGA clients **re-resolve the store id and open a new HTTP client on nearly every call**. A central PDP needs a warm store-id, pooled connections, a short-TTL decision cache, a batch endpoint (list-filtering does N checks today), and a circuit breaker. §3.5.

8. **RAG's coarse-role axis is missing from the analysis.** `rbac.py` mixes a `READONLY/INGESTONLY/ADMIN` hierarchy *with* OpenFGA. RAG cannot become a thin PEP unless the core subsumes coarse roles or they are explicitly demoted to a cheap local pre-filter (§7).

9. **Contract versioning is left as a question.** A "stable external contract" must be versioned from line one (`/api/authz/v1`). Because the new API is **additive**, there is no breaking change to existing clients — answering open question #7 directly.

---

## 2. Design principles

1. **One decision, one place.** Exactly one module computes "may subject S do action A on resource R." Everything else is transport.
2. **The PDP is an implementation detail.** Callers send `{subject, resource, action, context}` and receive `{decision, reason}`. OpenFGA relation names and tuples never cross the boundary (except the admin `/explain` tier).
3. **Never trust the caller's identity claims.** The service validates every token itself (JWKS) and binds the answer to who is allowed to *ask*.
4. **Fail closed, observably.** PDP error ⇒ DENY + retriable + audit. Break-glass is explicit, time-boxed, alarmed.
5. **Least privilege over convenience.** Delegation is runtime-scoped, not a persistent grant, unless an admin deliberately makes it persistent.
6. **Additive first.** The service ships touching nothing. Enforcement moves caller-by-caller on measured parity.

---

## 3. Target architecture

### 3.1 The decision core — `ui/src/lib/authz/`

The single reusable module. Pure, transport-free, PDP-agnostic.

```text
ui/src/lib/authz/
  index.ts            # authorize(), authorizeMany(), authorizeOrThrow(), filterAccessible()
  contract.ts         # Subject, Resource, Action, Decision, ReasonCode  (the public vocabulary)
  reasons.ts          # stable reason codes + retriable mapping + user action hints
  compose.ts          # domain composition (workflow visibility, channel scope) layered over PDP
  engine.ts           # PolicyEngine interface
  engines/
    openfga.ts        # the ONLY OpenFGA adapter (wraps today's lib/rbac/openfga.ts transport)
  domains/
    workflow.ts       # workflowDelegatesAgentUse, run visibility (product policy over PDP)
    slack-channel.ts
    webex-space.ts
  cache.ts            # short-TTL decision cache (engine-level)
  audit.ts            # one decision → one audit event (owns the write)
```

- **Collapses the two BFF agent-use algorithms.** `requireAgentUsePermission` and `evaluateAgentAccess` both become thin callers of `authorize({subject, resource:{type:"agent"}, action:"use"})`. One direct+team-union implementation, one reason taxonomy.
- **`compose.ts` is where product policy lives** (workflow visibility, derive-team-from-channel) so it sits *above* the PDP and is reused identically by every transport. This is the home the DA Mongo reads should never have left.
- The action→relation map already exists in `resource-authz.ts` (`use → can_use`); it moves into `engines/openfga.ts` as the adapter seam. The `action` vocabulary is already PDP-agnostic; only the relation strings are FGA-specific.

### 3.2 Transport A — in-process (BFF routes)

```ts
await authorizeOrThrow(session, { type: "agent", id, action: "use" });
const visible = await filterAccessible(session, agents, { type: "agent", action: "discover", id: a => a.id });
```

No network hop. Existing `requireResourcePermission` / `requireAgentPermission` / `requireSkillPermission` become 3-line wrappers over `authorize()` so call sites don't churn. ESLint forbids importing `engines/openfga` outside `lib/authz/**`.

### 3.3 Transport B — the common PDP AuthZ API (HTTP)

The single contract for **every out-of-process caller** (DA, RAG, bots). Versioned, additive, PDP-agnostic.

```http
POST /api/authz/v1/decisions
Authorization: Bearer <caller-token>          # user OR service-account; VERIFIED by the service
Content-Type: application/json

{
  "subject":  { "type": "user", "id": "<oidc-sub>" },
  "resource": { "type": "agent", "id": "platform-engineer" },
  "action":   "use",
  "context":  { "workflow_run_id": "wr-123" }   // advisory only; never *expands* a grant (§4)
}
```

**Response — evaluation succeeded (HTTP 200 for both ALLOW and DENY):**

```json
{ "decision": "ALLOW", "reason": "OK", "retriable": false, "ttl_seconds": 15 }
```
```json
{ "decision": "DENY",  "reason": "NO_CAPABILITY", "retriable": false }
```

> **API design note (answers a muddle in the doc's Option 2 sketch):** a *DENY is not an HTTP error*. The evaluation succeeded; the answer is "no" ⇒ **200 with a body**. HTTP status is reserved for **meta** failures: `401` caller not authenticated, `403` caller may not ask about this subject, `400` malformed, `503` PDP unavailable (`retriable:true`). PEPs translate `DENY`→ their own 403. This keeps deny-reasoning out of status codes and makes the contract uniform.

**Batch (replaces N round-trips for list filtering):**

```http
POST /api/authz/v1/decisions:batch
{ "subject": {...}, "action": "discover", "resource_type": "agent", "ids": ["a","b","c"] }
→ { "results": [ { "id":"a","decision":"ALLOW" }, { "id":"b","decision":"DENY","reason":"NO_CAPABILITY" }, ... ] }
```

**Admin explain tier (the *only* place FGA detail is exposed):**

```http
POST /api/authz/v1/explain          # requires can_audit / admin_ui#view
→ { "decision":"DENY", "reason":"NO_CAPABILITY",
    "debug": { "engine":"openfga", "checked":["user:… can_use agent:…","team:… "], "store":"…" } }
```

This **extends the existing draft** `rebac-policy-api.md` (which already defines the `{subject, action, resource}` vocabulary and a per-type action catalog) into two tiers: **runtime/decision** (new, PDP-agnostic) and **admin/explain** (already drafted, FGA-visible). One vocabulary, exactly as Kevin asked.

### 3.4 Transport C (optional) — signed decision tokens

For the duplicate-hop problem (workflow step execution), the API can mint a **short-lived, audience-bound decision token** instead of a bare yes/no:

```jsonc
// header: alg, kid       payload:
{ "iss":"caipe-bff", "aud":"dynamic-agents", "sub":"user:<oidc-sub>",
  "res":"agent:platform-engineer", "act":"use",
  "iat":1710000000, "exp":1710000045, "jti":"…" }   // ≤60s
```

The PEP verifies **signature + aud + exp + res/act match** offline — no OpenFGA, no Mongo, no second hop.

**I disagree with the doc's deferral of this to "Phase 5, optional, expensive."** Constrained as above it is cheap and is the *cleanest* way to satisfy "no Mongo in DA" + "no duplicate PDP hop" + "PDP-agnostic at the boundary" simultaneously:

- **No revocation machinery** needed at ≤60s TTL — document the TTL as the bound on staleness.
- **Symmetric signing** (shared secret in the trust boundary) is acceptable to start; move to JWKS/asymmetric when bots/3rd parties consume it.
- It is **additive** — the workflow engine attaches the token; a PEP that doesn't understand it falls back to a `/decisions` call.

Keep it optional, but design for it now (P5), don't treat it as exotic.

### 3.5 PDP adapter, HA OpenFGA, caching

| Concern | Today (3× duplicated) | Central service |
|---------|------------------------|-----------------|
| Store id | Re-resolved via `GET /stores` per call (DA, RAG) | Resolved once at boot, cached, refreshed on miss |
| HTTP client | New `httpx`/fetch per call | One pooled client, keep-alive |
| HA | Single OpenFGA assumed | OpenFGA replicated (stateless vs its datastore) behind a Service; adapter retries idempotent `check` across replicas |
| Hot path | Every check hits OpenFGA | Short-TTL decision cache (≤15s) keyed `(subject,resource,action)`, per-replica bounded LRU; **write/manage/delete bypass cache or ≤2s** |
| List filtering | N sequential checks | `decisions:batch` → `BatchCheck`/parallel with bounded concurrency |
| Outage | Each PEP improvises | One circuit breaker; open ⇒ fail closed (`AUTHZ_UNAVAILABLE`, retriable) |
| Consistency | n/a | Use OpenFGA `consistency: HIGHER_CONSISTENCY` for sensitive actions; cache TTL bounds staleness for the rest |

### 3.6 PDP-agnostic contract (the stable surface)

```ts
type ReasonCode =
  | "OK"                 // ALLOW
  | "NO_CAPABILITY"      // DENY — no relationship      → action: contact_admin
  | "NOT_AUTHENTICATED"  // missing/invalid caller auth → action: sign_in
  | "AUTHZ_UNAVAILABLE"  // PDP timeout/error           → action: retry   (retriable)
  | "INVALID_REQUEST";   // bad id / malformed          → action: fix_request

interface Decision { decision: "ALLOW" | "DENY"; reason: ReasonCode; retriable: boolean; ttl_seconds?: number; token?: string; }
```

**Envelope migration** (one shared `error-responses` builder, used by *all* surfaces):

| Current (leaky, in 3 places) | Public v1 | Admin/explain only |
|------------------------------|-----------|--------------------|
| `code: "agent#use"` | `reason: "NO_CAPABILITY"` | `debug.relation: "can_use"` |
| `reason: "pdp_denied"` | `reason: "NO_CAPABILITY"` | |
| `reason: "pdp_unavailable"` | `reason: "AUTHZ_UNAVAILABLE"` | |
| `pdp: "openfga"` in body | *omitted* | audit log only |
| tuple strings in messages | *omitted* | `/explain` only |

---

## 4. Security model (threats → controls)

The service is a **trust boundary**. It assumes callers are hostile-capable and verifies everything.

| # | Threat | Control |
|---|--------|---------|
| 1 | **Forged subject** — caller asks "can `admin-user` do X" and acts on it | **Subject-binding.** A *user* token may only evaluate `subject == token.sub`. Cross-subject queries require `can_audit` on the type (admin/explain tier). Default rejects mismatched subject with `403`. |
| 2 | **Bot impersonation / OBO** — bot evaluates for a user | Require **both** the bot's verified client-credentials token **and** a verified user assertion (OBO token or signed envelope). Service checks a real tuple `service_account:<id> can_impersonate user:*` (or per-user). **Never trust a bare `delegated_subject` body field** — that was a hole in the doc's sketch. |
| 3 | **Caller-decoded / forgeable identity** — DA base64-decodes the JWT payload and trusts upstream; epic **[#1730] (P1)**: privileged paths trust unsigned `X-User-Context`, forgeable if DA is reached directly | Service **always** validates signature, `exp`, `aud`, `iss` via cached JWKS. Body/header-supplied identity is treated only as the *target* subject, then authorized per #1/#2. No upstream hop or unsigned header is trusted. **This is the canonical fix for [#1730].** |
| 4 | **PDP outage → silent allow** | **Fail closed**: `DENY` + `AUTHZ_UNAVAILABLE` + `retriable` + `503` + audit. Break-glass via explicit env flag (mirrors `CAIPE_UNSAFE_RBAC_BYPASS` but **centralized, time-boxed, alarmed, audited per request**). |
| 5 | **Decision-token theft / replay** (Transport C) | `aud` bound to one downstream, `res`+`act` bound, `exp ≤ 60s`, `jti`, signed. PEP verifies offline; stolen token is useless elsewhere and expires fast. |
| 6 | **Cache stale-allow** | TTL ≤15s read / ≤2s for write-class actions; per-replica; bounded LRU; revocation tolerated within TTL window (documented). Sensitive mutations may set `no-cache`. |
| 7 | **Confused deputy via `context`** | `context` is **advisory only**. It may *narrow* (scope) but must never *expand* a decision beyond the subject's own relationships — except through server-evaluated delegation (the workflow run-authorizer in §6), which is computed inside the core, not asserted by the caller. |
| 8 | **Enumeration / info leak** | DENY reasons are coarse (`NO_CAPABILITY`); no tuple/relation strings outside `/explain`; rate-limit per caller; every decision audited with correlation id. |
| 9 | **Privilege via the API itself** | The decision API is **read/evaluate only in v1.** No tuple writes. Reconcile/ownership writes stay in their current modules — so standing up the service grants no new mutation surface. |

---

## 5. Standalone build + shadow migration (touch nothing, migrate slowly)

This is the mechanism the problem statement is missing and the explicit requirement.

### 5.1 Shadow mode

Each existing PEP gets a thin consult wrapper behind a **per-surface** flag:

```
AUTHZ_CENTRAL_MODE = off | shadow | enforce      # per surface: da_agent_use, da_workflow, rag_kb, slack, …
```

- **`off`** — legacy only (today).
- **`shadow`** — call the central API *best-effort, time-boxed*; **compare** to the legacy decision; emit an `authz_parity` metric/audit `{surface, legacy, central, agree}`. **Legacy stays authoritative.** Zero user-visible change. *This is "standalone without touching resources."*
- **`enforce`** — central is authoritative; legacy code deleted.

```text
  request ─▶ legacy check ──▶ (authoritative) ──▶ response
                │
                └─(shadow)─▶ central /decisions ─▶ parity log  ✗ cannot change outcome
```

Flip a surface to `enforce` only after **~100% parity over N days** on a dashboard. Roll back instantly by setting the flag to `shadow`.

### 5.2 Phases (standalone-first)

| Phase | Scope | Touches existing behavior? | Exit gate |
|-------|-------|----------------------------|-----------|
| **P0 Core extraction** | Build `lib/authz` core; refactor the 2 BFF agent-use algos + `resource-authz` to call it | **No** (pure refactor, identical outputs) | Existing tests green; golden-decision parity |
| **P1 The standalone service** | `POST /api/authz/v1/{decisions,decisions:batch,explain}` over the core | **No** (nobody calls it yet) | Contract tests + parity vs in-process core. **Ships alone, touches nothing.** |
| **P2 Shadow** | DA, RAG, bots call central in `shadow` | **No** (observe-only) | Parity dashboard ~100% per surface |
| **P3 Workflow enforce** | Flip `da_workflow`; delete `workflow_execution_authz.py` + `workflow_config_id` Mongo bypass; delegation via central run-authorizer (§6) | Yes (one surface) | DA reads no workflow/team Mongo |
| **P4 Agent-use + RAG enforce** | Flip `da_agent_use`, `rag_*`; DA drops its OpenFGA client + Mongo audit writes; `rbac.py` → thin PEP | Yes (per surface) | No OpenFGA client / policy Mongo in DA or RAG |
| **P5 (optional) Decision tokens** | Workflow engine attaches tokens; PEP verifies offline | Yes | Duplicate hop ([#1731]) gone; ADR for [#1458] |

Cross-cutting: the v1 envelope (§3.6) is **native** on the new API from P1. Legacy routes adopt the shared `error-responses` builder opportunistically — **no breaking change** because the new API is additive and versioned (answers open Q#7).

---

## 6. Workflow delegation done right (PR #1751)

**Decision: runtime-scoped delegation, not persistent pre-grants.**

| Operation | Owner | Mechanism |
|-----------|-------|-----------|
| Create/update/list/cancel workflow + runs | BFF | existing `workflow-configs` / `workflow-runs` routes |
| "Can this user run this workflow?" | **core `domains/workflow.ts`** | `workflowDelegatesAgentUse` = agent ∈ steps **AND** run visibility — wired at `POST /api/workflow-runs` |
| Step execution agent-use | **central run-authorizer** | At run start the BFF computes the delegated set once; step calls carry a run-scoped decision (or token, P5). DA does **not** read `workflow_configs`. |
| DA workflow *tools* | DA → BFF `WorkflowApiClient` | already correct — keep |

**Flag the regression:** PR #1751's modal that pre-grants `team#can_use agent` tuples on save is an **over-grant** — it lets the team use the agent *outside* the workflow, permanently. Prefer runtime delegation (above). If product genuinely wants standing access, make it an **explicit, separate, admin-visible grant**, not a side effect of saving a workflow. `workflowDelegatesAgentUse` already exists and is unused — wire it instead of writing tuples.

---

## 7. RAG & DA convergence

- **RAG becomes a thin PEP over HTTP.** A shared Python *library* would be a **fourth** reimplementation — reject it. RAG calls `POST /api/authz/v1/decisions` (and `:batch` for `inject_kb_filter`'s datasource list). The service owns the channel→team Mongo lookup (it already has the data); RAG stops reading `channel_team_mappings`/`teams`.
- **Coarse roles** (`READONLY/INGESTONLY/ADMIN`) are **demoted to a local pre-filter**: client-credentials/automation principals short-circuit *before* calling central (cheap, preserves automation); all human/per-resource decisions go to central. Don't let coarse roles re-enter the resource decision.
- **DA** drops `openfga_authz.py`'s OpenFGA client, its per-call store-id discovery, its Mongo audit writes, and `workflow_execution_authz.py` entirely. `require_agent_use_permission` → `require_authorization(resource, action)` calling central (or verifying a decision token in P5).

---

## 8. CI enforcement (aim the existing guards at the new boundary)

Keep the doc's Option 4 guards, retargeted:

| Guard | Blocks |
|-------|--------|
| ESLint `no-restricted-imports` | importing `engines/openfga` (or `lib/rbac/openfga`) outside `lib/authz/**` |
| `validate-authz-boundaries.py` (new) | `workflow_configs`/`teams`/OpenFGA-client imports in `dynamic_agents/**` and RAG once their surface is `enforce` |
| extend `validate-fga-create-paths.py` | new BFF routes must reach OpenFGA only via the core |
| `fga-enforcement-manifest.ts` | add `task`/workflow + runtime `/api/authz/v1/*` surfaces |
| Parity test (new) | central decision == legacy for a golden fixture set (gates each `shadow→enforce` flip) |

---

## 9. Answers to the problem statement's open questions

1. **DA execution gate** — Keep OpenFGA in DA *only* during shadow (P2). At enforce (P4), DA holds **no** PDP client; it calls central or verifies a decision token. Dual-gate ([#1731]) is resolved empirically by parity, not debate.
2. **Workflow delegation** — Runtime-scoped via the central run-authorizer (§6). Persistent pre-grants only as an explicit, separate admin action.
3. **Generic vs domain HTTP APIs** — One generic `POST /api/authz/v1/decisions` + `:batch`. Domain endpoints (`authorize-run`) become thin wrappers that call the core with a `context`; they are conveniences, not parallel logic.
4. **RAG** — HTTP client to the central API. **No** shared Python policy library (it would be reimplementation #4).
5. **Service-account delegation** — Verified OBO: bot token **+** user assertion **+** real `can_impersonate` tuple. Never a trusted body field (§4 #2).
6. **Claim revocation** — Not required at ≤60s TTL; TTL is the documented staleness bound (§3.4).
7. **Breaking API changes** — None. New API is `/api/authz/v1` and additive; legacy clients migrate envelopes opportunistically. No `/v2` flag day.
8. **Workflow `task` in FGA** — Mongo visibility stays a **product policy layer** in `domains/workflow.ts` *above* FGA for now; revisit folding it fully into FGA after P4, as a separate decision.

---

## 10. Recommendation

**Option mix:** `Option 1 (core) ≡ Option 2 (HTTP)` as one thing + `Option 5 (vocabulary)` adopted into `contract.ts` + `Option 4 (enforcement)` aimed at the new boundary + **`Option 3 (decision tokens) promoted from "someday" to a real P5**, constrained.

**Split into three specs** (the doc asks whether to split — yes):
- **Spec A — Core + envelope + enforcement** (P0–P1, + §3.6, + §8). Ships the standalone service. No behavior change.
- **Spec B — Runtime convergence** (P2–P4 shadow→enforce for DA/RAG/bots, + §6 workflow delegation).
- **Spec C — Decision tokens** (P5, optional), gated on [#1458] ADR.

**Ordered task list (Spec A first — the standalone service you asked for):**
1. `lib/authz/contract.ts` + `reasons.ts` — PDP-agnostic types & reason codes.
2. `engines/openfga.ts` — wrap today's transport; warm store-id; pooled client; cache hook.
3. `index.ts` `authorize/authorizeMany/authorizeOrThrow/filterAccessible`; **fold the two agent-use algos into it**.
4. Refactor `requireResourcePermission`/`requireAgentUsePermission`/`evaluateAgentAccess` to call the core (no behavior change; golden parity test).
5. `domains/workflow.ts` — move visibility/`workflowDelegatesAgentUse` here.
6. `POST /api/authz/v1/{decisions,decisions:batch,explain}` over the core; v1 envelope; caller-token verification + subject-binding (§4 #1–#3).
7. Shared `error-responses` v1 builder; switch BFF authz throws to it.
8. ESLint import boundary + parity test harness.
9. **Stop.** Ship. The service is live, used by no one, touching nothing → then begin Spec B shadow.

### 10.1 Alignment with the real epic [#1742] (and one correction)

I verified against the epic itself — it aligns with this architecture *better* than the problem statement's own §8 table does:

- **The runtime HTTP API is already a prerequisite, not a late phase.** #1742 states: *"#1455 — runtime BFF ReBAC endpoints — must land before the Slack BFF moves (#1737, #1739)."* That is exactly **Transport B / Spec A**. → **Correction:** the "facade (Phase 2) then runtime API (Phase 3)" sequencing is the *problem statement's §8*, **not** the epic. The epic supports shipping the service **first**.
- **This service is the canonical fix for the epic's top P1.** #1730 (DA trusts unsigned, forgeable `X-User-Context`) is resolved by §4 #1–#3 — mandatory token verification + subject-binding at the central boundary. The problem statement under-weighted #1730; it should be the headline security driver.
- **Slack P1s shrink as a side effect.** Once bots get decisions + identity linking from the BFF (#1737/#1739, gated on #1455), the bot sheds Keycloak-Admin/Mongo blast radius (#1741).

**Epic sub-issue → spec map:**

| Spec | Closes / enables |
|------|------------------|
| **A** Core + HTTP API + envelope | **#1455** (prereq), enables **#1730**; sets up #1733 (service owns audit), #1736 (service owns cached channel→team) |
| **B** Convergence (shadow→enforce) | #1730, #1731, #1733 (DA); #1734/#1735/#1736 (RAG); #1737/#1739/#1741 (Slack) |
| **C** Decision tokens (optional) | #1731 capstone; gated on **#1458** dual-gate ADR |

**Remaining contradictions to reconcile:**
- #1742 Phase 0 "remove DA workflow Mongo" is right, but the *replacement* (runtime delegation) must land in `domains/workflow.ts`, **not** as new DA-side logic. Sequence at P3.
- PR #1751's modal pre-grant contradicts the least-privilege delegation in §6 — reconcile before it becomes load-bearing.
- #1755 is **not** in scope of this architecture (narrow skills-UI DRY); keep it independent so it isn't blocked on the PDP work.

---

<!-- assisted-by claude code claude-opus-4-8 -->
