# Quickstart: Enterprise RBAC Local Development

**Phase 1 Output** | **Date**: 2026-03-25 | **Plan**: [plan.md](./plan.md)

## Prerequisites

- Docker + Docker Compose
- Node.js 20+ (via nvm)
- Python 3.11+ with uv
- Access to the `098-enterprise-rbac-slack-ui` branch

## 1. Start Keycloak

```bash
cd deploy/keycloak
docker compose up -d
```

Keycloak will be available at `http://localhost:7080` with the `caipe` realm pre-configured.

**Default admin**: `admin` / `admin` (Keycloak console)

### Verify realm roles

Open `http://localhost:7080/admin/master/console/#/caipe/roles` and confirm these roles exist:
- `admin`, `chat_user`, `team_member`, `kb_admin`, `offline_access`

### Configure client mapper (if not in realm-config.json)

1. Navigate to **Clients → caipe-ui → Client scopes → caipe-ui-dedicated**
2. Add mapper: **Realm Roles** → Claim name: `realm_access` (already default)
3. Add mapper: **Group Membership** → Claim name: `groups`, Full group path: OFF

## 2. Start MongoDB

```bash
# From repo root
docker compose -f docker-compose.dev.yaml up -d mongodb
```

## 3. Configure UI environment

Ensure `ui/.env.local` has:

```bash
# Keycloak OIDC
OIDC_ISSUER=http://localhost:7080/realms/caipe
OIDC_CLIENT_ID=caipe-ui
OIDC_CLIENT_SECRET=caipe-ui-dev-secret

# Admin group (must match a group in your IdP or Keycloak)
OIDC_REQUIRED_ADMIN_GROUP=eti_sre_admin

# Bootstrap admin (for initial setup before group mapping works)
BOOTSTRAP_ADMIN_EMAILS=your.email@example.com

# Keycloak Admin API — UI BFF (NextAuth.js role-mapping CRUD)
KEYCLOAK_URL=http://localhost:7080
KEYCLOAK_REALM=caipe
KEYCLOAK_ADMIN_CLIENT_ID=admin-cli
KEYCLOAK_ADMIN_CLIENT_SECRET=<generate-in-keycloak>

# Keycloak Admin API — Slack bot (user lookup by slack_user_id).
# MUST be a confidential client with view-users + query-users on
# realm-management. Distinct from KEYCLOAK_ADMIN_* above to avoid the
# namespace collision that would silently break slack-bot. The surface-
# specific prefix leaves room for future bots (Webex, Teams, …).
# (defaults to caipe-platform / caipe-platform-dev-secret in dev compose)
# KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID=caipe-platform
# KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET=<keycloak-managed-secret>

# MongoDB
MONGODB_URI=mongodb://admin:changeme@localhost:27017
MONGODB_DATABASE=caipe
```

## 4. Start the UI

```bash
cd ui
npm install
npm run dev
```

## 5. Run tests

### UI tests

```bash
cd ui
npm test                    # All tests
npm test -- --coverage      # With coverage report
```

### Supervisor tests

```bash
# Install missing deps
uv add --dev pytest-asyncio pytest-cov

# Run tests
PYTHONPATH=. uv run pytest tests/ -v

# With coverage
PYTHONPATH=. uv run pytest tests/ --cov=ai_platform_engineering --cov-report=term-missing
```

## 6. Verify RBAC is working

1. Log in at `http://localhost:3000`
2. Check server console for `[Auth JWT] User groups count:` — should show your groups
3. Check `[Auth JWT] User role:` — should show `admin` if your group matches
4. Navigate to Admin dashboard — Roles and Slack Integration tabs should be visible
5. Open user system menu — should show your realm roles and teams

## 7. Persona validation checklist (SC-003)

Use Keycloak users from `deploy/keycloak/realm-config.json` (adjust passwords locally) or create equivalent realm roles. Goal: **no** protected surface grants a high-risk action that the [permission matrix](./permission-matrix.md) forbids for that persona.

Record **Pass / Fail** and notes (which endpoint or UI path was exercised).

### `admin` — full access

| # | Check | Pass? |
|---|--------|-------|
| A1 | UI: Admin dashboard loads; Users, Teams, Roles, sensitive tabs available per `admin_tab_policies` | |
| A2 | API: `GET /api/admin/users` returns 200 | |
| A3 | Can assign roles / team membership (if exercised) | |
| A4 | RAG proxy / query succeeds for all KBs the deployment exposes | |
| A5 | MCP via Agent Gateway: admin-prefixed or `supervisor_config` tools allowed when JWT has `admin` realm role | |

### `chat_user` — chat access, no admin

| # | Check | Pass? |
|---|--------|-------|
| C1 | UI: Main chat works; **Admin** entry hidden or returns 403 on deep link | |
| C2 | API: `GET /api/admin/users` returns **403** | |
| C3 | User menu: shows own RBAC posture (`/api/auth/my-roles`); no admin-only tabs | |
| C4 | Supervisor / A2A invoke allowed where matrix grants `chat_user` | |
| C5 | MCP (AG): generic tool invoke allowed; **admin_** / **rag_ingest** / **supervisor_config** denied | |

### `team_member` — team-scoped KB / agent context

| # | Check | Pass? |
|---|--------|-------|
| T1 | Can access team-scoped RAG tools / KBs only for member teams (MongoDB + Keycloak roles) | |
| T2 | Cannot modify another team’s tool configs without `kb_admin` / `admin` | |
| T3 | Slack (if configured): channel→team mapping scopes context; without `team_member` for that team, bot denies with clear message (FR-031 / FR-004) | |

### `kb_admin` — KB administration

| # | Check | Pass? |
|---|--------|-------|
| K1 | RAG ingest and KB admin operations succeed | |
| K2 | UI admin **user/role** management still **403** unless also `admin` / bootstrap admin | |
| K3 | AG: `rag_ingest*` allowed; platform user management remains blocked | |

### `denied` — no baseline access

Use a user with **no** `chat_user`, `team_member`, `kb_admin`, or `admin` (seed user `denied@example.com` is a starting point).

| # | Check | Pass? |
|---|--------|-------|
| D1 | UI: cannot reach agent chat or receives clear unauthorized experience | |
| D2 | `GET /api/chat/conversations` or equivalent protected API returns **401/403** | |
| D3 | AG MCP: tool list/invoke **denied** (no valid role in `jwt.realm_access.roles`) | |
| D4 | No leakage of other users’ data in error messages (FR-004) | |

### Optional regression

| # | Check | Pass? |
|---|--------|-------|
| R1 | Stop Keycloak: BFF protected route returns **503** fail-closed (no silent allow) | |
| R2 | With ASP denying a tool: RBAC allow + ASP deny → **deny** | |

**References**: [security-review.md](./security-review.md), [operator-guide.md](./operator-guide.md).

## Troubleshooting

### "User role: user" even with OIDC_REQUIRED_ADMIN_GROUP set

Your OIDC token may not contain the admin group in its claims. Check:
1. Server logs for `[Auth JWT] User groups count:` — if 0, the groups claim is missing
2. Add a **Group Membership** mapper on the `caipe-ui` client in Keycloak
3. Alternatively, use `BOOTSTRAP_ADMIN_EMAILS=your.email@example.com` as a temporary workaround

### Supervisor tests fail with "async def functions are not natively supported"

```bash
uv add --dev pytest-asyncio
```

### UI tests fail with ESM module errors

Some dependencies (uuid, jose, @a2a-js) require ESM transforms. Check `jest.config.js` has them in `transformIgnorePatterns`.
