# Using RBAC in Practice

How to bring up the stack, log in as different roles, verify denials, run the demo, and answer the questions you'll inevitably get from teammates. For the architecture and request flows, see [Architecture](./architecture.md) and [Workflows](./workflows.md).

---

## Start the Stack

```bash
COMPOSE_PROFILES='rbac,caipe-ui,caipe-mongodb' \
  docker compose -f docker-compose.dev.yaml up -d

# Wait for Keycloak to be healthy before logging in
docker compose -f docker-compose.dev.yaml ps keycloak
```

Keycloak admin console: `http://localhost:7080/admin` (admin / admin)

> **Heads-up: `caipe-ui` host port is hard-pinned to `3000`.** Keycloak's `caipe-ui` client only allow-lists `http://localhost:3000/*` as a redirect URI (see `deploy/keycloak/realm-config.json`). Remapping the UI breaks the OIDC redirect dance and login fails with `Invalid redirect_uri`. The spec-102 e2e lane (`make test-rbac-up`) honours this — it remaps Mongo (`28017`) and supervisor (`28000`) to a `28xxx` band, but leaves `caipe-ui:3000` and Keycloak (`7080/7443`) untouched. See [spec 102 quickstart › E2E port band](../../specs/102-comprehensive-rbac-tests-and-completion/quickstart.md#e2e-port-band) for the full table and env-var contract.

---

## Built-in Test Users (`caipe` realm)

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
# → 403 (AgentGateway CEL denies — no chat_user role)
```

---

## Demo Walkthrough — Prove Every Gate

This script exercises **all three RBAC outcomes** at AgentGateway: `200` (CEL allow), `403` (CEL deny), `401` (jwtAuth reject). It's the cleanest live demo of the system because it shows you *which layer* fired in each case.

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

The three outcomes (200, 403, 401) map directly onto the three distinct layers in the [per-request authorization diagram](./workflows.md#per-request-authorization-end-to-end): **CEL allow**, **CEL deny**, and **jwtAuth reject**.

---

## Enable Dynamic Agents Auth

`AUTH_ENABLED` defaults to `false` in dev (returns a hardcoded admin bypass). To test the real RBAC path:

```bash
# .env
AUTH_ENABLED=true
OIDC_ISSUER=http://localhost:7080/realms/caipe
OIDC_CLIENT_ID=caipe-ui
OIDC_REQUIRED_ADMIN_GROUP=admin
```

See [Architecture › Component 5: Dynamic Agents](./architecture.md#component-5-dynamic-agents--the-workshop-floor) for the full env var table and what each one does.

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

Yes. In Keycloak Admin: Realm Roles → Create. Add it to `default-roles-caipe` if it should be universal. Add an IdP mapper if it should come from a Duo SSO group. Then update `deploy/agentgateway/config.yaml` with a CEL policy referencing the new role. No code changes required.

**Q: Where do I look to change something?**

See [the file map](./file-map.md). Every auth-relevant file is listed with what changing it actually does.
