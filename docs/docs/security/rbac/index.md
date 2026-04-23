# CAIPE RBAC

**Audience:** Junior engineers getting oriented + security architects reviewing the design.

This is the canonical reference for how authentication and authorization work in CAIPE. It is split into four focused docs (plus this index) so you don't have to read end-to-end to find what you need:

| If you want to… | Read |
|---|---|
| Understand each component (Keycloak, UI, Supervisor, AgentGateway, Dynamic Agents) and how they're wired | [Architecture](./architecture.md) |
| Trace a request — login, OBO token-exchange, end-to-end Slack flow, Slack channel → agent routing | [Workflows](./workflows.md) |
| Log in, exercise a role, verify a denial, link a Slack user, run the demo | [Usage](./usage.md) |
| Find the file that owns a specific piece of the auth path | [File map](./file-map.md) |
| **Install CAIPE on a real K8s cluster** — bootstrap admin, IdP, and slack-bot client secrets via dev defaults, manual K8s Secrets, or ESO (Vault / AWS-SM / GCP-SM) | [Secrets bootstrap](./secrets-bootstrap.md) |

Every component-level doc opens with a **badge analogy** to build intuition, followed by the precise technical detail. Read the analogy first, then the technical section — they describe the same thing at different levels of abstraction.

---

## The Big Picture

Think of CAIPE like a **secure corporate office building**:

- **Keycloak** is HR + the front desk. It issues ID badges, manages who works here, and verifies contractors through a partner agency (your enterprise IdP — typically **Okta** or **Duo SSO**).
- **Every service** is a room with its own badge reader. You prove who you are once at the front desk, get a badge, and that badge is checked at every door — no calling HR again each time.
- **AgentGateway** is the armed security checkpoint between the office and the server room. Everyone must show their badge, and the checkpoint has a rulebook specifying exactly which roles are allowed in which room.
- **The badge itself** is a JWT — a tamper-proof, digitally signed card that any badge reader can verify independently without phoning HR.

Technically: CAIPE uses **OpenID Connect (OIDC)** for authentication and **JWT bearer tokens** for stateless authorization across all service boundaries. There is one token issuer (Keycloak), and every service verifies tokens against Keycloak's published JWKS public keys — no shared secrets, no per-hop re-authentication.

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

When you log in, Keycloak issues a **JWT (JSON Web Token)** signed with RS256 using its realm private key. It's a base64url-encoded envelope of three parts: `header.payload.signature`.

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

**Services never call Keycloak on each request.** They validate the signature offline using the cached JWKS public key. JWKS is refreshed on cache miss (unknown `kid`) or on a TTL (1 hour).

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
| `AUTH_ENABLED=false` in production | Startup log emits a `WARNING` when auth is disabled; also documented in [Architecture › Dynamic Agents env vars](./architecture.md#key-environment-variables-2) |
| Bootstrap admin left permanently enabled | No automatic enforcement — documented operational risk; must be removed post-setup |

---

## Where to next

- **[Architecture](./architecture.md)** — Component-by-component reference: Keycloak, UI, Supervisor, AgentGateway, Dynamic Agents.
- **[Workflows](./workflows.md)** — Sequence diagrams for login, OBO, end-to-end requests, Slack channel routing.
- **[Usage](./usage.md)** — Bring up the stack, log in as test users, verify RBAC denials, run the demo.
- **[File map](./file-map.md)** — When you need to change something, this tells you which file to open.
