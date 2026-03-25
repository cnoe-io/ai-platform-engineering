# 098 Enterprise RBAC — Operator Guide

Operational procedures for **098 Enterprise RBAC** (Keycloak, OBO token exchange, Authorization Services, Agent Gateway, policy authoring, composition, fail-closed behavior, and day-two tasks). Maps to implementation tasks **T070–T077**.

**Related artifacts**

- Realm template: [`deploy/keycloak/realm-config.json`](../../../../deploy/keycloak/realm-config.json)
- Permission matrix: [permission-matrix.md](./permission-matrix.md)
- Agent Gateway sample: [`deploy/agentgateway/config.yaml`](../../../../deploy/agentgateway/config.yaml)
- Slack OBO client: [`ai_platform_engineering/integrations/slack_bot/utils/obo_exchange.py`](../../../../ai_platform_engineering/integrations/slack_bot/utils/obo_exchange.py)

---

## 1. Keycloak Realm Setup (T070)

### 1.1 Create realm `caipe`

**Dev / import**

```bash
# From repo root — Keycloak imports realm on start (see deploy/keycloak/docker-compose.yml)
docker compose -f deploy/keycloak/docker-compose.yml up -d keycloak
```

The import file sets `"realm": "caipe"` and clients, roles, IdP stubs, and mappers. For **production**, use the same JSON as a baseline and manage drift via your GitOps / Keycloak operator workflow.

**Admin Console**

1. **Create realm** → Name: `caipe` → Create.
2. Or **Import** → select `deploy/keycloak/realm-config.json` (review secrets and placeholders first).

### 1.2 Configure IdP brokers

Enable and fill in one or more of the stub identity providers defined in the template:

| Alias        | Protocol | Template section in `realm-config.json` |
|-------------|----------|-------------------------------------------|
| `okta-oidc` | OIDC     | `identityProviders` → Okta URLs, client id/secret |
| `okta-saml` | SAML 2.0 | SSO URL, certs, NameID format |
| `entra-oidc`| OIDC     | Microsoft tenant URLs + app registration |
| `entra-saml`| SAML 2.0 | Entra SAML endpoints |

**Checklist per IdP**

- Set **Client ID / secret** (OIDC) or **metadata / URLs / signing** (SAML).
- **Trust email** if your HR source of truth is the IdP.
- **First broker login** flow: decide link-only vs auto-link vs review profile (enterprise policy).
- Turn **`enabled`: true** after validation (template ships `enabled: false` for stubs).

### 1.3 Attribute importers (claim → user attribute)

Map IdP group or claim data into Keycloak user attributes so you can audit and optionally drive secondary logic.

Examples already in `realm-config.json` under `identityProviderMappers`:

- **Okta OIDC**: `oidc-user-attribute-idp-mapper` — `claim` `groups` → `user.attribute` `idp_groups`.
- **Okta SAML**: `saml-user-attribute-idp-mapper` — SAML `groups` → `idp_groups`.
- **Entra OIDC / SAML**: same pattern; Entra SAML often uses `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups`.

**Admin Console path**: Realm **Identity providers** → *your IdP* → **Mappers** → Add mapper → *OIDC attribute* or *SAML attribute*.

### 1.4 Group → realm role mappers

Realm roles used by CAIPE: **`admin`**, **`chat_user`**, **`team_member`**, **`kb_admin`**.

| IdP group (example)   | Keycloak realm role |
|-----------------------|---------------------|
| `platform-admin`      | `admin`             |
| `backstage-access`    | `chat_user`         |
| `team-{name}-eng`     | `team_member`       |
| `kb-admins`           | `kb_admin`          |

**OIDC**: use **Hardcoded role** (`hardcoded-role-idp-mapper`) with `claim` + `claim.value`, or Advanced claim → role if you need pattern matching.

**SAML**: use **SAML Attribute to Role** (`saml-role-idp-mapper`) with `attribute.name` + `attribute.value`.

The template includes examples (e.g. `platform-admin` → `admin`, `team-a-eng` → `team_member`, `kb-admins` → `kb_admin`). **Duplicate mappers** per team group or use a single mapper type your IdP supports (e.g. regex / script) per Keycloak version.

### 1.5 Protocol mappers for JWT claims `groups`, `roles`, `org`

Defined as **client scopes** in `realm-config.json`:

| Scope   | Claim(s) | Mechanism |
|---------|----------|-----------|
| `roles` | `roles`  | `oidc-usermodel-realm-role-mapper` (multivalued) |
| `groups`| `groups` | `oidc-group-membership-mapper` |
| `org`   | `org`    | `oidc-usermodel-attribute-mapper` on user attribute `org` |

Clients **`caipe-ui`**, **`caipe-platform`**, **`caipe-slack-bot`** attach: `profile`, `email`, `roles`, `groups`, `org`.

Populate **`org`** via user attribute (federation mapper or admin API) for multi-tenant checks (e.g. AG header vs JWT — see Agent Gateway config).

### 1.6 Realm roles (reference)

Ensure these **realm roles** exist (included in template):

- `admin`, `chat_user`, `team_member`, `kb_admin` (+ `offline_access`, `uma_authorization` as needed).

---

## 2. OBO Token Exchange (T071)

Slack (and other bots) use **OAuth 2.0 Token Exchange** ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html)) so the bot acts **on behalf of** the linked user. The implementation posts to Keycloak’s token endpoint with grant type `urn:ietf:params:oauth:grant-type:token-exchange`.

### 2.1 Confidential client `caipe-slack-bot`

In `realm-config.json` the client is:

- **Confidential**, **service accounts enabled**
- **`oidc.token.exchange.enabled`**: `true`
- **`fullScopeAllowed`**: `false` (scope ceiling enforced by Keycloak + your policies)

**Production**: replace dev secret; store in a secret manager; wire env:

```bash
export KEYCLOAK_URL=https://keycloak.example.com
export KEYCLOAK_REALM=caipe
export KEYCLOAK_BOT_CLIENT_ID=caipe-slack-bot
export KEYCLOAK_BOT_CLIENT_SECRET='<rotated-secret>'
```

### 2.2 Enable token exchange permission

In Keycloak **26.x** (adjust for your minor version):

1. **Realm settings** → **Tokens** → enable **OAuth 2.0 Token Exchange** (if presented as a realm toggle).
2. **Clients** → `caipe-slack-bot` → **Service account roles** / **Permissions**: ensure the service account may perform token exchange **from** user tokens **to** an access token for the intended audience (often `caipe-platform` for AG).

Exact UI labels vary; if using fine-grained client permissions, grant **`token-exchange`** to the bot client for subjects in realm `caipe`.

### 2.3 Scope ceiling (FR-021)

The **effective OBO scope** must be the **intersection** of:

- What the **user** is allowed (realm roles + optional client scopes), and  
- What the **bot client** is allowed to request (**scope ceiling**).

Operational rules:

- Keep **`fullScopeAllowed`** off on `caipe-slack-bot`.
- Assign **only** the client scopes needed for AG + AuthZ (e.g. `profile`, `email`, `roles`, `groups`, `org` — no unnecessary optional scopes).
- Document **`scope_ceiling`** per tenant in your runbook (see [data-model.md](./data-model.md) *Bot service account*).

### 2.4 Verify with curl (RFC 8693)

After the user has a normal **access token** (`$USER_ACCESS_TOKEN`):

```bash
KC_HOST=http://localhost:7080
REALM=caipe

curl -s "$KC_HOST/realms/$REALM/protocol/openid-connect/token" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=$USER_ACCESS_TOKEN" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "requested_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "client_id=caipe-slack-bot" \
  -d "client_secret=<secret>"
```

Decode the JWT: expect **`sub`** = end user, **`act.sub`** = bot client identifier (per your Keycloak config). On failure, check **Events** for `TOKEN_EXCHANGE` / `TOKEN_EXCHANGE_ERROR`.

---

## 3. Keycloak Authorization Services (T072)

**Resource server client**: `caipe-platform` — **`authorizationServicesEnabled`: true**, **`policyEnforcementMode`**: `ENFORCING`.

### 3.1 Resources (permission matrix components)

| Resource     | Type              | Purpose (summary)        |
|-------------|-------------------|---------------------------|
| `admin_ui`  | `caipe:component` | UI dashboard / config     |
| `slack`     | `caipe:component` | Slack surfaces            |
| `supervisor`| `caipe:component` | Supervisor routing        |
| `rag`       | `caipe:component` | RAG / KB / tools          |
| `sub_agent` | `caipe:component` | Sub-agent dispatch        |
| `tool`      | `caipe:component` | Tool abstraction          |
| `skill`     | `caipe:component` | Skills                    |
| `a2a`       | `caipe:component` | A2A tasks                 |
| `mcp`       | `caipe:component` | MCP                       |

Full scope lists are in `realm-config.json` under `authorizationSettings.resources` (e.g. `admin_ui`: `view`, `configure`, `admin`, `audit.view`; `rag`: `query`, `ingest`, `tool.*`, `kb.*`, etc.).

### 3.2 Role-based policies

Template policies (positive, role-based):

- `admin-role-policy` → realm role `admin`
- `chat-user-role-policy` → `chat_user`
- `team-member-role-policy` → `team_member`
- `kb-admin-role-policy` → `kb_admin`

### 3.3 Scope permissions

**Scope permissions** bind resources + scopes to those policies (e.g. `rag-query-access` → `rag` scopes `query`, `tool.view`, `kb.query` + `chat_user`).

### 3.4 Decision strategy: UNANIMOUS

`authorizationSettings.decisionStrategy` is **`UNANIMOUS`**: every applicable policy must agree **positively** for allow (aligns with stricter default — confirm any custom deny policies with your security team).

**Admin Console**: **Clients** → `caipe-platform` → **Authorization** → **Settings** → Decision strategy.

---

## 4. Agent Gateway Deployment (T073)

### 4.1 Docker (repo layout)

```bash
# Start Keycloak first so network keycloak_default exists
docker compose -f deploy/keycloak/docker-compose.yml up -d

docker compose -f deploy/agentgateway/docker-compose.yml up -d
```

- **Port**: `4000` (configurable in `config.yaml`).
- **JWKS**: init container fetches `http://keycloak:7080/realms/caipe/protocol/openid-connect/certs` into a shared volume; AG reads `/etc/agentgateway/jwks.json`.

### 4.2 Kubernetes

Follow upstream Keycloak + AG integration: [Agent Gateway — Keycloak auth (Kubernetes)](https://agentgateway.dev/docs/kubernetes/latest/mcp/auth/keycloak/).

**Operator checklist**

- Mount **config** analogous to `deploy/agentgateway/config.yaml`.
- Set **`jwtAuth.issuer`** to your realm issuer (e.g. `https://<keycloak>/realms/caipe`).
- Set **`jwtAuth.audiences`** to include the audience present on tokens (template uses **`caipe-platform`** via audience mapper on `profile` scope).
- **JWKS URI**: sync or sidecar-fetch from `.../realms/caipe/protocol/openid-connect/certs`; rotate on Keycloak cert rollover.

### 4.3 OIDC parameters (reference)

From `deploy/agentgateway/config.yaml`:

```yaml
jwtAuth:
  mode: strict
  issuer: http://keycloak:7080/realms/caipe   # replace in prod
  audiences: [caipe-platform]
  jwks:
    file: /etc/agentgateway/jwks.json
```

Adjust **issuer** and **audiences** for every environment; mismatch causes **401/403** on all AG routes.

---

## 5. AG Policy Authoring (T074)

CEL rules should **mirror** [permission-matrix.md](./permission-matrix.md) for MCP, A2A, and agent traffic. AG evaluates **allow** rules (implementation-specific: first match or any-match — align with your AG version; the sample stacks role checks for MCP tools).

### 5.1 Principles

- One **logical rule** per matrix row (or grouped rows with the same role pattern).
- Use JWT claims exposed by AG (e.g. `jwt.realm_access.roles`, `jwt.sub`, `jwt.org`).
- Prefer **deny-by-default**: only listed allow patterns pass (plus HTTP-level `authorization` rules in config).

### 5.2 Example — MCP tool invocation (`mcp#invoke`)

Illustrative CEL (pattern from `deploy/agentgateway/config.yaml`):

```cel
("chat_user" in jwt.realm_access.roles ||
 "team_member" in jwt.realm_access.roles ||
 "kb_admin" in jwt.realm_access.roles ||
 "admin" in jwt.realm_access.roles) &&
has(mcp.tool) &&
!(mcp.tool.name.startsWith("admin_")) &&
!(mcp.tool.name.startsWith("rag_ingest"))
```

### 5.3 Example — A2A task creation (`a2a#create`)

If your AG route exposes an A2A-specific context (pseudo-variables — align with [Agent Gateway policy docs](https://agentgateway.dev/docs/standalone/latest/configuration/security/)):

```cel
("chat_user" in jwt.realm_access.roles ||
 "team_member" in jwt.realm_access.roles ||
 "kb_admin" in jwt.realm_access.roles ||
 "admin" in jwt.realm_access.roles) &&
has(a2a.task) &&
a2a.task.operation == "create"
```

**Admin-only** A2A:

```cel
"admin" in jwt.realm_access.roles &&
has(a2a.task) &&
a2a.task.operation in ["admin", "delete_namespace"]
```

Keep names (`a2a.task.operation`, etc.) consistent with your **actual** AG extension fields.

### 5.4 Tenant header vs `org` claim

Sample HTTP rule from config:

```cel
has(jwt.org) && has(request.headers.x_tenant_id) && jwt.org != request.headers.x_tenant_id
```

→ **deny** if header tenant disagrees with JWT `org`.

---

## 6. Composition & Precedence (T075)

Four layers (see permission matrix **§ Composition**):

| Order | Layer              | Where enforced              |
|-------|--------------------|-----------------------------|
| 1     | **AG CEL**         | Agent Gateway               |
| 2     | **Keycloak AuthZ** | UI BFF, Slack bot (UMA/RPT) |
| 3     | **ASP**            | RAG / supervisor tool policy (MongoDB) |
| 4     | **Team-scope**     | BFF + RAG (ownership, datasource binding) |

### 6.1 Deny-wins

```
effective_access = AG_allows ∧ keycloak_allows ∧ asp_allows ∧ team_scope_allows
```

Any **deny** or **unavailable PDP** → **deny** (see §7).

### 6.2 Worked example

**Goal**: `team_member` for team A creates a RAG tool scoped to team A.

1. **AG**: MCP tool name matches `rag_tool` pattern; roles include `team_member` → allow at edge.
2. **Keycloak**: Permission `rag#tool.create` granted to `team_member` → allow.
3. **ASP**: Tool not on global deny list → allow.
4. **Team-scope**: `team_id` on payload = A and datasources ⊆ team A allow-list → allow.

**Result**: **allow**. If step 4 fails (cross-team id) → **deny** even if 1–3 allowed.

---

## 7. Fail-Closed Behavior (T076)

| Failure | Symptom | Policy |
|---------|---------|--------|
| **Keycloak down** | No OIDC login, token refresh fails, AuthZ errors | **No new sessions**; treat as **deny** for protected APIs. |
| **AG down / unreachable** | MCP/A2A/agent via AG fail | **Deny** agent-plane traffic; **Slack/UI** paths that only use Keycloak AuthZ may still work if KC healthy and design does not route those through AG. |
| **MongoDB unavailable** | Team-scope / ASP reads fail | PDP returns **deny** or **503**; **never** implicit allow. Audit reason e.g. `DENY_PDP_UNAVAILABLE`, `DENY_SCOPE`. |

### 7.3 Runbooks (short)

**Keycloak outage**

1. Page identity on-call; capture realm logs and `LOGIN_ERROR` / `TOKEN_EXCHANGE_ERROR` events.
2. Enable maintenance page for UI if sessions cannot refresh.
3. Do **not** disable AuthZ checks in app config “temporarily” without explicit risk acceptance.

**AG outage**

1. Route emergency traffic or disable agent features that **require** AG; do not bypass JWT validation.
2. Restore JWKS volume / fix issuer URL; verify a sample MCP call with a valid OBO token.

**MongoDB outage**

1. BFF/RAG return errors for team-scoped writes; verify alerts on connection pool.
2. After recovery, reconcile any in-flight writes (idempotent APIs preferred).

---

## 8. Day-Two Operations (T077)

### 8.1 Adding new IdP groups

1. Create group in Okta / Entra.
2. Add **IdP mapper** in Keycloak (hardcoded role or attribute → role).
3. Confirm user login shows **realm role** under **Users** → *user* → **Role mapping**.
4. Validate JWT at [jwt.io](https://jwt.io) (dev) or `jq` decode: `roles`, `groups`, `org`.

### 8.2 Creating new roles

1. Add realm role in Keycloak.
2. Update **AuthZ policies** on `caipe-platform` (new role policy + scope permission).
3. Update **AG CEL** in `config.yaml` (Git-reviewed).
4. Update [permission-matrix.md](./permission-matrix.md) and consuming apps.

### 8.3 Onboarding a new team / KB

1. **IdP**: add group `team-<new>-eng` → `team_member` mapper.
2. **MongoDB**: create team record, allowed datasources, KB bindings (per [data-model.md](./data-model.md)).
3. **RAG**: verify `rag#tool.*` and datasource validation for that `team_id`.
4. Smoke test: UI BFF + optional AG MCP path.

### 8.4 Rotating `caipe-slack-bot` client secret

1. Keycloak **Clients** → `caipe-slack-bot` → **Credentials** → **Regenerate secret**.
2. Update secret in vault / k8s Secret / Slack bot deployment env **`KEYCLOAK_BOT_CLIENT_SECRET`**.
3. Roll pods; verify OBO exchange curl (§2.4).

### 8.5 Upgrading AG policy

1. Change CEL in Git → review against permission matrix.
2. Roll AG deployment; run **canary** route if supported.
3. Watch AG JSON logs for denials; spot-check `chat_user` vs `admin` tool paths.

### 8.6 Monitoring audit logs

- **Keycloak**: Admin events + `TOKEN_EXCHANGE`, `PERMISSION_TOKEN` (enabled in template).
- **Application**: authorization decision records (component, capability, `pdp`, `reason_code`) per data model.
- Correlate with **correlation_id** across BFF, bot, and AG.

### 8.7 Re-linking invalidated Slack accounts

If a user is **disabled**, **deleted**, or **mapper** changed such that the link is wrong:

1. Bot denies RBAC commands until re-link (FR-025).
2. Remove stale **`slack_user_id`** attribute on the old Keycloak user (Admin API or console) if the user record still exists.
3. User completes **Link your account** flow again; bot writes fresh `slack_user_id` on the correct user.
4. Verify **OBO** exchange and a single protected command.

---

## Quick reference — client IDs

| Client             | Use |
|--------------------|-----|
| `caipe-ui`         | Public OIDC — Admin UI |
| `caipe-platform`   | Resource server + **Authorization Services** |
| `caipe-slack-bot`  | Confidential — **OBO token exchange** |

---

*Document version: aligned with spec **098-enterprise-rbac-slack-ui** and repo templates as of task authoring (T070–T077).*
