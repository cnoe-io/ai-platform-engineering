# Research: Enterprise RBAC for Slack and CAIPE UI (098)

## R-1: Where should authorization decisions run?

**Decision (updated 2026-04-03)**: **Dual-PDP architecture** with enforcement at component boundaries (**spec FR-008**):

- **UI / Slack / Webex paths** → **Keycloak Authorization Services** as PDP (FR-022). BFF and Slack bot call Keycloak AuthZ (UMA / resource-based permissions) for every protected operation.
- **MCP / A2A / Agent paths** → **Agent Gateway** as PDP (FR-013). AG validates JWT issued by Keycloak and applies [CEL](https://agentgateway.dev/docs/reference/cel/) policy.
- **RAG server** retains forwarded-identity checks aligned to the same matrix.

The 098 permission matrix is modeled as Keycloak **resources** (components), **scopes** (capabilities), and **policies** (role-based).

**Rationale**: Keycloak is already required as OIDC broker (FR-011, Session 2026-04-03); its Authorization Services provide a production-grade PDP without building a custom `caipe-authorization-server`. AG centralizes agent-side JWT validation.

**Alternatives considered**: Shared authorization helper / thin internal HTTP endpoint (original R-1 decision — **superseded** by Keycloak AuthZ mandate, Session 2026-04-03); central PDP microservice (rejected—Keycloak serves this role); client-only RBAC (rejected—unsafe).

> **Supersedes**: Original R-1 (shared authorization helper pattern, "avoids a separate PDP microservice"). Keycloak AuthZ is the PDP; constitution Principle X justified in plan.md Complexity Tracking.

---

## R-2: Canonical source of group membership for RBAC

**Decision (updated 2026-04-03)**: Use **Keycloak-issued JWT claims** as the canonical source. Enterprise IdP groups (Okta, Entra ID) are **federated into Keycloak** via identity brokering. Keycloak **IdP mappers** (Attribute Importer for SAML, Claim to User Attribute for OIDC) import groups, and **Hardcoded Role** / **SAML Attribute to Role** mappers convert them to Keycloak realm roles. **Protocol mappers** emit `groups`, `roles`, `scope`, and `org` claims in the JWT at token issuance time. The platform resolves authorization from **JWT claims only** — no runtime SCIM or directory lookups (FR-010, Session 2026-04-03).

For **Slack**, `slack_user_id ↔ keycloak_sub` mapping is stored as a **Keycloak user attribute** (FR-025). The bot resolves identity via **Keycloak Admin API** (find user by attribute), then performs **OBO token exchange** (RFC 8693) to obtain a JWT scoped to the commanding user.

**Rationale**: Keycloak is required (FR-011); storing identity links in Keycloak eliminates MongoDB as a Slack bot dependency. OIDC claims mapping at token issuance avoids hot-path directory lookups.

**Alternatives considered**: Generic OIDC userinfo claims (original R-2 — **superseded** by Keycloak-specific JWT with claim mappers); MongoDB-only roles (rejected—duplicates enterprise directory); SCIM sync as sole source (deferred—optional acceleration).

> **Supersedes**: Original R-2 (generic OIDC claims + `AUTH_GROUP_CLAIM`). Now Keycloak-specific with IdP mappers and user attribute storage.

---

## R-3: Team-scoped RAG tool ownership storage

**Decision**: Store **`team_id` / `owner_scope` + allowed datasource IDs** on the **RAG tool configuration document** (or equivalent MongoDB collection the UI already uses for MCP/custom tools), indexed for query by team. **UI API** checks **capability** + **scope** before create/update/delete; **RAG server** rejects bind to datasources outside allowed list.

**Rationale**: **FR-009** requires no global editable pool; colocating scope with tool config prevents orphan references.

**Alternatives considered**: Separate ACL collection only (kept as optional normalization later if queries grow).

---

## R-4: Relationship to OBO and Global Tool Authorization (093)

**Decision (updated 2026-04-02)**: **093 normative requirements absorbed into 098** (Session 2026-04-02). OBO token exchange (FR-018), multi-hop delegation (FR-019), multi-tenant isolation (FR-020), and bot service account authorization (FR-021) are now **098 functional requirements**. 093 research documents remain as references. **098** maps enterprise roles to capabilities per component; **ASP / tool policy** implements how tool execution is constrained. Composition: **default deny** at each layer; **deny wins** when 098 and ASP both apply (FR-012).

**Rationale**: Single specification simplifies tracking; 098 owns the unified capability matrix, OBO delegation chain, and multi-tenant isolation.

**Alternatives considered**: Keep 093/098 separate (rejected—caused cross-spec dependency confusion); merge RBAC into ASP only (rejected—IdP group lifecycle differs from tool policy).

---

## R-5: Audit and privacy

**Decision**: Log **structured authorization events** with **hashed or opaque user id**, **capability key**, **component** (`admin_ui` | `slack` | `supervisor` | `rag` | `sub_agent` | `tool` | `skill` | `a2a` | `mcp`), **allow/deny**, **correlation id**; **no** raw PII in info-level logs. Retention per org policy.

**Rationale**: **FR-005** and OWASP logging guidance.

**Alternatives considered**: Full JWT logging (rejected).

---

## R-6: Is AgentGateway required for 098?

**Decision (updated 2026-04-01)**: **[Agent Gateway](https://agentgateway.dev/)** is **required** for **MCP tool calls**, **A2A inter-agent traffic**, and **agent/sub-agent dispatch** (**FR-013**, Session 2026-04-01). AG validates **JWT** from the tenant OIDC provider ([Keycloak tutorial](https://agentgateway.dev/docs/kubernetes/latest/mcp/auth/keycloak/), Okta, Entra) and enforces **[CEL](https://agentgateway.dev/docs/reference/cel/)**-based authorization rules. **Slack** and **Admin UI** stay on **BFF/bot** enforcement. If AG is **unavailable**, MCP/A2A/agent traffic MUST **fail closed**.

**Rationale**: Centralizes **JWT validation + policy** for all **agent-side** traffic; solves **remote MCP** and **auth-less MCP** gaps with a single component; keeps **Slack/UI** path simple and AG-independent.

**Alternatives considered**: AG optional (superseded Sessions 2026-03-26, 2026-03-30); AG for all entry points (rejected—over-couples Slack/UI to infra); no AG at all (rejected—leaves MCP/A2A without uniform auth gateway).

---

## R-7: Scope vs supervisor, RAG runtime, sub-agents, tools, skills, Admin, A2A, MCP

**Decision** (**updated 2026-03-28**): **098** enterprise RBAC **includes** **Admin**, **Slack**, **Supervisor**, **RAG** (admin + data-plane entry points), **sub-agents**, **tools** (config + runtime), **skills**, **A2A**, and **MCP**—each with **matrix rows** and **default deny** (**spec FR-008**, **FR-014**, Session 2026-03-28). **093** / **ASP** remain authoritative for **OBO** and **policy-engine** implementation; **capability keys** MUST **align** to avoid silent conflict.

**Rationale**: Stakeholder direction for **one** auditable RBAC model across the stack.

**Alternatives considered**: UI/Slack-only matrix (**superseded**—Session 2026-03-27).

---

## R-8: Keycloak as required OIDC broker and PDP

**Decision (2026-04-03)**: **Keycloak** is the **required** OIDC / authorization layer for the CAIPE platform (FR-011, Session 2026-04-03). Enterprise customers federate their existing IdP (Okta, Entra ID, SAML) into Keycloak via identity brokering. Keycloak provides: OBO / token exchange (RFC 8693), Authorization Services as PDP for UI/Slack RBAC (FR-022), groups → roles mapping at token issuance (FR-010), JWT issuance, and Slack identity link storage as user attributes (FR-025).

**Rationale**: Consolidates OIDC brokering, OBO, PDP, identity linking, and group mapping into one proven component. Eliminates the need for a custom `caipe-authorization-server`. The Slack bot becomes stateless with respect to MongoDB — all identity state lives in Keycloak.

**Alternatives considered**: Keycloak optional with direct Okta/Entra (original Session 2026-03-24 Q3 — **superseded**); custom `caipe-authorization-server` as PDP fallback (eliminated — Keycloak handles this); Keycloak as sole IdP (rejected — broker mode preserves existing customer IdPs).

---

## R-9: Hybrid RBAC configuration store

**Decision (2026-04-03)**: **Keycloak** stores authorization policies (resources, scopes, role-based policies) and Slack identity links (user attributes). **MongoDB** stores team/KB ownership assignments, app metadata, ASP tool policies, and operational RBAC state (FR-023, Session 2026-04-03). The Admin UI writes to both via Keycloak Admin API + MongoDB.

**Rationale**: Keycloak is the natural home for authz policies (it evaluates them); MongoDB is the natural home for team/KB assignments (already used by the UI and RAG server). Avoids duplicating policies across stores.

**Alternatives considered**: Keycloak-only (rejected—team/KB assignments and ASP policies don't fit Keycloak's AuthZ model well); MongoDB-only (rejected—would require building a PDP from scratch).

---

## R-10: Admin UI User Detail View — Keycloak API strategy (FR-033)

**Decision (2026-03-25)**: Use Keycloak Admin REST API for server-side user pagination (`GET /users?search=&first=&max=&enabled=`), user count (`GET /users/count`), role mapping management (`GET/POST/DELETE /users/{id}/role-mappings/realm`), user session retrieval (`GET /users/{id}/sessions`), and federated identity lookup (`GET /users/{id}/federated-identity`). Role-based filtering uses `GET /roles/{name}/users`. Team and Slack link filters cross-reference MongoDB and Keycloak user attributes respectively via BFF-side joins.

**Rationale**: Keycloak's Admin API natively supports paginated user search, enabled/disabled filter, and per-user role mapping management — no custom indexing needed. Role filtering via the role-users endpoint avoids fetching all users. Team membership and Slack link status require MongoDB/attribute lookups but the dataset is smaller after Keycloak-side pagination narrows results.

**Alternatives considered**: Client-side pagination (rejected — doesn't scale to 1000+ users); custom user index in MongoDB (rejected — adds sync complexity and dual-write risk); GraphQL layer over Keycloak (over-engineering for current needs).

---

## R-11: Slack identity linking callback architecture (FR-025)

**Decision (2026-03-25)**: The OAuth callback for Slack identity linking lives at **`/api/auth/slack-link`** in the **Next.js BFF**. The Slack bot generates a linking URL containing a **single-use nonce** (32 bytes, hex-encoded) and `slack_user_id` as query parameters. The BFF validates the nonce against MongoDB (`slack_link_nonces`), initiates Keycloak OIDC authorization code flow, exchanges the code for tokens, extracts `keycloak_sub`, stores the `slack_user_id ↔ keycloak_sub` mapping as a Keycloak user attribute via Admin API, marks the nonce as consumed, renders a success page in the browser, and posts a confirmation DM to the user via the **Slack Web API** using `SLACK_BOT_TOKEN`.

**Rationale**: The BFF already has Keycloak OIDC integration (NextAuth). Hosting the callback there avoids adding HTTP server capabilities to the Python Slack bot. Direct Slack API call for the confirmation DM avoids inter-service webhook infrastructure. The bot remains a pure Slack Bolt app with no inbound HTTP requirements.

**Alternatives considered**: Bot backend callback (rejected — adds HTTP server to bot); webhook from BFF to bot for DM (rejected — adds inter-service dependency); lazy detection on next command (rejected — no immediate in-Slack feedback); dedicated linking microservice (over-engineering).

---

## R-12: Nonce storage and TTL for identity linking (FR-025)

**Decision (2026-03-25)**: Nonces are stored in MongoDB collection `slack_link_nonces` with a **10-minute TTL** via MongoDB TTL index on `created_at`. Each document contains `nonce` (unique), `slack_user_id`, `created_at`, and `consumed` (boolean). On callback, the BFF validates: (1) nonce exists, (2) not consumed, (3) not expired. After successful use, `consumed` is set to `true` (prevents replay even before TTL expiry).

**Rationale**: MongoDB TTL indexes auto-expire documents — no cron or cleanup needed. 10 minutes allows for MFA prompts and browser switching while limiting the interception window. Single-use + consumed flag prevents replay attacks.

**Alternatives considered**: Redis TTL (rejected — not in current stack for this use case); in-memory store (rejected — doesn't survive BFF restarts); 5-minute TTL (too short for MFA); 30-minute TTL (unnecessarily long exposure).
