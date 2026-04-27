# Secret bootstrap: dev, K8s Secrets, and External Secrets Operator (ESO)

> **Audience:** platform engineers installing CAIPE with Helm. If you're
> running `docker-compose.dev.yaml` you can skip this — the `.env` file
> already covers everything.

The Keycloak subchart needs **three** secrets to bootstrap a clean
realm:

| Secret (in cluster)               | Keys                          | Used by                                                           |
| --------------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| `<release>-keycloak-admin`        | `username`, `password`        | both init Jobs (Keycloak Admin REST API)                          |
| `<release>-keycloak-idp`          | `IDP_CLIENT_SECRET`           | `init-idp` Job (configures upstream IdP broker, e.g. Okta/Duo)    |
| `<release>-keycloak-bot`          | `KC_BOT_CLIENT_SECRET`        | `init-token-exchange` Job **and** the `slack-bot` deployment      |

There are **three install paths** — pick the one that matches your
environment. All three use the *same* helm chart; they differ only in
how the underlying K8s Secrets are produced.

```
┌──────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐
│  (1) DEV     │  │  (2) PROD with K8s Secrets│  │  (3) PROD with ESO       │
│              │  │                          │  │                          │
│ helm-managed │  │ kubectl create secret …  │  │ ExternalSecret pulls from│
│ random pwds  │  │ then point chart at them │  │ Vault/AWS-SM/GCP-SM/…   │
│              │  │                          │  │                          │
│ NO external  │  │ NO external dependency   │  │ ESO controller required  │
│ dependency   │  │                          │  │ + your secrets backend   │
└──────────────┘  └──────────────────────────┘  └──────────────────────────┘
```

---

## Path 1 — DEV (helm-managed random passwords)

Best for sandbox/PoC clusters. **Do not use in production.**

```yaml
# values.yaml
keycloak:
  admin:
    username: admin
    # password: ""    # leave empty → 32-char random, kept across upgrades
  idp:
    enabled: false    # local Keycloak users only — no upstream IdP
  tokenExchange:
    enabled: true
    # botClientSecret: ""  # leave empty → 32-char random
```

```bash
helm install caipe ./charts/ai-platform-engineering -n caipe --create-namespace
```

The chart will:

1. Generate `caipe-keycloak-admin` Secret with `admin` / random 32-char pw.
2. Generate `caipe-keycloak-bot` Secret with `KC_BOT_CLIENT_SECRET` = random 32-char.
3. Run `init-token-exchange` Job which **PUTs that secret to Keycloak**, so
   the slack-bot pod and the Keycloak `caipe-slack-bot` client share one
   value end-to-end.

To grab the admin password later:

```bash
kubectl get secret caipe-keycloak-admin -n caipe -o jsonpath='{.data.password}' | base64 -d
```

> **Why `helm.sh/resource-policy: keep`?** Both auto-generated Secrets
> have this annotation so they survive `helm uninstall` — and the
> *random* password isn't re-rolled on every `helm upgrade` (which
> would lock the cluster out of Keycloak). To actually rotate, delete
> the Secret manually, then re-run `helm upgrade`.

---

## Path 2 — PROD with manually-managed K8s Secrets

Best when you have a Secret-injection sidecar (Vault Agent, csi-secrets-store)
or just a CI pipeline that `kubectl apply`s Secrets out-of-band.

### Step 1: create the Secrets

```bash
kubectl -n caipe create secret generic caipe-keycloak-admin \
  --from-literal=username=admin \
  --from-literal=password="$(openssl rand -hex 32)"

# Only if upstream IdP enabled
kubectl -n caipe create secret generic caipe-keycloak-idp \
  --from-literal=IDP_CLIENT_SECRET="<value-from-okta-app>"

kubectl -n caipe create secret generic caipe-keycloak-bot \
  --from-literal=KC_BOT_CLIENT_SECRET="$(openssl rand -hex 32)"
```

### Step 2: point the chart at them

```yaml
keycloak:
  admin:
    secretRef: caipe-keycloak-admin       # chart will NOT create one
  idp:
    enabled: true
    alias: okta
    displayName: "Okta SSO"
    issuer: "https://example.okta.com"
    clientId: caipe-okta
    accessGroup: caipe-users
    adminGroup: caipe-admins
    secretRef: caipe-keycloak-idp
  tokenExchange:
    enabled: true
    secretRef: caipe-keycloak-bot

# Wire slack-bot to the SAME bot Secret — single source of truth.
slack-bot:
  oauth2:
    clientSecretFromSecret:
      name: caipe-keycloak-bot
      key: KC_BOT_CLIENT_SECRET
```

```bash
helm install caipe ./charts/ai-platform-engineering -n caipe -f values.yaml
```

---

## Path 3 — PROD with External Secrets Operator (ESO)

Best when secrets live in **Vault / AWS Secrets Manager / GCP Secret
Manager / Azure Key Vault**, etc. and you want the chart itself to
reconcile them into K8s without anyone running `kubectl create secret`.

### Prerequisites

* [external-secrets-operator](https://external-secrets.io/) installed
  in the cluster.
* A `ClusterSecretStore` (or `SecretStore`) configured for your backend.
  Examples below assume a store named `vault-backend`. You can verify
  with:

  ```bash
  kubectl get clustersecretstore vault-backend -o yaml
  ```

### values.yaml

```yaml
keycloak:
  externalSecretsApiVersion: v1beta1   # bump when ESO promotes to v1

  admin:
    username: admin                     # username is non-sensitive — OK in values
    externalSecret:
      enabled: true
      refreshInterval: "1h"
      secretStoreRef:
        name: vault-backend
        kind: ClusterSecretStore
      remoteRefs:
        username:
          key: secret/data/prod/keycloak
          property: admin_username
        password:
          key: secret/data/prod/keycloak
          property: admin_password

  idp:
    enabled: true
    alias: okta
    displayName: "Okta SSO"
    issuer: "https://example.okta.com"
    clientId: caipe-okta
    accessGroup: caipe-users
    adminGroup: caipe-admins
    externalSecret:
      enabled: true
      secretStoreRef:
        name: vault-backend
        kind: ClusterSecretStore
      remoteRef:
        key: secret/data/prod/keycloak
        property: idp_client_secret

  tokenExchange:
    enabled: true
    externalSecret:
      enabled: true
      secretStoreRef:
        name: vault-backend
        kind: ClusterSecretStore
      remoteRef:
        key: secret/data/prod/keycloak
        property: bot_client_secret

# Single source of truth: slack-bot pulls OAUTH2_CLIENT_SECRET from
# the SAME ESO-managed Secret that init-token-exchange wrote into Keycloak.
slack-bot:
  oauth2:
    clientSecretFromSecret:
      name: caipe-keycloak-bot
      key: KC_BOT_CLIENT_SECRET
```

### Install

```bash
helm install caipe ./charts/ai-platform-engineering -n caipe -f values.yaml
```

ESO will:

1. See the three `ExternalSecret` CRs the chart emits.
2. Reconcile each into a K8s Secret with the right name & keys.
3. The init Jobs (helm post-install hooks) wait for the Secrets and then
   run — `init-token-exchange.sh` PUTs `KC_BOT_CLIENT_SECRET` to
   Keycloak so the value lives in **exactly one place**: your secrets
   backend.

### Rotation

```bash
# In Vault:
vault kv put secret/prod/keycloak \
  bot_client_secret="$(openssl rand -hex 32)"

# Within `refreshInterval` (1h above), ESO updates the K8s Secret.
# Then trigger init-token-exchange to push the new value to Keycloak:
helm upgrade caipe ./charts/ai-platform-engineering -n caipe -f values.yaml
# (or `kubectl create job --from=cronjob/...` if you've cronified the Job)

# Bot pods need to be restarted to pick up the new env var.
# Add stakater/Reloader annotations to the slack-bot deployment if you
# want this fully automatic on Secret change.
```

---

## Reference: which template owns which Secret?

```
charts/ai-platform-engineering/charts/keycloak/templates/
├── secret.yaml                  # admin Secret (literal) — only when no secretRef AND no ESO
├── external-secret.yaml         # admin ExternalSecret  — when admin.externalSecret.enabled
│                                #                          OR legacy externalSecrets.enabled
├── idp-external-secret.yaml     # idp ExternalSecret    — when idp.externalSecret.enabled
├── bot-secret.yaml              # bot Secret (random)   — when no secretRef AND no ESO
├── bot-external-secret.yaml     # bot ExternalSecret    — when tokenExchange.externalSecret.enabled
├── job-init-idp.yaml            # consumes admin + (optional) idp Secret
└── job-init-token-exchange.yaml # consumes admin + (optional) bot Secret; PUTs bot secret to Keycloak
```

The `_helpers.tpl` defines `keycloak.adminSecretName`, `keycloak.idpSecretName`,
and `keycloak.botSecretName` — all three honor the `*.secretRef` override
so an external Secret name flows through all consumers without duplication.

## What is NOT covered here

* **Realm-import secrets** baked into the realm JSON — these are
  consumed before the init Jobs run, so they live in a ConfigMap. If
  you need to inject sensitive values into the realm itself (e.g.
  pre-seeded service-account credentials), use a Vault Sidecar +
  `kubectl create configmap --from-file=…` workflow instead.
* **MongoDB and other downstream component creds** — see those
  subcharts' own `values.yaml`. They follow the same pattern
  (`existingSecret` + `externalSecrets.enabled`).
* **OIDC IdP-side configuration** (creating the OIDC client app in
  Okta/Duo/etc.) — that's owned by your IdP admin. CAIPE only consumes
  the resulting `client_id` + `client_secret`.
