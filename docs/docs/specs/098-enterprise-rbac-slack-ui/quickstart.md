# Quickstart: Enterprise RBAC local verification

Verify the 098 Enterprise RBAC feature locally using the unified dev compose stack.

## Prerequisites

- Docker / Docker Compose v2+
- Node.js 20+ and npm
- Python 3.11+ and uv
- `curl` and `jq`

## 1. Start the RBAC stack

From the repo root:

```bash
docker compose -f docker-compose.dev.yaml \
  --profile rbac --profile caipe-mongodb up -d
```

This starts:
- **Keycloak** on port 7080 (admin console: `http://localhost:7080/admin`, creds: `admin` / `admin`)
- **Agent Gateway** on port 4000
- **MongoDB** on port 27017

The realm config at `deploy/keycloak/realm-config.json` is auto-imported with test users, roles, clients, and Authorization Services policies.

Wait for healthy:

```bash
docker compose -f docker-compose.dev.yaml --profile rbac ps
```

## 2. Test personas

| Username | Password | Roles | Tenant |
|---|---|---|---|
| `admin-user` | `admin` | admin, chat_user | acme |
| `standard-user` | `standard` | chat_user, team_member | acme |
| `kb-admin-user` | `kbadmin` | chat_user, team_member, kb_admin | acme |
| `denied-user` | `denied` | (none) | acme |
| `org-b-user` | `orgb` | chat_user | globex |

## 3. Verify Keycloak token issuance

```bash
KC_HOST=http://localhost:7080
REALM=caipe

TOKEN=$(curl -s "$KC_HOST/realms/$REALM/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=caipe-ui" \
  -d "username=admin-user" \
  -d "password=admin" \
  -d "scope=openid" | jq -r '.access_token')

echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```

Expected claims: `sub`, `realm_access.roles` (should include `admin`, `chat_user`), `org` (`acme`).

## 4. Verify Keycloak Authorization Services (PDP-1)

Check an admin permission:

```bash
curl -s "$KC_HOST/realms/$REALM/protocol/openid-connect/token" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:uma-ticket" \
  -d "audience=caipe-platform" \
  -d "permission=admin_ui#view" \
  -d "response_mode=decision" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Expected: `{"result": true}` for `admin-user`.

Now test with `denied-user`:

```bash
DENIED_TOKEN=$(curl -s "$KC_HOST/realms/$REALM/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=caipe-ui" \
  -d "username=denied-user" \
  -d "password=denied" \
  -d "scope=openid" | jq -r '.access_token')

curl -s "$KC_HOST/realms/$REALM/protocol/openid-connect/token" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:uma-ticket" \
  -d "audience=caipe-platform" \
  -d "permission=admin_ui#view" \
  -d "response_mode=decision" \
  -H "Authorization: Bearer $DENIED_TOKEN" | jq .
```

Expected: `403 Forbidden` (no admin role).

## 5. Verify Agent Gateway policy (PDP-2)

```bash
AG_HOST=http://localhost:4000

curl -s -o /dev/null -w "%{http_code}" "$AG_HOST/v1/mcp/tools/list" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Without a valid token: should return `401` or `403`.

## 6. Verify OBO token exchange

Simulate bot-to-user delegation:

```bash
OBO_TOKEN=$(curl -s "$KC_HOST/realms/$REALM/protocol/openid-connect/token" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  -d "subject_token=$TOKEN" \
  -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "requested_token_type=urn:ietf:params:oauth:token-type:access_token" \
  -d "client_id=caipe-slack-bot" \
  -d "client_secret=caipe-slack-bot-dev-secret" | jq -r '.access_token')

echo "$OBO_TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```

Expected: OBO JWT with `sub` = user, `act.sub` = bot service account.

## 7. Verify Slack identity link (Keycloak user attribute)

Write and read `slack_user_id` attribute:

```bash
ADMIN_TOKEN=$(curl -s "$KC_HOST/realms/master/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=admin" | jq -r '.access_token')

USER_ID=$(curl -s "$KC_HOST/admin/realms/$REALM/users?username=admin-user" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.[0].id')

curl -s -X PUT "$KC_HOST/admin/realms/$REALM/users/$USER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"attributes\": {\"slack_user_id\": [\"U12345\"], \"org\": [\"acme\"]}}"

curl -s "$KC_HOST/admin/realms/$REALM/users?q=slack_user_id:U12345" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.[0].attributes'
```

Expected: `{"slack_user_id": ["U12345"], "org": ["acme"]}`.

## 8. Verify multi-tenant isolation

Attempt cross-tenant access with `org-b-user` (tenant `globex`):

```bash
ORGB_TOKEN=$(curl -s "$KC_HOST/realms/$REALM/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=caipe-ui" \
  -d "username=org-b-user" \
  -d "password=orgb" \
  -d "scope=openid" | jq -r '.access_token')

curl -s -o /dev/null -w "%{http_code}" "$AG_HOST/v1/mcp/tools/list" \
  -H "Authorization: Bearer $ORGB_TOKEN" \
  -H "X-Tenant-Id: acme" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: `403` (org-b-user has `org=globex` but requests `X-Tenant-Id: acme`).

## 9. Run UI with RBAC

```bash
cd ui
npm install

# Set env vars for Keycloak OIDC
SSO_ENABLED=true \
OIDC_CLIENT_ID=caipe-ui \
OIDC_ISSUER=http://localhost:7080/realms/caipe \
KEYCLOAK_URL=http://localhost:7080 \
KEYCLOAK_REALM=caipe \
KEYCLOAK_RESOURCE_SERVER_ID=caipe-platform \
KEYCLOAK_CLIENT_SECRET=caipe-platform-dev-secret \
MONGODB_URI="mongodb://admin:changeme@localhost:27017/caipe?authSource=admin" \
npm run dev
```

Open `http://localhost:3000`. Sign in as different personas — admin pages should be visible/hidden based on role.

## 10. Verify audit trail

After performing some operations, query the audit API:

```bash
curl -s "http://localhost:3000/api/admin/rbac-audit?limit=5" \
  -H "Cookie: <session-cookie>" | jq .
```

Or check MongoDB directly:

```bash
docker exec caipe-mongodb-dev mongosh --quiet \
  -u admin -p changeme --authenticationDatabase admin \
  caipe --eval 'db.authorization_decision_records.find().sort({ts:-1}).limit(5).toArray()'
```

## Acceptance criteria checklist

- [ ] Keycloak token contains `realm_access.roles` and `org` claims
- [ ] Keycloak AuthZ returns correct allow/deny for matrix capabilities
- [ ] AG blocks unauthenticated MCP requests (401/403)
- [ ] AG applies CEL policy rules for role-based tool access
- [ ] AG blocks cross-tenant access (org mismatch → 403)
- [ ] OBO token contains `act.sub` claim
- [ ] Slack identity link stored and retrieved via Keycloak Admin API
- [ ] BFF middleware denies unauthorized admin routes
- [ ] Denied actions show user-friendly feedback
- [ ] Audit records persisted to MongoDB
- [ ] Admin audit API returns paginated records (admin-only)

## Teardown

```bash
docker compose -f docker-compose.dev.yaml --profile rbac --profile caipe-mongodb down -v
```
