# 098 Architecture: Enterprise RBAC for CAIPE Platform

**Spec**: 098 — Enterprise RBAC for Slack and CAIPE UI (`098-enterprise-rbac-slack-ui`)
**Date**: April 2026
**Supersedes**: [093 architecture](../093-agent-enterprise-identity/architecture.md) (historical reference)

---

## Canonical Architecture Diagram

This is the **single source of architecture truth** for Enterprise RBAC. Numbered arrows correspond to the flow table below the diagram.

```mermaid
flowchart LR
    subgraph Entry["① Entry Points"]
        Slack("Slack")
        Webex("Webex")
        UI("CAIPE Admin UI")
    end

    subgraph Backend["② Bot / BFF Layer"]
        BotBFF("Bot Backend / BFF\n• Identity linking via KC (FR-025)\n• OBO token exchange\n• I/O guardrails")
    end

    subgraph Identity["③ Keycloak (REQUIRED)"]
        KC["OIDC Broker\n+ AuthZ Services (PDP)"]
        IdP["Enterprise IdP\n(Okta / Entra)"]
    end

    subgraph AuthZ["④ Authorization"]
        direction TB
        PDP["Keycloak AuthZ\n(UI/Slack PDP)"]
        AG["Agent Gateway\n(MCP/A2A PDP)"]
    end

    subgraph Platform["⑤ CAIPE Platform"]
        Sup("Supervisor")
        Agents("Domain Agents")
        MCP("MCP Servers")
        RAG("RAG Server")
    end

    Store[("⑥ MongoDB\n+ Keycloak\n(hybrid store)")]

    Down["⑦ Downstream\n(GitHub, Jira,\nArgoCD)"]

    Slack & Webex & UI -->|"① user action"| BotBFF
    IdP -->|"③a federation"| KC
    BotBFF <-->|"③b OBO + JWT"| KC
    BotBFF -->|"④a authz check"| PDP
    BotBFF -->|"④b request + JWT"| AG
    AG -->|"⑤a authorized"| Sup
    Sup --> Agents
    Agents -->|"⑤b MCP call"| AG
    AG --> MCP
    Sup --> RAG
    Agents --> Down
    PDP -.-> Store
    RAG -.-> Store

    style KC fill:#4A90D9,color:#fff
    style PDP fill:#8E44AD,color:#fff
    style AG fill:#E67E22,color:#fff
    style Slack fill:#611f69,color:#fff
    style Webex fill:#00a884,color:#fff
    style UI fill:#2980B9,color:#fff
    style Sup fill:#2ECC71,color:#fff
    style Store fill:#27AE60,color:#fff
```

### Flow Table

| Step | From | To | Description |
|------|------|----|-------------|
| **①** | User | Slack / Webex / Admin UI | User sends command or performs admin action |
| **②** | Entry point | Bot Backend / BFF | Event delivered with user context (Slack signature, OAuth, NextAuth session) |
| **③a** | Enterprise IdP | Keycloak | Federation: Okta/Entra groups and identity brokered into Keycloak |
| **③b** | Bot/BFF | Keycloak | OBO token exchange (RFC 8693): bot obtains JWT with `sub`=user, `act`=bot, `groups`, `roles`, `scope`, `org` |
| **④a** | Bot/BFF | Keycloak AuthZ (PDP) | UI/Slack authorization: checks JWT + requested capability against 098 matrix → allow/deny |
| **④b** | Bot/BFF | Agent Gateway | MCP/A2A/agent authorization: AG validates JWT, applies CEL policy → allow/deny |
| **⑤a** | Agent Gateway | Supervisor → Agents | Authorized request routed to domain agents |
| **⑤b** | Agents | Agent Gateway → MCP | Agent MCP tool calls re-enter AG for tool-level RBAC (FR-016) |
| **⑥** | PDP / RAG | MongoDB + Keycloak | Hybrid store: Keycloak holds authz policies (resources, scopes, permissions) and Slack identity links (user attributes); MongoDB holds team/KB assignments, ASP policies, app metadata |
| **⑦** | Agents | GitHub / Jira / ArgoCD | Downstream API calls using brokered user tokens |

---

## Authorization Enforcement Points

098 defines **three enforcement zones**, each with its own PDP:

| Zone | Enforcement Point | PDP | Traffic |
|------|-------------------|-----|---------|
| **UI** | Next.js BFF (NextAuth middleware) | **Keycloak Authorization Services** | Admin UI API routes, page access |
| **Slack / Webex** | Bot backend middleware | **Keycloak Authorization Services** | Slack commands, Webex events |
| **MCP / A2A / Agent** | Agent Gateway (required) | AG built-in (CEL policy) | MCP tool calls, A2A tasks, agent dispatch |

All three zones enforce the **same 098 permission matrix** (FR-014). Default deny applies everywhere (FR-002).

---

## Sequence Diagram 1: Slack Identity Linking (FR-025)

One-time flow to establish the `slack_user_id ↔ keycloak_sub` mapping. The mapping is stored as a **Keycloak user attribute** — the bot has **no MongoDB dependency**.

```mermaid
sequenceDiagram
    actor User
    participant Slack
    participant Bot as Slack Bot
    participant KC as Keycloak
    participant IdP as Enterprise IdP<br>(Okta / Entra)

    User->>Slack: First command
    Slack->>Bot: Event (slack_user_id)

    Bot->>KC: Admin API: find user by<br>attribute slack_user_id = X
    KC-->>Bot: Not found

    Bot-->>User: "Link your account" button<br>(single-use URL, short TTL, HTTPS)

    User->>KC: Click link → OIDC login page
    KC->>IdP: Federated auth (SAML / OIDC)
    IdP-->>KC: Assertion (user identity + groups)
    KC-->>User: Auth success → redirect to bot callback

    User->>Bot: Callback with auth code
    Bot->>KC: Exchange code → keycloak_sub
    KC-->>Bot: keycloak_sub + groups

    Bot->>KC: Admin API: set user attribute<br>slack_user_id = X on keycloak_sub
    KC-->>Bot: OK
    Bot-->>User: ✓ Account linked!
```

---

## Sequence Diagram 2: Authorized Request Flow

Every subsequent request after identity linking. Shows OBO exchange, PDP check, and agent execution.

```mermaid
sequenceDiagram
    actor User
    participant Bot as Bot / BFF
    participant KC as Keycloak
    participant AG as Agent Gateway
    participant Sup as Supervisor
    participant Agent as Domain Agent
    participant MCP as MCP Server

    User->>Bot: Command (slack_user_id or UI session)

    rect rgb(230, 240, 255)
        Note over Bot,KC: ③ Identity Resolution + OBO
        Bot->>KC: Admin API: find user by<br>attribute slack_user_id = X
        KC-->>Bot: keycloak_sub
        Bot->>KC: Token exchange (RFC 8693)<br>for keycloak_sub
        KC-->>Bot: JWT (sub=user, act=bot,<br>groups, roles, scope, org)
    end

    rect rgb(240, 230, 255)
        Note over Bot,KC: ④a UI/Slack Authorization
        Bot->>KC: AuthZ check (JWT + capability)
        KC-->>Bot: Allow / Deny
    end

    alt Denied by Keycloak PDP
        Bot-->>User: Access denied
    else Allowed
        rect rgb(255, 240, 230)
            Note over Bot,AG: ④b Agent Path Authorization
            Bot->>AG: Request + JWT
            AG->>AG: Validate JWT<br>+ CEL policy
        end

        alt Denied by AG
            AG-->>Bot: 403 Forbidden
            Bot-->>User: Access denied
        else Allowed by AG
            AG->>Sup: Authorized request
            Sup->>Agent: Dispatch (user principal)

            rect rgb(255, 240, 230)
                Note over Agent,MCP: ⑤b Tool-Level RBAC
                Agent->>AG: MCP tool call + JWT
                AG->>AG: Tool-level policy (FR-016)
                AG->>MCP: Authorized invocation
            end

            MCP-->>Agent: Tool result
            Agent-->>Sup: Result
            Sup-->>Bot: Response
            Bot-->>User: Answer
        end
    end
```

---

## IdP Groups → Keycloak Roles Mapping (FR-010)

Enterprise IdP groups (Okta and Microsoft Entra ID / AD-backed groups) are mapped to CAIPE platform roles **at token issuance time** inside Keycloak — **no runtime SCIM sync or directory lookups**. Keycloak acts as a required OIDC broker that federates both IdPs.

### Sequence Diagram 3: IdP Groups → Keycloak Roles (Runtime)

This diagram shows what happens at login time when a user authenticates through a federated IdP. It covers both the SAML path (Okta SAML, Entra SAML) and the OIDC path (Okta OIDC).

```mermaid
sequenceDiagram
    actor User
    participant App as CAIPE App<br>(UI / Bot)
    participant KC as Keycloak<br>(REQUIRED broker)
    participant IdP as Enterprise IdP<br>(Okta / Entra)

    User->>App: Access protected resource
    App->>KC: Redirect to Keycloak login

    Note over KC: Keycloak shows login page<br>with federated IdP options

    User->>KC: Select enterprise IdP
    KC->>IdP: Redirect to IdP login<br>(SAML AuthnRequest or OIDC /authorize)

    User->>IdP: Authenticate (SSO / MFA)

    alt SAML IdP (Okta SAML / Entra SAML)
        IdP-->>KC: SAML Assertion<br>• NameID = user@corp.com<br>• Attribute: groups = [platform-admin, team-a-eng]
        Note over KC: IdP Mapper: "Attribute Importer"<br>extracts groups from SAML assertion<br>→ stores as user attribute
    else OIDC IdP (Okta OIDC)
        IdP-->>KC: ID Token<br>• sub = user-id<br>• groups = [platform-admin, team-a-eng]
        Note over KC: IdP Mapper: "Claim to User Attribute"<br>extracts groups from OIDC token<br>→ stores as user attribute
    end

    rect rgb(255, 245, 230)
        Note over KC: Group → Role Resolution (token issuance)
        KC->>KC: IdP Mapper: "Hardcoded Role"<br>or "SAML Attribute to Role"<br>maps group values → KC realm roles<br><br>platform-admin → admin<br>team-a-eng → team_member(team-a)<br>kb-admins → kb_admin
        KC->>KC: Protocol Mapper: "Group Membership"<br>→ emits groups claim in JWT
        KC->>KC: Protocol Mapper: "Realm Role"<br>→ emits roles claim in JWT
        KC->>KC: Protocol Mapper: "User Attribute"<br>→ emits org claim in JWT
    end

    KC-->>App: JWT with mapped claims
    Note over App: JWT payload:<br>sub: user-id<br>groups: [platform-admin, team-a-eng]<br>roles: [admin, team_member(team-a)]<br>org: acme-corp<br>scope: openid profile caipe

    App->>App: Resolve authorization<br>from JWT claims only<br>(no directory lookup)
```

### Keycloak Mapper Configuration (One-Time Admin Setup)

Three layers of mappers work together to transform IdP groups into JWT claims:

| Layer | Mapper Type | Keycloak Config | Purpose |
|-------|-------------|-----------------|---------|
| **1. Import** | Identity Provider Mapper | **SAML**: "Attribute Importer" — attribute name `groups` → user attribute `idp_groups` | Extracts groups from IdP assertion/token into Keycloak user profile |
| | | **OIDC**: "Claim to User Attribute" — claim `groups` → user attribute `idp_groups` | |
| **2. Map to Roles** | Identity Provider Mapper | "Hardcoded Role" or "SAML Attribute IdP Role Mapper" — when `groups` contains `platform-admin` → assign KC realm role `admin` | Converts IdP group membership into Keycloak realm roles |
| | | Repeat per group → role mapping | |
| **3. Emit in JWT** | Client Protocol Mapper | "Group Membership" → token claim `groups` | Emits groups in JWT for downstream consumers |
| | | "Realm Role" → token claim `roles` | Emits mapped roles in JWT |
| | | "User Attribute" → token claim `org` | Emits tenant/org context in JWT |

### IdP-Specific Federation Setup

| IdP | Protocol | Group Source | Keycloak Broker Config |
|-----|----------|--------------|------------------------|
| **Okta** (SAML) | SAML 2.0 | SAML Assertion → Attribute Statement `groups` | Identity Provider → SAML → Import SAML attributes |
| **Okta** (OIDC) | OIDC | ID Token → `groups` claim (requires Okta "Groups claim" config in the Okta app) | Identity Provider → OIDC → Import OIDC claims |
| **Microsoft Entra ID** (SAML) | SAML 2.0 | SAML Assertion → `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups` (GUIDs) or custom `groups` attribute | Identity Provider → SAML → Attribute Importer (map GUIDs or group names) |
| **Microsoft Entra ID** (OIDC) | OIDC | ID Token → `groups` claim (requires Entra "Group claims" config in App Registration → Token configuration) | Identity Provider → OIDC → Claim to User Attribute |

> **Entra ID note**: By default Entra sends group **Object IDs** (GUIDs) in SAML/OIDC. To get human-readable names, configure "Emit groups as role claims" or use the `cloud_displayName` source attribute in the enterprise app's SAML claims configuration.

### Group → Role Mapping Table

| IdP Group | Keycloak Realm Role | Capabilities (098 matrix examples) |
|-----------|---------------------|-------------------------------------|
| `platform-admin` | `admin` | All protected capabilities |
| `team-a-eng` | `team_member(team-a)` | Chat, invoke team-a tools, query team-a KBs |
| `kb-admins` | `kb_admin` | Create/update/delete KBs, manage ingest |
| `team-b-ops` | `team_member(team-b)` | Chat, invoke team-b tools, query team-b KBs |
| *(no group)* | *(no role)* | Default deny — no platform access (FR-002) |

### Resulting JWT Claims (Example)

```json
{
  "sub": "a1b2c3d4-...",
  "iss": "https://keycloak.caipe.example.com/realms/caipe",
  "aud": "caipe-platform",
  "groups": ["platform-admin", "team-a-eng"],
  "roles": ["admin", "team_member(team-a)"],
  "org": "acme-corp",
  "scope": "openid profile caipe",
  "exp": 1743900000
}
```

The **CAIPE platform**, **Agent Gateway**, and **Keycloak PDP** all consume these JWT claims directly — no callback to the IdP or Keycloak at authorization time.

---

## Multi-Tenant Isolation (FR-020)

```
┌─────────────────────────────────┐
│          Tenant Boundary        │
│  ┌───────────┐  ┌───────────┐  │
│  │  Org A    │  │  Org B    │  │
│  │           │  │           │  │
│  │ Users A   │  │ Users B   │  │
│  │ Agents A  │  │ Agents B  │  │
│  │ Tools A   │  │ Tools B   │  │
│  │ KBs A     │  │ KBs B     │  │
│  │           │  │           │  │
│  │ JWT.org=A │  │ JWT.org=B │  │
│  └───────────┘  └───────────┘  │
│                                 │
│  PDP + AG enforce: principal    │
│  in org A CANNOT access org B   │
│  resources (FR-020)             │
└─────────────────────────────────┘
```

---

## Slack Identity Linking (FR-025)

The identity linking flow establishes the `slack_user_id ↔ keycloak_sub` mapping required before any OBO exchange. The mapping is stored as a **custom Keycloak user attribute** — the Slack bot has **no MongoDB dependency**.

### Storage mechanism

| Aspect | Detail |
|--------|--------|
| **Where** | Keycloak user profile — custom attribute `slack_user_id` |
| **Write (linking)** | Bot calls **Keycloak Admin API** to set `slack_user_id` on the authenticated user |
| **Read (lookup)** | Bot calls **Keycloak Admin API** to find user by attribute `slack_user_id = X` → returns `keycloak_sub` |
| **Bot dependencies** | Keycloak only (Admin API + OIDC); **no MongoDB** on the Slack path |

### Flow

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Slack   │    │  Slack Bot   │    │   Keycloak   │    │  Enterprise  │
│  User    │    │  Backend     │    │   (broker)   │    │  IdP (Okta)  │
└────┬─────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
     │  1. First       │                    │                   │
     │  command ──────▶│                    │                   │
     │                 │ 2. Admin API:      │                   │
     │                 │ find user by       │                   │
     │                 │ slack_user_id=X ──▶│                   │
     │                 │◀── Not found ──────│                   │
     │                 │                    │                   │
     │◀─── 3. "Link ──│                    │                   │
     │    account" URL │                    │                   │
     │  (single-use,   │                    │                   │
     │   time-bounded) │                    │                   │
     │                 │                    │                   │
     │── 4. Click ────────────────────────▶│                   │
     │    URL          │                    │── 5. Federate ──▶│
     │                 │                    │◀── 6. SAML ──────│
     │◀──── 7. Auth ───────────────────────│                   │
     │    success      │                    │                   │
     │                 │◀── 8. Callback ────│                   │
     │                 │    (keycloak_sub)  │                   │
     │                 │                    │                   │
     │                 │ 9. Admin API: set  │                   │
     │                 │ slack_user_id=X on │                   │
     │                 │ keycloak_sub ─────▶│                   │
     │                 │◀── OK ─────────────│                   │
     │◀─ 10. "Linked!" │                    │                   │
     │                 │                    │                   │
     │  11. Subsequent │                    │                   │
     │  commands ─────▶│ 12. Admin API:     │                   │
     │                 │ find slack_user_id │                   │
     │                 │ → keycloak_sub ───▶│                   │
     │                 │◀── keycloak_sub ───│                   │
     │                 │ 13. OBO exchange   │                   │
     │                 │ (RFC 8693) ───────▶│                   │
     │                 │◀── JWT ────────────│                   │
```

**Security constraints**: Linking URL is **single-use**, **time-bounded** (short TTL), **HTTPS-only**. Unlinked users are **denied** all RBAC-protected operations.

---

## RBAC Configuration Store (FR-023)

```
┌───────────────────────────────────────────────────────┐
│                   CAIPE Admin UI (FR-024)              │
│         Administrators manage RBAC here                │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  Roles & Access Tab (US6)                       │  │
│  │  • Create/delete custom realm roles             │  │
│  │  • Map IdP groups → realm roles                 │  │
│  │  • Assign roles to teams                        │  │
│  └─────────────────────────────────────────────────┘  │
└──────────┬──────────────────────────┬─────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────────┐    ┌──────────────────────┐
│     Keycloak         │    │      MongoDB         │
│  (Admin REST API)    │    │                      │
│                      │    │                      │
│  • Resources         │    │  • Team/KB ownership │
│    (components)      │    │    assignments       │
│  • Scopes            │    │  • Custom RAG tool   │
│    (capabilities)    │    │    bindings           │
│  • Policies          │    │  • App metadata      │
│    (role-based)      │    │  • ASP tool policies │
│  • Realm Roles       │    │  • Team keycloak_    │
│    (CRUD via UI)     │    │    roles assignments │
│  • IdP Mappers       │    │                      │
│    (group→role, UI)  │    │                      │
│  • Permissions       │    │                      │
│  • User attributes   │    │                      │
│    (slack_user_id)   │    │                      │
│    (FR-025)          │    │                      │
│                      │    │                      │
│  PDP for UI/Slack    │    │  Operational state   │
└──────────────────────┘    └──────────────────────┘
```

### Admin UI → Keycloak Admin API Flow (FR-024, US6)

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  Admin UI        │   │  BFF API Routes  │   │  Keycloak Admin  │
│  RolesAccessTab  │──▶│  /api/admin/     │──▶│  REST API        │
│                  │   │  roles,           │   │                  │
│  CreateRole      │   │  role-mappings,   │   │  client_creds    │
│  Dialog          │   │  teams/:id/roles │   │  grant auth      │
│                  │   │                  │   │                  │
│  GroupMapping    │   │  requireAdmin()  │   │  realm-management│
│  Dialog          │   │  session check   │   │  service account │
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

---

## OBO Delegation Chain (FR-018, FR-019)

The multi-hop delegation chain ensures the **originating user** is always the effective principal:

```
User ──▶ Slack Bot ──▶ Supervisor ──▶ Agent ──▶ MCP Tool
  │         │              │            │           │
  │    OBO exchange    Forwards     Forwards    AG checks
  │    (RFC 8693)      user JWT     user JWT    JWT.sub=user
  │         │              │            │           │
  └─── sub=user ──────────────────────────────────────┘
        act=bot
        scope=user's entitlements (not bot's)
        groups=[user's groups]
        org=user's org

  Effective permissions = intersection of:
    • User's entitlements (098 matrix)
    • Bot service account's scope ceiling
    • Component's matrix row (FR-008)
```

---

## PDP Architecture (FR-022)

**Keycloak is required** (Session 2026-04-03). Enterprise IdPs (Okta, Entra, SAML) federate into Keycloak via identity brokering.

| Path | PDP | How |
|------|-----|-----|
| **UI / Slack / Webex** | **Keycloak Authorization Services** | UMA / resource-based permissions; 098 matrix modeled as KC resources, scopes, policies |
| **MCP / A2A / Agent** | **Agent Gateway** | CEL policy; JWT issued by Keycloak |

Keycloak Authorization Services:
- Consume JWT `groups`, `roles`, `scope`, `org` claims (FR-010)
- 098 permission matrix modeled as Keycloak **resources** (components), **scopes** (capabilities), and **policies** (role-based)
- Return allow/deny with audit-grade detail (FR-005)
- Target sub-5ms decision latency
- Admin manages policies via Keycloak Admin Console or CAIPE Admin UI (which calls Keycloak Admin API)

---

## Map RAG RBAC to Keycloak + Per-KB Access Control Architecture Overview

The RAG server is integrated into the Keycloak RBAC system with **defense-in-depth** enforcement. The BFF performs coarse Keycloak AuthZ checks; the RAG server validates the JWT directly and enforces per-KB access control. This section documents the architecture for **FR-026** (Keycloak JWT integration) and **FR-027** (per-KB access control).

### Dual-Layer Enforcement Flow

```mermaid
flowchart TD
    subgraph bff [BFF Layer — Coarse AuthZ]
        BFF_KB["BFF /api/rag/kb/*"]
        BFF_RAG["BFF /api/rag/*"]
        BFF_Tools["BFF /api/rag/tools/*"]
    end

    subgraph keycloak [Keycloak]
        KC_JWT["JWT with roles claim\n(admin, kb_admin, chat_user,\nkb_reader:kb-id, ...)"]
        KC_AuthZ["AuthZ Services PDP"]
    end

    subgraph rag [RAG Server — Fine-Grained Enforcement]
        JWTValidation["JWT Validation\n(OIDC provider config)"]
        RoleMapper["Keycloak Role Mapper\n(realm roles → RAG roles)"]
        KBAccessCheck["Per-KB Access Check\n(Keycloak roles + team ownership)"]
        QueryFilter["Query-Time KB Filter\n(inject datasource_id filter)"]
        Endpoints["FastAPI Endpoints\n(/v1/query, /v1/ingest, ...)"]
    end

    subgraph mongo [MongoDB]
        TeamKB["team_kb_ownership\n(team_id, kb_ids,\nallowed_datasource_ids)"]
    end

    BFF_KB -->|"requireRbacPermission\n(rag, kb.query/ingest/admin)"| KC_AuthZ
    BFF_KB -->|"Bearer token +\nX-Team-Id"| JWTValidation
    BFF_RAG -->|"Bearer token"| JWTValidation
    BFF_Tools -->|"requireRbacPermission\n+ team scope"| KC_AuthZ

    KC_JWT --> JWTValidation
    JWTValidation --> RoleMapper
    RoleMapper --> KBAccessCheck
    KBAccessCheck -->|"per-KB roles"| KC_JWT
    KBAccessCheck -->|"team ownership"| TeamKB
    KBAccessCheck --> Endpoints
    Endpoints -->|"/v1/query"| QueryFilter
    QueryFilter --> TeamKB
```

### Keycloak Realm Role to RAG Server Role Mapping (FR-026)

The RAG server maps Keycloak realm roles from the JWT `roles` claim to its internal role hierarchy. When the `roles` claim is present, Keycloak role mapping takes precedence. When absent, the existing group-based assignment (`RBAC_*_GROUPS`) is used as fallback.

| Keycloak Realm Role | RAG Server Role | Permissions | KB Access |
|---------------------|-----------------|-------------|-----------|
| `admin` | `admin` | read, ingest, delete | All KBs (global override) |
| `kb_admin` | `ingestonly` | read, ingest | All KBs (global override) |
| `team_member` | `readonly` | read | Team-owned KBs only |
| `chat_user` | `readonly` | read | Per-KB roles or team-owned KBs |
| `kb_reader:<kb-id>` | `readonly` (scoped) | read | Specified KB only |
| `kb_reader:*` | `readonly` (all) | read | All KBs (wildcard) |
| `kb_ingestor:<kb-id>` | `ingestonly` (scoped) | read, ingest | Specified KB only |
| `kb_ingestor:*` | `ingestonly` (all) | read, ingest | All KBs (wildcard) |
| `kb_admin:<kb-id>` | `admin` (scoped) | read, ingest, delete | Specified KB only |
| *(no matching role)* | `anonymous` | *(none)* | No KBs |

### Per-KB Access Resolution (FR-027)

Effective KB access is the **union** of Keycloak per-KB roles and team ownership. Global roles override per-KB restrictions.

```mermaid
flowchart TD
    JWT["JWT roles claim"] --> ExtractGlobal["Extract global roles\n(admin, kb_admin)"]
    JWT --> ExtractPerKB["Extract per-KB roles\n(kb_reader:X, kb_ingestor:X)"]

    ExtractGlobal --> GlobalCheck{"Has admin\nor kb_admin?"}

    GlobalCheck -->|Yes| AllKBs["Access: ALL KBs\n(global override)"]
    GlobalCheck -->|No| MergeAccess["Merge accessible KBs"]

    ExtractPerKB --> PerKBList["Per-KB role list:\nkb_reader:kb-team-a → read\nkb_ingestor:kb-ops → read+ingest"]

    TeamLookup["MongoDB:\nteam_kb_ownership\nfor user's team_id"] --> TeamKBList["Team-owned KB list:\nkb-platform, kb-shared"]

    PerKBList --> MergeAccess
    TeamKBList --> MergeAccess

    MergeAccess --> EffectiveAccess["Effective accessible KBs =\nUNION(per-KB roles, team KBs)"]

    EffectiveAccess --> InjectFilter["inject_kb_filter()\nadd datasource_id filter\nto vector DB query"]
```

### Query-Time KB Filtering

The `/v1/query` endpoint injects a `datasource_id` filter into vector DB queries based on the user's accessible KB list. This is **server-side enforced** and **transparent to the caller** — the API consumer does not need to know which KBs they can access.

```
User calls POST /v1/query { "query": "how do I deploy?", "filters": {} }

    ┌─────────────────────────────────────────────────┐
    │ RAG Server /v1/query handler                    │
    │                                                 │
    │ 1. Validate JWT → UserContext (role, kb_perms)  │
    │ 2. require_role(Role.READONLY) ✓                │
    │ 3. get_accessible_kb_ids(user_context)           │
    │    → ["kb-team-a", "kb-platform"]               │
    │ 4. inject_kb_filter(query, accessible_kbs)       │
    │    → filters.datasource_id IN [...]             │
    │ 5. VectorDBQueryService.query(filtered_request)  │
    │    → results from kb-team-a + kb-platform only  │
    └─────────────────────────────────────────────────┘
```

### Defense-in-Depth Enforcement Layers

Four layers of authorization checks protect KB operations:

| Layer | Check | PDP | Scope | Failure Mode |
|-------|-------|-----|-------|-------------|
| **1. BFF** `/api/rag/kb/*` | `requireRbacPermission("rag", "kb.query")` | Keycloak AuthZ | Coarse capability (can user do KB operations at all?) | 401/403 to UI |
| **2. RAG** global role | `require_role(Role.READONLY)` via JWT → Keycloak role mapper | RAG server (JWT) | Global role check (is user authenticated with sufficient role?) | 401/403 from RAG |
| **3. RAG** per-KB access | `require_kb_access(kb_id, scope)` | RAG server (JWT + MongoDB) | Fine-grained per-KB (can user access THIS specific KB?) | 403 from RAG |
| **4. RAG** query filter | `inject_kb_filter()` in `/v1/query` | RAG server (JWT + MongoDB) | Query-time row filtering (restrict results to accessible KBs) | Empty results / 503 |

If **any** layer denies, the operation is denied. If MongoDB is unavailable for team ownership lookup, the system **fails closed** (deny).

---

## Dynamic Agent RBAC Architecture (FR-028, FR-029, FR-030)

Dynamic agents are governed by the same Keycloak RBAC model as KBs and tools. This section documents the three-layer authorization model, CEL as the universal policy engine, and deepagent MCP routing through Agent Gateway.

### Three-Layer Enforcement Flow

```mermaid
flowchart TD
    subgraph creation ["Agent Write Path (Creation)"]
        AdminUI["Admin UI / API\nPOST /api/v1/agents"]
        MongoDB_W["MongoDB\nDynamicAgentConfig\n(visibility, shared_with_teams,\nowner_id)"]
        KCResource["Keycloak Resource\ntype: dynamic_agent\nscopes: view, invoke,\nconfigure, delete"]
        KCPolicy["Keycloak Policies\n(auto-generated from\nvisibility level)"]
    end

    subgraph assignment ["Role Assignment (Admin Path)"]
        RoleAssign["Admin assigns\nper-agent realm roles\n(or IdP group mapping)"]
        PerAgentRoles["Keycloak Realm Roles\nagent_user:agent-123\nagent_admin:agent-123\nagent_user:*"]
    end

    subgraph runtime ["Runtime Access Check"]
        UserJWT["User JWT\nroles: [agent_user:agent-123,\nchat_user, team_member]"]
        CELEval["CEL Evaluator\n(embedded in service)"]
        MongoViz["MongoDB\nvisibility + shared_with_teams\n+ owner_id"]
        Result["Allow / Deny\n+ filtered agent list"]
    end

    subgraph mcp_path ["Deepagent MCP Path (FR-030)"]
        AgentRT["AgentRuntime\n(LangGraph deepagent)"]
        MCPClient["MCP Client\n(OBO JWT attached)"]
        AG_MCP["Agent Gateway\nCEL policy evaluation"]
        MCPServer["MCP Server"]
    end

    AdminUI --> MongoDB_W
    AdminUI --> KCResource
    KCResource --> KCPolicy

    RoleAssign --> PerAgentRoles

    UserJWT --> CELEval
    MongoViz --> CELEval
    CELEval --> Result

    AgentRT -->|"user OBO JWT"| MCPClient
    MCPClient -->|"Bearer token"| AG_MCP
    AG_MCP -->|"CEL allow"| MCPServer
```

### Dynamic Agent Role Mapping Table

| Keycloak Realm Role | Scopes Granted | Agent Access |
|---------------------|----------------|--------------|
| `admin` | view, invoke, configure, delete | All agents (global override) |
| `agent_admin:<agent-id>` | view, invoke, configure, delete | Specified agent only |
| `agent_admin:*` | view, invoke, configure, delete | All agents (wildcard) |
| `agent_user:<agent-id>` | view, invoke | Specified agent only |
| `agent_user:*` | view, invoke | All agents (wildcard) |
| `team_member(team-x)` | view, invoke (team agents) | Agents with `visibility: team` + `shared_with_teams` includes `team-x` |
| *(owner)* | view, invoke, configure, delete | Own agents (`owner_id` match) |
| *(no matching role)* | *(none)* | Only `visibility: global` agents |

### Per-Agent Access Resolution

Effective agent access is the **union** of three sources: per-agent Keycloak roles, MongoDB visibility, and ownership. CEL evaluates all three at runtime.

```mermaid
flowchart TD
    JWT["JWT roles claim"] --> ExtractGlobal["Extract global roles\n(admin)"]
    JWT --> ExtractPerAgent["Extract per-agent roles\n(agent_user:X, agent_admin:X)"]

    ExtractGlobal --> GlobalCheck{"Has admin?"}

    GlobalCheck -->|Yes| AllAgents["Access: ALL agents\n(global override)"]
    GlobalCheck -->|No| MergeAccess["CEL evaluates\naccess per agent"]

    ExtractPerAgent --> PerAgentList["Per-agent role list:\nagent_user:agent-123 → view+invoke\nagent_admin:agent-456 → full"]

    MongoViz["MongoDB:\nagent.visibility\nagent.shared_with_teams\nagent.owner_id"] --> CELInputs["CEL context:\nresource.visibility\nresource.shared_with_teams\nresource.owner_id"]

    TeamMembership["User teams\n(from JWT or session)"] --> CELInputs

    PerAgentList --> MergeAccess
    CELInputs --> MergeAccess

    MergeAccess --> EffectiveAccess["Effective access =\nCEL(per-agent roles\n∪ visibility match\n∪ ownership)"]
```

### CEL as Universal Policy Engine (FR-029)

CEL is mandated at **all four enforcement points**. Each service embeds a CEL evaluator library with a shared context schema.

```
┌──────────────────────────────────────────────────────────────┐
│                    CEL Context Schema                        │
│                                                              │
│  user.roles      : ["admin", "agent_user:agent-123", ...]   │
│  user.teams      : ["team-a", "team-b"]                     │
│  user.email      : "user@corp.com"                          │
│  resource.id     : "agent-123" | "kb-team-a" | ...          │
│  resource.type   : "dynamic_agent" | "kb" | "rag_tool"      │
│  resource.visibility : "private" | "team" | "global"        │
│  resource.owner_id   : "owner@corp.com"                     │
│  resource.shared_with_teams : ["team-a"]                    │
│  action          : "view" | "invoke" | "configure" | ...    │
└──────────────────────────────────────────────────────────────┘
         │              │               │              │
         ▼              ▼               ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────┐
│ Agent        │ │ RAG Server   │ │ Dynamic      │ │ BFF      │
│ Gateway      │ │ (Python)     │ │ Agents       │ │ (TS)     │
│              │ │              │ │ (Python)     │ │          │
│ CEL built-in │ │ cel-python   │ │ cel-python   │ │ cel-js   │
│ (Rust)       │ │              │ │              │ │          │
│              │ │ Per-KB       │ │ Per-agent    │ │ RBAC     │
│ MCP/A2A/     │ │ access       │ │ access       │ │ middleware│
│ agent policy │ │ (FR-027)     │ │ (FR-028)     │ │ checks   │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────┘
```

**Example CEL expressions** (configurable, not hardcoded):

```cel
// Dynamic agent view access
user.roles.exists(r, r == "admin")
  || user.roles.exists(r, r == "agent_user:" + resource.id)
  || user.roles.exists(r, r == "agent_user:*")
  || resource.visibility == "global"
  || (resource.visibility == "team"
      && resource.shared_with_teams.exists(t, t in user.teams))
  || resource.owner_id == user.email

// KB read access (same pattern)
user.roles.exists(r, r == "admin" || r == "kb_admin")
  || user.roles.exists(r, r == "kb_reader:" + resource.id)
  || user.roles.exists(r, r == "kb_reader:*")
  || resource.team_owned_by.exists(t, t in user.teams)
```

### Deepagent MCP Routing (FR-030)

```mermaid
sequenceDiagram
    actor User
    participant UI as Dynamic Agent UI
    participant RT as AgentRuntime<br>(LangGraph)
    participant MCP as MCP Client
    participant AG as Agent Gateway
    participant Tool as MCP Server

    User->>UI: Chat message
    UI->>RT: start-stream(message, user_context)

    Note over RT: LangGraph deepagent executes<br>with user's OBO JWT stored<br>in AgentContext

    RT->>RT: LLM decides to call MCP tool

    RT->>MCP: tool_call(name, args)
    MCP->>AG: HTTP request + Authorization:<br>Bearer {user_obo_jwt}

    AG->>AG: Validate JWT<br>+ CEL policy evaluation<br>(user.roles vs tool pattern)

    alt CEL allows
        AG->>Tool: Authorized tool call
        Tool-->>AG: Tool result
        AG-->>MCP: Result
        MCP-->>RT: Tool output
        RT-->>UI: Streamed response
    else CEL denies
        AG-->>MCP: 403 Forbidden
        MCP-->>RT: Tool call denied
        RT-->>UI: Error: insufficient permissions
    end
```

---

## Component Summary

| Component | Role | Required? | Authorization |
|-----------|------|-----------|---------------|
| **Slack / Webex** | User-facing entry (at least one) | At least one channel | Bot validates identity + PDP check |
| **CAIPE Admin UI** | Admin web interface | Yes | NextAuth session + PDP check |
| **Slack Bot / Webex Bot Backend** | Event handling, identity resolution (via Keycloak user attributes), OBO exchange | Yes | PDP for capability checks; **no MongoDB dependency** |
| **Keycloak** (required) | OIDC broker, token issuance, groups→roles mapping, OBO, Authorization Services (PDP), Slack identity link storage (user attributes) | **Required** | Source of JWT claims + PDP for UI/Slack + identity link store |
| **Enterprise IdP** | SSO (Okta SAML, Entra AD); federated into Keycloak | Optional | Federation source |
| **Agent Gateway** | MCP/A2A gateway, JWT validation, CEL policy | **Required** | PDP for agent traffic |
| **Supervisor / Orchestrator** | A2A server, agent routing | Yes | Carries forwarded identity |
| **Domain Agents** | GitHub, Jira, ArgoCD, etc. | Yes | OBO tokens for downstream |
| **MCP Servers** | Tool invocation | Yes | AG-gated access |
| **RAG Server** | KBs, datasources | Yes | PDP-gated admin; AG-gated queries; CEL per-KB access (FR-027) |
| **Dynamic Agents** | User-created/runtime agents, deepagent LangGraph | Yes | Three-layer RBAC: Keycloak resource + per-agent roles + MongoDB visibility + CEL (FR-028); MCP calls via AG (FR-030) |
| **MongoDB** | Users, policies, permission matrix, team/KB config (no Slack identity links — those are in Keycloak) | Yes | Data store for PDP + Admin UI |

---

## Fail-Closed Behavior

| Failure | Impact | Behavior |
|---------|--------|----------|
| **Agent Gateway down** | MCP/A2A/agent traffic | **Denied** (fail closed). Slack and Admin UI unaffected. |
| **Keycloak down** | Token issuance, login, UI/Slack authz | **No new sessions**; existing valid JWTs may continue until expiry; authz checks **denied** (fail closed). |
| **MongoDB unavailable** | Matrix/config reads | PDP returns **deny** (fail closed). |

---

## Related Documents

- [spec.md](./spec.md) — Feature specification (098)
- [093 architecture](../093-agent-enterprise-identity/architecture.md) — Historical architecture (superseded)
- [093 research index](../093-agent-enterprise-identity/README.md) — Policy engine comparison, AG/Keycloak research
- [Agent Gateway](https://agentgateway.dev/) — Upstream project
- [AG Keycloak tutorial](https://agentgateway.dev/docs/kubernetes/latest/mcp/auth/keycloak/) — OIDC integration reference
