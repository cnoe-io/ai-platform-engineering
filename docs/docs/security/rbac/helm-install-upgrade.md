# Helm Installation and Upgrade Guide

**Audience:** platform engineers installing the RBAC/OpenFGA refactor on a real Kubernetes cluster.

This guide describes the RBAC runtime packaging in the `0.5.0` Helm chart. Keycloak, AgentGateway, OpenFGA, and the OpenFGA bridge are optional chart components; production installs still need externalized secrets and persistent datastores.

For local or demo installs, `setup-caipe.sh --rbac-runtime` now enables those optional in-chart components together. It is still a development-oriented path: Keycloak defaults to `start-dev`/embedded H2, OpenFGA defaults to the in-memory datastore unless overridden, and production installs should use explicit values files and managed secrets as described below.

## Current Helm Packaging Status

| Component | Is it installed by the umbrella chart today? | What exists today |
|-----------|----------------------------------------------|-------------------|
| CAIPE UI | Yes | `charts/ai-platform-engineering/charts/caipe-ui` includes Deployment, Service, Ingress, ConfigMap, and secret wiring. |
| Slack bot | Yes | `charts/ai-platform-engineering/charts/slack-bot` includes Deployment and Slack/OBO configuration. |
| Keycloak | Yes, optional | Enable with `tags.keycloak=true`. The subchart imports the realm and runs the IdP/token-exchange init hooks. |
| AgentGateway | Yes, optional | Enable the standalone proxy with `agentgateway.enabled=true`. Gateway API route resources are still controlled by `global.agentgateway.enabled=true`. |
| OpenFGA | Yes, optional | Enable with `openfga.enabled=true`. The subchart deploys OpenFGA and a model-loader hook for the CAIPE authorization model. |
| OpenFGA bridge | Yes, optional | Enable with `openfgaAuthzBridge.enabled=true`. The bridge image is published with the release and exposed as an internal gRPC Service. |

For a production install, plan three layers:

1. Prepare external infrastructure: DNS/TLS, External Secrets, and persistent databases for Keycloak and OpenFGA.
2. Install the CAIPE umbrella chart with `tags.keycloak`, `openfga.enabled`, `openfgaAuthzBridge.enabled`, and `agentgateway.enabled` set for an in-chart RBAC runtime.
3. Point UI, Slack bot, dynamic agents, and MCP callers at the in-cluster services through values and secrets.

## Recommended Public Hostnames

For an instance domain such as `caipe.example.com`, use separate hostnames:

| Host | Audience | Recommended exposure |
|------|----------|----------------------|
| `caipe.example.com` | End users | Public HTTPS Ingress for the CAIPE UI. |
| `idp.caipe.example.com` | End users and services | Public HTTPS Ingress for Keycloak OIDC login, callbacks, JWKS, and token endpoints. |
| `agentgateway.caipe.example.com` | Internal service callers or controlled clients | Prefer private or authenticated exposure. Do not expose the admin port publicly. |
| `openfga.caipe.example.com` | Platform services only | Prefer private cluster/network exposure. Public exposure is not required for normal CAIPE users. |

End users should normally use `caipe.example.com`. AgentGateway is the MCP data-plane policy enforcement point, not the primary user interface. If you expose any AgentGateway admin UI or Envoy admin port, put it behind admin SSO, network allow lists, and TLS; do not expose it as a general end-user surface.

## Prerequisites

Before installing the refactor, prepare:

- A Kubernetes namespace, for example `caipe`.
- DNS and TLS for `caipe.example.com` and `idp.caipe.example.com`.
- A trusted Ingress controller or Gateway API implementation.
- Gateway API CRDs if using the chart's AgentGateway route resources.
- A production OpenFGA datastore, usually PostgreSQL, exposed through a Kubernetes Secret consumed by `openfga.datastore.uriSecretRef`.
- The OpenFGA model initialized by the `openfga-init` Helm hook.
- The OpenFGA bridge enabled as an internal service reachable by AgentGateway `ext_authz`.
- External Secrets Operator or pre-created Kubernetes Secrets for production secrets.
- A production Keycloak database. The current Keycloak subchart is dev-oriented: it runs `start-dev`, defaults to embedded H2, and does not yet expose secret-sourced database environment variables. For production, either harden this subchart first or use a platform-managed Keycloak installation with the same realm import and init job behavior.

## Install Keycloak

The current Keycloak subchart owns the realm import and post-install bootstrap jobs.

### What the Keycloak subchart does

The subchart:

- Renders `realm-config.json` into a ConfigMap.
- Starts Keycloak with `--import-realm`.
- Runs `init-token-exchange.sh` as a Helm `post-install,post-upgrade` hook when `tokenExchange.enabled=true`.
- Runs `init-idp.sh` as a Helm `post-install,post-upgrade` hook when `idp.enabled=true`.
- Reads admin, upstream IdP, and Slack bot client secrets from Kubernetes Secrets or External Secrets.

The init jobs call Keycloak through the in-cluster service URL, not through the public hostname. The public hostname is still required for browsers, OIDC issuer URLs, redirects, and JWKS consumers.

### Keycloak values

Create `values-keycloak-prod.yaml`. This example shows the target configuration, but production database password handling still requires chart hardening or a platform-managed Keycloak chart that supports secret-sourced database credentials. Do not put database passwords directly in Helm values.

```yaml
fullnameOverride: caipe-keycloak

realm:
  name: caipe
  sslRequired: external

demoUsers:
  # Keep false for shared/prod realms. Set true only for local RBAC matrix runs.
  enabled: false

# Optional explicit initial admins. These users receive Keycloak `admin` and
# `admin_user` roles when they already exist in the realm.
bootstrapAdminEmails: "admin@example.com"

env:
  KC_HOSTNAME: "https://idp.caipe.example.com"
  # Admin console and master realm stay private. Use kubectl port-forward to
  # localhost:18080 instead of exposing /admin on public ingress.
  KC_HOSTNAME_ADMIN: "http://localhost:18080"
  KC_HOSTNAME_STRICT: "true"
  KC_PROXY_HEADERS: "xforwarded"
  KC_HTTP_ENABLED: "true"
  KC_DB: "postgres"
  KC_DB_URL: "jdbc:postgresql://keycloak-postgres.example.internal:5432/keycloak"
  KC_DB_USERNAME: "keycloak"

admin:
  # Keeps the master-realm admin console usable through the private
  # port-forward URL while public ingress exposes only /realms/caipe.
  frontendUrl: "http://localhost:18080"
  externalSecret:
    enabled: true
    secretStoreRef:
      name: vault
      kind: ClusterSecretStore
    remoteRefs:
      username:
        key: secret/data/caipe/keycloak
        property: KEYCLOAK_ADMIN_USERNAME
      password:
        key: secret/data/caipe/keycloak
        property: KEYCLOAK_ADMIN_PASSWORD

idp:
  enabled: true
  alias: enterprise-sso
  displayName: "Enterprise SSO"
  issuer: "https://your-enterprise-idp.example.com"
  clientId: caipe
  # Optional group references only; Keycloak mirrors upstream groups into idp_groups.
  accessGroup: ""
  # Map your enterprise admin group to a CAIPE admin team through Identity Group Sync.
  adminGroup: ""
  # Default true: require the IdP redirector and disable local app-realm login.
  forceRedirect: true
  secretRef: caipe-keycloak-idp

tokenExchange:
  enabled: true
  botClientId: caipe-slack-bot
  secretRef: caipe-keycloak-bot

uiClient:
  redirectUris:
    - https://caipe.example.com/api/auth/callback/oidc
    - https://caipe.example.com/*
  webOrigins:
    - https://caipe.example.com
```

Create the referenced non-admin secrets out of band. The Keycloak admin Secret should come from your secret manager through `admin.externalSecret`, not a chart-generated password.

`demoUsers.enabled=false` prevents the chart from importing sample password users and keeps `init-idp.sh` from seeding spec test personas. This is the production default; enable it only in isolated local/CI environments that intentionally exercise the RBAC matrix personas.

`idp.forceRedirect=true` is also the production default when an external IdP is enabled. The init hook makes the `caipe` realm browser flow enterprise-IdP-only by requiring the Identity Provider Redirector and disabling the local Keycloak username/password form. The `master` realm admin login is unaffected and should remain private through `admin.frontendUrl`.

Set `bootstrapAdminEmails` only for explicit initial administrators, and mirror the same comma-separated value into the CAIPE UI `BOOTSTRAP_ADMIN_EMAILS` config if you need the UI fallback before enterprise group claims have propagated. For steady-state admin access, map your enterprise admin group to a CAIPE admin team through Identity Group Sync, then grant that team `admin` on `organization:<org>` in OpenFGA.

```bash
kubectl create namespace caipe --dry-run=client -o yaml | kubectl apply -f -

kubectl -n caipe create secret generic caipe-keycloak-idp \
  --from-literal=IDP_CLIENT_SECRET="${IDP_CLIENT_SECRET}"

kubectl -n caipe create secret generic caipe-keycloak-bot \
  --from-literal=KC_BOT_CLIENT_SECRET="$(openssl rand -hex 32)"
```

Enable Keycloak inside the umbrella release after confirming database credential handling is secure for your environment:

```yaml
tags:
  keycloak: true

keycloak:
  # Include the Keycloak values shown above.
```

```bash
helm upgrade --install caipe \
  ./charts/ai-platform-engineering \
  --namespace caipe \
  --values values-keycloak-prod.yaml
```

### Expose `idp.caipe.example.com`

The Keycloak subchart can render an Ingress through `keycloak.ingress`. Public ingress should expose only the application realm and static login assets. Keep `/admin` and `/realms/master` private behind the ClusterIP service for `kubectl port-forward` or private networking.

For nginx Ingress:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: caipe-keycloak
  namespace: caipe
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/backend-protocol: "HTTP"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - secretName: idp-caipe-example-com-tls
      hosts:
        - idp.caipe.example.com
  rules:
    - host: idp.caipe.example.com
      http:
        paths:
          - path: /realms/caipe
            pathType: Prefix
            backend:
              service:
                name: caipe-keycloak
                port:
                  number: 8080
          - path: /resources
            pathType: Prefix
            backend:
              service:
                name: caipe-keycloak
                port:
                  number: 8080
```

Use port-forward for Keycloak Admin Console or master realm operations. If public ingress blocks `/admin` and `/realms/master`, also set `keycloak.admin.frontendUrl` to the same private admin base URL so the admin console authenticates against the port-forwarded master realm instead of the public issuer hostname.

```bash
kubectl -n caipe port-forward svc/caipe-keycloak 18080:8080
# Open http://localhost:18080/admin/
```

After DNS and TLS are ready, verify:

```bash
curl -fsS https://idp.caipe.example.com/realms/caipe/.well-known/openid-configuration
curl -fsS https://idp.caipe.example.com/realms/caipe/protocol/openid-connect/certs
```

### Redirect URIs

The imported development realm contains localhost redirect URIs by default. For production, set `keycloak.uiClient.redirectUris` and `keycloak.uiClient.webOrigins` so the rendered `caipe-ui` client includes:

```text
https://caipe.example.com/*
```

Verify this after every new realm import because an existing Keycloak database will not re-import changed client settings automatically.

## Install OpenFGA and the Bridge

OpenFGA is the relationship PDP. It should be installed before CAIPE starts writing tuples.

Recommended production shape:

- OpenFGA server with PostgreSQL datastore.
- OpenFGA migration/init job.
- OpenFGA model loader using the model under `deploy/openfga`.
- OpenFGA bridge deployed as an internal service.
- Network policy allowing AgentGateway to call the bridge and the bridge to call OpenFGA.

Enable OpenFGA and the bridge through the umbrella chart:

```yaml
openfga:
  enabled: true
  datastore:
    engine: postgres
    uriSecretRef:
      name: caipe-openfga-datastore
      key: OPENFGA_DATASTORE_URI
  init:
    enabled: true
    storeName: caipe-openfga

openfgaAuthzBridge:
  enabled: true

openfga-authz-bridge:
  image:
    repository: ghcr.io/cnoe-io/openfga-authz-bridge
  openfga:
    httpUrl: "http://{{ .Release.Name }}-openfga:8080"
    storeName: caipe-openfga
  tokenValidation:
    jwksUrl: "http://{{ .Release.Name }}-keycloak:8080/realms/caipe/protocol/openid-connect/certs"
    issuer: "https://idp.caipe.example.com/realms/caipe"
    audiences:
      - agentgateway
      - caipe-platform
```

Do not expose OpenFGA publicly unless you have a separate gateway, authentication, rate limiting, and audit controls. CAIPE users do not need browser access to OpenFGA.

The bridge validates the bearer JWT itself before it calls OpenFGA. AgentGateway should still validate JWTs at the edge, but the bridge no longer trusts forwarded subject headers or gRPC metadata as the sole identity source.

## Install AgentGateway

Enable the standalone AgentGateway proxy and configure its JWT and OpenFGA `ext_authz` policy:

```yaml
agentgateway:
  enabled: true
  config:
    binds:
      - port: 4000
        listeners:
          - protocol: HTTP
            policies:
              jwtAuth:
                mode: strict
                issuer: https://idp.caipe.example.com/realms/caipe
                audiences: [caipe-platform, agentgateway]
                jwks:
                  url: http://caipe-keycloak:8080/realms/caipe/protocol/openid-connect/certs
            routes:
              - policies:
                  extAuthz:
                    host: caipe-openfga-authz-bridge:9100
                    failureMode:
                      denyWithStatus: 403
                    protocol:
                      grpc:
                        metadata:
                          caipe.auth: '{"sub": jwt.sub}'
                  authorization:
                    rules:
                      - allow: 'true'
                backends:
                  - mcp:
                      targets: []
```

If you use the Gateway API controller path instead of standalone config, enable `global.agentgateway.enabled=true`. The parent chart then renders:

- A `Gateway` using `gatewayClassName: agentgateway`.
- One `AgentgatewayBackend` per enabled MCP backend.
- One `HTTPRoute` per enabled MCP backend.
- An optional `AgentgatewayPolicy` when `global.agentgateway.extAuth.enabled=true`.

## Install Through `setup-caipe.sh`

For a development or release-smoke install of all chart-owned RBAC runtime components, use:

```bash
./setup-caipe.sh --non-interactive --rbac-runtime
```

This passes values equivalent to enabling `tags.keycloak`, `openfga.enabled`, `openfgaAuthzBridge.enabled`, and `agentgateway.enabled`, and it wires `caipe-ui.config.OPENFGA_*` plus `KEYCLOAK_*` service URLs to the in-cluster services. The script also port-forwards Keycloak, OpenFGA, and AgentGateway in interactive mode. Use a dedicated values file for production hostnames, Keycloak database settings, OpenFGA datastore settings, and secret references.

## Install CAIPE UI and Services

Create `values-caipe-prod.yaml` for the umbrella chart:

```yaml
caipe-ui:
  ingress:
    enabled: true
    className: nginx
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
      nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    hosts:
      - host: caipe.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: caipe-example-com-tls
        hosts:
          - caipe.example.com

  config:
    NEXTAUTH_URL: "https://caipe.example.com"
    SSO_ENABLED: "true"
    OIDC_REQUIRED_GROUP: "caipe-users"
    OIDC_REQUIRED_ADMIN_GROUP: ""
    OIDC_IDP_HINT: "enterprise-sso"
    IDENTITY_SYNC_LOGIN_CLAIMS_ENABLED: "true"
    IDENTITY_SYNC_OIDC_CLAIM_PROVIDER_ID: "enterprise-sso"
    ENABLE_USER_INFO_TOOL: "true"

  existingSecret: caipe-ui-secrets

global:
  agentgateway:
    enabled: true
    proxyPort: 8080
```

Create `caipe-ui-secrets` through your secret manager or CI pipeline. It should include at least:

```text
NEXTAUTH_SECRET
MONGODB_URI
OIDC_ISSUER=https://idp.caipe.example.com/realms/caipe
OIDC_CLIENT_ID=caipe-ui
OIDC_CLIENT_SECRET=<client-secret-from-keycloak>
OPENFGA_HTTP=<internal-openfga-api-url>
OPENFGA_STORE_NAME=caipe-openfga
OPENFGA_STORE_ID=<store-id>
OPENFGA_RECONCILE_ENABLED=true
```

Install or upgrade the umbrella chart:

```bash
helm dependency build ./charts/ai-platform-engineering

helm upgrade --install caipe \
  ./charts/ai-platform-engineering \
  --namespace caipe \
  --values values-caipe-prod.yaml
```

Verify:

```bash
kubectl -n caipe get pods
kubectl -n caipe get ingress
curl -fsS https://caipe.example.com/api/health
```

## Slack Bot OBO Configuration

The Slack bot and Keycloak must share the same `caipe-slack-bot` client secret. In production, use one Kubernetes Secret or one ExternalSecret as the source of truth:

```yaml
keycloak:
  tokenExchange:
    secretRef: caipe-keycloak-bot

slack-bot:
  oauth2:
    clientSecretFromSecret:
      name: caipe-keycloak-bot
      key: KC_BOT_CLIENT_SECRET
  config:
    SLACK_INTEGRATION_ENABLE_AUTH: "true"
    OAUTH2_TOKEN_URL: "https://idp.caipe.example.com/realms/caipe/protocol/openid-connect/token"
    OAUTH2_CLIENT_ID: "caipe-slack-bot"
```

The Keycloak `init-token-exchange` job writes the same secret into the Keycloak client, so the Slack bot and Keycloak stay aligned.

## Upgrade From Pre-Refactor Deployments

Use this order when upgrading an existing CAIPE deployment.

### 1. Snapshot current state

Back up:

- MongoDB collections that store teams, users, Slack routes, and ReBAC relationships.
- Existing Keycloak realm export.
- Existing AgentGateway configuration.
- OpenFGA datastore if already deployed.

### 2. Install or upgrade OpenFGA

Install OpenFGA and load the current authorization model before enabling tuple writes from the UI.

Verify the model and store:

```bash
curl -fsS "${OPENFGA_HTTP}/stores/${OPENFGA_STORE_ID}/authorization-models"
```

### 3. Install or upgrade Keycloak

Install the Keycloak subchart, confirm the realm imports, and confirm both init jobs complete:

```bash
kubectl -n caipe get jobs | grep keycloak
kubectl -n caipe logs job/caipe-keycloak-init-token-exchange
kubectl -n caipe logs job/caipe-keycloak-init-idp
```

Verify:

- `caipe-ui` exists as an OIDC client.
- Redirect URIs include `https://caipe.example.com/*`.
- `caipe-slack-bot` exists and token exchange is enabled.
- Realm roles include only coarse/bootstrap roles for new assignments.
- Resource-specific Keycloak roles are no longer used for new grants.

### 4. Upgrade CAIPE

Upgrade the umbrella chart with RBAC/OpenFGA values and UI OIDC values:

```bash
helm upgrade caipe \
  ./charts/ai-platform-engineering \
  --namespace caipe \
  --values values-caipe-prod.yaml
```

### 5. Backfill Mongo relationship records

Run the Universal ReBAC backfill after MongoDB is available. This creates the Mongo relationship and provenance records used by the Admin UI; OpenFGA tuple materialization happens through the OpenFGA reconciliation paths when relationship changes are applied.

```bash
MONGODB_URI="${MONGODB_URI}" \
MONGODB_DATABASE="${MONGODB_DATABASE}" \
APPLY=true \
npx ts-node -P tsconfig.scripts.json scripts/backfill-universal-rebac.ts
```

If your environment still has legacy team roles, reconcile them only as a compatibility step:

```bash
scripts/reconcile-keycloak-from-mongo.sh
```

Do not recreate resource-specific realm roles such as `agent_user:*`, `tool_user:*`, `kb_admin`, task grants, or skill grants. New resource access belongs in OpenFGA.

### 6. Cut over AgentGateway authorization

Remove CEL policy dependencies from AgentGateway config and route authorization through OpenFGA `ext_authz`.

Verify fail-closed behavior by temporarily denying a known tuple and confirming the MCP call returns `403`.

### 7. Remove bootstrap bypasses

After at least two real platform admins can log in through enterprise SSO:

- Remove `BOOTSTRAP_ADMIN_EMAILS`.
- Remove temporary local Keycloak users if not needed.
- Confirm team admins can manage only their scoped teams.
- Confirm OpenFGA graph and access checker show expected relationships.

## Rollback Notes

Rollback should keep data ownership clear:

- Rolling back CAIPE UI code does not remove OpenFGA tuples.
- Rolling back Keycloak does not restore resource-specific role mirroring.
- If you must revert AgentGateway authorization, keep the OpenFGA datastore intact and disable only the gateway route or `ext_authz` integration.
- Keep Keycloak realm and MongoDB backups from before the upgrade until tuple backfill and Slack OBO flows are verified.

## Verification Checklist

Run these checks before declaring the install production-ready:

- `https://caipe.example.com/api/health` returns `200`.
- `https://idp.caipe.example.com/realms/caipe/.well-known/openid-configuration` returns the production issuer.
- `NEXTAUTH_URL` exactly matches `https://caipe.example.com`.
- `OIDC_ISSUER` exactly matches `https://idp.caipe.example.com/realms/caipe`.
- Keycloak `caipe-ui` redirect URIs include `https://caipe.example.com/*`.
- Keycloak token exchange job completed successfully.
- OpenFGA HTTP URL, store name, and store ID are set in the UI and bridge environment.
- Team membership writes create OpenFGA `user:<sub> member team:<slug>` tuples.
- Team Resources writes base OpenFGA tuples such as `user`, `manager`, and `caller`; `can_use`, `can_manage`, and `can_call` are derived check relations only.
- AgentGateway validates JWTs from Keycloak JWKS.
- AgentGateway calls the OpenFGA bridge for MCP authorization.
- AgentGateway fails closed when the OpenFGA bridge is unavailable.
- Slack bot can exchange OBO tokens and route channel messages through OpenFGA channel-to-agent authorization.

## Chart Work Still Needed

To make this a true one-command Helm installation, add:

1. Keycloak dependency wiring in the umbrella chart or a documented release split with parent values removed.
2. Production Keycloak database secret wiring.
3. OpenFGA subchart or dependency with datastore settings.
4. OpenFGA model/init job.
5. OpenFGA bridge Deployment, Service, probes, and network policy.
6. AgentGateway controller/proxy dependency or explicit prerequisite documentation that points to the supported upstream chart.
7. AgentGateway `ext_authz` and JWT configuration templates tied to Keycloak/OpenFGA values.
8. End-to-end Helm smoke tests for login, tuple writes, Slack OBO, and MCP denial/allow checks.
