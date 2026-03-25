# Feature Specification: Enterprise RBAC for Slack and CAIPE UI

**Feature Branch**: `098-enterprise-rbac-slack-ui`  
**Created**: 2026-03-24  
**Status**: Draft  
**Input**: User description: "let's design the Enterprise RBAC for slack features and caipe-ui"

**Scope update (2026-03-23)**: **Knowledge bases / datasources** and **tool-based** (runtime) RBAC are **explicitly in scope** (**FR-015**, **FR-016**, Session 2026-03-23).

**Scope update (2026-03-28)**: Stakeholder direction—enterprise RBAC covers **supervisor**, **RAG**, **sub-agents**, **tools**, **skills**, **Admin**, **A2A**, and **MCP**, not only Slack and web UI (see Session 2026-03-28).

**Scope update (2026-04-02)**: **093 normative requirements absorbed** — OBO / token exchange, multi-hop delegation, multi-tenant isolation, bot service account authorization, and architecture are now part of **098** (Session 2026-04-02). 093 research documents remain as references; 093 is **superseded** for normative purposes.

## Clarifications

### Session 2026-03-23

- Q: Can we include RBAC for **KBs** and **tool-based** RBAC as well? → A: **Yes.** **Knowledge bases and datasources** MUST be **first-class** protected resources in the **permission matrix**—not only as **bindings** on custom RAG tools—including, where the product exposes them, **administration** (create/update/delete/config), **ingest**, **query/search/retrieval**, and **visibility/listing**, scoped by **team or org** as applicable (**FR-015**). **Tool-based RBAC** MUST cover **runtime invocation** of **agent tools, MCP tools, and tool categories** per **principal** and **scope**, with matrix rows **aligned** to **ASP / Global Tool Authorization** so enterprise denial **cannot** be bypassed at invocation time (**FR-016**, **FR-012**).

### Session 2026-03-24

- Q: Should users expect per-channel RAG organization (vs only prioritizing datasources in the custom prompt), and does that speed up the assistant? → A: Custom RAG tools that query only certain datasources **already exist**; the gap is **RBAC in the UI** so teams can **create and maintain** those tools **for their team** instead of one shared pool everyone can edit. Narrower KBs are **not assumed to be the main latency bottleneck** for the assistant; retrieved volume may stay similar, with a **possible reduction in answer quality** when tangentially related facts live outside the preferred dataset.
- Q: How should Microsoft AD / Entra groups, Okta groups, and team-based knowledge access relate to RBAC? → A: **Directory groups** from the customer’s IdP (e.g., **Okta groups**, **Microsoft Entra ID / AD-backed groups**) are mapped into **roles or permission scopes** that control **who may configure team-scoped RAG tools** and **which knowledge bases or datasource bindings** each team may use—enforcing **team-based KB access** without a single global edit surface.
- Q: Do we need Keycloak to implement this feature, and should the Slack bot authenticate via Keycloak vs Okta? → A: *(Initially "Keycloak is not mandatory." **Superseded by Session 2026-04-03**: Keycloak is now **required** as the platform's OIDC / authorization broker. Enterprise IdPs federate into Keycloak. See **FR-011**.)*

### Session 2026-03-25

- Q: How does **098** work together with **[093-agent-enterprise-identity](../093-agent-enterprise-identity/spec.md)** where we implement **OBO**? → A: *(Originally described 093/098 as separate, composable specs. **Superseded by Session 2026-04-02**: 093 normative requirements are now **absorbed** into 098; **FR-018**–**FR-021** cover OBO, delegation, multi-tenant, and bot auth directly.)* 093 research documents remain as references.

### Session 2026-03-26

- Q: Do we need **AgentGateway** in this (**098**) implementation? → A: *(Initially **No**—superseded by Session 2026-04-01: AG is now **required** for **MCP + A2A + agent** traffic.)*

### Session 2026-03-27

- Q: Does **098** RBAC cover **supervisor**, **RAG**, **sub-agents**, **tools**, **skills**, **Admin**, **A2A**, and **MCP**? → A: **Partial by design (initial).** *(Superseded for product scope—see Session 2026-03-28.)*

### Session 2026-03-28

- Q: Should **098** enterprise RBAC cover **supervisor**, **RAG**, **sub-agents**, **tools**, **skills**, **Admin**, **A2A**, and **MCP**? → A: **Yes.** The **permission model** and **matrix** MUST extend to **all** of these **components**: **Admin** (web UI and related APIs), **Slack**, **Supervisor** (routing, delegation, orchestration entry points), **RAG** (administrative and data-plane APIs behind forwarded identity), **sub-agents** (dispatch, handoff, and invocation attributable to a user or service context), **tools** (both **configuration**—e.g. team RAG tools—and **runtime** MCP/agent tool invocation), **skills** (where registered or executed in the platform), **A2A** (inter-agent tasks, artifacts, and streaming boundaries), and **MCP** (tool listing and invocation on MCP servers). **Default deny** applies everywhere. **FR-008** and **FR-014** list and classify **every** such entry point. **093** and **ASP / Global Tool Authorization** remain authoritative for **OBO** and **policy-engine** mechanics; **098** MUST **align** capability keys and roles so enterprise RBAC and tool policy **do not** silently conflict—**precedence** and **composition** rules MUST be **documented** in the matrix or operator guide.

### Session 2026-03-29

- Q: **AgentGateway** uses **CEL** for policy—is **CEL** a **better** way to evaluate policy (for **098**)? → A: **Not a 098 product decision; CEL is a strong but optional pattern for tool policy.** **CEL** (Common Expression Language) fits **sandboxed, deterministic** rules over **structured attributes** and is a **reasonable** choice when **093** / **AgentGateway** implements **tool-path** policy. Whether it is **“better”** than alternatives (e.g. **OPA/Rego**, **custom code**, vendor PDPs) depends on **ops**, **skills**, and **ecosystem**—there is **no universal** winner. **098** does **not** require **CEL** (or any **policy DSL**) to deliver the **enterprise permission matrix**; **098** requires **aligned allow/deny outcomes** with **ASP / tool** policy (**FR-012**, **FR-016**). Selection of **CEL** vs other engines for **AgentGateway** stays under **093**.

### Session 2026-03-30

- Q: Should **AgentGateway** (JWT + **CEL** policy for **MCP** and **agents**, especially **remote MCP** or MCP **without native auth primitives**) be included as an **external system** in **098**? → A: *(Initially **optional external**—superseded by Session 2026-04-01: AG is now **mandatory** for **MCP + A2A + agent** traffic.)*

### Session 2026-03-31

- Q: Should **098** reference the public **Agent Gateway** project at **agentgateway.dev**? → A: **Yes.** **[Agent Gateway](https://agentgateway.dev/)** is the **canonical public reference** for an **open-source**, **MCP**- and **A2A**-native **data-plane gateway** (**JWT**, **RBAC**, policy-based authorization, observability) that matches the **required external ingress** role in **FR-017**. AG uses **[CEL (Common Expression Language)](https://agentgateway.dev/docs/reference/cel/)** for authorization rules; **098** requires **aligned security outcomes** (**FR-012**).

### Session 2026-04-01

- Q: What scope of **[Agent Gateway](https://agentgateway.dev/)** mandate for **098**? → A: **MCP + A2A + agent traffic only** (**Option B**). **[Agent Gateway](https://agentgateway.dev/)** is **required** for **MCP tool calls**, **A2A inter-agent traffic**, and **agent/sub-agent dispatch**. **Slack** and **Admin UI** continue with **existing BFF/bot** enforcement (NextAuth, Slack Bolt). AG validates **JWT** from the tenant's **OIDC provider** (Keycloak, Okta, Entra—see [AG Keycloak MCP auth tutorial](https://agentgateway.dev/docs/kubernetes/latest/mcp/auth/keycloak/)) and applies **policy-based** access control. This **supersedes** **FR-013** (formerly "implementable without AG") and rewrites **FR-017**; previous "optional" sessions (2026-03-26, 2026-03-30) are superseded for MCP/A2A/agent paths.

### Session 2026-04-02

- Q: Should **093** be collapsed into **098** as a single specification? → A: **Yes — normative requirements absorbed (Option B).** 093's **normative FRs** (OBO / token exchange, multi-hop delegation, multi-tenant isolation, bot service account authorization) and **architecture** are absorbed into **098** (**FR-018**–**FR-021**). 093 **research documents** (policy engine comparison, AgentGateway/Keycloak/Slack research, I/O guardrails) remain **in place as references** and are **not** moved. **093** is marked **superseded by 098** for all normative requirements. The [093 architecture diagram](../093-agent-enterprise-identity/architecture.md) becomes the **canonical architecture reference** for 098.
- Q: Should **098** have its own architecture document? → A: **Yes (Option A).** Create `098-enterprise-rbac-slack-ui/architecture.md` with an updated diagram showing AG as required, all RBAC enforcement points, OBO flow, and multi-tenant boundaries. 093's architecture becomes a **historical reference**. See [098 architecture](./architecture.md).
- Q: How are **Okta groups** mapped to **scopes** (or roles)? → A: **OIDC claims mapping (Option B).** Okta groups are carried as a `groups` claim in the **OIDC token**; the OIDC provider (**Keycloak** broker or **Okta** directly) maps groups → roles at **token issuance time**. The platform resolves roles from **JWT claims only** — no runtime SCIM/directory lookups on the hot path. See **FR-010**.
- Q: For **UI/Slack** (non-AG paths), where does the RBAC authorization decision happen? → A: *(Initially Keycloak AuthZ + caipe-authorization-server fallback. **Superseded by Session 2026-04-03**: Keycloak is now **required**; `caipe-authorization-server` eliminated.)*

### Session 2026-04-03

- Q: Should **Keycloak** be **mandated** for **098**? → A: **Yes — Keycloak as required broker (Option B).** **Keycloak** is the platform's **required OIDC / authorization layer**. Enterprise customers **federate** their existing IdP (**Okta**, **Entra ID**, **SAML**) into Keycloak via **identity brokering**. Keycloak provides: **OBO / token exchange** (RFC 8693), **Authorization Services** (PDP for UI/Slack RBAC), **groups → roles mapping** at token issuance, and **JWT** issuance with `sub`, `act`, `groups`, `roles`, `scope`, `org` claims. This **supersedes FR-011** (formerly "without requiring Keycloak") and **simplifies FR-022** (eliminates `caipe-authorization-server` fallback). Sessions 2026-03-24 Q3 ("Keycloak is not mandatory") is **superseded**.
- Q: Where are **098 permission matrix** rows and **team/KB assignments** stored at runtime? → A: **Hybrid (Option C).** **Keycloak** holds **authorization policies** (resources, scopes, role-based policies — the PDP data). **MongoDB** holds **team/KB ownership assignments** and **app metadata**. The **Admin UI** writes to **both** via Keycloak Admin API + MongoDB. See **FR-023**.
- Q: How do administrators manage **role mappings**, **team assignments**, and the **permission matrix**? → A: **CAIPE Admin UI (Option A).** Administrators manage RBAC through the existing **CAIPE Admin web interface**, which calls **Keycloak Admin API** for policy/role changes and **MongoDB** for team/KB assignments. See **FR-024**.
- Q: How does a **Slack user** establish the initial mapping between their **Slack user ID** and their **Keycloak identity**? → A: **Interactive OAuth account linking (Option A).** On first interaction, the bot sends a **"Link your account"** message with a URL. User clicks → redirected to **Keycloak OIDC login** → authenticates (via federated Okta/Entra) → on success, bot backend stores `slack_user_id ↔ keycloak_sub` mapping. Subsequent commands use this stored link for **OBO exchange**. See **FR-025**.

### Session 2026-03-24 (RAG RBAC Integration)

- Q: How can we map RAG RBAC to use the new Keycloak system and apply the same RBAC for each knowledge base? → A: **Defense-in-depth with hybrid per-KB access.** The RAG server MUST validate Keycloak-issued JWTs directly and map Keycloak realm roles to RAG server roles (e.g., `admin` → `admin`, `kb_admin` → `ingestonly`, `chat_user` → `readonly`) (**FR-026**). Per-KB access MUST combine two sources: (a) **Keycloak per-KB roles** (e.g., `kb_reader:platform-docs`, `kb_ingestor:team-a-docs`) for fine-grained role-based access, and (b) **team ownership** from MongoDB (`TeamKbOwnership`) for team-scoped access (**FR-027**). Global roles (`admin`, `kb_admin`) grant access to all KBs. Query-time filtering MUST restrict `/v1/query` results to KBs the user is permitted to access (server-side enforced, transparent to caller). The BFF continues to perform coarse Keycloak AuthZ checks (`rag#kb.query`, `rag#kb.ingest`, `rag#kb.admin`) as the first layer; the RAG server validates the JWT and enforces per-KB access as the second layer.

### Session 2026-03-25 (Dynamic Agent RBAC + CEL Mandate)

- Q: What are "dynamic agents" for RBAC purposes? → A: **Both runtime-registered A2A agents AND user-created tool wrappers (Option C).** Dynamic agents include agents registered at runtime (via A2A discovery or admin provisioning) and user-created agents (via the dynamic agents UI/API). Each type receives distinct RBAC treatment: runtime-registered agents get Keycloak service accounts with scoped realm roles; user-created agents get Keycloak resource representations with visibility-based policies. Both are governed by the same three-layer authorization model (**FR-028**).
- Q: Should 098 mandate a specific policy engine for all enforcement points? → A: **Yes — CEL is mandated everywhere.** **CEL (Common Expression Language)** MUST be the policy evaluation language at **all** enforcement points: **Agent Gateway** (already uses CEL), **RAG server** (per-KB access), **dynamic agents** (per-agent access), and **BFF middleware** (RBAC checks). Each service embeds a CEL evaluator library; policy expressions are **configurable, not hardcoded**. This **supersedes** Session 2026-03-29 ("CEL is optional for 098") (**FR-029**).
- Q: How should dynamic agents be represented in Keycloak for RBAC? → A: **B+C+D combined (layered).** Dynamic agents use **three combined layers**: (B) each agent is a **Keycloak resource** with scopes (`view`, `invoke`, `configure`, `delete`); (C) per-agent **Keycloak realm roles** on user profiles (`agent_user:<agent-id>`, `agent_admin:<agent-id>`, wildcards `agent_user:*`); (D) existing **MongoDB visibility** model (`private`/`team`/`global` + `shared_with_teams` + `owner_id`) with **CEL evaluation**. Effective access is the **union** of per-agent roles, team visibility, and ownership. Global roles (`admin`) override (**FR-028**).
- Q: Should dynamic agent MCP tool invocations route through Agent Gateway? → A: **Yes — route through Agent Gateway.** Deepagent MCP calls MUST go through AG with the user's **OBO JWT**; AG applies **CEL policy** on tool invocations consistent with **FR-013**. The `AgentRuntime` MUST forward user identity context (OBO JWT) through the LangGraph execution graph to the MCP client layer (**FR-030**).

## Related work

| Spec | Focus | How it pairs with 098 |
|------|--------|-------------------------|
| **[093-agent-enterprise-identity](../093-agent-enterprise-identity/spec.md)** (**superseded by 098**) | Policy comparison, federation, OBO, bots, AgentGateway narrative, tool authorization | **Normative requirements absorbed** into 098 (**FR-018**–**FR-021**, Session 2026-04-02). Research documents (policy engine comparison, AG/Keycloak/Slack research, I/O guardrails) remain as **references**. |
| [098 architecture](./architecture.md) (**primary**) | Full diagram: entry points, OIDC, OBO, PDP, AG, CAIPE platform, multi-tenant | **098-owned** architecture with all enforcement points, AG required, PDP (Keycloak / caipe-authorization-server), OBO flow (Session 2026-04-02). |
| [093 architecture](../093-agent-enterprise-identity/architecture.md) (**historical**) | Original diagram: Slack/Webex → Keycloak → AgentGateway (optional) → CAIPE | **Superseded** by 098 architecture; retained as historical reference. |
| **[Agent Gateway](https://agentgateway.dev/)** (**required**) | LF **open-source** **MCP/A2A** **data-plane** proxy; **JWT**, **RBAC**, policy auth ([Keycloak tutorial](https://agentgateway.dev/docs/kubernetes/latest/mcp/auth/keycloak/)) | **Required** for **MCP**, **A2A**, **agent/sub-agent** traffic (**FR-013**, **FR-017**, Session 2026-04-01); **JWT** validated against tenant OIDC provider; policy dialect per upstream. |

**Out of scope for 098**: ASP migration mechanics—these remain **implementation choices** documented by 093 research. **[Agent Gateway](https://agentgateway.dev/)** uses **[CEL (Common Expression Language)](https://agentgateway.dev/docs/reference/cel/)** for authorization rules; **098** requires **compatible outcomes**. **Implementing / packaging** Agent Gateway upstream—external; **deploying and configuring** AG for **MCP/A2A/agent** paths as part of **098** rollout—**required** (**FR-013**, **FR-017**, Session 2026-04-01).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Organization administrator governs who may use Slack and UI capabilities (Priority: P1)

As an organization administrator, I need a single, enterprise-grade permission model that applies to **Slack**, the **CAIPE web experience**, and **platform entry points** (Supervisor, RAG, agents, tools, skills, A2A, MCP) per **FR-008**, so that the same teams and roles are trusted consistently across surfaces.

**Why this priority**: Without aligned governance, users may be over- or under-privileged on one channel, creating security gaps or blocking legitimate work.

**Independent Test**: Can be validated by defining a small set of roles, assigning users, and confirming identical allow/deny outcomes for the same person in Slack versus the UI for the same protected actions.

**Acceptance Scenarios**:

1. **Given** a user belongs only to roles that may use basic chat features, **When** they attempt an administrative or high-risk action in Slack or the UI, **Then** they are denied with an explanation appropriate to the channel (without exposing internal policy details).
2. **Given** an administrator updates which enterprise group maps to a privileged role, **When** the change has propagated, **Then** affected users gain or lose matching capabilities in both Slack and the UI within the agreed time window (see success criteria).

---

### User Story 2 - End user sees only what they are allowed to use (Priority: P2)

As an end user, I need Slack shortcuts, commands, and UI screens to reflect my permissions, so I am not offered actions I cannot complete and I do not see sensitive areas meant for administrators.

**Why this priority**: Reduces support burden, prevents frustration, and limits accidental exposure of sensitive controls.

**Independent Test**: For each of several test personas, walk through representative Slack flows and UI pages and record visible options versus blocked actions; results must match the authorization matrix.

**Acceptance Scenarios**:

1. **Given** a user lacks permission for workspace administration, **When** they open the CAIPE UI, **Then** administrative destinations are hidden or clearly unavailable (not merely failing after submission).
2. **Given** a user lacks permission for a specific Slack-initiated workflow, **When** they invoke the corresponding entry point in Slack, **Then** they receive a clear denial and the workflow does not proceed.

---

### User Story 3 - Team maintainer configures scoped RAG tools for their team (Priority: P2)

As a team lead or delegated maintainer, I need to create and update custom RAG tools that use only our team’s approved datasources, without sharing one global configuration space that every user can edit, so our retrieval policies stay correct and least-privilege.

**Why this priority**: Today’s capability exists technically, but without UI RBAC, configuration sprawl and cross-team risk block safe self-service.

**Independent Test**: Two teams each have distinct directory-group mappings; a maintainer on team A can create or edit only tools and KB bindings allowed for team A, and cannot modify team B’s tools; unauthorized users cannot edit any team’s tools.

**Acceptance Scenarios**:

1. **Given** a user is not in a role mapped from their IdP groups to “RAG tool administrator” for team X, **When** they open CAIPE UI configuration for team X’s tools, **Then** they cannot save changes (and preferably cannot see edit affordances).
2. **Given** directory group membership changes remove a user from team X’s maintainer groups, **When** permissions refresh, **Then** they lose ability to change team X’s RAG tools and datasource bindings in line with other protected capabilities.

---

### User Story 4 - Security or compliance reviewer audits access consistency (Priority: P3)

As a security or compliance reviewer, I need documentation and evidence that Slack and UI enforce the same permission rules for the same identities, so audits can treat the platform as one controlled surface.

**Why this priority**: Enterprise adoption depends on demonstrable consistency and traceability.

**Independent Test**: Reviewer can trace from a published permission matrix to sample audit records showing allow/deny decisions for both channels for the same test users.

**Acceptance Scenarios**:

1. **Given** a documented list of protected capabilities and required roles, **When** the reviewer samples decisions for Slack and UI, **Then** no capability appears permitted in one channel while forbidden in the other for the same user under the same conditions.
2. **Given** a denied action, **When** the reviewer inspects audit evidence, **Then** the record includes who was acting, which capability was requested, and the outcome, without storing unnecessary personal data.

---

### User Story 5 - Bot-to-agent delegation carries user identity end-to-end (Priority: P1) *(absorbed from 093)*

As a platform operator, I need the Slack/Webex bot to obtain an OBO token scoped to the commanding user, so that every downstream agent and tool call is authorized as that user — not as the bot service account — and no privilege escalation occurs along the delegation chain.

**Why this priority**: Without end-to-end user identity, bot actions default to the bot's own (often over-privileged) service account, violating least privilege and breaking audit traceability.

**Independent Test**: A user with limited permissions issues a command in Slack; the bot obtains an OBO token; the agent invokes a tool via Agent Gateway. Verify: (a) the JWT `sub` = user, `act` = bot; (b) AG enforces the user's scope, not the bot's; (c) a tool outside the user's matrix row is denied.

**Acceptance Scenarios**:

1. **Given** a user with role `chat_user` (no admin) issues a Slack command, **When** the bot exchanges the Slack identity for a Keycloak OBO token, **Then** the token's `scope` and `roles` reflect only the user's entitlements, not the bot service account's full scope.
2. **Given** the delegation chain user → bot → supervisor → agent → MCP tool, **When** any hop is traced in audit logs, **Then** the originating user principal is present and effective permissions are the intersection of user entitlements and 098 matrix (**FR-019**).

---

### User Story 6 - Administrator manages roles and group mappings from the CAIPE UI (Priority: P2)

As a platform administrator, I need to create custom roles, map AD/IdP groups to roles, and assign roles to teams from the CAIPE Admin UI, so that I do not need direct Keycloak Admin Console access for day-to-day RBAC operations.

**Why this priority**: Without a self-service RBAC management UI, every role or mapping change requires Keycloak Admin Console access, which is operationally impractical for platform teams and creates a bottleneck on infrastructure admins.

**Independent Test**: An admin creates a custom role, maps an AD group to it, and assigns it to a team — all from the CAIPE Admin UI. A user in that AD group logs in and receives the new role in their JWT. The admin cannot delete built-in roles.

**Acceptance Scenarios**:

1. **Given** an admin opens the "Roles & Access" tab in the CAIPE Admin UI, **When** the page loads, **Then** they see all Keycloak realm roles with descriptions and "built-in" badges for protected roles (`admin`, `chat_user`, `team_member`, `kb_admin`, `offline_access`).
2. **Given** an admin creates a new role with a name and description, **When** the role is saved, **Then** it is created in Keycloak via the Admin REST API and immediately appears in the roles list and is available for group mapping and team assignment.
3. **Given** an admin maps an AD group to a role (e.g., `backstage-access` → `chat_user`), **When** the mapping is saved, **Then** a Keycloak IdP mapper is created on the selected identity provider, and future logins from users in that AD group receive the mapped role in their JWT.
4. **Given** an admin assigns roles to a team, **When** the assignment is saved, **Then** the team document in MongoDB is updated with `keycloak_roles` and team-scoped authorization reflects the assigned roles.
5. **Given** an admin attempts to delete a built-in role, **When** they click delete, **Then** the action is blocked and the role remains intact.

---

### User Story 7 - RAG server enforces Keycloak-based RBAC with per-KB access control (Priority: P1)

As a platform operator, I need the RAG server to validate Keycloak JWTs directly and enforce per-knowledge-base access control, so that query results, ingest operations, and KB administration are restricted to only the KBs each user is authorized to access — providing defense-in-depth beyond the BFF layer.

**Why this priority**: Without RAG server-side enforcement, any caller that bypasses or misconfigures the BFF proxy can access all KBs. The current RAG server uses group-based RBAC that does not understand Keycloak realm roles, and has no per-KB access restrictions — all authenticated users can query all KBs.

**Independent Test**: Configure two KBs (kb-platform, kb-team-a). Assign `kb_reader:kb-team-a` role to a test user. Verify: (a) RAG server accepts Keycloak JWT and maps realm roles correctly; (b) `/v1/query` returns only results from kb-team-a; (c) an admin user sees results from both KBs; (d) a user with no per-KB role and no team ownership sees no results.

**Acceptance Scenarios**:

1. **Given** a user authenticates with a Keycloak JWT containing `roles: ["chat_user", "kb_reader:kb-team-a"]`, **When** they call `/v1/query` on the RAG server, **Then** results are filtered to only include documents from `kb-team-a` datasources — documents from other KBs are excluded.
2. **Given** a user with Keycloak role `admin` or `kb_admin`, **When** they call any RAG server endpoint, **Then** they have access to all KBs without per-KB role restrictions (global override).
3. **Given** a user whose team owns `kb-platform` via a `TeamKbOwnership` MongoDB record, **When** they call `/v1/query`, **Then** results include documents from `kb-platform` even if they lack an explicit `kb_reader:kb-platform` Keycloak role (team ownership grants access).
4. **Given** a user with Keycloak role `kb_ingestor:kb-team-a`, **When** they call `/v1/ingest` targeting `kb-team-a`, **Then** the ingest is allowed; **When** they target `kb-other`, **Then** the ingest is denied with 403.
5. **Given** the RAG server receives a JWT without a valid Keycloak `roles` claim, **When** it falls back to group-based role assignment, **Then** existing group-based RBAC continues to work (backward compatibility).

---

### User Story 8 - Dynamic agents enforce Keycloak RBAC with CEL policy evaluation (Priority: P1)

As a platform operator, I need dynamic agents to be governed by the same Keycloak RBAC model as all other platform resources, so that agent visibility, invocation, and configuration are restricted by roles, teams, and CEL policies — consistent with KB and tool access controls.

**Why this priority**: Without RBAC on dynamic agents, any authenticated user can view, invoke, and configure all agents regardless of team or role. The current code-based `can_view_agent`/`can_use_agent` checks in `access.py` use group-based admin logic and MongoDB visibility but do not integrate with Keycloak roles or CEL. MCP tool calls from deepagents bypass Agent Gateway entirely, creating an authorization gap.

**Independent Test**: Create two dynamic agents (agent-team-a with `visibility: team`, agent-global with `visibility: global`). Assign `agent_user:agent-team-a` role to a test user. Verify: (a) CEL evaluation restricts listing to authorized agents; (b) per-agent role grants invoke access; (c) admin sees all; (d) deepagent MCP calls route through AG and are denied when user lacks tool role.

**Acceptance Scenarios**:

1. **Given** a user with Keycloak role `team_member(team-a)`, **When** they call `GET /api/v1/agents`, **Then** they see only agents with `visibility: global` and agents with `visibility: team` where `shared_with_teams` includes `team-a` — private agents owned by others are excluded.
2. **Given** a user with Keycloak role `agent_user:agent-123`, **When** they call `POST /api/v1/chat/start-stream` with `agent_id: agent-123`, **Then** the invocation is allowed; **When** they target `agent-456` (no role), **Then** access is denied with 403.
3. **Given** a user with Keycloak role `admin`, **When** they call any dynamic agent endpoint, **Then** they have access to all agents without per-agent role restrictions (global override).
4. **Given** a dynamic agent invokes an MCP tool during a chat session, **When** the MCP client sends the request, **Then** it routes through Agent Gateway with the user's OBO JWT; **When** the user lacks the tool role in AG's CEL policy, **Then** the tool call is denied.
5. **Given** an admin creates a dynamic agent via `POST /api/v1/agents`, **When** the agent is created, **Then** a Keycloak resource (type: `dynamic_agent`) is created with scopes `view`, `invoke`, `configure`, `delete`; **When** the agent is deleted, **Then** the Keycloak resource and any dangling per-agent roles are cleaned up.
6. **Given** all enforcement points (AG, RAG server, dynamic agents, BFF), **When** an authorization decision is made, **Then** CEL is used as the policy evaluation language with configurable expressions — not hardcoded conditional logic.

---

### Edge Cases

- User holds multiple enterprise memberships or switches primary organization context; permissions must resolve deterministically without privilege leakage across tenants.
- Human users versus automated or bot principals: high-risk actions require human-appropriate controls; service identities have narrower, explicitly scoped permissions.
- Slack workspace or enterprise link not yet registered or revoked: user must be denied enterprise Slack features until linkage is valid. **Unlinked Slack users** (no `slack_user_id ↔ keycloak_sub` mapping per **FR-025**) MUST receive an account-linking prompt; all RBAC-protected operations MUST be denied until linking succeeds. If a previously linked user's Keycloak account is disabled or deleted, the link MUST be treated as invalid and the user MUST re-link.
- Delay or partial failure when refreshing role information from the enterprise directory: system must fail closed for protected actions or show a safe degraded experience, not stale elevated access indefinitely.
- **Stacked or brokered identity** (e.g., upstream Okta or Entra with Keycloak as token issuer): operators MUST define **one canonical source of group claims** for RBAC; conflicting or duplicated group sources MUST NOT combine in a way that **elevates** privilege beyond the documented mapping.
- **Layered authorization**: **098** RBAC (including absorbed OBO / delegation — **FR-018**–**FR-019**), **ASP / tool policy**, and **Agent Gateway** policy may **all** apply; operators MUST document **precedence** (e.g., deny wins, or stricter-of-two) so **supervisor, tools, MCP, and A2A** paths do not grant access when **any** applicable layer **denies**.
- **Agent Gateway in the MCP/A2A/agent path (mandatory)**: **All** MCP, A2A, and agent/sub-agent traffic MUST route through **[Agent Gateway](https://agentgateway.dev/)**. AG validates **JWT** from the tenant OIDC provider and applies **policy** per **093**. **Effective** access MUST still satisfy **098** matrix rows for **MCP**/**tool**/**A2A** invocation (**FR-016**); AG MUST **not** become a **bypass** for enterprise denial. If AG is **unavailable**, MCP/A2A/agent traffic MUST **fail closed** (deny).
- **AG unavailability**: If Agent Gateway is down or unreachable, **MCP/A2A/agent** requests MUST be **denied** (fail closed). **Slack** and **Admin UI** are **not** affected (BFF/bot path is independent).
- **KB vs custom RAG tool**: Permission to **use** a custom RAG tool MUST **not** imply **KB/datasource admin or ingest** unless the matrix **explicitly** grants those capabilities or documents **inheritance** rules; default is **no** privilege expansion from tool use alone.
- **Keycloak role-to-RAG role mapping mismatch**: If a Keycloak realm role name conflicts with a legacy RAG group name (e.g., both `admin` as a group and `admin` as a Keycloak role), the Keycloak role MUST take precedence when the `roles` claim is present in the JWT. When the `roles` claim is absent (non-Keycloak token), group-based assignment MUST remain as fallback for backward compatibility.
- **Per-KB role wildcard**: The `kb_reader:*` convention grants read access to all KBs; this MUST NOT be confused with `kb_admin` (which grants admin/ingest/read). Wildcard per-KB roles grant only the specified scope (read, ingest) — not administrative operations.
- **Query-time filter bypass**: If `inject_kb_filter()` fails to resolve accessible KBs (e.g., MongoDB unavailable for team ownership lookup), the query MUST fail closed (return empty results or 503), not return unfiltered results.
- **Dynamic agent visibility with deleted team**: If a dynamic agent has `visibility: team` but the team referenced in `shared_with_teams` has been deleted from MongoDB, the system MUST fail closed — deny access to that agent for non-owners/non-admins.
- **Dangling per-agent Keycloak roles**: If a per-agent Keycloak role (e.g., `agent_user:agent-123`) is assigned to a user but the agent is deleted from MongoDB, the role MUST have no effect (dangling). On agent deletion, the system SHOULD clean up associated Keycloak roles and resource to prevent role pollution.
- **Deepagent sub-agent delegation**: When a deepagent spawns a sub-agent (via `subagents` configuration), the sub-agent MUST inherit the parent user's OBO JWT for MCP tool calls — not the agent's own identity or the bot service account. The delegation chain principal remains the originating user (**FR-019**).
- **CEL evaluator unavailability**: If the CEL evaluator fails to initialize or evaluate a policy expression (e.g., malformed CEL, library error), the system MUST fail closed — deny access rather than fall back to code-based checks or allow by default.
- Emergency break-glass access: if offered, it must be time-bound, explicitly attributed, and fully auditable.
- **Knowledge scope vs answer quality**: When RAG tools are restricted to team-approved datasources, responses may omit useful tangentially related facts that exist only outside that scope; product and support messaging should set expectations without weakening enforcement.

### Explicitly out of scope (this spec)

- Replacing or redefining how custom RAG tools perform retrieval at the model layer (already product capability); this spec covers **who may configure** them and **which KBs/datasources** a team may bind.
- Proving latency improvements for the assistant from KB narrowing; **not** a success criterion here.
- ~~Mandating Keycloak~~ — **Superseded (Session 2026-04-03)**: Keycloak is now **required** as the platform's OIDC / authorization broker (**FR-011**). Enterprise customers federate their existing IdP (Okta, Entra, SAML) into Keycloak.
- **ASP migration mechanics**—these remain **implementation research** documented in **[093 research](../093-agent-enterprise-identity/README.md)**; **098** defines **requirements** for OBO (**FR-018**), delegation (**FR-019**), and multi-tenant (**FR-020**). Agent Gateway's policy language is **[CEL](https://agentgateway.dev/docs/reference/cel/)**.
- 093's **research documents** (policy engine comparison table, AgentGateway/Keycloak/Slack research, I/O guardrails) — retained as **references** in `093-agent-enterprise-identity/`; not moved into this spec directory.
- ~~Agent Gateway uses CEL as its policy language; this is an AG upstream decision, not a 098 prescriptive choice~~ — **Superseded (Session 2026-03-25)**: **CEL** is now **mandated** as the policy evaluation language at **all** enforcement points (**FR-029**). AG continues to use CEL; RAG server, dynamic agents, and BFF MUST also adopt CEL evaluators.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST maintain a documented mapping between enterprise identities (users and designated service principals) and the roles or permission sets that govern **Slack, CAIPE web Admin, Supervisor, RAG, sub-agents, tools, skills, A2A, and MCP**—as enumerated in the **permission matrix** (**FR-008**, **FR-014**).
- **FR-002**: For every **protected capability** in **FR-008**, the system MUST enforce a **default-deny** rule unless the acting principal is explicitly authorized at that entry point.
- **FR-003**: Administrators MUST be able to reason about permissions using a **single conceptual model** (roles or equivalent groupings) across **all** components in **FR-014**, with any **component-specific** differences explicitly documented.
- **FR-004**: Users MUST receive clear, **surface-appropriate** feedback when an action is denied (Slack vs UI vs API error contract), without revealing existence of resources they are not allowed to know about.
- **FR-005**: The system MUST record auditable events for security-relevant allow and deny decisions, sufficient to support enterprise review (subject to privacy and retention policies).
- **FR-006**: Permission changes driven by the enterprise directory or administrator configuration MUST propagate to **effective authorization** on **Slack, UI, Supervisor, RAG, sub-agents, tools, skills, A2A, and MCP** entry points within the success-criteria time window in the steady state (or document stricter SLA per component).
- **FR-007**: High-risk or administrative capabilities MUST be separable so that granting them can follow least privilege (e.g., distinct roles from day-to-day usage), without requiring every user to hold broad access.
- **FR-008**: The authorization design MUST identify **all** integration entry points for **Slack**, **CAIPE web UI (including Admin)**, **Supervisor** (routing, task handoff), **RAG** (admin and data APIs, **including KB/datasource** operations per **FR-015**), **sub-agents**, **runtime tools** (agent/MCP tool calls, **FR-016**), **skills**, **A2A** (inter-agent operations), and **MCP servers** (tool discovery and invocation)—**none** may remain outside the RBAC model.
- **FR-009**: Create, update, delete, and ownership of **custom RAG tools** and their **datasource scope** MUST be protected capabilities in the CAIPE UI. The product MUST NOT present a single undifferentiated configuration area where any authenticated user can edit every team’s tools.
- **FR-010**: The permission model MUST support **mapping from enterprise directory groups** (including **Microsoft Entra ID / AD-backed groups** and **Okta groups** where the customer uses those IdPs) into roles or scopes that govern (a) **who may administer team-scoped RAG tools** and (b) **which knowledge bases or datasource collections** each team may attach to those tools—delivering **team-based knowledge access** aligned with IdP group membership. **Mechanism**: Enterprise IdP groups (Okta, Entra, SAML) are **federated into Keycloak** via identity brokering. Keycloak **claim mappers** carry groups as a `groups` claim in the **OIDC token** and map groups → platform roles at **token issuance time**. The platform resolves roles from **JWT claims only** — no runtime SCIM or directory lookups on the authorization hot path (Session 2026-04-02 Q2, Session 2026-04-03).
- **FR-011**: **Keycloak** is the **required** OIDC / authorization layer for the CAIPE platform (**Session 2026-04-03**). Enterprise customers federate their existing IdP (**Okta**, **Microsoft Entra ID**, **SAML**) into Keycloak via **identity brokering**. Keycloak provides: **OBO / token exchange** (RFC 8693, **FR-018**), **Authorization Services** as the PDP for UI/Slack RBAC (**FR-022**), **groups → roles mapping** at token issuance (**FR-010**), and **JWT** issuance. The **Slack bot** and **Admin UI** MUST derive end-user identity and group-based authorization inputs from the **same Keycloak realm** so RBAC outcomes are **not** undermined by a parallel identity silo. *(Supersedes earlier "without requiring Keycloak" — Session 2026-03-24 Q3.)*
- **FR-012**: **Enterprise RBAC** MUST be **composable** with **OBO** (**FR-018**) and **ASP / tool policy**: the **enterprise subject and group claims** used across **Supervisor, tools, MCP, A2A**, and **UI/Slack** MUST be the **same conceptual principal** where a human user is in the chain. This spec defines the **unified capability matrix**, the **OBO / delegation** chain (**FR-018**–**FR-019**), and **multi-tenant** isolation (**FR-020**); **ASP** defines **how** tool policy is **implemented** (including **[Agent Gateway](https://agentgateway.dev/)** policy per upstream)—implementations MUST **align** capability definitions and document **precedence** when both apply (**Session 2026-03-28**, **Session 2026-03-29**, **Session 2026-03-31**, **Session 2026-04-02**).
- **FR-013**: **[Agent Gateway](https://agentgateway.dev/)** is **required** for **MCP tool calls**, **A2A inter-agent traffic**, and **agent/sub-agent dispatch** (**Session 2026-04-01**). AG MUST validate **JWT** issued by **Keycloak** (see [AG Keycloak tutorial](https://agentgateway.dev/docs/kubernetes/latest/mcp/auth/keycloak/)) and enforce **policy-based** access control aligned with the **098** matrix (**FR-012**, **FR-016**). **Slack** and **Admin UI** enforcement continues via **BFF / Slack bot** calling **Keycloak Authorization Services** (not routed through AG). If AG is **unavailable**, MCP/A2A/agent requests MUST **fail closed**.
- **FR-014**: The **permission matrix** MUST list, per **component**, all protected capabilities for: **Admin** (web), **Slack**, **Supervisor**, **RAG**, **sub-agents**, **tools** (config + runtime), **skills**, **A2A**, and **MCP**. Each row MUST include **component**, **capability id**, **channels or APIs affected**, **required roles / IdP groups**, and **relationship to ASP or tool policy** where applicable. **No** enumerated entry point may be omitted.
- **FR-015**: **Knowledge bases and datasources** MUST be **first-class** resources in the matrix: capabilities such as **listing/visibility**, **administration**, **ingest**, and **query/search** (or equivalent product operations) MUST be **authorized per principal** with **team or org scope** where applicable. **FR-009** / **FR-010** **custom RAG tool** bindings remain required but **do not** replace **FR-015** where KBs exist outside a single tool definition.
- **FR-016**: **Tool-based RBAC** (runtime): The matrix MUST define **which tools or tool groups** (including **MCP tool names** or **stable tool ids**) a principal may **invoke**, and under what **scope**. Implementations MUST **align** these rows with **ASP / Global Tool Authorization** (**FR-012**); **effective** runtime invocation MUST **deny** if **either** enterprise RBAC or **ASP** denies.
- **FR-017**: **Deployment architecture** for **098** MUST include **Keycloak** and **[Agent Gateway](https://agentgateway.dev/)** as **required infrastructure components**. The **operator guide** MUST document: (a) **Keycloak** realm setup with enterprise IdP federation (Okta/Entra/SAML brokering), groups→roles claim mappers, OBO token exchange, and Authorization Services resource/policy configuration; (b) **AG deployment** (standalone or Kubernetes per upstream docs) with **Keycloak** as the OIDC provider ([reference tutorial](https://agentgateway.dev/docs/kubernetes/latest/mcp/auth/keycloak/)); (c) **policy rules** that mirror **098** matrix rows for **tool invocation** (**FR-016**), **A2A**, and **agent dispatch**; (d) **composition / precedence** with **ASP** (**FR-012**); (e) **fail-closed** behavior when AG or Keycloak is unavailable. **Slack** and **Admin UI** enforcement uses **Keycloak Authorization Services** (independent of AG) (**Session 2026-04-01**, **Session 2026-04-03**).

#### Absorbed from 093 (Session 2026-04-02)

- **FR-018**: **OBO / Token Exchange** — implementations MUST support **OAuth 2.0 Token Exchange** (**RFC 8693**) so that agents (and bot service accounts) can act **on behalf of** an authenticated user. The resulting **OBO token** MUST carry both **principal** (`sub`) and **actor** (`act`) identities plus **scope**, **roles**, and **org** claims issued by the tenant's OIDC provider. The OBO flow is the mechanism for **bot → agent → tool** delegation chains (see [093 architecture](../093-agent-enterprise-identity/architecture.md)).
- **FR-019**: **Multi-hop delegation** — the authorization chain (**user → bot → supervisor → agent → tool**) MUST be **traceable end-to-end**. Each hop MUST carry the **originating user principal** (via OBO or equivalent forwarded identity), and MUST **NOT** silently escalate privileges: effective permissions at each hop are the **intersection** of the user's entitlements, the delegating service account's scope, and the **098** matrix row for that component (**FR-008**, **FR-016**). At least **two** candidate policy engines MUST support end-to-end traceability of this chain (093 SC-006).
- **FR-020**: **Multi-tenant isolation** — authorization MUST enforce **tenant boundaries**: a principal authenticated in **org A** MUST NOT access **resources**, **agents**, **tools**, **KBs**, or **MCP servers** belonging to **org B**. Tenant context MUST be an explicit attribute in the **098** matrix and in **Agent Gateway** policy rules where AG is in the path.
- **FR-021**: **Bot service account authorization** — **Slack** and **Webex** bot backends MUST authenticate via **Keycloak** using a **service account**. Bot actions MUST be authorized under an **OBO token** (**FR-018**) whose effective scope MUST **NOT exceed** the delegating user's authorization scope. The bot MUST **NOT** use a separate identity silo disconnected from enterprise directory groups (**FR-011**). See [093 research: Slack bot authorization](../093-agent-enterprise-identity/research-slack-bot-authorization.md).
- **FR-022**: **RBAC Policy Decision Point (PDP) for UI/Slack** — For **non-AG** request paths (**Admin UI** via NextAuth BFF, **Slack** via Slack Bolt), authorization decisions MUST be evaluated by **Keycloak Authorization Services** (UMA / resource-based permissions) as the **PDP** (**Session 2026-04-03**). The PDP MUST: (a) consume **JWT identity and group claims** from **FR-010**; (b) evaluate them against the **098 permission matrix** (**FR-014**) modeled as Keycloak **resources**, **scopes**, and **policies**; (c) return **allow/deny** decisions with **audit-grade** detail (**FR-005**); (d) support **sub-5ms** decision latency on the hot path. **Agent Gateway** remains the PDP for **MCP/A2A/agent** paths (**FR-013**). *(`caipe-authorization-server` fallback eliminated — Keycloak is required per FR-011.)*
- **FR-023**: **RBAC configuration store (hybrid)** — **Keycloak** MUST store authorization policies (resources, scopes, role-based policies) that constitute the **PDP data** for **FR-022**, as well as **Slack identity links** stored as **custom user attributes** (**FR-025**). **MongoDB** MUST store **team/KB ownership assignments**, **app metadata**, **ASP tool policies**, and **operational RBAC state** (e.g., which teams own which KBs, custom RAG tool bindings per **FR-009**). The **Admin UI** (**FR-024**) MUST write to **both** stores: **Keycloak Admin API** for policy/role changes and **MongoDB** for team/KB assignments. Changes to either store MUST propagate to effective authorization within **FR-006** time window (Session 2026-04-03).
- **FR-024**: **CAIPE Admin UI for RBAC management** — Administrators MUST be able to manage **role-to-capability mappings**, **team/KB assignments**, and view the **permission matrix** through the existing **CAIPE Admin web interface**. The Admin UI MUST call **Keycloak Admin API** for creating/updating roles, resources, scopes, and policies (**FR-023**) and **MongoDB** for team/KB ownership and app metadata. Administrators MUST NOT be required to use the **Keycloak Admin Console** directly for day-to-day RBAC operations (Session 2026-04-03).
- **FR-025**: **Slack identity linking (account linking)** — On **first interaction** with the Slack bot, if no `slack_user_id ↔ keycloak_sub` mapping exists, the bot MUST send a **"Link your account"** message containing a secure URL. The user clicks the URL → is redirected to **Keycloak OIDC login** → authenticates (via federated Okta/Entra) → on success, the bot backend MUST store the `slack_user_id ↔ keycloak_sub` mapping as a **custom Keycloak user attribute** (`slack_user_id`) via the **Keycloak Admin API**. Subsequent Slack commands MUST resolve the mapping by querying **Keycloak Admin API** (find user by attribute `slack_user_id`) and then perform **OBO token exchange** (**FR-018**). The Slack bot has **no MongoDB dependency** for identity linking — all identity state is stored in Keycloak. The linking URL MUST be **single-use**, **time-bounded** (short TTL), and **HTTPS-only**. The bot MUST **deny** all RBAC-protected operations for unlinked users (Session 2026-04-03).

#### RAG Server Keycloak Integration (Session 2026-03-24)

- **FR-026**: **RAG Server Keycloak JWT Integration** — The RAG server MUST validate Keycloak-issued JWTs as a **second enforcement layer** (defense-in-depth with the BFF). When the JWT `roles` claim is present (indicating a Keycloak-issued token), the RAG server MUST map Keycloak realm roles to RAG server roles: `admin` → `admin` (read, ingest, delete); `kb_admin` → `ingestonly` (read, ingest); `team_member` → `readonly` (read); `chat_user` → `readonly` (read); no matching role → `anonymous` (no access). When the `roles` claim is absent (non-Keycloak token), the RAG server MUST fall back to the existing group-based role assignment (`RBAC_ADMIN_GROUPS`, `RBAC_INGESTONLY_GROUPS`, `RBAC_READONLY_GROUPS`) for backward compatibility. The RAG server's OIDC provider configuration MUST include the Keycloak realm as a trusted issuer (**FR-011**).
- **FR-027**: **Per-KB Access Control (Hybrid)** — The RAG server MUST enforce **per-knowledge-base** access control by combining two sources: (a) **Keycloak per-KB roles** — realm roles following the convention `kb_reader:<kb-id>` (read), `kb_ingestor:<kb-id>` (read + ingest), `kb_admin:<kb-id>` (full admin), and wildcard `kb_reader:*` / `kb_ingestor:*` (all KBs at that scope), extracted from the JWT `roles` claim; and (b) **team ownership** — the `TeamKbOwnership` MongoDB collection linking teams to `kb_ids` and `allowed_datasource_ids`. Effective KB access is the **union** of both sources: a user may access a KB if they have EITHER a matching per-KB Keycloak role OR their team owns the KB. Global roles (`admin`, `kb_admin`) MUST grant access to **all** KBs without requiring per-KB roles. The `/v1/query` endpoint MUST inject a `datasource_id` filter into vector DB queries based on the user's accessible KB list (**query-time filtering**), ensuring results are restricted to authorized KBs (server-side enforced, transparent to the caller). If the team ownership lookup fails (MongoDB unavailable), the system MUST fail closed — deny access rather than return unfiltered results (**FR-002**).

#### Dynamic Agent RBAC + CEL Mandate (Session 2026-03-25)

- **FR-028**: **Dynamic Agent RBAC (Three-Layer Model)** — Dynamic agents (both runtime-registered A2A agents and user-created tool wrappers) MUST be **first-class RBAC resources** using a three-layer authorization model: **(B) Keycloak resources** — each agent is registered as a Keycloak resource (type: `dynamic_agent`) with scopes `view`, `invoke`, `configure`, `delete`; policies auto-generated from visibility level; **(C) per-agent realm roles** — Keycloak realm roles following the convention `agent_user:<agent-id>` (view + invoke), `agent_admin:<agent-id>` (view + invoke + configure + delete), and wildcard `agent_user:*` / `agent_admin:*` (all agents at that scope); **(D) MongoDB visibility** — existing `visibility` (`private`/`team`/`global`), `shared_with_teams`, and `owner_id` fields remain the operational data store, with **CEL** evaluating access by combining JWT roles, MongoDB visibility, and team membership. Effective access is the **union** of per-agent roles, team visibility, and ownership. Global roles (`admin`) grant access to **all** agents without per-agent roles. On agent creation, a Keycloak resource MUST be synced; on deletion, the resource and dangling per-agent roles MUST be cleaned up. Query-time filtering (agent listing) MUST evaluate CEL for each agent and return only those the user can access.
- **FR-029**: **CEL as Mandated Policy Engine** — **CEL (Common Expression Language)** MUST be the policy evaluation language at **all** authorization enforcement points: (a) **Agent Gateway** — CEL policy for MCP/A2A/agent traffic (already implemented); (b) **RAG server** — CEL for per-KB access checks (replacing code-based `get_accessible_kb_ids`, **FR-027**); (c) **Dynamic Agents service** — CEL for per-agent access checks (replacing code-based `can_view_agent`/`can_use_agent`, **FR-028**); (d) **BFF middleware** — CEL for RBAC permission checks (extending `requireRbacPermission`). Each service MUST embed a CEL evaluator library (Python: `cel-python`; TypeScript: `cel-js` or equivalent). Policy expressions MUST be **configurable** (loaded from config/DB), **not hardcoded** in application code. A shared **CEL context schema** MUST be defined with standard fields: `user.roles`, `user.teams`, `user.email`, `resource.id`, `resource.type`, `resource.visibility`, `resource.owner_id`, `resource.shared_with_teams`. This **supersedes** Session 2026-03-29 ("CEL is optional for 098") and updates the out-of-scope declaration regarding CEL.
- **FR-030**: **Dynamic Agent MCP Routing via Agent Gateway** — MCP tool invocations from dynamic agent runtimes (LangGraph `deepagent`) MUST route through **Agent Gateway** with the user's **OBO JWT** (**FR-018**). AG MUST apply **CEL policy** on tool invocations consistent with **FR-013**. The `AgentRuntime` MUST accept and store the OBO JWT from `UserContext`, forward it through the LangGraph execution graph, and attach it as `Authorization: Bearer` on all outbound MCP client requests to AG. This ensures dynamic agent tool calls are subject to the same enterprise RBAC as all other MCP traffic — dynamic agents MUST NOT be a bypass path around enterprise authorization.

### Key Entities *(include if feature involves data)*

- **Principal**: A human user or approved non-human actor identified by the enterprise (and channel context where relevant).
- **Role (or permission set)**: A named bundle of capabilities used for administration and user assignment; should align with enterprise group or role conventions where possible.
- **Protected capability**: A discrete action or area (e.g., triggering a class of workflow, viewing sensitive configuration) that must be authorized.
- **Resource context**: The scope in which a capability applies (for example organization, workspace, or project), when permissions are not purely global.
- **Authorization decision record**: Minimal information needed to explain an allow or deny for audit, linked to a principal, capability, outcome, and time.
- **Permission matrix**: The human-readable contract listing capabilities, required roles, **component** (e.g. `admin_ui`, `slack`, `supervisor`, `rag`, `sub_agent`, `tool`, `skill`, `a2a`, `mcp`), and applicable surfaces or APIs.
- **Directory group (IdP)**: A group object from the customer’s identity system (e.g., Okta group, Entra security group) carried in claims or synced mappings; may be issued **directly** by that IdP or **via a broker/OIDC server** (e.g., Keycloak) that federates it—input to resolving roles for KB and RAG-tool administration.
- **Team-scoped RAG tool configuration**: A custom RAG tool definition limited to approved datasources for a team or org scope; subject to RBAC separate from end-user chat.
- **Knowledge base / datasource (KB)**: A first-class knowledge or data source object (or collection) whose **admin, ingest, query, and visibility** are governed by **FR-015**, independent of whether it is referenced only via a custom RAG tool.
- **Agent Gateway (required for MCP/A2A/agent)**: **[Agent Gateway](https://agentgateway.dev/)** — **required** infrastructure at **MCP/A2A/agent** ingress (**FR-013**). Validates **JWT** from tenant OIDC provider; applies **[CEL](https://agentgateway.dev/docs/reference/cel/)** authorization rules. **Not** in the **Slack** or **Admin UI** request path.
- **OBO Token** *(absorbed from 093)*: A token obtained via **OAuth 2.0 Token Exchange** (**RFC 8693**) that allows a service account (agent or bot) to act **on behalf of** a user. Carries both **principal** (`sub`) and **actor** (`act`) identities. Key relationship: consumed by Agent Gateway and CAIPE platform components; scope MUST NOT exceed delegating user's entitlements (**FR-018**, **FR-019**).
- **Bot Service Account** *(absorbed from 093)*: An identity representing a **Slack** or **Webex** bot that acts as an intermediary between user commands and CAIPE agent execution. Authenticates via the tenant's **OIDC provider**; actions are authorized under an **OBO token** scoped to the delegating user (**FR-021**). Key constraint: MUST NOT exceed the delegating user's authorization scope; MUST NOT use a disconnected identity silo.
- **Keycloak JWT** *(absorbed from 093)*: An identity token issued by **Keycloak** (or equivalent OIDC provider) containing claims (`sub`, `act`, `scope`, `roles`, `groups`, `org`) used to convey user identity, group memberships, and delegated authority. The `groups` claim carries **IdP directory groups** mapped to roles at token issuance (**FR-010**). Key relationship: consumed by **Agent Gateway** and **PDP** for validation and policy evaluation (**FR-013**, **FR-018**, **FR-022**).
- **Dynamic Agent (resource)** *(Session 2026-03-25)*: A user-created or runtime-registered agent stored in MongoDB (`DynamicAgentConfig`) with a corresponding **Keycloak resource** representation (type: `dynamic_agent`, scopes: `view`, `invoke`, `configure`, `delete`). Governed by **three-layer RBAC** (**FR-028**): (B) Keycloak resource with policies auto-generated from visibility; (C) per-agent Keycloak realm roles (`agent_user:<id>`, `agent_admin:<id>`); (D) MongoDB visibility model (`private`/`team`/`global` + `shared_with_teams` + `owner_id`) with **CEL evaluation** (**FR-029**). MCP tool calls from the agent's LangGraph runtime route through **Agent Gateway** with user's OBO JWT (**FR-030**). Key attributes: `_id`, `name`, `owner_id`, `visibility`, `shared_with_teams`, `allowed_tools`, `subagents`, `is_system`, `enabled`.
- **PDP (Policy Decision Point)**: **Keycloak Authorization Services** — the component that evaluates authorization requests against the **098 permission matrix** modeled as Keycloak resources, scopes, and policies. Consumes JWT claims; returns allow/deny. UI and Slack paths use Keycloak as PDP; MCP/A2A/agent paths use **Agent Gateway** as PDP (**FR-022**). *(`caipe-authorization-server` eliminated — Session 2026-04-03.)*
- **Slack identity link** *(Session 2026-04-03)*: A stored mapping (`slack_user_id ↔ keycloak_sub`) created via interactive OAuth account linking (**FR-025**). Required before any RBAC-protected Slack operation. Stored as a **custom Keycloak user attribute** (`slack_user_id`) on the user profile — **not** in MongoDB. The bot resolves identity via **Keycloak Admin API** (find user by attribute). This eliminates MongoDB as a dependency on the Slack bot path. The link is the prerequisite for OBO token exchange on the Slack path.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A published permission matrix covers **100%** of **FR-008** entry points across **Slack, Admin UI, Supervisor, RAG, sub-agents, tools, skills, A2A, and MCP**.
- **SC-002**: In controlled testing, after a simulated enterprise role change, at least **99%** of repeated authorization checks for the same user show updated allow/deny results **across sampled surfaces** (UI, Slack, and at least one of Supervisor or MCP) within **15 minutes**.
- **SC-003**: For a representative set of at least five personas (low, standard, elevated, admin, and denied), acceptance testing shows **zero** cases where a **protected surface** (UI, Slack, Supervisor, RAG, tool, skill, A2A, or MCP) allows a **high-risk** action that the matrix marks as **forbidden** for that persona.
- **SC-004**: Within three months of launch, at least **80%** of surveyed organization administrators agree or strongly agree that managing access **across CAIPE components** from **one RBAC model** is easier than **disconnected** per-service rules (baseline: pre-design survey or agreed proxy).
- **SC-005**: The published permission matrix explicitly includes **create / update / delete / bind datasource** (or equivalent) actions for **team-scoped RAG tools**, and documents which **IdP directory groups** map to those actions for at least two representative teams in acceptance testing.
- **SC-006**: The published permission matrix includes **at least one** representative **KB/datasource** (**FR-015**) with documented **admin vs query/ingest** separation, and **at least one** **tool-based** (**runtime**) row (**FR-016**) cross-referenced to **ASP** (or documented equivalent) in acceptance testing.
- **SC-007**: In controlled testing, an **MCP tool call**, an **A2A task**, and an **agent dispatch** all route through **[Agent Gateway](https://agentgateway.dev/)** with **JWT** validated against the tenant OIDC provider, and a **denied** persona is rejected by AG **before** the request reaches the backend MCP/agent service.
- **SC-008** *(absorbed from 093)*: The **OBO token exchange** flow (user → bot → agent) is demonstrated end-to-end: the resulting token carries correct `sub` (user), `act` (bot/agent), and `scope` claims, and **Agent Gateway** accepts it for MCP/A2A/agent requests while rejecting a token whose scope exceeds the delegating user's entitlements (**FR-018**, **FR-019**).
- **SC-009** *(absorbed from 093)*: In a **multi-tenant** deployment, a principal authenticated in **org A** is **denied** access to resources, agents, and tools belonging to **org B** across **all** tested surfaces (UI, Slack, AG-routed MCP) (**FR-020**).
- **SC-010**: The RAG server correctly validates Keycloak-issued JWTs and maps realm roles (`admin`, `kb_admin`, `team_member`, `chat_user`) to RAG server roles (`admin`, `ingestonly`, `readonly`). For non-Keycloak tokens (no `roles` claim), the existing group-based role assignment continues to function (**FR-026**).
- **SC-011**: Per-KB access control is enforced at query time: a user with `kb_reader:kb-team-a` role sees only `kb-team-a` results from `/v1/query`; a user whose team owns `kb-platform` (via `TeamKbOwnership`) sees `kb-platform` results; an `admin` or `kb_admin` user sees all KB results; a user with no per-KB role and no team ownership sees no results (**FR-027**).
- **SC-012**: Dynamic agents enforce layered RBAC: a `team_member(team-a)` user sees only team-a and global agents in `GET /api/v1/agents`; a user with `agent_user:agent-123` can invoke that specific agent; `admin` sees all agents; a user with no matching per-agent role, team membership, or ownership sees no private/team agents. Agent creation syncs a Keycloak resource; deletion cleans up resource + dangling roles (**FR-028**).
- **SC-013**: CEL is the policy evaluation engine at **all** enforcement points: Agent Gateway (MCP/A2A), RAG server (per-KB), dynamic agents (per-agent), and BFF middleware all evaluate CEL expressions for authorization decisions. Policy expressions are configurable, not hardcoded. The shared CEL context schema (`user.roles`, `user.teams`, `resource.id`, `resource.type`, `resource.visibility`) is consistent across services (**FR-029**).
