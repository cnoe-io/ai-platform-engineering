# Helm Installation and Upgrade Guide

**Audience:** platform engineers installing the RBAC/OpenFGA refactor on a real Kubernetes cluster.

This guide is intentionally candid about the current chart boundary. The RBAC refactor introduced Keycloak, AgentGateway, OpenFGA, and OpenFGA bridge responsibilities, but not every runtime is packaged by the umbrella Helm chart yet.

## Current Helm Packaging Status

| Component | Is it installed by the umbrella chart today? | What exists today |
|-----------|----------------------------------------------|-------------------|
| CAIPE UI | Yes | `charts/ai-platform-engineering/charts/caipe-ui` includes Deployment, Service, Ingress, ConfigMap, and secret wiring. |
| Slack bot | Yes | `charts/ai-platform-engineering/charts/slack-bot` includes Deployment and Slack/OBO configuration. |
| Keycloak | Not by the umbrella chart today | A Keycloak subchart exists at `charts/ai-platform-engineering/charts/keycloak`, but `charts/ai-platform-engineering/Chart.yaml` does not list it as a dependency. Install it as a separate release, or add dependency wiring before claiming umbrella-chart install support. |
| AgentGateway | Partially | The parent chart can render Gateway API resources in `templates/agentgateway-mcp.yaml`, but it does not install the AgentGateway controller/proxy workload. |
| OpenFGA | No | Docker Compose and deploy assets exist under `docker-compose.dev.yaml` and `deploy/openfga-experiment`, but there is no OpenFGA Helm subchart in this repo today. |
| OpenFGA bridge | No | The bridge implementation exists under `deploy/openfga-experiment/bridge`, but it is not charted today. |

Until the chart gap is closed, a production install has three layers:

1. Install external infrastructure: Gateway API CRDs, AgentGateway controller/proxy, OpenFGA, OpenFGA datastore, and OpenFGA bridge.
2. Install Keycloak using the Keycloak subchart as a separate release.
3. Install the CAIPE umbrella chart and point UI, Slack bot, dynamic agents, AgentGateway, and OpenFGA clients at those services.

## Recommended Public Hostnames

For an instance domain such as `grid.outshift.io`, use separate hostnames:

| Host | Audience | Recommended exposure |
|------|----------|----------------------|
| `grid.outshift.io` | End users | Public HTTPS Ingress for the CAIPE UI. |
| `idp.grid.outshift.io` | End users and services | Public HTTPS Ingress for Keycloak OIDC login, callbacks, JWKS, and token endpoints. |
| `agentgateway.grid.outshift.io` | Internal service callers or controlled clients | Prefer private or authenticated exposure. Do not expose the admin port publicly. |
| `openfga.grid.outshift.io` | Platform services only | Prefer private cluster/network exposure. Public exposure is not required for normal CAIPE users. |

End users should normally use `grid.outshift.io`. AgentGateway is the MCP data-plane policy enforcement point, not the primary user interface. If you expose any AgentGateway admin UI or Envoy admin port, put it behind admin SSO, network allow lists, and TLS; do not expose it as a general end-user surface.

## Prerequisites

Before installing the refactor, prepare:

- A Kubernetes namespace, for example `caipe`.
- DNS and TLS for `grid.outshift.io` and `idp.grid.outshift.io`.
- A trusted Ingress controller or Gateway API implementation.
- Gateway API CRDs if using the chart's AgentGateway route resources.
- AgentGateway controller/proxy installed by its upstream chart or platform-managed add-on.
- OpenFGA installed with a production datastore, usually PostgreSQL.
- OpenFGA model initialization using `deploy/openfga-experiment/model.fga` or the generated `authorization-model.json`.
- The OpenFGA bridge deployed as an internal service reachable by AgentGateway `ext_authz`.
- External Secrets Operator or pre-created Kubernetes Secrets for production secrets.
- A production Keycloak database. The current Keycloak subchart is dev-oriented: it runs `start-dev`, defaults to embedded H2, has no Ingress template, and does not yet expose secret-sourced database environment variables. For production, either harden this subchart first or use a platform-managed Keycloak installation with the same realm import and init job behavior.

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

env:
  KC_HOSTNAME: "https://idp.grid.outshift.io"
  KC_HOSTNAME_STRICT: "true"
  KC_PROXY_HEADERS: "xforwarded"
  KC_HTTP_ENABLED: "true"
  KC_DB: "postgres"
  KC_DB_URL: "jdbc:postgresql://keycloak-postgres.example.internal:5432/keycloak"
  KC_DB_USERNAME: "keycloak"

admin:
  secretRef: caipe-keycloak-admin

idp:
  enabled: true
  alias: enterprise-sso
  displayName: "Enterprise SSO"
  issuer: "https://your-enterprise-idp.example.com"
  clientId: caipe
  accessGroup: caipe-users
  adminGroup: caipe-admins
  secretRef: caipe-keycloak-idp

tokenExchange:
  enabled: true
  botClientId: caipe-slack-bot
  secretRef: caipe-keycloak-bot
```

Create the referenced secrets out of band:

```bash
kubectl create namespace caipe --dry-run=client -o yaml | kubectl apply -f -

kubectl -n caipe create secret generic caipe-keycloak-admin \
  --from-literal=username=admin \
  --from-literal=password="$(openssl rand -hex 32)"

kubectl -n caipe create secret generic caipe-keycloak-idp \
  --from-literal=IDP_CLIENT_SECRET="${IDP_CLIENT_SECRET}"

kubectl -n caipe create secret generic caipe-keycloak-bot \
  --from-literal=KC_BOT_CLIENT_SECRET="$(openssl rand -hex 32)"
```

Install Keycloak as its own release after confirming database credential handling is secure for your environment:

```bash
helm upgrade --install caipe-keycloak \
  ./charts/ai-platform-engineering/charts/keycloak \
  --namespace caipe \
  --values values-keycloak-prod.yaml
```

### Expose `idp.grid.outshift.io`

The Keycloak subchart does not currently render an Ingress. Create one with your cluster's Ingress or Gateway standard. For nginx Ingress:

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
    - secretName: idp-grid-outshift-io-tls
      hosts:
        - idp.grid.outshift.io
  rules:
    - host: idp.grid.outshift.io
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: caipe-keycloak
                port:
                  number: 8080
```

After DNS and TLS are ready, verify:

```bash
curl -fsS https://idp.grid.outshift.io/realms/caipe/.well-known/openid-configuration
curl -fsS https://idp.grid.outshift.io/realms/caipe/protocol/openid-connect/certs
```

### Redirect URIs

The imported development realm contains localhost redirect URIs. For production, update the `caipe-ui` client in Keycloak so redirects and web origins include:

```text
https://grid.outshift.io/*
```

The clean long-term fix is to template production redirect URIs in the Keycloak chart or add a post-install job parameter for UI hostnames. Until that exists, make this part of the install runbook and verify it after every new realm import.

## Install OpenFGA and the Bridge

OpenFGA is the relationship PDP. It should be installed before CAIPE starts writing tuples.

Recommended production shape:

- OpenFGA server with PostgreSQL datastore.
- OpenFGA migration/init job.
- OpenFGA model loader using the model under `deploy/openfga-experiment`.
- OpenFGA bridge deployed as an internal service.
- Network policy allowing AgentGateway to call the bridge and the bridge to call OpenFGA.

Example values depend on the upstream OpenFGA chart you choose. At minimum, record these outputs for the CAIPE install:

```text
OPENFGA_HTTP=http://openfga.openfga.svc.cluster.local:8080
OPENFGA_STORE_NAME=caipe-openfga
OPENFGA_STORE_ID=<store-id-from-init-job>
OPENFGA_BRIDGE_GRPC_URL=openfga-authz-bridge.caipe.svc.cluster.local:9100
```

Do not expose OpenFGA publicly unless you have a separate gateway, authentication, rate limiting, and audit controls. CAIPE users do not need browser access to OpenFGA.

## Install AgentGateway

The CAIPE chart currently assumes the AgentGateway controller and Gateway API CRDs already exist.

Install prerequisites first:

```bash
kubectl get crd gateways.gateway.networking.k8s.io
kubectl get gatewayclass agentgateway
```

Enable AgentGateway routes in CAIPE values only after the controller exists:

```yaml
global:
  agentgateway:
    enabled: true
    proxyPort: 8080

agent-jira:
  mcp:
    agentgateway:
      enabled: true

agent-github:
  mcp:
    agentgateway:
      enabled: true
```

The parent chart then renders:

- A `Gateway` using `gatewayClassName: agentgateway`.
- One `AgentgatewayBackend` per enabled MCP backend.
- One `HTTPRoute` per enabled MCP backend.

The chart does not currently render the AgentGateway proxy Deployment, Service, OpenFGA `ext_authz` config, or admin exposure. Configure those in the platform-managed AgentGateway install. Point its `ext_authz` cluster at the OpenFGA bridge and configure JWT validation against:

```text
issuer: https://idp.grid.outshift.io/realms/caipe
jwks:   https://idp.grid.outshift.io/realms/caipe/protocol/openid-connect/certs
```

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
      - host: grid.outshift.io
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: grid-outshift-io-tls
        hosts:
          - grid.outshift.io

  config:
    NEXTAUTH_URL: "https://grid.outshift.io"
    SSO_ENABLED: "true"
    OIDC_REQUIRED_GROUP: "caipe-users"
    OIDC_REQUIRED_ADMIN_GROUP: "caipe-admins"
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
OIDC_ISSUER=https://idp.grid.outshift.io/realms/caipe
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
curl -fsS https://grid.outshift.io/api/health
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
    OAUTH2_TOKEN_URL: "https://idp.grid.outshift.io/realms/caipe/protocol/openid-connect/token"
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
- Redirect URIs include `https://grid.outshift.io/*`.
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

- `https://grid.outshift.io/api/health` returns `200`.
- `https://idp.grid.outshift.io/realms/caipe/.well-known/openid-configuration` returns the production issuer.
- `NEXTAUTH_URL` exactly matches `https://grid.outshift.io`.
- `OIDC_ISSUER` exactly matches `https://idp.grid.outshift.io/realms/caipe`.
- Keycloak `caipe-ui` redirect URIs include `https://grid.outshift.io/*`.
- Keycloak token exchange job completed successfully.
- OpenFGA HTTP URL, store name, and store ID are set in the UI and bridge environment.
- Team membership writes create OpenFGA `user:<sub> member team:<slug>` tuples.
- Team Resources writes OpenFGA `can_use`, `can_manage`, and `can_call` tuples.
- AgentGateway validates JWTs from Keycloak JWKS.
- AgentGateway calls the OpenFGA bridge for MCP authorization.
- AgentGateway fails closed when the OpenFGA bridge is unavailable.
- Slack bot can exchange OBO tokens and route channel messages through OpenFGA channel-to-agent authorization.

## Chart Work Still Needed

To make this a true one-command Helm installation, add:

1. Keycloak dependency wiring in the umbrella chart or a documented release split with parent values removed.
2. Keycloak Ingress/Gateway templates and production redirect URI values.
3. OpenFGA subchart or dependency with datastore settings.
4. OpenFGA model/init job.
5. OpenFGA bridge Deployment, Service, probes, and network policy.
6. AgentGateway controller/proxy dependency or explicit prerequisite documentation that points to the supported upstream chart.
7. AgentGateway `ext_authz` and JWT configuration templates tied to Keycloak/OpenFGA values.
8. End-to-end Helm smoke tests for login, tuple writes, Slack OBO, and MCP denial/allow checks.
