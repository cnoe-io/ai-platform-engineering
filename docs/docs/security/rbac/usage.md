# Using RBAC in Practice

How to bring up the stack, log in as different roles, verify denials, run the demo, and answer the questions you'll inevitably get from teammates. For the architecture and request flows, see [Architecture](./architecture.md) and [Workflows](./workflows.md).

---

## Start the Stack

```bash
COMPOSE_PROFILES='rbac,caipe-ui,caipe-mongodb' \
  docker compose -f docker-compose.dev.yaml up -d

# Confirm Keycloak is healthy before logging in
docker compose -f docker-compose.dev.yaml ps keycloak
```

Keycloak admin console: `http://localhost:7080/admin` (admin / admin)

When the `rbac` profile is selected, `caipe-ui` has an optional `depends_on`
health dependency on `keycloak`. This keeps UI startup seed/scope sync from
racing Keycloak realm import while preserving non-RBAC UI runs where Keycloak is
not selected.

The local `.env` mirrors the Grid RBAC defaults that affect auth behavior:
`KEYCLOAK_FORCE_IDP_REDIRECT=true`, `OIDC_GROUP_CLAIM=members,groups`,
deployment-specific access/admin group settings, and the RAG ingestor
`INGESTOR_OIDC_*` client-credentials settings. The compose `keycloak-init` service passes
`KEYCLOAK_FORCE_IDP_REDIRECT` through to `deploy/keycloak/init-idp.sh`, so a
fresh `rbac` profile start configures the same IdP-only app-realm login path as
the Helm deployment.

> **Heads-up: `caipe-ui` host port is hard-pinned to `3000`.** Keycloak's `caipe-ui` client only allow-lists `http://localhost:3000/*` as a redirect URI (see `deploy/keycloak/realm-config.json`). Remapping the UI breaks the OIDC redirect dance and login fails with `Invalid redirect_uri`. The spec-102 e2e lane (`make test-rbac-up`) honours this — it remaps Mongo (`28017`) and supervisor (`28000`) to a `28xxx` band, but leaves `caipe-ui:3000` and Keycloak (`7080/7443`) untouched. See [spec 102 quickstart › E2E port band](../../specs/102-comprehensive-rbac-tests-and-completion/quickstart.md#e2e-port-band) for the full table and env-var contract.

---

## Optional Test Users (`caipe` realm)

Shared and production realms should not contain sample password users. The
Keycloak Helm chart disables them by default with `keycloak.demoUsers.enabled=false`.
Enable demo users only in an isolated local/CI RBAC test stack.

| Username | Password | Roles | Boundary to test |
|----------|----------|-------|-----------------|
| `admin-user` | `admin` | admin, chat_user | Full admin UI access |
| `standard-user` | `standard` | chat_user, team_member | Chat only, no admin UI |
| `kb-admin-user` | `kbadmin` | chat_user, team_member, kb_admin | RAG management |
| `denied-user` | `denied` | (none) | 403 on all protected routes |
| `org-b-user` | `orgb` | chat_user (tenant: globex) | Tenant isolation — sees only Globex data |

---

## Verify Role Enforcement

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
# → 403 (AgentGateway ext_authz/OpenFGA denies)
```

---

## Verify ReBAC Transition Mode

Use the engineer-facing enforcement comparison endpoint to prove stale
resource-specific realm roles do not allow access once a resource type is
marked `rebac_enforced`. This migration check is not exposed in the admin UI.

```bash
curl -s -X POST http://localhost:3000/api/rbac/enforcement-comparison \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": {"type":"user","id":"alice"},
    "resource": {"type":"agent","id":"incident-agent"},
    "action": "use",
    "realm_roles": ["agent_user:incident-agent"]
  }' | python3 -m json.tool
```

Expected result for `agent=rebac_enforced`: `legacy.allowed=false`,
`legacy.ignored_roles=["agent_user:incident-agent"]`, and
`effective.source="rebac"`.

---

## Demo Walkthrough — Prove Every Gate

This script exercises **all three RBAC outcomes** at AgentGateway: `200` (ext_authz allow), `403` (ext_authz deny), `401` (jwtAuth reject). It's the cleanest live demo of the system because it shows you *which layer* fired in each case.

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

# 3) Call AG with a valid token → ext_authz allows → proxied to RAG MCP
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST http://localhost:4000/rag/v1/query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"hello"}'
# → HTTP 200 (jwtAuth passed, OpenFGA allows)

# 4) Call AG with a denied-user token → ext_authz evaluates → 403
DENIED=$(curl -s -X POST http://localhost:7080/realms/caipe/protocol/openid-connect/token \
  -d 'grant_type=password&client_id=caipe-ui&client_secret=caipe-ui-dev-secret' \
  -d 'username=denied-user&password=denied' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $DENIED" \
  http://localhost:4000/rag/v1/query
# → HTTP 403 (jwtAuth passed — denied-user is authenticated — but OpenFGA denies)

# 5) Call AG with a forged token → jwtAuth rejects before ext_authz even runs
FORGED_JWT="not.a.real.jwt"
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $FORGED_JWT" \
  http://localhost:4000/rag/v1/query
# → HTTP 401 (signature verification fails against JWKS)

# 6) Show live config as AG sees it
curl -s http://localhost:15000/config | python3 -m json.tool | head -40
```

The three outcomes (200, 403, 401) map directly onto the distinct layers in the [per-request authorization diagram](./workflows.md#per-request-authorization-end-to-end): **ext_authz allow**, **ext_authz deny**, and **jwtAuth reject**.

---

## Enable Dynamic Agents Auth

`AUTH_ENABLED` controls the legacy Dynamic Agents user-context dependency. The
layered execution PDP also requires validated bearer identity at runtime and an
OpenFGA store with agent-use tuples. To test the full path:

```bash
# .env
AUTH_ENABLED=true
OIDC_ISSUER=http://localhost:7080/realms/caipe
OIDC_CLIENT_ID=caipe-ui
OIDC_REQUIRED_GROUP=caipe-users
DA_REQUIRE_BEARER=true
OPENFGA_HTTP=http://openfga:8080
OPENFGA_STORE_NAME=caipe-openfga
```

Use `OPENFGA_STORE_ID` instead of store-name discovery when your environment
pins the store id. With these settings, `POST /api/v1/chat/stream/start`,
`POST /api/v1/chat/invoke`, and `POST /api/v1/chat/stream/resume` require
`user:<sub> can_use agent:<agent_id>` at both the Web UI backend and runtime layers.
If existing team data was seeded with email principals, both layers fallback to
`user:<email> can_use agent:<agent_id>` after the subject check fails.
`POST /api/v1/chat/stream/cancel` remains authentication-only.

The RBAC Audit tab records OpenFGA results as `OpenFGA ReBAC`. Filter by type
`OpenFGA ReBAC` to see `webui_backend` `dynamic_agent#use` checks, Dynamic Agents
runtime `dynamic_agent#use` checks, AgentGateway bridge `mcp#can_call` checks, and
admin graph/check/relationship activity from the OpenFGA ReBAC panel. The Admin UI
reads MongoDB `audit_events`, so this view works without Jaeger. To keep the
default feed useful, routine `admin_ui#view` checks are hidden unless the user
explicitly selects the `Authorization` type filter. The same default filter
applies to `admin_ui#audit.view` checks generated while viewing the audit page.

### Authz Audit Storage

Authorization audit is MongoDB-backed in local dev. Use Admin → Security &
Policy → RBAC Audit as the durable view for OpenFGA checks and authorization
decisions; the dev compose stack does not start a separate trace backend.

See [Architecture › Component 5: Dynamic Agents](./architecture.md#component-5-dynamic-agents--the-workshop-floor) for the full env var table and what each one does.

---

## Backfill OpenFGA Relationships

After enabling the Dynamic Agent execution gate, run the OpenFGA relationship
backfill so existing team/resource assignments and the configured default agent
are represented in the OpenFGA graph.

Dry-run first:

```bash
MONGODB_URI=mongodb://localhost:27017 \
MONGODB_DATABASE=caipe \
OPENFGA_HTTP=http://localhost:8080 \
OPENFGA_STORE_NAME=caipe-openfga \
APPLY=false \
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/backfill-universal-rebac.ts
```

Review the JSON summary for planned tuples, skipped identifiers, unmapped users,
and `defaultAgent`. If a dynamic default agent is configured, the active model
must allow `user:*` on `agent.can_use` and the summary should include the
default-agent grant.

Before applying in an environment that already has team members, make sure users
have logged in at least once through CAIPE so `users.keycloak_sub` is populated.
The backfill uses that persisted Keycloak subject for `user:<sub>
member/admin team:<slug>` tuples; email is only a compatibility fallback.

Apply once:

```bash
MONGODB_URI=mongodb://localhost:27017 \
MONGODB_DATABASE=caipe \
OPENFGA_HTTP=http://localhost:8080 \
OPENFGA_STORE_NAME=caipe-openfga \
APPLY=true \
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/backfill-universal-rebac.ts
```

The script records completion in MongoDB `rbac_migrations` with
`_id=openfga_relationship_backfill_v1`. Re-running with `APPLY=true` exits
without rewriting when that completed record exists. Use `FORCE=true` only when
intentionally reconciling again.

The migration writes:

- `user:<sub> member/admin team:<slug>` from team members.
- Team resource tuples for agents, tools, knowledge bases, skills, and tasks.
- `user:* can_use agent:<default_agent_id>` when the configured default is a
  dynamic agent.
- Mongo provenance in `team_membership_sources` and `rebac_relationships`.

Then backfill per-agent MCP tool restrictions so existing Dynamic Agents match
the enforcement that new agent create/update calls write automatically:

```bash
# Dry-run first
MONGODB_URI=mongodb://localhost:27017 \
MONGODB_DATABASE=caipe \
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/backfill-agent-tool-openfga.ts

# Apply after reviewing planned tuples. Apply mode reconciles existing
# agent-scoped tool tuples, including deleting stale wildcard grants that are
# no longer present in dynamic_agents.allowed_tools.
MONGODB_URI=mongodb://localhost:27017 \
MONGODB_DATABASE=caipe \
OPENFGA_HTTP=http://localhost:8080 \
OPENFGA_STORE_NAME=caipe-openfga \
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/backfill-agent-tool-openfga.ts --apply
```

This reconciles `agent:<agent_id> can_call tool:<server>/<tool>` tuples from
each agent's `allowed_tools`; empty tool arrays become `tool:<server>/*`, and
OpenFGA tuples for removed tools are deleted during apply mode.

Verify the default-agent path:

```text
Check user:<any-authenticated-subject> can_use agent:<default_agent_id>
```

Expected result: allowed for the configured dynamic default agent; unrelated
agents remain denied unless the user has a direct or team-derived grant.

---

## Slack Identity Linking

**Auto mode (default):**

1. Send any message to the bot
2. Bot silently fetches your Slack email, matches it to your Keycloak account, links automatically
3. Subsequent messages: OBO exchange happens automatically — zero user action required

**Forced-link mode (`SLACK_FORCE_LINK=true`):**

1. DM the Slack bot with any message
2. If unlinked: one-time HMAC-signed link prompt (rate-limited by `SLACK_LINKING_PROMPT_COOLDOWN`)
3. Click link → SSO login → `slack_user_id` written to Keycloak via Admin API
4. Subsequent messages: OBO exchange happens automatically

The full sequence (HMAC URL shape, TTL enforcement, **JIT user creation** for unknown emails, what happens server-side) is in [Workflows › Slack identity linking](./workflows.md#slack-identity-linking-auto-bootstrap--jit--forced-link).

---

## Slack Channel Migration Defaults

Use **Admin → OpenFGA ReBAC → Slack Channels → Migration Defaults** when onboarding an existing Slack bot workspace. Pick a default team and a default Dynamic Agent, then apply defaults to all onboarded Slack channels.

The bulk action is explicit and idempotent:

- Slack channels without a team mapping get the selected `team_slug`.
- Every active onboarded channel gets `slack_channel:<channel> can_use agent:<id>`.
- The selected team gets `team:<slug>#member can_use agent:<id>`.
- If selected, matching bootstrap rows are added to `slack_channel_agent_routes`.

If the Team or Dynamic Agent dropdown is empty, create the missing object in the admin UI and click **Refresh lists** before applying defaults.

---

## Running the Test Suite

The comprehensive RBAC test matrix (helper unit tests + matrix-driver tests + Playwright e2e) lives under `tests/rbac/` and is owned by spec 102. Quick reference:

```bash
# Lint everything (matrix YAML, jest, ruff)
make test-rbac-lint

# Boot the full stack with the e2e port band (UI:3000, mongo:28017, supervisor:28000)
make test-rbac-up

# Run helper unit tests + the YAML-driven matrix tests (Python + Jest)
make test-rbac-pytest
make test-rbac-jest

# Run Playwright e2e (requires the stack from `make test-rbac-up`)
RBAC_E2E=1 make test-rbac-e2e

# Tear down (removes volumes)
make test-rbac-down
```

Full details — port band rationale, the `E2E_COMPOSE_ENV` contract, and how the rules-as-data matrix in `tests/rbac/rbac-matrix.yaml` flows into both pytest and Jest — are in [spec 102 quickstart](../../specs/102-comprehensive-rbac-tests-and-completion/quickstart.md).

---

## Common Questions

**Q: Why does the UI still work if Keycloak is down?**

The UI and all services cache the JWKS public key. Signature validation is local — no Keycloak call needed per request. Sessions already in flight remain valid until their `exp`. Only new logins (which need Keycloak's auth endpoint) fail.

**Q: What is `BOOTSTRAP_ADMIN_EMAILS` and when should I remove it?**

It's an emergency bypass that grants full admin regardless of JWT roles. Intended only for initial setup when Keycloak role mapping isn't yet configured. Once `admin-user` (or your real admin account) has the `admin` realm role and can log in successfully, remove `BOOTSTRAP_ADMIN_EMAILS` from your env. Leaving it in production is a standing privilege escalation risk.

**Q: Why are there both `access_token` and `obo_jwt` on `UserContext`?**

UI-sourced requests carry the user's own access token (`access_token`). Slack-sourced requests carry an OBO token (`obo_jwt` from the `X-OBO-JWT` header) — this preserves the delegator/delegatee distinction for audit purposes. The agent runtime prefers `obo_jwt` over `access_token` when forwarding to MCP tools.

**Q: What happens when the JWT expires mid-session?**

NextAuth holds the refresh token and silently refreshes before expiry. If the refresh fails (revoked session, Keycloak unavailable), the next API call returns 401 and the client redirects to login. OBO tokens issued by the Slack bot are short-lived; the bot re-exchanges on each message.

**Q: Can I add a custom role and enforce it at AgentGateway?**

Yes for application/UI roles. In Keycloak Admin: Realm Roles → Create. Add it to `default-roles-caipe` if it should be universal. Add an IdP mapper if it should come from an upstream group. For AgentGateway authorization, model the access as OpenFGA relationships instead of editing CEL rules.

**Q: Where do I look to change something?**

See [the file map](./file-map.md). Every auth-relevant file is listed with what changing it actually does.
