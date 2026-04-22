# CAIPE RBAC Architecture

**Audience:** Junior engineers getting oriented + security architects reviewing the design.
Each component opens with a **badge analogy** to build intuition, followed by the
precise technical detail. Read the analogy first, then the technical section — they
describe the same thing at different levels of abstraction.

---

## The Big Picture

Think of CAIPE like a **secure corporate office building**:

- **Keycloak** is HR + the front desk. It issues ID badges, manages who works here, and
  verifies contractors through a partner agency (Duo SSO).
- **Every service** is a room with its own badge reader. You prove who you are once at
  the front desk, get a badge, and that badge is checked at every door — no calling HR
  again each time.
- **AgentGateway** is the armed security checkpoint between the office and the server
  room. Everyone must show their badge, and the checkpoint has a rulebook specifying
  exactly which roles are allowed in which room.
- **The badge itself** is a JWT — a tamper-proof, digitally signed card that any badge
  reader can verify independently without phoning HR.

Technically: CAIPE uses **OpenID Connect (OIDC)** for authentication and **JWT bearer
tokens** for stateless authorization across all service boundaries. There is one token
issuer (Keycloak), and every service verifies tokens against Keycloak's published JWKS
public keys — no shared secrets, no per-hop re-authentication.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              CAIPE Trust Boundary                            │
│                                                                              │
│  ┌────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐   │
│  │  Keycloak  │    │   CAIPE UI   │    │  Supervisor │    │   Dynamic    │   │
│  │  (OIDC IdP)│    │  (Next.js)   │    │  A2A Server │    │   Agents     │   │
│  │  port 7080 │    │  port 3000   │    │  port 8000  │    │  port 8001   │   │
│  └────────────┘    └──────────────┘    └─────────────┘    └──────────────┘   │
│    Token issuer     NextAuth + RBAC     JwtUserContext     get_current_user  │
│    JWKS endpoint    middleware          middleware          FastAPI Depends  │
│    User profile     Session → API       contextvar         JWKS validation   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                 AgentGateway  (Policy Enforcement Point)             │    │
│  │                 port 4000  ·  CEL policy engine  ·  JWT passthrough  │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                       │                                      │
│         ┌─────────────────────────────┼──────────────────┐                   │
│         ▼                             ▼                  ▼                   │
│   ┌───────────┐                ┌───────────┐       ┌───────────┐             │
│   │  RAG MCP  │                │ ArgoCD MCP│       │GitHub MCP │  ...        │
│   │  Server   │                │  Server   │       │  Server   │             │
│   └───────────┘                └───────────┘       └───────────┘             │
│   JWKS validation at each MCP — tokens verified independently                │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Security properties the architecture is designed to guarantee:**

| Property | How it's achieved |
|----------|-------------------|
| Single source of truth for identity | Keycloak is the only token issuer; all services verify against its JWKS |
| No credentials in transit between services | JWT is a signed assertion — no password or secret is passed between hops |
| User identity preserved end-to-end | The same JWT travels Slack Bot → Supervisor → AgentGateway → MCP unchanged |
| Delegation is auditable | OBO tokens carry `act.sub` (the delegating party) alongside `sub` (the real user) |
| Policy enforcement is centralised | AgentGateway is the single PEP for all MCP tool calls; tools don't implement their own authz |
| Least privilege at tool layer | CEL policies on AgentGateway allow per-tool, per-role access rules |
| Tenant isolation | `tenant` claim in JWT scopes data visible to the MCP server |

---

## Core Concept: The JWT

When you log in, Keycloak issues a **JWT (JSON Web Token)** signed with RS256 using its
realm private key. It's a base64url-encoded envelope of three parts:
`header.payload.signature`.

A decoded payload looks like this:

```json
{
  "iss": "http://localhost:7080/realms/caipe",
  "sub": "a3f9b2c1-...",
  "email": "alice@example.com",
  "name": "Alice Smith",
  "realm_access": {
    "roles": ["admin", "chat_user"]
  },
  "resource_access": {
    "caipe-ui": { "roles": ["uma_protection"] }
  },
  "tenant": "acme",
  "exp": 1713200000,
  "iat": 1713196400,
  "act": {
    "sub": "slack-bot-client"
  }
}
```

Key fields for security architects:

| Claim | Purpose | Where it's enforced |
|-------|---------|---------------------|
| `iss` | Token issuer — services reject tokens from unknown issuers | Dynamic agents JWKS validation, RAG server |
| `sub` | Opaque user ID (Keycloak UUID) — stable, not guessable | Conversation ownership, audit logs |
| `email` | Human-readable identity — used for display and Slack linking | UI, supervisor user context |
| `realm_access.roles` | Realm-level role assignments | AgentGateway CEL, dynamic agents `is_admin` |
| `exp` | Token expiry — enforced cryptographically | All JWKS validators, NextAuth refresh |
| `act.sub` | Delegation chain — set on OBO tokens only | Audit: proves bot acted on behalf of user |
| `tenant` | Multi-tenant data scoping | RAG server query isolation |

**Services never call Keycloak on each request.** They validate the signature offline
using the cached JWKS public key. JWKS is refreshed on cache miss (unknown `kid`) or on
a TTL (1 hour).

---

## Component 1: Keycloak — HR & The Front Desk

> **Badge analogy:** HR issues ID badges. The front desk verifies them on entry. Every
> other door in the building trusts the badge's chip — they don't call HR each time.
> When a contractor arrives via a partner agency (Duo SSO), the front desk checks with
> the agency once, creates an internal record, and issues a standard building badge.
> From that point on, the contractor uses the same badge as everyone else.

**Technically:** Keycloak acts as an OIDC Authorization Server and IdP broker. It
proxies login to Duo SSO via an OIDC client, maps external claims to local realm roles,
and issues its own signed JWT — so downstream services only ever need to trust one issuer.

### Realm Roles (`caipe` realm)

| Role | Default? | Purpose |
|------|----------|---------|
| `chat_user` | Yes — all authenticated users | Grants access to supervisor, Slack bot, RAG tools via AgentGateway CEL |
| `admin` | No — explicit assignment | Full CAIPE admin UI: user management, team CRUD, role assignment, Keycloak Admin API proxy |
| `kb_admin` | No | Knowledge base management: upload documents, configure RAG pipelines |
| `team_member` | No | Scoped to team-visibility dynamic agents |

`chat_user` is in the `default-roles-caipe` composite, so every newly-created or
brokered user gets it automatically. This is patched at runtime by `init-idp.sh` because
Keycloak's realm import doesn't reliably populate composite role members.

### External IdP Brokering (Duo SSO, Okta, or any OIDC provider)

> **Badge analogy:** The partner agency desk. Whether it's Duo SSO, Okta, or any other
> corporate identity provider, they all speak the same language (OIDC). Keycloak is the
> single translator — it talks to whichever agency is configured and converts their
> badges into standard building badges. The rest of the building never needs to know
> which agency originally issued the contractor's credentials.

Keycloak acts as a **relying party** to the upstream IdP (OIDC). From the user's
perspective it's invisible — they see only the upstream IdP login page. From a security
perspective:

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

**Supported upstream IdPs** — the `init-idp.sh` script configures any OIDC provider
generically via OIDC discovery (`/.well-known/openid-configuration`):

| Provider | `IDP_ALIAS` (in realm) | `IDP_ISSUER` example | Notes |
|----------|----------------------|----------------------|-------|
| Duo SSO | `duo-sso` | `https://sso-xxx.sso.duosecurity.com/oidc/xxx` | Uses `firstname`/`lastname` (non-standard); extra IdP mappers handle both `given_name` and `firstname` |
| Okta (OIDC) | `okta-oidc` | `https://your-org.okta.com` or `https://your-org.okta.com/oauth2/default` | Standard OIDC claims; groups come from Okta's `groups` claim (requires Okta app config) |
| Okta (SAML) | `okta-saml` | — | SAML 2.0; configured as a SAML IdP in Keycloak; attribute mappers needed for groups |
| Microsoft Entra ID (OIDC) | `entra-oidc` | `https://login.microsoftonline.com/{tenant-id}/v2.0` | Standard OIDC; groups claim requires Entra app manifest `groupMembershipClaims` config |
| Microsoft Entra ID (SAML) | `entra-saml` | — | SAML 2.0; common in enterprise M365 environments |
| Generic OIDC | any alias | any OIDC-compliant issuer URL | Works as long as the provider exposes `/.well-known/openid-configuration` |

**To wire up a new IdP**, set these env vars and run `init-idp.sh` (or restart the
`init-idp` container — it is idempotent):

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

**`OIDC_IDP_HINT`** (set in `ui/.env.local`) is passed to Keycloak as `kc_idp_hint` on
every auth request. It skips the Keycloak login page entirely and redirects straight to
the named IdP. Set it to the same value as `IDP_ALIAS`.

**Claim mapping chain:** The IdP sends `email`, `given_name`/`firstname`, `family_name`/
`lastname`, and `groups` claims. Keycloak IdP mappers write these to the local user
record. Role mappers translate `IDP_ACCESS_GROUP` membership to `chat_user` and
`IDP_ADMIN_GROUP` to `admin`. If neither group var is set, all brokered users receive
`chat_user` automatically via a hardcoded role mapper.

### Silent First-Login Flow (`caipe-silent-broker-login`)

The default Keycloak "first broker login" flow shows a "Review Profile" page and, if a
local account with the same email already exists, a "Confirm Link Account" page. Both are
eliminated by the custom flow patched in by `init-idp.sh`:

```
caipe-silent-broker-login  (both executions: ALTERNATIVE)
  │
  ├── idp-create-user-if-unique
  │     Condition: no local user with this email exists
  │     Action:    provision new Keycloak user, assign default roles
  │
  └── idp-auto-link
        Condition: local user with matching email already exists
        Action:    link external identity to existing account silently
```

This only works correctly because `trustEmail=true` is set on the IdP. That flag tells
Keycloak to treat the email claim from Duo SSO as authoritative for account matching.
**Security implication:** if the upstream IdP can be compromised to issue arbitrary email
claims, an attacker could link to any existing account. This is acceptable here because
Duo SSO is a corporate SSO — trust in the email claim is the same as trust in the IdP.

### User Profile & Custom Attributes

Keycloak 26+ enforces a user profile schema. Custom attributes are silently dropped
unless declared or `unmanagedAttributePolicy=ADMIN_EDIT` is set. `init-idp.sh` patches
both:

- Adds `slack_user_id` to the user profile schema with `admin`-only view/edit permissions
- Sets `unmanagedAttributePolicy=ADMIN_EDIT` so other Admin API attribute writes succeed

### Account Linking (Slack)

There are two modes, controlled by `SLACK_FORCE_LINK`:

**Auto-bootstrap (default, `SLACK_FORCE_LINK=false`):**

On the user's first Slack message the bot:
1. Calls Slack `users.info` → fetches `profile.email`
2. Queries Keycloak Admin API for a user with that exact email
3. If found: writes `slack_user_id` attribute → **linked silently, zero user action required**
4. If not found (email mismatch or user not yet in Keycloak): falls back to the manual link prompt below

**Explicit link (`SLACK_FORCE_LINK=true`):**

Slack users link their account by clicking an HMAC-signed URL:

```
/api/auth/slack-link?slack_user_id=U09TC6RR8KX&ts=1713196400&sig=<HMAC-SHA256>
```

The HMAC signature uses `SLACK_LINK_HMAC_SECRET`, prevents forged links, and is
time-bound (TTL enforced server-side). After OIDC login, the server writes
`slack_user_id` to the Keycloak user via the Admin API.

In both modes, once the link is established, all future Slack messages carry the user's
Keycloak identity automatically — no repeated login.

---

## Component 2: CAIPE UI — The Reception Desk

> **Badge analogy:** The reception desk at each department entrance. When you badge in,
> it reads your chip (JWT), checks your clearance level for this department, and either
> waves you through or says "sorry, you don't have access here." It doesn't phone HR —
> the badge chip already carries everything needed to make the decision.

**Technically:** Next.js App Router with NextAuth (Auth.js v5) for OIDC session
management. Every API route handler runs `requireRbacPermission()` which validates the
server-side session and enforces role requirements before proxying to backend services.

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

**Security note:** The JWT is stored in an httpOnly, Secure, SameSite=Lax session cookie
managed by NextAuth. Client-side JavaScript cannot read it. The session is encrypted with
`NEXTAUTH_SECRET`.

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

1. **Role-based (JWT claim):** `hasRoleFallback()` checks `realm_access.roles` from the
   session JWT against the required role for the resource+action pair.

2. **Bootstrap admin bypass:** `isBootstrapAdmin(email)` checks the email against
   `BOOTSTRAP_ADMIN_EMAILS`. This bypasses **all** resource/action checks. It exists for
   the chicken-and-egg problem: the first admin must be able to log in before Keycloak
   roles are properly configured. **Remove this env var once roles are working.**

### Token Refresh

NextAuth holds the refresh token and silently refreshes the access token before it
expires. If the refresh fails (revoked session, Keycloak down), the user is redirected to
login. The access token in the session is always the current live token — it's what gets
forwarded to backend services.

---

## Component 3: Supervisor A2A Server — The Dispatcher

> **Badge analogy:** The dispatcher at the internal mail room. When you drop off a work
> order, they scan your badge, note your name and clearance on the paperwork, and attach
> a photo-copy of your badge to every sub-order sent to other departments. Downstream
> departments never need to ask who initiated the original request — it's stapled to
> everything.

**Technically:** A Starlette/FastAPI application running the LangGraph multi-agent
supervisor. It has a layered middleware stack. The JWT is validated once at the
outer layer, then decoded and stored in a per-request contextvar by
`JwtUserContextMiddleware` so all downstream code can read user identity without
re-parsing the header.

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

`JwtUserContextMiddleware` is intentionally read-only. It does not re-validate the
token — that's already done by the auth middleware above it. It decodes the JWT payload
without verification, fetches the OIDC userinfo endpoint (cached 10 min) for
authoritative email/name/groups, and stores the result in a `ContextVar`:

```python
# Set once per request by JwtUserContextMiddleware
_jwt_user_context_var: ContextVar[JwtUserContext | None]

# Read anywhere in the same request (agent executor, tools, sub-calls)
ctx = get_jwt_user_context()
# ctx.email, ctx.name, ctx.groups, ctx.token
```

### JWT Forwarding to MCP Tools

When `FORWARD_JWT_TO_MCP=true`, the supervisor forwards the **original, unmodified**
bearer token from the incoming request to AgentGateway. This means:

- The token that reaches AgentGateway has `sub` = the real user (or OBO token with `act.sub` = bot)
- AgentGateway can evaluate the user's actual roles, not the supervisor's service account
- MCP servers that do their own JWT validation (e.g. RAG) see the real user identity

```
User JWT  →  Supervisor  →  (same JWT)  →  AgentGateway  →  MCP Server
```

**Security implication:** The supervisor must not modify or strip the bearer token before
forwarding. If it substituted its own service account token, the entire per-user
authorization chain would collapse.

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

> **Badge analogy:** The armed security checkpoint at the entrance to the server room.
> Everyone must badge in — no exceptions, no tailgating. The checkpoint has a physical
> rulebook (CEL policies) specifying exactly which badge types (roles) can enter which
> server rack (MCP tool). If your badge says `chat_user` and the rack requires `kb_admin`,
> you're turned away at the door, not inside the rack.

**Technically:** AgentGateway is the single **Policy Enforcement Point (PEP)** for all
MCP tool calls. It proxies HTTP/SSE requests to registered MCP backend servers and
evaluates a CEL (Common Expression Language) policy against the JWT claims before
allowing each request through. It is the only place in the architecture where
tool-level authorization is enforced — MCP servers do not need their own authz logic
beyond JWT signature validation.

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
jwt.claims.realm_access.roles.exists(r, r == "chat_user")

# Elevated access: admin or kb_admin
jwt.claims.realm_access.roles.exists(r, r == "admin" || r == "kb_admin")

# Tenant-scoped: user can only query their own tenant's data
jwt.claims.tenant == resource.tenant

# Combine role and tenant
jwt.claims.realm_access.roles.exists(r, r == "chat_user")
  && jwt.claims.tenant != ""
```

### Why This Is the Right Architecture for a PEP

- **Decoupled policy from business logic:** MCP servers implement domain logic, not authz.
  Changing a policy means editing `config.yaml`, not redeploying an MCP server.
- **Consistent enforcement:** Every tool — RAG, GitHub, ArgoCD, Slack — goes through the
  same gateway with the same JWT. No tool can be accidentally left unenforced.
- **Token passthrough:** AgentGateway forwards the JWT to the MCP backend unchanged.
  The backend can do its own secondary validation (e.g. tenant isolation).

---

## AgentGateway + OIDC + Keycloak — The Integrated Picture

> **Badge analogy:** **Duo SSO is the national ID office** — it issues the underlying
> identity. **Keycloak is HR** — it takes that national ID, prints a CAIPE-branded
> employee badge with your roles stamped on it, and publishes a **public fingerprint
> scanner** (JWKS) in the lobby so anyone can verify a badge is really HR-issued.
> **AgentGateway is the armed checkpoint** at the server room door. The checkpoint has
> a photocopy of the scanner taped to its desk so it can verify badges instantly without
> calling HR (or Duo). The checkpoint's rulebook (CEL) is kept up to date by a small
> courier (`ag-config-bridge`) that walks between the head office (MongoDB) and the
> checkpoint every few seconds with the latest rule updates.

**Technically:** Three distinct services cooperate to put a verified, role-carrying JWT
in front of AgentGateway on every request. AG itself is the **Policy Enforcement Point
(PEP)** — it doesn't authenticate users, it doesn't store roles, and it never talks to
Duo. It only verifies that the JWT in the request was signed by Keycloak (using a cached
copy of Keycloak's JWKS) and that the claims inside satisfy the CEL policy for the
target MCP tool.

| Layer | Role | What it owns | What it does NOT own |
|-------|------|--------------|----------------------|
| **Upstream IdP** (e.g. Duo SSO, Okta, Azure AD) | Identity provider | User authentication (password, MFA, device trust), email ownership | Application roles, per-tool access rules |
| **Keycloak** | OIDC AS + IdP broker | Realm roles (`chat_user`, `admin`), JWT issuance, JWKS publication, OBO token exchange (RFC 8693) | Tool-level decisions, user password (delegated to Duo) |
| **AgentGateway (PEP)** | Policy Enforcement Point | Per-route CEL rules, per-tool `mcpAuthorization` rules, local JWT verification against cached JWKS | Identity store, role store, token minting |

Keycloak **brokers** the upstream IdP — Duo SSO doesn't issue the JWT that AG sees.
Duo authenticates the user, returns an OIDC authorization code to Keycloak, and
Keycloak then mints the CAIPE JWT with the realm roles that CEL evaluates. From AG's
perspective, **Keycloak is the only issuer it trusts** (`iss = http://localhost:7080/realms/caipe`);
the existence of Duo is invisible to AG. This is the standard OIDC/OAuth 2.0
resource-server pattern applied to an MCP-aware proxy.

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

1. **Duo SSO authenticates the human.** It doesn't know about CAIPE roles. It only
   proves "this really is `alice@cisco.com` with working MFA" and hands an OIDC
   authorization code to Keycloak. Duo's issuer (`IDP_ISSUER`) is configured in
   Keycloak as `IDP_ALIAS=duo-sso`; this is the only direct contact between CAIPE and
   Duo.
2. **Keycloak brokers and rebrands the identity.** It validates the Duo code, runs its
   IdP mappers (e.g. `firstname` → `given_name` to handle Duo's non-standard claim),
   assigns realm roles (`chat_user` via the default role composite, plus `admin` if
   explicitly granted), and signs a **fresh JWT** with its own RS256 key. This is the
   only token CAIPE services ever see. Duo's identity token is discarded at the
   Keycloak boundary.
3. **Every CAIPE caller holds the same JWT.** The Slack Bot additionally does an RFC
   8693 token-exchange to produce an **OBO (On-Behalf-Of) JWT** that pins `sub=alice`
   and `act.sub=caipe-slack-bot` — but it's still a Keycloak-signed JWT with
   `iss = http://localhost:7080/realms/caipe`. From AG's perspective there's no
   difference between a UI JWT and an OBO JWT; both pass `jwtAuth` as long as they're
   signed by a key in AG's JWKS cache.
4. **AG verifies locally, evaluates CEL locally, forwards unchanged.** The JWT
   reaches the MCP server with Alice's identity intact, so MCP-level defense-in-depth
   checks (e.g. the RAG server's per-tenant document ACLs) see the real user — not
   the supervisor's service account and not the Slack bot.

The practical consequence: **to switch CAIPE from Duo SSO to Okta or Azure AD you
don't touch AgentGateway at all.** You change `IDP_ISSUER`, `IDP_CLIENT_ID`,
`IDP_CLIENT_SECRET`, `IDP_ALIAS`, and maybe a mapper in Keycloak, and every component
downstream — including the CEL rules on AG — keeps working without modification. This
is the whole point of making Keycloak the IdP broker instead of having each service
integrate directly with the upstream IdP.

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

There is **no direct API call from AG to Keycloak per request**. JWKS fetching is a
pure cache-refresh operation, not a live auth check.

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
- **`aud` must contain at least one of `audiences`** — protects against token substitution
  where a token was issued to a different service client.
- **`exp`, `nbf`, `iat` enforced** — expired or not-yet-valid tokens rejected.
- **Signature verified against JWKS** — `kid` in the JWT header must match a cached key.
- **Unknown `kid` triggers one forced JWKS refresh** — handles Keycloak key rotation without
  manual intervention.

Only after `jwtAuth` passes does AG evaluate the `authorization` and `mcpAuthorization`
CEL rules. If `jwtAuth` fails, the request never reaches policy evaluation.

### Per-Request Authorization Flow — End to End

```mermaid
sequenceDiagram
    autonumber
    actor User as Alice (Slack user)
    participant Duo as Duo SSO<br/>(upstream IdP)
    participant SB as Slack Bot
    participant UI as CAIPE UI<br/>(NextAuth)
    participant KC as Keycloak<br/>(OIDC server + JWKS + IdP broker)
    participant SUP as Supervisor A2A
    participant AG as AgentGateway :4000
    participant AGB as ag-config-bridge
    participant MDB as MongoDB<br/>(ag_mcp_policies)
    participant RAG as RAG MCP :9446

    rect rgb(245, 245, 252)
      note over AGB, MDB: Policy sync path (out-of-band, every ~5s)
      AGB->>MDB: find({}) on ag_mcp_policies + ag_mcp_backends
      MDB-->>AGB: [ {tool_pattern, expression, enabled}, ... ]
      AGB->>AGB: render config.yaml.j2 → sha256 changed?
      AGB->>AG: atomic write /etc/agentgateway/config.yaml
      note over AG: File watcher reloads CEL rules + jwtAuth config<br/>(no restart needed)
    end

    rect rgb(245, 252, 245)
      note over AG, KC: JWKS refresh (out-of-band, on TTL or unknown kid)
      AG->>KC: GET /realms/caipe/protocol/openid-connect/certs
      KC-->>AG: { keys: [ { kid, kty: RSA, n, e, ... }, ... ] }
      AG->>AG: cache keys by kid, TTL = Cache-Control max-age
    end

    rect rgb(252, 250, 240)
      note over User, KC: One-time login path (per user session,<br/>typically once per workday)
      User->>UI: opens CAIPE UI
      UI->>KC: GET /auth?kc_idp_hint=duo-sso
      KC->>Duo: OIDC auth code request<br/>(IDP_CLIENT_ID, redirect_uri=KC/broker/duo-sso/endpoint)
      Duo->>User: Duo Universal Prompt<br/>(password + MFA + device trust)
      User-->>Duo: authenticated
      Duo-->>KC: auth code → /token → id_token + userinfo<br/>(email, firstname, lastname)

      note over KC: IdP mappers normalize claims<br/>(firstname→given_name, email→email)<br/>First login also creates local user + assigns<br/>default realm role chat_user
      KC-->>UI: CAIPE JWT<br/>iss=http://localhost:7080/realms/caipe<br/>sub=alice, email=alice@cisco.com,<br/>realm_access.roles=[chat_user, argocd-admin]
      note over UI: NextAuth stores JWT in<br/>encrypted server-side session cookie
      UI-->>User: logged in (Duo identity never leaves KC boundary)
    end

    rect rgb(252, 248, 245)
      note over User, RAG: Hot path — one user request
      User->>SB: "list my ArgoCD apps"
      note over SB: Slack already linked to Keycloak user via<br/>/api/admin/slack-links → uses stored slack_user_id→sub mapping
      SB->>KC: POST /token (RFC 8693 token-exchange for Alice)<br/>subject_token=slack-bot-service-account<br/>requested_subject=alice
      KC-->>SB: OBO JWT<br/>iss=http://localhost:7080/realms/caipe,<br/>sub=alice, act.sub=caipe-slack-bot,<br/>realm_access.roles=[chat_user], aud=[caipe-platform]

      SB->>SUP: POST /a2a<br/>Authorization: Bearer OBO_JWT

      note over SUP: JwtUserContextMiddleware validates & stashes JWT
      SUP->>AG: POST /rag/... Authorization: Bearer OBO_JWT<br/>(same token, unmodified)

      note over AG: jwtAuth: validate signature + iss + aud + exp<br/>(all local — AG never talks to Duo or KC on this path)
      AG->>AG: lookup kid in JWKS cache → verify RS256
      AG->>AG: iss == http://localhost:7080/realms/caipe ✓
      AG->>AG: "caipe-platform" in aud ✓
      AG->>AG: now < exp ✓

      note over AG: CEL authorization: per-route + per-tool
      AG->>AG: route rule:<br/>"chat_user" in jwt.realm_access.roles → ALLOW
      AG->>AG: mcpAuthorization rule for tool "rag_query":<br/>roles ∋ chat_user && tool.name.startsWith("rag_query") → ALLOW

      AG->>RAG: proxied POST /mcp<br/>Authorization: Bearer OBO_JWT (untouched)
      note over RAG: MCP does its own JWKS validation<br/>(defense in depth)
      RAG->>KC: (optional) JWKS fetch if cache miss
      KC-->>RAG: JWKS (cached)
      RAG-->>AG: { documents: [...] }
      AG-->>SUP: proxied response
      SUP-->>SB: streamed
      SB-->>User: DM with results
    end
```

**Read this diagram as four independent timelines that happen to converge:**

1. **Policy timeline** — admins edit CEL rules in the UI (`/admin/rbac/ag-policies`),
   which writes to MongoDB. `ag-config-bridge` polls MongoDB and re-renders `config.yaml`
   on change. AG hot-reloads via its file watcher. **Mean time from admin save to
   enforcement: ≤10s.**
2. **Key timeline** — Keycloak publishes its signing keys on a public endpoint. AG
   fetches them lazily (startup, TTL expiry, or unknown `kid`). **Keycloak is not a
   runtime dependency of AG** — requests succeed even if Keycloak is briefly unreachable,
   as long as the cached JWKS has a valid key for the JWT's `kid`.
3. **Login timeline** — Duo SSO authenticates the human exactly **once per session**
   (typically once per workday; SAML assertion / OIDC id_token then carries forward via
   Duo's own session). Keycloak exchanges that Duo assertion for a CAIPE-signed JWT
   that travels through every subsequent request. **Duo is not on the request hot
   path** — it is only touched on login. This is why AG's CEL rules can assume a JWT
   exists without ever needing to understand what Duo is.
4. **Request timeline** — the OBO JWT carries the user's identity and roles end-to-end.
   The *same token* is verified by AG (edge) and optionally re-verified by the MCP
   server (depth). This is deliberate: a misconfigured CEL rule doesn't leave the MCP
   open; a compromised AG doesn't let tokens past MCP without signature check.

> **Demo tip:** when presenting this diagram live, start by highlighting the
> **Login timeline** (steps ~5–13) and note "this happens once per day". Then trace
> through the **Request timeline** (steps ~14–28) and ask the audience where Duo
> appears — the answer is *nowhere*, because every downstream check uses the
> Keycloak-signed JWT. This is the clearest way to explain why CAIPE can swap IdPs
> without touching agent code.

### Policy Storage: Two Surfaces, One Source of Truth

AG's CEL rules can be authored two ways — they end up in the same MongoDB collection:

| Surface | Use case | Path |
|---------|----------|------|
| **Admin UI** (dynamic) | Change policy without a redeploy; audit trail per edit | `CAIPE UI → Admin → AG MCP Policies` → `ui/src/app/api/rbac/ag-policies/route.ts` → MongoDB `ag_mcp_policies` |
| **Static bootstrap** | First-run seed in environments that start from empty MongoDB | `deploy/agentgateway/config-bridge.py` → `SEED_POLICIES` (upserts once if collection empty) |

In both cases the **only consumer** is `ag-config-bridge`, which renders to
`config.yaml.j2` and writes the final `config.yaml` that AG reads. There is no other
path by which a CEL rule can reach AG.

### CEL Cheat Sheet — JWT Claims Available in Rules

AG evaluates CEL expressions against a context object that includes the **verified**
JWT payload. The most useful fields:

```cel
# Realm roles (set in realm-config.json + init-idp.sh composites)
"chat_user" in jwt.realm_access.roles
"admin"     in jwt.realm_access.roles

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
has(mcp.tool) && mcp.tool.name.startsWith("admin_")
```

The existing production ruleset in `deploy/agentgateway/config.yaml` shows the common
patterns: admin-only prefixes (`admin_*`, `supervisor_config`), role-gated prefixes
(`rag_query`, `rag_ingest`, `rag_tool`, `team_*`, `dynamic_agent_*`, `github_*`), and
a catch-all for non-admin, non-ingest tools.

### Operational Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| AG restart does not invalidate user sessions | User JWTs are self-contained; AG just re-fetches JWKS on startup |
| Keycloak key rotation is zero-downtime | Unknown `kid` triggers one forced JWKS refresh; cached keys remain valid until `exp` |
| Policy update is zero-downtime | Atomic `os.replace()` write in `ag-config-bridge` + AG file watcher = no dropped requests |
| Admin UI edit audit trail | Every policy write to `ag_mcp_policies` records `updated_by` and `updated_at` |
| MongoDB outage doesn't take AG down | AG keeps running against the last-rendered `config.yaml`; `ag-config-bridge` logs `bridge_error` but doesn't crash AG |
| Keycloak outage doesn't take AG down for already-issued tokens | JWKS is cached; new logins fail at Keycloak, not at AG |

### Demo Walkthrough: Prove Every Gate

```bash
# 1) Get a real chat_user token from Keycloak (no UI involved)
TOKEN=$(curl -s -X POST http://localhost:7080/realms/caipe/protocol/openid-connect/token \
  -d 'grant_type=password' \
  -d 'client_id=caipe-ui' \
  -d 'client_secret=caipe-ui-dev-secret' \
  -d 'username=standard-user' \
  -d 'password=standard' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 2) Inspect the claims — prove iss, aud, roles match AG's jwtAuth expectations
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool \
  | grep -E '"(iss|aud|exp|realm_access)"'

# 3) Call AG with a valid token → CEL rule evaluates → proxied to RAG MCP
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST http://localhost:4000/rag/v1/query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"hello"}'
# → HTTP 200 (jwtAuth passed, chat_user role matches CEL rule)

# 4) Call AG with a denied-user token → CEL evaluates → 403
DENIED=$(curl -s -X POST http://localhost:7080/realms/caipe/protocol/openid-connect/token \
  -d 'grant_type=password&client_id=caipe-ui&client_secret=caipe-ui-dev-secret' \
  -d 'username=denied-user&password=denied' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $DENIED" \
  http://localhost:4000/rag/v1/query
# → HTTP 403 (jwtAuth passed — denied-user is authenticated — but CEL deny)

# 5) Call AG with a forged token → jwtAuth rejects before CEL even runs
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer not.a.real.jwt" \
  http://localhost:4000/rag/v1/query
# → HTTP 401 (signature verification fails against JWKS)

# 6) Show live config as AG sees it
curl -s http://localhost:15000/config | python3 -m json.tool | head -40
```

The three outcomes (200, 403, 401) map directly onto the three distinct layers
the diagram above: **CEL allow**, **CEL deny**, and **jwtAuth reject**.

---

## Component 5: Dynamic Agents — The Workshop Floor

> **Badge analogy:** A workshop where employees build and operate their own machines.
> The workshop checks your badge at the door (JWT validation on every request). Once
> inside, each machine has its own access tag — some are personal (Private), some are
> shared with your team (Team), some anyone can use (Global). Your badge level determines
> which machines you can touch. When a machine makes a tool call, it presents your badge
> — not its own — so the security checkpoint still sees *you*, not the machine.

**Technically:** A FastAPI service where every route handler uses `get_current_user()`
as a FastAPI `Depends()`. Unlike the supervisor (which uses a middleware contextvar), the
dynamic agents service validates the JWT on every request at the route level, giving
precise control per endpoint.

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

After the user is authenticated, `can_use_agent(agent, user)` decides whether they can
invoke a specific agent:

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

The `UserContext.obo_jwt` (set from `X-OBO-JWT` header) or `UserContext.access_token`
is forwarded as the `Authorization: Bearer` header on all MCP tool calls made by the
agent runtime. This gives the same per-user enforcement at AgentGateway as the supervisor
path provides.

### Key Environment Variables

| Variable | Default | Security note |
|----------|---------|---------------|
| `AUTH_ENABLED` | `false` | **Must be `true` in production.** `false` returns a hardcoded `dev@localhost` admin — never deploy with `false`. |
| `OIDC_ISSUER` | — | Validated against `iss` claim; tokens from other issuers are rejected |
| `OIDC_CLIENT_ID` | — | Used as expected `aud` claim; prevents token substitution from other clients |
| `OIDC_REQUIRED_GROUP` | — | Blanket access gate; set to `chat_user` to mirror AgentGateway policy |
| `OIDC_REQUIRED_ADMIN_GROUP` | — | Group/role that grants `is_admin`; defaults to pattern matching "admin" |

---

## The OBO Token Exchange — Slack Identity Propagation

> **Badge analogy:** The Slack bot is a courier service. When Alice asks the courier to
> pick something up from the server room on her behalf, the courier can't use their own
> badge — the server room requires Alice's clearance. Instead, the courier goes to HR
> (Keycloak), presents their credentials and Alice's employee ID, and HR issues a
> *delegated badge*: it opens the same doors as Alice's badge, but it has a second chip
> that says "issued on behalf of Alice, presented by courier bot." The delegation chain
> is physically stamped on the badge — it's auditable and unforgeable.

**The hardest part to get right technically.** Without OBO, every Slack request carries
the bot's service account identity — `realm_access.roles` would be the bot's roles, not
the user's, and all per-user authorization would be meaningless.

### RFC 8693 Token Exchange

OBO (On-Behalf-Of) is implemented via [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)
token exchange. The bot uses its `client_credentials` grant to request a token
**impersonating** a specific Keycloak user:

```http
POST /realms/caipe/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&client_id=slack-bot
&client_secret=<bot-secret>
&subject_token=<bot-access-token>
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&requested_subject=<keycloak-user-id>
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
```

Keycloak responds with an OBO JWT where:

- `sub` = the impersonated user's Keycloak ID
- `email` = the user's email
- `realm_access.roles` = the **user's** roles (not the bot's)
- `act.sub` = the bot's client ID — the delegation chain is cryptographically recorded

```mermaid
sequenceDiagram
    actor U as Slack User
    participant SB as Slack Bot
    participant KC as Keycloak
    participant SUP as Supervisor A2A
    participant AG as AgentGateway
    participant MCP as RAG MCP

    U->>SB: query the knowledge base about X

    note over SB: rbac_global_middleware runs first
    SB->>KC: GET /admin/realms/caipe/users?q=slack_user_id:U09TC6RR8KX
    KC-->>SB: [{ id: "a3f9...", email: "alice@example.com" }]

    note over SB,KC: RFC 8693 token exchange
    SB->>KC: POST /token (grant=token-exchange, requested_subject=a3f9...)
    KC-->>SB: OBO JWT (sub=a3f9, act.sub=slack-bot, roles=[admin,chat_user])

    SB->>SUP: POST /a2a  Authorization: Bearer OBO_JWT

    note over SUP: JwtUserContextMiddleware
    SUP->>SUP: decode JWT → email=alice, roles=[admin,chat_user]
    SUP->>SUP: store in ContextVar (get_jwt_user_context())

    note over SUP: LangGraph selects RAG tool
    SUP->>AG: POST /rag/v1/query  Authorization: Bearer OBO_JWT

    note over AG: CEL policy evaluation
    AG->>AG: roles.exists(r, r=="chat_user") → ALLOW

    AG->>MCP: POST /v1/query  Authorization: Bearer OBO_JWT
    note over MCP: JWKS validation
    MCP->>KC: GET /realms/caipe/protocol/openid-connect/certs
    KC-->>MCP: JWKS public keys
    MCP->>MCP: verify signature, extract email + tenant

    MCP-->>AG: results
    AG-->>SUP: results
    SUP-->>SB: streamed response
    SB-->>U: DM with answer
```

### Security Properties of OBO

| Property | Mechanism |
|----------|-----------|
| Bot cannot forge a user identity | Keycloak only issues the OBO token if the bot's `client_id` has the `token-exchange` permission granted in the realm |
| Delegation is auditable | `act.sub` in the JWT records the bot as delegating party — verifiable in any JWKS-aware system |
| User roles are enforced, not bot roles | `realm_access.roles` in the OBO token are the user's, not the bot's service account roles |
| Token expiry still applies | OBO tokens have the same `exp` as a normal Keycloak token; expired tokens are rejected at every JWKS validation point |
| Unlinked users are blocked at the edge | `rbac_global_middleware` in the Slack bot rejects unlinked users before they reach the supervisor — the linking prompt is sent at most once per `SLACK_LINKING_PROMPT_COOLDOWN` seconds (default: 3600) |

---

## Channel → Dynamic Agent Routing

> **Badge analogy:** Each Slack channel is a dedicated help-desk line. An admin assigns each
> line a specific expert agent (like routing IT tickets to the right tier). When a user calls in,
> the operator checks the channel's routing table, verifies the user has clearance for that agent,
> then patches them through. The routing decision and access check happen *before* the message
> reaches the agent.

### How It Works

Every Slack channel can be mapped to exactly one dynamic agent (1:1 mapping). When a message
arrives, the Slack bot resolves the target agent:

1. **Lookup**: query `channel_agent_mappings` in MongoDB by `slack_channel_id`
2. **Existence check**: verify the mapped agent exists in `dynamic_agents` and `enabled = true`
3. **RBAC check** (basic):
   - `visibility = global` → allow any authenticated user
   - `visibility = team` → require `team_member:<team>` Keycloak realm role for one of the agent's `shared_with_teams`
   - `visibility = private` → deny (private agents are not appropriate for channel routing)
4. **Route**: pass the resolved `agent_id` to the chat/stream call; fallback to YAML config default if no mapping exists

### Admin UI

Admins configure mappings in **CAIPE UI → Admin → Channel-to-agent mappings**.

- Dropdown lists all dynamic agents visible to the admin
- Upsert semantics: creating a new mapping for an already-mapped channel replaces the old mapping
- Deactivating a mapping (soft delete) falls back to the YAML config default agent

### Key Files

| Layer | File |
|-------|------|
| MongoDB channel→agent mapping (read/write) | `ui/src/app/api/admin/slack/channel-mappings/route.ts` |
| Admin UI tab | `ui/src/components/admin/SlackChannelMappingTab.tsx` |
| Slack bot resolver + RBAC check | `ai_platform_engineering/integrations/slack_bot/utils/channel_agent_mapper.py` |
| Slack bot integration point | `ai_platform_engineering/integrations/slack_bot/app.py` (`_rbac_enrich_context`, `_channel_agent_id_from_context`) |

### MongoDB Collection: `channel_agent_mappings`

```json
{
  "_id": ObjectId,
  "slack_channel_id": "C0123456789",
  "agent_id": "my-k8s-agent",
  "channel_name": "#k8s-support",
  "slack_workspace_id": "T0123456789",
  "created_by": "admin@example.com",
  "created_at": ISODate,
  "active": true
}
```

The `agent_id` field is the dynamic agent's slug (string `_id` in `dynamic_agents` collection).

---

## End-to-End Request Flow

```
Slack User: "What's the status of my ArgoCD deployment?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1: Identity Resolution  (Slack Bot)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  slack_user_id U09TC6RR8KX
    → Keycloak Admin API lookup by attribute
    → user: { id: "a3f9...", email: "alice@example.com" }
  RFC 8693 exchange → OBO JWT
    sub=alice, act.sub=slack-bot, roles=[chat_user]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2: Supervisor Ingestion  (A2A + LangGraph)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  POST /a2a  Authorization: Bearer OBO_JWT
    → OAuth2Middleware: validates RS256 signature against JWKS
    → JwtUserContextMiddleware: decodes claims, stores in ContextVar
    → agent_executor: get_jwt_user_context() → email=alice
    → LangGraph selects ArgoCD MCP tool

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3: Policy Enforcement  (AgentGateway)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  POST /argocd/...  Authorization: Bearer OBO_JWT
    → CEL: roles.exists(r, r=="chat_user") → ALLOW
    → Proxy to ArgoCD MCP Server

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4: MCP Tool Execution  (ArgoCD MCP Server)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Validates OBO JWT against Keycloak JWKS independently
  Extracts email=alice, tenant=acme
  Returns deployments scoped to alice's tenant

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Response path: MCP → Gateway → Supervisor → Slack → User
```

---

## How to Use It Right Now

### Start the Stack

```bash
COMPOSE_PROFILES='rbac,caipe-ui,caipe-mongodb' \
  docker compose -f docker-compose.dev.yaml up -d

# Wait for Keycloak to be healthy before logging in
docker compose -f docker-compose.dev.yaml ps keycloak
```

Keycloak admin console: `http://localhost:7080/admin` (admin / admin)

> **Heads-up: `caipe-ui` host port is hard-pinned to `3000`.** Keycloak's `caipe-ui` client only allow-lists `http://localhost:3000/*` as a redirect URI (see `deploy/keycloak/realm-config.json`). Remapping the UI breaks the OIDC redirect dance and login fails with `Invalid redirect_uri`. The spec-102 e2e lane (`make test-rbac-up`) honours this — it remaps Mongo (`28017`) and supervisor (`28000`) to a `28xxx` band, but leaves `caipe-ui:3000` and Keycloak (`7080/7443`) untouched. See [spec 102 quickstart › E2E port band](../102-comprehensive-rbac-tests-and-completion/quickstart.md#e2e-port-band) for the full table and env-var contract.

### Built-in Test Users (`caipe` realm)

| Username | Password | Roles | Boundary to test |
|----------|----------|-------|-----------------|
| `admin-user` | `admin` | admin, chat_user | Full admin UI access |
| `standard-user` | `standard` | chat_user, team_member | Chat only, no admin UI |
| `kb-admin-user` | `kbadmin` | chat_user, team_member, kb_admin | RAG management |
| `denied-user` | `denied` | (none) | 403 on all protected routes |
| `org-b-user` | `orgb` | chat_user (tenant: globex) | Tenant isolation — sees only Globex data |

### Verify Role Enforcement

```bash
# Login as denied-user, try to hit a protected API directly
TOKEN=$(curl -s -X POST http://localhost:7080/realms/caipe/protocol/openid-connect/token \
  -d "grant_type=password&client_id=caipe-ui&client_secret=caipe-ui-dev-secret&username=denied-user&password=denied" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/.well-known/agent.json
# → 200 (public endpoint)

curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/rag/v1/query
# → 403 (AgentGateway CEL denies — no chat_user role)
```

### Enable Dynamic Agents Auth

`AUTH_ENABLED` defaults to `false` in dev (returns a hardcoded admin bypass). To test
the real RBAC path:

```bash
# .env
AUTH_ENABLED=true
OIDC_ISSUER=http://localhost:7080/realms/caipe
OIDC_CLIENT_ID=caipe-ui
OIDC_REQUIRED_ADMIN_GROUP=admin
```

### Slack Identity Linking

**Auto mode (default):**
1. Send any message to the bot
2. Bot silently fetches your Slack email, matches it to your Keycloak account, links automatically
3. Subsequent messages: OBO exchange happens automatically — zero user action required

**Forced-link mode (`SLACK_FORCE_LINK=true`):**
1. DM the Slack bot with any message
2. If unlinked: one-time HMAC-signed link prompt (rate-limited by `SLACK_LINKING_PROMPT_COOLDOWN`)
3. Click link → SSO login → `slack_user_id` written to Keycloak via Admin API
4. Subsequent messages: OBO exchange happens automatically

---

## Threat Model Considerations

| Threat | Mitigation |
|--------|-----------|
| JWT forgery | RS256 signature verified against Keycloak JWKS; private key never leaves Keycloak |
| JWT replay after expiry | `exp` claim enforced at every JWKS validation point |
| Token theft from browser | NextAuth stores tokens in httpOnly server-side session cookie; raw JWT never in JS context |
| Bot impersonating arbitrary user via OBO | Keycloak's `token-exchange` permission must be explicitly granted to the bot client; not available by default |
| Privilege escalation via claim manipulation | JWT is signed; any claim modification invalidates the RS256 signature |
| Tenant data leakage | `tenant` claim in JWT used for query scoping at MCP layer; enforced by CEL policy per-route |
| Unlinked Slack users bypassing RBAC | `rbac_global_middleware` blocks all unlinked users before the supervisor is called |
| `AUTH_ENABLED=false` in production | Startup log emits a `WARNING` when auth is disabled; also documented in the Dynamic Agents env var table above |
| Bootstrap admin left permanently enabled | No automatic enforcement — documented operational risk; must be removed post-setup |

---

## Common Questions

**Q: Why does the UI still work if Keycloak is down?**

The UI and all services cache the JWKS public key. Signature validation is local — no
Keycloak call needed per request. Sessions already in flight remain valid until their
`exp`. Only new logins (which need Keycloak's auth endpoint) fail.

**Q: What is `BOOTSTRAP_ADMIN_EMAILS` and when should I remove it?**

It's an emergency bypass that grants full admin regardless of JWT roles. Intended only
for initial setup when Keycloak role mapping isn't yet configured. Once `admin-user` (or
your real admin account) has the `admin` realm role and can log in successfully, remove
`BOOTSTRAP_ADMIN_EMAILS` from your env. Leaving it in production is a standing
privilege escalation risk.

**Q: Why are there both `access_token` and `obo_jwt` on `UserContext`?**

UI-sourced requests carry the user's own access token (`access_token`). Slack-sourced
requests carry an OBO token (`obo_jwt` from the `X-OBO-JWT` header) — this preserves
the delegator/delegatee distinction for audit purposes. The agent runtime prefers
`obo_jwt` over `access_token` when forwarding to MCP tools.

**Q: What happens when the JWT expires mid-session?**

NextAuth holds the refresh token and silently refreshes before expiry. If the refresh
fails (revoked session, Keycloak unavailable), the next API call returns 401 and the
client redirects to login. OBO tokens issued by the Slack bot are short-lived; the bot
re-exchanges on each message.

**Q: Can I add a custom role and enforce it at AgentGateway?**

Yes. In Keycloak Admin: Realm Roles → Create. Add it to `default-roles-caipe` if it
should be universal. Add an IdP mapper if it should come from a Duo SSO group. Then
update `deploy/agentgateway/config.yaml` with a CEL policy referencing the new role.
No code changes required.

---

## Service-to-Service Authentication (Slack bot → caipe-ui)

The Slack bot calls caipe-ui's API as a machine client, not as a logged-in
user. It uses the OAuth2 `client_credentials` grant against the `caipe`
realm:

| Env var | Purpose |
|---------|---------|
| `SLACK_INTEGRATION_ENABLE_AUTH=true` | Enables Bearer-token path in `app.py` |
| `SLACK_INTEGRATION_AUTH_TOKEN_URL` | `${KEYCLOAK_URL}/realms/caipe/protocol/openid-connect/token` |
| `SLACK_INTEGRATION_AUTH_CLIENT_ID` | `caipe-slack-bot` (pre-created in `realm-config.json`) |
| `SLACK_INTEGRATION_AUTH_CLIENT_SECRET` | Fetched from Keycloak — see "Provisioning service-client secrets" below |

**Token shape** (fields that matter):

- `iss` — `${KEYCLOAK_URL}/realms/caipe`
- `aud` — `[caipe-ui, caipe-platform]` — both audiences are needed. `caipe-platform`
  is added by Keycloak's default audience resolution; `caipe-ui` comes from an
  `oidc-audience-mapper` protocol mapper (`aud-caipe-ui`) on the `caipe-slack-bot`
  client. caipe-ui's JWT validator rejects tokens whose audience doesn't include
  `OIDC_CLIENT_ID` (i.e. `caipe-ui`), so this mapper is required.
- `azp` — `caipe-slack-bot`
- `sub` — service account UUID (stable)
- `preferred_username` — `service-account-caipe-slack-bot`
- `scope` — `groups email profile org roles`

The mapper is created automatically by `deploy/keycloak/init-idp.sh` (idempotent).

**This token represents the bot, not the user.** User identity is carried
separately by the OBO flow in `utils/obo_exchange.py` (RFC 8693 token
exchange), which produces a second token with `act.sub=caipe-slack-bot`
and the real user's `sub`/`email`.

### Provisioning service-client secrets in production

In dev, secrets are embedded in `deploy/keycloak/realm-config.json`. In
production, operators should treat them as rotating credentials:

**Option A — manual (Keycloak Admin UI):**

1. Log into Keycloak Admin Console → `caipe` realm → Clients →
   `caipe-slack-bot` → Credentials tab.
2. Copy the Secret value (or click **Regenerate Secret** for rotation).
3. Store it in your secret manager (Vault, AWS SSM, K8s Secret) as
   `SLACK_INTEGRATION_AUTH_CLIENT_SECRET`.
4. Redeploy / restart the Slack bot pod so it picks up the new secret.

**Option B — scripted (`deploy/keycloak/export-client-secrets.sh`):**

The script fetches secrets via the Keycloak Admin API and emits them in
one of three formats:

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

The Helm chart can wire this up as a post-install Job so fresh installs
get the Secret populated without operator intervention. Rotation is the
same call — the Secret is overwritten in place.

---

## File Map

| What you want to change | File |
|-------------------------|------|
| Keycloak realm: roles, clients, test users | `deploy/keycloak/realm-config.json` |
| Keycloak runtime patches: silent flow, user profile, role composites, slack-bot audience mapper | `deploy/keycloak/init-idp.sh` |
| Export client secrets to env/dotenv/K8s Secret | `deploy/keycloak/export-client-secrets.sh` |
| UI session & NextAuth OIDC config | `ui/src/lib/auth.ts` |
| UI RBAC middleware (per-route role enforcement) | `ui/src/lib/api-middleware.ts` |
| Supervisor middleware stack (auth + JWT context) | `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/main.py` |
| Per-request user identity (contextvar) | `ai_platform_engineering/utils/auth/jwt_context.py` |
| JWT context middleware (Starlette) | `ai_platform_engineering/utils/auth/jwt_user_context_middleware.py` |
| Supervisor agent executor (ENABLE_USER_INFO_TOOL) | `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py` |
| Dynamic agents JWT validation & userinfo | `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/auth.py` |
| Dynamic agents agent-level authorization (CEL / visibility) | `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/access.py` |
| AgentGateway static CEL policies (rendered) | `deploy/agentgateway/config.yaml` |
| AgentGateway Jinja template (source of truth for rendering) | `deploy/agentgateway/config.yaml.j2` |
| `ag-config-bridge` (MongoDB → config.yaml sync + seed) | `deploy/agentgateway/config-bridge.py` |
| Admin UI: edit AG CEL policies at runtime | `ui/src/app/api/rbac/ag-policies/route.ts` |
| MongoDB collections: `ag_mcp_policies`, `ag_mcp_backends`, `ag_sync_state` | managed by `config-bridge.py` |
| Slack OBO token exchange (RFC 8693) | `ai_platform_engineering/integrations/slack_bot/utils/obo_exchange.py` |
| Slack identity auto-bootstrap + manual link | `ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py` |
| Slack account linking UI callback | `ui/src/app/api/auth/slack-link/route.ts` |
| Slack channel → agent routing + RBAC | `ai_platform_engineering/integrations/slack_bot/utils/channel_agent_mapper.py` |
| Admin UI: channel-to-agent mappings | `ui/src/components/admin/SlackChannelMappingTab.tsx` |
| API: channel-to-agent mapping CRUD | `ui/src/app/api/admin/slack/channel-mappings/route.ts` |
| Admin API: Keycloak identities (RBAC mgmt) | `ui/src/app/api/admin/users/route.ts` |
| Admin API: per-user MongoDB activity stats (Keycloak `admin_ui#view`) | `ui/src/app/api/admin/users/stats/route.ts` |
| RBAC e2e port band + `E2E_COMPOSE_ENV` contract (spec 102) | `Makefile` (`test-rbac-up` target) + [spec 102 quickstart › E2E port band](../102-comprehensive-rbac-tests-and-completion/quickstart.md#e2e-port-band) |
| RBAC e2e env-var substitutions inside the dev compose file | `docker-compose.dev.yaml` (search for `MONGODB_HOST_PORT`, `SUPERVISOR_HOST_PORT`, `RBAC_FALLBACK_FILE`, `E2E_RUN`) |
