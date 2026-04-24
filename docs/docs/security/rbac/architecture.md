# RBAC Architecture

Component-by-component reference. Each section describes **what it owns**, **what it does NOT own**, and **the env vars / config files / extension points** you'd touch to change its behavior.

> Read [the index](./index.md) first if you want the big-picture mental model and the JWT primer.
> Read [Workflows](./workflows.md) for the request-flow sequence diagrams that tie all of this together.

---

## Component 1: Keycloak — HR & The Front Desk

> **Badge analogy:** HR issues ID badges. The front desk verifies them on entry. Every other door in the building trusts the badge's chip — they don't call HR each time. When a contractor arrives via a partner agency (Duo SSO), the front desk checks with the agency once, creates an internal record, and issues a standard building badge. From that point on, the contractor uses the same badge as everyone else.

**Technically:** Keycloak acts as an OIDC Authorization Server and IdP broker. It proxies login to Duo SSO via an OIDC client, maps external claims to local realm roles, and issues its own signed JWT — so downstream services only ever need to trust one issuer.

### Realm Roles (`caipe` realm)

| Role | Default? | Purpose |
|------|----------|---------|
| `chat_user` | Yes — all authenticated users | Grants access to supervisor, Slack bot, RAG tools via AgentGateway CEL |
| `admin` | No — explicit assignment | Full CAIPE admin UI: user management, team CRUD, role assignment, Keycloak Admin API proxy |
| `kb_admin` | No | Knowledge base management: upload documents, configure RAG pipelines |
| `team_member` | No | Legacy team marker — superseded by `team_member:<team_id>` (spec 104) |

`chat_user` is in the `default-roles-caipe` composite, so every newly-created or brokered user gets it automatically. This is patched at runtime by `init-idp.sh` because Keycloak's realm import doesn't reliably populate composite role members.

#### Resource-scoped roles (spec 104 — team-scoped RBAC)

Spec 104 introduces a second tier of realm roles that bind *resources* (tools, agents, teams) to *callers*. They use a `<category>:<id>` naming convention with `:` as the separator. AgentGateway CEL rules and Dynamic Agents auth check for these roles in `jwt.realm_access.roles`.

| Pattern | Example | Meaning |
|---------|---------|---------|
| `tool_user:<tool_name>` | `tool_user:jira_search_issues` | Caller may invoke this MCP tool. The tool name is the LangChain-prefixed `<server_id>_<tool>` produced by Dynamic Agents. |
| `tool_user:*` | `tool_user:*` | Wildcard — caller may invoke any MCP tool (admin convenience). |
| `tool_user:<server>_*` | `tool_user:jira_*` | All tools from one MCP server (seeded by `init-idp.sh`; AG CEL match is exact today, glob support tracked). |
| `agent_user:<agent_id>` | `agent_user:test-april-2025` | Caller may chat with this dynamic agent (enforced in DA, not AG). |
| `agent_admin:<agent_id>` | `agent_admin:test-april-2025` | Caller may modify the agent's config. Implies `agent_user:<agent_id>`. |
| `team_member:<team_id>` | `team_member:demo-team` | Caller belongs to the team. AG CEL rules already use this prefix for team-scoped resources. |
| `team_admin:<team_id>` | `team_admin:demo-team` | Caller manages team membership and resource assignments. |
| `admin_user` | `admin_user` | Realm-wide superuser for the spec-104 model. Bypasses every per-resource check. Distinct from the legacy flat `admin` so we can deprecate the old model later. Granted automatically to every email in `BOOTSTRAP_ADMIN_EMAILS` by `init-idp.sh`. |

Roles are created and assigned by:
- `init-idp.sh` (dev/CI seed; runs in the `keycloak-init` job; reads `BOOTSTRAP_ADMIN_EMAILS` to seed the demo bundle).
- The Admin UI **Team Resources panel** (`Admin → Teams → <team> → Resources` tab, spec 104 Story 4) — checking an agent or tool box calls `PUT /api/admin/teams/[id]/resources`, which:
  1. Ensures the realm role (`agent_user:<id>`, `agent_admin:<id>`, `tool_user:<server>_*`, or `tool_user:*` for the wildcard) exists in Keycloak (idempotent — `ensureRealmRole`).
  2. Resolves each team member's email to a Keycloak `sub` (`findUserIdByEmail`) and applies the add/remove diff via `assignRealmRolesToUser` / `removeRealmRolesFromUser`.
  3. Persists the selection on the team document in Mongo (`team.resources = { agents, agent_admins, tools, tool_wildcard }`).
  The Resources tab covers Use+Manage per agent and per-MCP-server tool grants plus a single "All tools" wildcard checkbox. Members without a Keycloak account yet (invited but never logged in) are returned in `members_skipped`; the rest of the operation still completes so a single absent user can't brick the panel. Mongo persistence happens **after** Keycloak reconciliation so a KC outage doesn't leave the two stores permanently out of sync.
- The Admin UI **Team Slack Channels panel** (`Admin → Teams → <team> → Slack Channels` tab, spec 098 US9) — bind Slack channels to a team so the bot resolves the channel's effective team via `channel_team_mappings` (and optionally a default agent via `channel_agent_mappings`). `PUT /api/admin/teams/[id]/slack-channels` is an idempotent full-replace: it deactivates this team's previous mappings that aren't in the new payload (only when `team_id` still matches — never touches another team's rows), upserts the active set, mirrors the bound-agent dropdown into `channel_agent_mappings`, and denormalises a thin `slack_channels` array onto the team document for the team-card chip count. The UI offers a live `conversations.list` discovery picker (server-side `SLACK_BOT_TOKEN` only, 60s in-process cache) plus a manual ID entry fallback for when the bot isn't in the channel yet. The bound-agent dropdown is constrained to `team.resources.agents` so admins can't accidentally bind a channel to an agent the team doesn't otherwise have access to (the backend re-validates).
- The Admin UI **Team Roles panel** (`Admin → Teams → <team> → Roles` tab) — for everything *not* covered by the Resources tab (`admin_user`, `chat_user`, `kb_admin`, `kb_reader:<kb>`, `kb_ingestor:<kb>`, custom roles, etc.). Calls `PUT /api/admin/teams/[id]/roles` with the same idempotent ensure-role + diff-reconcile-members + persist-on-team flow. The GET endpoint surfaces the full realm-role catalog (minus system roles like `default-roles-caipe`/`offline_access`/`uma_authorization`) grouped by category prefix so admins can pick or paste in role names; orphan assignments (roles assigned but no longer in the catalog) are surfaced as a warning so they can be removed.

### External IdP Brokering (Duo SSO, Okta, or any OIDC provider)

> **Badge analogy:** The partner agency desk. Whether it's Duo SSO, Okta, or any other corporate identity provider, they all speak the same language (OIDC). Keycloak is the single translator — it talks to whichever agency is configured and converts their badges into standard building badges. The rest of the building never needs to know which agency originally issued the contractor's credentials.

Keycloak acts as a **relying party** to the upstream IdP (OIDC). From the user's perspective it's invisible — they see only the upstream IdP login page. From a security perspective:

```
Browser ──OIDC auth code flow──▶ Keycloak
                                      │
                   ──OIDC auth code──▶ Upstream IdP (Duo SSO / Okta / any OIDC)
                                      │
                   ◀── id_token ───────┘  (external claims: email, name, groups)
                        │
                   Maps external claims to local roles via IdP mappers
                   Issues new Keycloak JWT with realm_access.roles
                        │
Browser ◀── Keycloak JWT ──────────────┘
```

**Supported upstream IdPs** — the `init-idp.sh` script configures any OIDC provider generically via OIDC discovery (`/.well-known/openid-configuration`):

| Provider | `IDP_ALIAS` (in realm) | `IDP_ISSUER` example | Notes |
|----------|----------------------|----------------------|-------|
| Duo SSO | `duo-sso` | `https://sso-xxx.sso.duosecurity.com/oidc/xxx` | Uses `firstname`/`lastname` (non-standard); extra IdP mappers handle both `given_name` and `firstname` |
| Okta (OIDC) | `okta-oidc` | `https://your-org.okta.com` or `https://your-org.okta.com/oauth2/default` | Standard OIDC claims; groups come from Okta's `groups` claim (requires Okta app config) |
| Okta (SAML) | `okta-saml` | — | SAML 2.0; configured as a SAML IdP in Keycloak; attribute mappers needed for groups |
| Microsoft Entra ID (OIDC) | `entra-oidc` | `https://login.microsoftonline.com/{tenant-id}/v2.0` | Standard OIDC; groups claim requires Entra app manifest `groupMembershipClaims` config |
| Microsoft Entra ID (SAML) | `entra-saml` | — | SAML 2.0; common in enterprise M365 environments |
| Generic OIDC | any alias | any OIDC-compliant issuer URL | Works as long as the provider exposes `/.well-known/openid-configuration` |

**To wire up a new IdP**, set these env vars and run `init-idp.sh` (or restart the `init-idp` container — it is idempotent):

```bash
IDP_ALIAS=okta                                 # short alias, used in kc_idp_hint
IDP_DISPLAY_NAME="Okta SSO"                    # shown on Keycloak login page (if visible)
IDP_ISSUER=https://your-org.okta.com           # OIDC issuer URL
IDP_CLIENT_ID=<okta-app-client-id>
IDP_CLIENT_SECRET=<okta-app-client-secret>
IDP_ACCESS_GROUP=caipe-users                   # Okta group → chat_user role (optional)
IDP_ADMIN_GROUP=caipe-admins                   # Okta group → admin role (optional)
OIDC_IDP_HINT=okta                             # auto-redirect browser to this IdP alias
```

**`OIDC_IDP_HINT`** (set in `ui/.env.local`) is passed to Keycloak as `kc_idp_hint` on every auth request. It skips the Keycloak login page entirely and redirects straight to the named IdP. Set it to the same value as `IDP_ALIAS`.

**Claim mapping chain:** The IdP sends `email`, `given_name`/`firstname`, `family_name`/`lastname`, and `groups` claims. Keycloak IdP mappers write these to the local user record. Role mappers translate `IDP_ACCESS_GROUP` membership to `chat_user` and `IDP_ADMIN_GROUP` to `admin`. If neither group var is set, all brokered users receive `chat_user` automatically via a hardcoded role mapper.

> The login sequence diagram (one-time login + the silent first-broker-login flow) lives in [Workflows › Login](./workflows.md#login--first-time-broker-login).

### User Profile & Custom Attributes

Keycloak 26+ enforces a user profile schema. Custom attributes are silently dropped unless declared or `unmanagedAttributePolicy=ADMIN_EDIT` is set. `init-idp.sh` patches both:

- Adds `slack_user_id` to the user profile schema with `admin`-only view/edit permissions
- Sets `unmanagedAttributePolicy=ADMIN_EDIT` so other Admin API attribute writes succeed

### Account Linking (Slack)

Three onboarding paths, evaluated in order:

- **Auto-bootstrap** (default, `SLACK_FORCE_LINK=false`) — bot looks up the Slack user's email, finds an existing Keycloak user, writes `slack_user_id` silently. Zero user action required.
- **Just-In-Time user creation** (default ON, `SLACK_JIT_CREATE_USER=true`, spec 103) — when no existing Keycloak user matches, the bot creates a federated-only shell user via `POST /admin/realms/{realm}/users` using the same `caipe-platform` admin credential. Optional domain allowlist via `SLACK_JIT_ALLOWED_EMAIL_DOMAINS`. 409 races are resolved by re-querying.
- **Explicit link** (`SLACK_FORCE_LINK=true`, or fallback when JIT is off / not allowed / fails) — bot sends an HMAC-signed link prompt; user clicks → SSO login → `slack_user_id` written via Admin API.

The full sequence (including HMAC URL shape, TTL enforcement, JIT request body, error kinds, and post-link OBO flow) is in [Workflows › Slack identity linking](./workflows.md#slack-identity-linking-auto-bootstrap--jit--forced-link).

---

## Component 2: CAIPE UI — The Reception Desk

> **Badge analogy:** The reception desk at each department entrance. When you badge in, it reads your chip (JWT), checks your clearance level for this department, and either waves you through or says "sorry, you don't have access here." It doesn't phone HR — the badge chip already carries everything needed to make the decision.

**Technically:** Next.js App Router with NextAuth (Auth.js v5) for OIDC session management. Every API route handler runs `requireRbacPermission()` which validates the server-side session and enforces role requirements before proxying to backend services.

### Authentication Flow

```
1. Browser visits http://localhost:3000
2. NextAuth detects no session → 302 to Keycloak (OIDC auth code flow)
3. Keycloak → Duo SSO (kc_idp_hint=duo-sso auto-redirects, user never sees KC)
4. Duo SSO login → auth code returned to Keycloak
5. Keycloak issues JWT → NextAuth exchanges code for tokens
6. NextAuth stores { accessToken, refreshToken, sub, roles } in encrypted server-side session cookie
7. Browser receives httpOnly session cookie — raw JWT never touches the browser
```

**Security note:** The JWT is stored in an httpOnly, Secure, SameSite=Lax session cookie managed by NextAuth. Client-side JavaScript cannot read it. The session is encrypted with `NEXTAUTH_SECRET`.

### Server-Side Authorization (`api-middleware.ts`)

```typescript
// Every protected API route:
await requireRbacPermission(request, {
  resource: 'rag',
  action: 'read',
  user: session.user,
  accessToken: session.accessToken,
  sub: session.sub,
  org: session.org,
})
```

Two authorization paths:

1. **Role-based (JWT claim):** `hasRoleFallback()` checks `realm_access.roles` from the session JWT against the required role for the resource+action pair.
2. **Bootstrap admin bypass:** `isBootstrapAdmin(email)` checks the email against `BOOTSTRAP_ADMIN_EMAILS`. This bypasses **all** resource/action checks. It exists for the chicken-and-egg problem: the first admin must be able to log in before Keycloak roles are properly configured. **Remove this env var once roles are working.**

### Token Refresh

NextAuth holds the refresh token and silently refreshes the access token before it expires. If the refresh fails (revoked session, Keycloak down), the user is redirected to login. The access token in the session is always the current live token — it's what gets forwarded to backend services.

---

## Component 3: Supervisor A2A Server — The Dispatcher

> **Badge analogy:** The dispatcher at the internal mail room. When you drop off a work order, they scan your badge, note your name and clearance on the paperwork, and attach a photo-copy of your badge to every sub-order sent to other departments. Downstream departments never need to ask who initiated the original request — it's stapled to everything.

**Technically:** A Starlette/FastAPI application running the LangGraph multi-agent supervisor. It has a layered middleware stack. The JWT is validated once at the outer layer, then decoded and stored in a per-request contextvar by `JwtUserContextMiddleware` so all downstream code can read user identity without re-parsing the header.

### Middleware Stack (outermost → innermost)

```
CORSMiddleware
    │
PrometheusMetricsMiddleware   (metrics, skips /health)
    │
OAuth2Middleware / SharedKeyMiddleware   (validates JWT signature + expiry)
    │
JwtUserContextMiddleware   (decodes claims → stores in contextvar)
    │
A2A request handler + LangGraph agent
```

`JwtUserContextMiddleware` is intentionally read-only. It does not re-validate the token — that's already done by the auth middleware above it. It decodes the JWT payload without verification, fetches the OIDC userinfo endpoint (cached 10 min) for authoritative email/name/groups, and stores the result in a `ContextVar`:

```python
# Set once per request by JwtUserContextMiddleware
_jwt_user_context_var: ContextVar[JwtUserContext | None]

# Read anywhere in the same request (agent executor, tools, sub-calls)
ctx = get_jwt_user_context()
# ctx.email, ctx.name, ctx.groups, ctx.token
```

### JWT Forwarding to MCP Tools

When `FORWARD_JWT_TO_MCP=true`, the supervisor forwards the **original, unmodified** bearer token from the incoming request to AgentGateway. This means:

- The token that reaches AgentGateway has `sub` = the real user (or OBO token with `act.sub` = bot)
- AgentGateway can evaluate the user's actual roles, not the supervisor's service account
- MCP servers that do their own JWT validation (e.g. RAG) see the real user identity

```
User JWT  →  Supervisor  →  (same JWT)  →  AgentGateway  →  MCP Server
```

**Security implication:** The supervisor must not modify or strip the bearer token before forwarding. If it substituted its own service account token, the entire per-user authorization chain would collapse.

### Key Environment Variables

| Variable | Purpose | Security note |
|----------|---------|---------------|
| `A2A_AUTH_OAUTH2=true` | Enable JWT signature validation | Off in dev; mandatory in prod |
| `A2A_AUTH_SHARED_KEY` | Shared-key auth alternative | Use only for service-to-service; not for user-facing flows |
| `ENABLE_USER_INFO_TOOL=true` | Extract identity from JWT (vs. `"by user: email"` prefix) | The JWT is the authoritative source; prefer this over message prefix |
| `FORWARD_JWT_TO_MCP=true` | Forward incoming JWT to MCP tools | Required for per-user enforcement at AgentGateway |
| `ISSUER` / `OIDC_ISSUER` | OIDC issuer for userinfo endpoint discovery | Must match `iss` claim in tokens |

---

## Component 4: AgentGateway — The Security Checkpoint

> **Badge analogy:** The armed security checkpoint at the entrance to the server room. Everyone must badge in — no exceptions, no tailgating. The checkpoint has a physical rulebook (CEL policies) specifying exactly which badge types (roles) can enter which server rack (MCP tool). If your badge says `chat_user` and the rack requires `kb_admin`, you're turned away at the door, not inside the rack.

**Technically:** AgentGateway is the single **Policy Enforcement Point (PEP)** for all MCP tool calls. It proxies HTTP/SSE requests to registered MCP backend servers and evaluates a CEL (Common Expression Language) policy against the JWT claims before allowing each request through. It is the only place in the architecture where tool-level authorization is enforced for the normal standalone-MCP path. MCP servers still mount a shared custom middleware package for **authentication defense-in-depth** (JWT/shared-key validation, token passthrough context, and an optional local-dev localhost bypass). For embedded/local MCP servers that do not sit behind AgentGateway, the same package can also perform an **optional Keycloak PDP scope check** (for example `mcp_jira#invoke`) so they still have a real authz gate.

### Request Flow

```
Supervisor POST /rag/v1/query
  Authorization: Bearer <JWT>
         │
         ▼
  AgentGateway
  ┌────────────────────────────────────────────┐
  │  1. Extract JWT from Authorization header  │
  │  2. Validate signature against JWKS        │
  │  3. Evaluate CEL policy against claims:    │
  │                                            │
  │     jwt.claims.realm_access.roles          │
  │       .exists(r, r == "chat_user")         │
  │                                            │
  │  4a. Policy DENY  →  403 Forbidden         │
  │  4b. Policy ALLOW →  proxy to MCP server   │
  └────────────────────────────────────────────┘
         │ ALLOW
         ▼
  RAG MCP Server
  (receives same JWT for its own validation)
```

### CEL Policy Examples

CEL is a lightweight expression language. Policies are evaluated per-route and per-method.

```cel
# Basic access: must have chat_user role
jwt.claims.realm_access.roles.contains("chat_user")

# Elevated access: admin or kb_admin
jwt.claims.realm_access.roles.contains("admin") ||
jwt.claims.realm_access.roles.contains("kb_admin")

# Tenant-scoped: user can only query their own tenant's data
jwt.claims.tenant == resource.tenant

# Combine role and tenant
jwt.claims.realm_access.roles.contains("chat_user")
  && jwt.claims.tenant != ""
```

### Why This Is the Right Architecture for a PEP

- **Decoupled policy from business logic:** MCP servers implement domain logic, not authz. Changing a policy means editing `config.yaml`, not redeploying an MCP server.
- **Consistent enforcement:** Every tool — RAG, GitHub, ArgoCD, Slack — goes through the same gateway with the same JWT. No tool can be accidentally left unenforced.
- **Token passthrough:** AgentGateway forwards the JWT to the MCP backend unchanged. The backend can do its own secondary validation (e.g. tenant isolation).

### Local / Embedded MCP Exception Path

Most production MCP traffic should still go through AgentGateway. The repository also ships a **shared custom MCP middleware** for the exception cases:

- **Local dev** — when an engineer runs a FastMCP server directly on `localhost` for `mcp dev`, `MCP_TRUSTED_LOCALHOST=true` can bypass auth for the real loopback peer only.
- **Embedded MCPs** — when an MCP lives inside another Python service and therefore cannot be registered as a standalone AgentGateway backend, the same package validates the bearer token locally and can optionally call Keycloak's PDP for a per-MCP scope decision.

That package lives under `ai_platform_engineering/agents/common/mcp-auth/` and is intentionally **authn-focused by default**. In the normal standalone path, AgentGateway remains the source of truth for RBAC.

---

## AgentGateway + OIDC + Keycloak — The Integrated Picture

> **Badge analogy:** **Duo SSO is the national ID office** — it issues the underlying identity. **Keycloak is HR** — it takes that national ID, prints a CAIPE-branded employee badge with your roles stamped on it, and publishes a **public fingerprint scanner** (JWKS) in the lobby so anyone can verify a badge is really HR-issued. **AgentGateway is the armed checkpoint** at the server room door. The checkpoint has a photocopy of the scanner taped to its desk so it can verify badges instantly without calling HR (or Duo). The checkpoint's rulebook (CEL) is kept up to date by a small courier (`ag-config-bridge`) that walks between the head office (MongoDB) and the checkpoint every few seconds with the latest rule updates.

**Technically:** Three distinct services cooperate to put a verified, role-carrying JWT in front of AgentGateway on every request. AG itself is the **Policy Enforcement Point (PEP)** — it doesn't authenticate users, it doesn't store roles, and it never talks to Duo. It only verifies that the JWT in the request was signed by Keycloak (using a cached copy of Keycloak's JWKS) and that the claims inside satisfy the CEL policy for the target MCP tool.

| Layer | Role | What it owns | What it does NOT own |
|-------|------|--------------|----------------------|
| **Upstream IdP** (e.g. Duo SSO, Okta, Azure AD) | Identity provider | User authentication (password, MFA, device trust), email ownership | Application roles, per-tool access rules |
| **Keycloak** | OIDC AS + IdP broker | Realm roles (`chat_user`, `admin`), JWT issuance, JWKS publication, OBO token exchange (RFC 8693) | Tool-level decisions, user password (delegated to Duo) |
| **AgentGateway (PEP)** | Policy Enforcement Point | Per-route CEL rules, per-tool `mcpAuthorization` rules, local JWT verification against cached JWKS | Identity store, role store, token minting |

Keycloak **brokers** the upstream IdP — Duo SSO doesn't issue the JWT that AG sees. Duo authenticates the user, returns an OIDC authorization code to Keycloak, and Keycloak then mints the CAIPE JWT with the realm roles that CEL evaluates. From AG's perspective, **Keycloak is the only issuer it trusts** (`iss = http://localhost:7080/realms/caipe`); the existence of Duo is invisible to AG. This is the standard OIDC/OAuth 2.0 resource-server pattern applied to an MCP-aware proxy.

### Identity Provenance: Duo SSO → Keycloak → JWT → AG → MCP

```mermaid
flowchart LR
  subgraph IdP["Upstream IdP<br/>(Duo SSO / Okta / Azure AD)"]
    DUO["Duo Universal Prompt<br/>(MFA, device trust, password)"]
    DUO_OIDC["OIDC token endpoint<br/>sso-xxx.sso.duosecurity.com"]
    DUO --> DUO_OIDC
  end

  subgraph KC["Keycloak — Realm: caipe"]
    direction TB
    KC_IDP["IdP broker<br/>alias: duo-sso<br/>IDP_ISSUER, IDP_CLIENT_ID"]
    KC_MAP["IdP mappers<br/>email, given_name/firstname → userinfo"]
    KC_ROLES["Realm roles<br/>chat_user, admin<br/>(assigned via init-idp.sh)"]
    KC_TOK["Token endpoint<br/>signs JWT with realm's RS256 key"]
    KC_JWKS["JWKS endpoint<br/>public keys (for AG to fetch)"]
    KC_IDP --> KC_MAP --> KC_ROLES --> KC_TOK
    KC_TOK --> KC_JWKS
  end

  subgraph CAIPE["CAIPE Callers (all hold the same JWT)"]
    UI["CAIPE UI<br/>(Next.js, NextAuth)"]
    SB["Slack Bot<br/>(uses OBO token-exchange)"]
    SUP["Supervisor<br/>(forwards user JWT)"]
    DA["Dynamic Agents<br/>(forwards user JWT)"]
  end

  AG["AgentGateway :4000<br/><b>PEP</b><br/>jwtAuth + CEL"]
  MCP["Backend MCP servers<br/>rag_server, github-mcp, …"]

  DUO_OIDC -. "1. OIDC auth code" .-> KC_IDP
  KC_TOK -. "2. JWT (iss=caipe, sub=alice,<br/>realm_access.roles=[chat_user])" .-> UI
  KC_TOK -. "2. JWT" .-> SB
  KC_JWKS -. "3. JWKS fetch (startup, TTL, unknown kid)" .-> AG

  UI --> SUP
  SB --> SUP
  SUP --> AG
  DA --> AG
  AG -->|"4. proxied + JWT unchanged"| MCP
```

**Read this as the badge's lifecycle:**

1. **Duo SSO authenticates the human.** It doesn't know about CAIPE roles. It only proves "this really is `alice@cisco.com` with working MFA" and hands an OIDC authorization code to Keycloak. Duo's issuer (`IDP_ISSUER`) is configured in Keycloak as `IDP_ALIAS=duo-sso`; this is the only direct contact between CAIPE and Duo.
2. **Keycloak brokers and rebrands the identity.** It validates the Duo code, runs its IdP mappers (e.g. `firstname` → `given_name` to handle Duo's non-standard claim), assigns realm roles (`chat_user` via the default role composite, plus `admin` if explicitly granted), and signs a **fresh JWT** with its own RS256 key. This is the only token CAIPE services ever see. Duo's identity token is discarded at the Keycloak boundary.
3. **Every CAIPE caller holds the same JWT.** The Slack Bot additionally does an RFC 8693 token-exchange to produce an **OBO (On-Behalf-Of) JWT** that pins `sub=alice` and `act.sub=caipe-slack-bot` — but it's still a Keycloak-signed JWT with `iss = http://localhost:7080/realms/caipe`. From AG's perspective there's no difference between a UI JWT and an OBO JWT; both pass `jwtAuth` as long as they're signed by a key in AG's JWKS cache.
4. **AG verifies locally, evaluates CEL locally, forwards unchanged.** The JWT reaches the MCP server with Alice's identity intact, so MCP-level defense-in-depth checks (e.g. the RAG server's per-tenant document ACLs) see the real user — not the supervisor's service account and not the Slack bot.

The practical consequence: **to switch CAIPE from Duo SSO to Okta or Azure AD you don't touch AgentGateway at all.** You change `IDP_ISSUER`, `IDP_CLIENT_ID`, `IDP_CLIENT_SECRET`, `IDP_ALIAS`, and maybe a mapper in Keycloak, and every component downstream — including the CEL rules on AG — keeps working without modification. This is the whole point of making Keycloak the IdP broker instead of having each service integrate directly with the upstream IdP.

### How AG Is Wired to Keycloak (at boot and at steady state)

```mermaid
flowchart LR
  subgraph Keycloak["Keycloak — OIDC Authorization Server"]
    direction TB
    KC_ISS["Realm: caipe<br/>iss = http://localhost:7080/realms/caipe"]
    KC_JWKS["JWKS endpoint<br/>/protocol/openid-connect/certs<br/>(public RS256 keys)"]
    KC_TOK["Token endpoint<br/>/protocol/openid-connect/token"]
  end

  subgraph Bridge["ag-config-bridge (sidecar)"]
    direction TB
    MDB[("MongoDB<br/>ag_mcp_policies<br/>ag_mcp_backends")]
    TPL["config.yaml.j2"]
    REND["Renderer<br/>(polls every 5s)"]
    MDB -->|read policies & backends| REND
    TPL -->|template| REND
  end

  subgraph AG["AgentGateway :4000"]
    direction TB
    CFG["/etc/agentgateway/config.yaml<br/>(hot-reload on file change)"]
    JWKS_CACHE[("In-memory JWKS cache<br/>TTL from Cache-Control")]
    JWT_VAL["jwtAuth:<br/>• mode: strict<br/>• issuer, audiences<br/>• jwks.url"]
    CEL["CEL mcpAuthorization<br/>rules per route/backend"]
    PROXY["MCP proxy<br/>mcp.targets"]
    CFG --> JWT_VAL
    CFG --> CEL
    CFG --> PROXY
    JWT_VAL --> JWKS_CACHE
  end

  KC_JWKS -.->|1. fetch at startup + TTL refresh| JWKS_CACHE
  REND -->|2. write rendered config atomically| CFG
  Client["Caller<br/>(Supervisor / Slack Bot / Dynamic Agent)"] -->|3. Bearer JWT| JWT_VAL
  JWT_VAL --> CEL
  CEL --> PROXY
  PROXY --> MCP["Backend MCP servers<br/>(rag_server, github-mcp, …)"]
  KC_TOK -.->|token issuance| Client
```

**Three independent channels between Keycloak and AG — all pull-based, all public:**

| # | Channel | Direction | Purpose | Cadence |
|---|---------|-----------|---------|---------|
| 1 | JWKS | AG → Keycloak | Fetch public keys to verify JWT signatures | On startup; on unknown `kid`; on Cache-Control TTL expiry |
| 2 | CEL policy rendering | `ag-config-bridge` → AG (file) | Keep `config.yaml` in sync with admin-editable policies in MongoDB | Every 5s poll; hot-reload on file change |
| 3 | Token issuance | Client → Keycloak → Client | Users/bots obtain JWTs to present to AG; AG **never** mints tokens | On login / OBO exchange |

There is **no direct API call from AG to Keycloak per request**. JWKS fetching is a pure cache-refresh operation, not a live auth check.

### The Exact `jwtAuth` Contract (from `config.yaml`)

```yaml
binds:
- port: 4000
  listeners:
  - protocol: HTTP
    policies:
      jwtAuth:
        mode: strict           # reject request if no valid JWT present
        issuer: http://localhost:7080/realms/caipe
        audiences: [caipe-platform]
        jwks:
          url: http://keycloak:7080/realms/caipe/protocol/openid-connect/certs
```

What `mode: strict` means in practice:

- **`iss` must equal `issuer`** — tokens from any other realm or IdP are rejected with 401.
- **`aud` must contain at least one of `audiences`** — protects against token substitution where a token was issued to a different service client.
- **`exp`, `nbf`, `iat` enforced** — expired or not-yet-valid tokens rejected.
- **Signature verified against JWKS** — `kid` in the JWT header must match a cached key.
- **Unknown `kid` triggers one forced JWKS refresh** — handles Keycloak key rotation without manual intervention.

Only after `jwtAuth` passes does AG evaluate the `authorization` and `mcpAuthorization` CEL rules. If `jwtAuth` fails, the request never reaches policy evaluation.

### Policy Storage: Two Surfaces, One Source of Truth

AG's CEL rules can be authored two ways — they end up in the same MongoDB collection:

| Surface | Use case | Path |
|---------|----------|------|
| **Admin UI** (dynamic) | Change policy without a redeploy; audit trail per edit | `CAIPE UI → Admin → AG MCP Policies` → `ui/src/app/api/rbac/ag-policies/route.ts` → MongoDB `ag_mcp_policies` |
| **Static bootstrap** | First-run seed in environments that start from empty MongoDB | `deploy/agentgateway/config-bridge.py` → `SEED_POLICIES` (upserts once if collection empty) |

In both cases the **only consumer** is `ag-config-bridge`, which renders to `config.yaml.j2` and writes the final `config.yaml` that AG reads. There is no other path by which a CEL rule can reach AG.

### CEL Cheat Sheet — JWT Claims Available in Rules

AG evaluates CEL expressions against a context object that includes the **verified** JWT payload. The most useful fields:

```cel
# Realm roles (set in realm-config.json + init-idp.sh composites)
jwt.realm_access.roles.contains("chat_user")
jwt.realm_access.roles.contains("admin")

# Client-level roles (rare — most roles live at the realm level in CAIPE)
"resource_access" in jwt && "caipe-ui" in jwt.resource_access

# User identity
jwt.sub             // opaque Keycloak user UUID
jwt.email           // human-readable
jwt.preferred_username

# Delegation (OBO tokens only — set by Slack bot's token-exchange)
has(jwt.act) && jwt.act.sub == "caipe-slack-bot"

# Multi-tenant scoping
jwt.org == request.headers.x_tenant_id

# MCP tool introspection (only inside mcpAuthorization, not on route-level authorization)
mcp.tool.name.startsWith("admin_")
```

### AGW CEL Runtime Caveat

The current AgentGateway CEL runtime in this repo does **not** behave like stock CEL for some JWT-backed dynamic fields:

- `has(jwt.sub)` and `has(jwt.realm_access.roles)` can return `false` even when the field is present.
- `"role" in jwt.realm_access.roles` returns `false` for list membership checks.
- `jwt.realm_access.roles.exists(...)` can panic the gateway with `Dynamic(Array ...)`.

The runtime-safe pattern is:

```cel
jwt.realm_access.roles.contains("admin_user")
jwt.realm_access.roles.contains("team_member:" + jwt.active_team)
```

That is why the checked-in `deploy/agentgateway/config.yaml` uses direct field access plus `.contains(...)` for all role checks and avoids `has(...)`, `in`, and `.exists(...)` against JWT role arrays.

The existing production ruleset in `deploy/agentgateway/config.yaml` shows the common patterns: admin-only prefixes (`admin_*`, `supervisor_config`), role-gated prefixes (`rag_query`, `rag_ingest`, `rag_tool`, `team_*`, `dynamic_agent_*`, `github_*`), and a catch-all for non-admin, non-ingest tools.

### Operational Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| AG restart does not invalidate user sessions | User JWTs are self-contained; AG just re-fetches JWKS on startup |
| Keycloak key rotation is zero-downtime | Unknown `kid` triggers one forced JWKS refresh; cached keys remain valid until `exp` |
| Policy update is zero-downtime | Atomic `os.replace()` write in `ag-config-bridge` + AG file watcher = no dropped requests |
| Admin UI edit audit trail | Every policy write to `ag_mcp_policies` records `updated_by` and `updated_at` |
| MongoDB outage doesn't take AG down | AG keeps running against the last-rendered `config.yaml`; `ag-config-bridge` logs `bridge_error` but doesn't crash AG |
| Keycloak outage doesn't take AG down for already-issued tokens | JWKS is cached; new logins fail at Keycloak, not at AG |

> The end-to-end per-request sequence diagram (and the demo walkthrough that proves all three outcomes — 200, 403, 401) lives in [Workflows › Per-request authorization](./workflows.md#per-request-authorization-end-to-end). Use that to demo the system live.

---

## Component 5: Dynamic Agents — The Workshop Floor

> **Badge analogy:** A workshop where employees build and operate their own machines. The workshop checks your badge at the door (JWT validation on every request). Once inside, each machine has its own access tag — some are personal (Private), some are shared with your team (Team), some anyone can use (Global). Your badge level determines which machines you can touch. When a machine makes a tool call, it presents your badge — not its own — so the security checkpoint still sees *you*, not the machine.

**Technically:** A FastAPI service where every route handler uses `get_current_user()` as a FastAPI `Depends()`. Unlike the supervisor (which uses a middleware contextvar), the dynamic agents service validates the JWT on every request at the route level, giving precise control per endpoint.

### JWT Validation Chain

```python
# FastAPI dependency injection — runs before every protected handler
user: UserContext = Depends(get_current_user)
```

Inside `get_current_user()`:

```
1. Extract Bearer token from Authorization header
2. Fetch JWKS from Keycloak (cached in-process)
3. Validate:
   - Signature (RS256 against JWKS public key)
   - expiry (exp)
   - issuer (iss == OIDC_ISSUER)
   - audience (aud == OIDC_CLIENT_ID, if set)
4. Call OIDC userinfo endpoint (cached 10 min by token hash)
   → authoritative email, name, groups (OIDC tokens often omit these)
5. Extract realm_access.roles from JWT claims
   (Keycloak puts roles here; also checked in userinfo)
6. Evaluate oidc_required_group (if set) — 403 if missing
7. Set is_admin via check_admin_role() pattern match against OIDC_REQUIRED_ADMIN_GROUP
8. Return UserContext { email, name, groups, is_admin, access_token, obo_jwt }
```

### Agent-Level Authorization (CEL or Visibility Rules)

After the user is authenticated, `can_use_agent(agent, user)` decides whether they can invoke a specific agent:

```
CEL expression configured? ──YES──▶ evaluate cel_dynamic_agent_access_expression
        │ NO
        ▼
  is_admin  →  ALLOW (admins can use any agent)
  owner_id == user.email  →  ALLOW
  visibility == GLOBAL  →  ALLOW
  visibility == TEAM && user.groups ∩ agent.shared_with_teams ≠ ∅  →  ALLOW
  visibility == PRIVATE  →  DENY
```

### Token Forwarding to MCP Tools

The `UserContext.obo_jwt` (set from `X-OBO-JWT` header) or `UserContext.access_token` is forwarded as the `Authorization: Bearer` header on all MCP tool calls made by the agent runtime. This gives the same per-user enforcement at AgentGateway as the supervisor path provides.

### Key Environment Variables

| Variable | Default | Security note |
|----------|---------|---------------|
| `AUTH_ENABLED` | `false` | **Must be `true` in production.** `false` returns a hardcoded `dev@localhost` admin — never deploy with `false`. |
| `OIDC_ISSUER` | — | Validated against `iss` claim; tokens from other issuers are rejected |
| `OIDC_CLIENT_ID` | — | Used as expected `aud` claim; prevents token substitution from other clients |
| `OIDC_REQUIRED_GROUP` | — | Blanket access gate; set to `chat_user` to mirror AgentGateway policy |
| `OIDC_REQUIRED_ADMIN_GROUP` | — | Group/role that grants `is_admin`; defaults to pattern matching "admin" |

---

## Service-to-Service Authentication (Slack bot → caipe-ui)

The Slack bot calls caipe-ui's API as a machine client, not as a logged-in user. It uses the OAuth2 `client_credentials` grant against the `caipe` realm:

| Env var | Purpose |
|---------|---------|
| `SLACK_INTEGRATION_ENABLE_AUTH=true` | Enables Bearer-token path in `app.py` |
| `SLACK_INTEGRATION_AUTH_TOKEN_URL` | `${KEYCLOAK_URL}/realms/caipe/protocol/openid-connect/token` |
| `SLACK_INTEGRATION_AUTH_CLIENT_ID` | `caipe-slack-bot` (pre-created in `realm-config.json`) |
| `SLACK_INTEGRATION_AUTH_CLIENT_SECRET` | Fetched from Keycloak — see "Provisioning service-client secrets" below |

**Token shape** (fields that matter):

- `iss` — `${KEYCLOAK_URL}/realms/caipe`
- `aud` — `[caipe-ui, caipe-platform]` — both audiences are needed. `caipe-platform` is added by Keycloak's default audience resolution; `caipe-ui` comes from an `oidc-audience-mapper` protocol mapper (`aud-caipe-ui`) on the `caipe-slack-bot` client. caipe-ui's JWT validator rejects tokens whose audience doesn't include `OIDC_CLIENT_ID` (i.e. `caipe-ui`), so this mapper is required.
- `azp` — `caipe-slack-bot`
- `sub` — service account UUID (stable)
- `preferred_username` — `service-account-caipe-slack-bot`
- `scope` — `groups email profile org roles`

The mapper is created automatically by `deploy/keycloak/init-idp.sh` (idempotent).

**This token represents the bot, not the user.** User identity is carried separately by the OBO flow in `utils/obo_exchange.py` (RFC 8693 token exchange), which produces a second token with `act.sub=caipe-slack-bot` and the real user's `sub`/`email`.

### Provisioning service-client secrets in production

In dev, secrets are embedded in `deploy/keycloak/realm-config.json`. In production, operators should treat them as rotating credentials:

**Option A — manual (Keycloak Admin UI):**

1. Log into Keycloak Admin Console → `caipe` realm → Clients → `caipe-slack-bot` → Credentials tab.
2. Copy the Secret value (or click **Regenerate Secret** for rotation).
3. Store it in your secret manager (Vault, AWS SSM, K8s Secret) as `SLACK_INTEGRATION_AUTH_CLIENT_SECRET`.
4. Redeploy / restart the Slack bot pod so it picks up the new secret.

**Option B — scripted (`deploy/keycloak/export-client-secrets.sh`):**

The script fetches secrets via the Keycloak Admin API and emits them in one of three formats:

```bash
# shell (source into current session)
eval "$(KC_URL=https://keycloak.example.com ./export-client-secrets.sh)"

# dotenv (append to a .env file)
KC_URL=https://keycloak.example.com FORMAT=dotenv \
  ./export-client-secrets.sh >> slack-bot.env

# kubernetes Secret (pipe to kubectl)
KC_URL=https://keycloak.example.com FORMAT=k8s \
  K8S_NAMESPACE=caipe K8S_SECRET_NAME=caipe-service-secrets \
  ./export-client-secrets.sh | kubectl apply -f -
```

The Helm chart can wire this up as a post-install Job so fresh installs get the Secret populated without operator intervention. Rotation is the same call — the Secret is overwritten in place.

## Slack bot → Keycloak Admin REST API (identity lookup)

Separate from the OBO flow above. The Slack bot also calls Keycloak's **Admin REST API** to find a Keycloak user by `slack_user_id` attribute (and to read/write `team_id`). This is the call that fires when someone @mentions the bot for the first time. It uses `client_credentials` and a **different** Keycloak client than the OBO flow.

| Env var | Purpose |
|---------|---------|
| `KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID` | Confidential Keycloak client for slack-bot's Admin API calls (lookup + JIT create). **Default `caipe-platform`** — that client's service account is granted `view-users` + `query-users` + `manage-users` on `realm-management` by the realm seeder. |
| `KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET` | Matching client_secret. In dev, defaults to `caipe-platform-dev-secret`. |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM` | Same values as everywhere else. |
| `SLACK_JIT_CREATE_USER` (spec 103) | `true` (default) auto-creates a federated-only Keycloak shell user on first DM when no Keycloak user with the Slack email exists. `false` falls through to the HMAC link URL so onboarding requires the web UI. Reuses `KEYCLOAK_SLACK_BOT_ADMIN_*` — no new secret. See [plan R-8](../../specs/103-slack-jit-user-creation/plan.md) for the single-credential trade-off. |
| `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` (spec 103) | Optional comma-separated allowlist (e.g. `corp.com,acme.io`). Empty = any domain. Recommended for prod when the federated IdP can return non-corporate emails. |

> **Why `KEYCLOAK_SLACK_BOT_ADMIN_*` and not just `KEYCLOAK_ADMIN_*` or `KEYCLOAK_BOT_ADMIN_*`?** Two reasons:
>
> 1. **No collision with the UI BFF.** Pre-098 the slack-bot read the same `KEYCLOAK_ADMIN_*` env names as the UI BFF. Both services share `docker-compose.dev.yaml` env interpolation, so a single `KEYCLOAK_ADMIN_CLIENT_ID=admin-cli` line in `.env` (intended for the UI's password-grant fallback) silently overrode the slack-bot's client_credentials path, producing `HTTP 401 "Public client not allowed to retrieve service account"` on every Slack mention.
> 2. **Room for future surfaces.** The surface-specific prefix (`KEYCLOAK_<surface>_BOT_ADMIN_*`) means future bot integrations like `KEYCLOAK_WEBEX_BOT_ADMIN_*` or `KEYCLOAK_TEAMS_BOT_ADMIN_*` can each have their own dedicated namespace without yet another rename.

**Required client config in Keycloak** (any client you point this at):

- `publicClient: false`
- `serviceAccountsEnabled: true`
- `clientAuthenticatorType: client-secret`
- Service-account user has these `realm-management` client roles: `view-users`, `query-users` (add `manage-users` if you need the bot to write user attributes).

The realm seeder already provisions `caipe-platform` with all of those, so the default values "just work" in dev.

## Spec 104 — `active_team` JWT claim (team-scope refactor)

> **Status: implemented in this branch.** Replaces the legacy `X-Team-Id`
> header. Full design + spike notes + sequence diagrams live in
> [`docs/docs/specs/104-team-scoped-rbac/active-team-design.md`](../../specs/104-team-scoped-rbac/active-team-design.md).

### What changed

| Before | After |
|---|---|
| Slack bot set `X-Team-Id: <slug>` on outbound A2A / RAG / AGW calls | Slack bot mints the OBO token with a Keycloak client scope (`team-<slug>` or `team-personal`) so the resulting JWT carries a signed `active_team` claim |
| Header could be dropped, swapped, or forged at any hop between bot → caipe-ui → DA → AGW | Claim is signed by Keycloak; tampering invalidates the JWT signature |
| `dynamic-agents` outbound MCP traffic ran with the slack-bot service-account JWT (`chat_user` only) → AGW returned 0 tools | DA forwards the user's OBO token unchanged via `current_user_token`; SA fallback is gone, mismatch is logged loudly |
| AGW CEL: any `chat_user` could invoke any non-admin tool | AGW CEL: per-tool `tool_user:<name>` AND `team_member:<jwt.active_team>` (group); `__personal__` short-circuits the team check; `admin_user` bypasses both |

### Components touched

1. **Keycloak**
   - `team-personal` client scope (hardcoded `active_team=__personal__`) bound as **optional** to `caipe-slack-bot`. Provisioned by the realm-init script on every boot.
   - `team-<slug>` client scopes (hardcoded `active_team=<slug>`) created on demand by the BFF when a team is created in Mongo, and on startup auto-sync for pre-existing teams.

2. **BFF (`caipe-ui`)**
   - `Team` schema gains an immutable `slug` field. `POST /api/admin/teams` derives one from `name`, calls `ensureTeamClientScope(slug)`, and rolls back the Mongo insert if Keycloak provisioning fails.
   - `DELETE /api/admin/teams/[id]` best-effort unbinds and deletes `team-<slug>`.
   - Startup hook (`instrumentation.ts` → `team-scope-sync.ts`) backfills slugs and ensures every team has its KC scope.
   - `/api/rag/*` proxy routes no longer add `X-Team-Id`.

3. **Slack bot (`integrations/slack_bot/`)**
   - `obo_exchange.impersonate_user(active_team=...)` adds `scope=openid team-<slug>` (or `team-personal`) to the token-exchange request and **verifies** the returned JWT's `active_team` claim matches what was requested. Mismatch raises `OboExchangeError` (load-bearing security invariant).
   - `channel_team_resolver.py` resolves Slack channel → team slug via `channel_team_mappings` + `teams.slug`, and pre-checks user membership. DMs short-circuit to `__personal__`.
   - `app._rbac_enrich_context` hard-rejects when a group channel has no team mapping or the user isn't in the mapped team — there is no silent fallback to personal mode for group channels.
   - `downstream_auth_headers` now returns only `Authorization: Bearer …`; the legacy `X-Team-Id` header is gone.

4. **Dynamic agents**
   - `JwtAuthMiddleware` accepts `aud=caipe-platform,agentgateway` (comma-separated env, default covers both) and logs `sub`/`aud`/`active_team` on every validated request.
   - `AgentRuntime.__init__` logs a WARNING when no per-request user token is bound — never falls back to a service-account token.

5. **AgentGateway**
   - Listener `audiences: [caipe-platform, agentgateway]`.
   - `mcpAuthorization` rules require either `admin_user`, OR `__personal__` + per-tool role, OR group-scope: `tool_user:<tool>` AND `team_member:<jwt.active_team>` simultaneously. The legacy broad `chat_user` allow rules were removed in this big-bang switch.

6. **RAG server**
   - `UserContext.active_team: Optional[str]` populated from the JWT claim by `extract_active_team_from_claims`.
   - `_kb_cel_context` exposes the slug in `user.teams` so existing CEL like `"<slug>" in user.teams` keeps working.
   - `check_kb_datasource_access` and `inject_kb_filter` prefer `user_context.active_team` over the legacy `X-Team-Id` header (header is still read as a fallback so mid-rollout tokens without the claim don't 403).

### Failure modes (intentional)

- **Group channel without a team mapping** → bot replies "this channel isn't assigned to a CAIPE team yet"; nothing reaches AGW.
- **User not in the mapped team** → bot replies "you aren't a member of `<team>`".
- **Keycloak scope provisioning fails on team create** → BFF rolls back the Mongo insert and returns HTTP 502.
- **OBO exchange fails / returns wrong `active_team`** → bot hard-rejects the request (no SA fallback).
- **DA receives a request without a user JWT** → middleware logs WARNING, MCP call goes out without `Authorization`, AGW 401s.
