# Quickstart: MongoDB Envelope Credentials and Credential Exchange

This quickstart defines the expected local and Helm verification flow for the implementation. The feature remains disabled by default until the required credential-store, key-wrap, policy, and UI routes are present.

## 1. Enable the Feature in Local Development

Add local-only values through an untracked env file or local shell export. Do not commit real secrets.

```bash
export CAIPE_CREDENTIALS_ENABLED=true
export CREDENTIAL_STORE_BACKEND=mongodb-envelope
export CREDENTIAL_KEY_PROVIDER=local-cmk
export CREDENTIAL_KMS_CMK_ID=alias/caipe-local-credentials
export CREDENTIAL_KMS_REGION=
export CREDENTIAL_EXCHANGE_ENABLED=true
```

`local-cmk` is the default local test wrapper. It uses the configured CMK alias/ID as local key-wrap context and must fail health checks in production. Production deployments should switch to `aws-kms`.

```bash
export CREDENTIAL_KEY_PROVIDER=aws-kms
export CREDENTIAL_KMS_CMK_ID=arn:aws:kms:us-west-2:123456789012:key/...
export CREDENTIAL_KMS_REGION=us-west-2
```

## 2. Start the Local Stack

```bash
docker compose -f docker-compose.dev.yaml up -d mongodb keycloak openfga caipe-ui dynamic-agents
```

Expected result:

- `caipe-ui` exposes the feature only when `CAIPE_CREDENTIALS_ENABLED=true`.
- The credential health endpoint reports credential store, key wrapper, and policy service status.
- No raw credential values appear in container logs.

## 3. Bootstrap MongoDB Indexes

Run the credential MongoDB index bootstrap after the implementation adds it. Existing RBAC index bootstrap patterns should be reused.

```bash
npm --prefix ui run init-credential-indexes
```

Expected result:

- Additive indexes for credential metadata, encrypted payloads, connectors, provider connections, audit, and migration previews exist.
- Existing MCP, skill hub, and catalog API key collections remain intact.

## 4. Optionally Bootstrap OAuth Connectors

Docker Compose reads bootstrap values from `.env`; Kubernetes must inject the
same variable names into `caipe-ui` through ESO/ExternalSecret. The startup
bootstrap is idempotent and writes provider client secrets through MongoDB
envelope encryption.

```bash
export CREDENTIAL_BOOTSTRAP_OAUTH_CONNECTORS=true
export GITHUB_CLIENT_ID=...
export GITHUB_CLIENT_SECRET=...
export GITHUB_REDIRECT_URI=http://localhost:3000/api/credentials/oauth/github/callback
export CONFLUENCE_CLIENT_ID=...
export CONFLUENCE_CLIENT_SECRET=...
export CONFLUENCE_REDIRECT_URI=http://localhost:3000/api/credentials/oauth/atlassian/callback
export WEBEX_CLIENT_ID=...
export WEBEX_CLIENT_SECRET=...
export WEBEX_REDIRECT_URI=http://localhost:3000/api/credentials/oauth/webex/callback
export PAGERDUTY_CLIENT_ID=...
export PAGERDUTY_CLIENT_SECRET=...
export PAGERDUTY_REDIRECT_URI=http://localhost:3000/api/credentials/oauth/pagerduty/callback
export PAGERDUTY_SCOPES="users.read incidents.read services.read oncalls.read schedules.read teams.read escalation_policies.read"
export GITLAB_CLIENT_ID=...
export GITLAB_CLIENT_SECRET=...
export GITLAB_REDIRECT_URI=http://localhost:3000/api/credentials/oauth/gitlab/callback
export GITLAB_SCOPES="api read_user"
```

For Kubernetes, configure `caipe-ui.externalSecrets.data` with those secret
keys. For the edge deployment, the source is Keeper namespace `eticloud`, path
`projects/caipe/edge/ttt`.

## 5. Create and Use a BYO Secret

1. Open CAIPE and navigate to **Connections & Secrets**.
2. Create a personal test secret with a non-production dummy value.
3. Confirm the saved detail view shows only metadata and masked value state.
4. Configure an MCP server credential source to use the created `secret_ref`.
5. Invoke a Dynamic Agent path as an authorized user.

Expected result:

- The MCP server record stores a `secret_ref`, not the raw value.
- Runtime retrieval requires a valid CAIPE JWT and OpenFGA `secret_ref#use`.
- Denied users receive a structured authorization error before decrypt.
- Browser UI calls can create and rotate the secret, but list/detail responses show only metadata and masked value state.

## 6. Verify Service Credential API Guardrails

Call the standard credential retrieval API from an approved server-side test client using a service JWT or approved OBO token.

Expected result:

- Authorized service calls receive only the minimum credential material needed for the declared intended use.
- Missing audience, missing service identity, missing resource context, or denied `secret_ref#use` fails before decrypt.
- Browser-origin, session-only, CSRF-shaped, or browser-accessible requests to retrieval or exchange endpoints are denied before decrypt, provider refresh, or token issuance.
- No retrieval or exchange endpoint response is proxied back to browser JavaScript.

## 7. Configure an OAuth Connector

1. As a platform admin, open **OAuth Connectors**.
2. Configure a built-in provider such as GitHub, Atlassian, Webex, PagerDuty, or GitLab.
3. Store the connector client secret through the credential-store UI/API.
4. Enable the connector for a test team or admin policy.

Expected result:

- Connector metadata is readable with `client_secret_masked=true`.
- Connector URLs are HTTPS and pass SSRF validation.
- Client secret material is stored as an encrypted credential payload.

## 8. Connect a Provider Account

1. As a normal user, start a provider connection flow from **My Connections**.
2. Complete provider consent.
3. Return to CAIPE and verify connection status is `active`.
4. Disconnect and reconnect to verify lifecycle behavior.

Expected result:

- Provider token material is stored through credential storage.
- The browser never receives raw access or refresh tokens.
- Connection metadata includes provider account and scope status only.

## 9. Verify MCP Impersonation Mode

Set `USE_IMPERSONATION_TOKENS` for a test GitHub, Jira, or Confluence MCP configuration.

Expected result:

- GitHub MCP requests use the invoking user's GitHub bearer credential when authorized.
- Jira and Confluence MCP requests use the invoking user's Atlassian OAuth bearer credential and required resource context.
- Missing connection, missing scope, disabled connector, revoked connection, or denied policy fails before the MCP tool call.
- With the flag disabled, existing static credential behavior remains unchanged.

## 10. Preview Migration Candidates

Run a migration preview for existing credential-shaped sources.

```bash
npm --prefix ui run credentials:migration-preview -- --source mcp_server_env
```

Expected result:

- Preview output identifies candidate fields without storing raw values in preview records.
- No records are changed until an explicit apply action exists and is approved.

## 11. Run Targeted Verification

Run the relevant checks after implementation changes.

```bash
npm --prefix ui test -- credentials
npm --prefix ui run lint
PYTHONPATH=. uv run pytest ai_platform_engineering/dynamic_agents/tests/test_mcp_client_token_forwarding.py -v
PYTHONPATH=. uv run pytest tests/test_mcp_auth_middleware.py -v
make test-rbac-unit
```

For Helm changes:

```bash
helm template caipe charts/ai-platform-engineering -f charts/ai-platform-engineering/values.yaml >/tmp/caipe-rendered.yaml
```

Expected result:

- Toggle-disabled tests preserve legacy behavior.
- Toggle-enabled tests cover allowed, denied, browser retrieval denied, browser exchange denied, unavailable, revoked, refresh, and migration-preview cases.
- Rendered Helm manifests contain toggle and KMS references but no hardcoded credentials.

## 12. Update Documentation

Any implementation that touches credential auth paths must update:

- `docs/docs/security/rbac/architecture.md`
- `docs/docs/security/rbac/workflows.md`
- `docs/docs/security/rbac/file-map.md`
- `docs/docs/security/rbac/usage.md`
- Relevant component READMEs and Helm values documentation
