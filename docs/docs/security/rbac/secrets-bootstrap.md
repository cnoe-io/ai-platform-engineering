# Secret bootstrap: dev, K8s Secrets, and External Secrets Operator (ESO)

> **Audience:** platform engineers installing CAIPE with Helm. If you're
> running `docker-compose.dev.yaml` you can skip this — the `.env` file
> already covers everything.

For the full RBAC/OpenFGA Kubernetes install and upgrade sequence, including
which services are charted today and which services remain external
prerequisites, start with the
[Helm installation and upgrade guide](./helm-install-upgrade.md).

The Keycloak subchart needs **five** secrets to bootstrap a clean
realm:

| Secret (in cluster)                  | Keys                          | Used by                                                                            |
| ------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------- |
| `<release>-keycloak-admin`           | `username`, `password`        | both init Jobs (Keycloak Admin REST API)                                           |
| `<release>-keycloak-idp`             | `IDP_CLIENT_SECRET`           | `init-idp` Job (configures upstream IdP broker, e.g. Okta/Duo)                     |
| `<release>-keycloak-ui-client`       | `OIDC_CLIENT_SECRET`          | `init-idp` / auth reconcile Jobs (reconciles Keycloak `caipe-ui`)                  |
| `<release>-keycloak-platform-client` | `OIDC_CLIENT_SECRET`          | `init-idp` / auth reconcile Jobs (reconciles Keycloak `caipe-platform` supervisor) |
| `<release>-keycloak-bot`             | `KC_BOT_CLIENT_SECRET`        | `init-token-exchange` Job **and** the `slack-bot` deployment                       |

> **What is `caipe-platform`?** It's the confidential OIDC client the
> **supervisor** uses for two flows: (1) `client_credentials` tokens for
> internal service-to-service calls, and (2) the **target audience** for
> on-behalf-of token-exchange from the bots. The realm import ships a
> dev placeholder (`caipe-platform-dev-secret`) so first-boot import works
> without external state — but that placeholder is plaintext-visible in
> the rendered realm ConfigMap and **must be replaced for any deployment
> that is not local dev/CI**. See [Migrating from the dev placeholder
> (`caipe-platform`)](#migrating-from-the-dev-placeholder-caipe-platform)
> below.

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

1. Require a stable Keycloak admin Secret source (`admin.password`,
   `admin.secretRef`, or `admin.externalSecret`). The chart no longer generates
   random admin passwords because Keycloak stores the bootstrap password hash in
   its database.
2. Generate `caipe-keycloak-bot` Secret with `KC_BOT_CLIENT_SECRET` = random 32-char.
3. Run `init-token-exchange` Job which **PUTs that secret to Keycloak**, so
   the slack-bot pod and the Keycloak `caipe-slack-bot` client share one
   value end-to-end.

For disposable dev installs, set `keycloak.admin.password` explicitly and store
it somewhere recoverable. For shared environments, prefer `admin.secretRef` or
`admin.externalSecret`.

To read a manually-managed admin password later:

```bash
kubectl get secret caipe-keycloak-admin -n caipe -o jsonpath='{.data.password}' | base64 -d
```

> **Why no generated admin password?** Keycloak consumes the admin password only
> when bootstrapping the initial user. Later upgrades must keep the Kubernetes
> Secret aligned with the password hash in Keycloak's database, or init jobs will
> receive `401` from the master realm.

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

kubectl -n caipe create secret generic caipe-keycloak-ui-client \
  --from-literal=OIDC_CLIENT_SECRET="<same-secret-used-by-caipe-ui>"

kubectl -n caipe create secret generic caipe-keycloak-platform-client \
  --from-literal=OIDC_CLIENT_SECRET="$(openssl rand -hex 32)"

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
    accessGroup: ""
    adminGroup: ""
    secretRef: caipe-keycloak-idp
  uiClient:
    secretRef: caipe-keycloak-ui-client
  platformClient:
    secretRef: caipe-keycloak-platform-client
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
    accessGroup: ""
    adminGroup: ""
    externalSecret:
      enabled: true
      secretStoreRef:
        name: vault-backend
        kind: ClusterSecretStore
      remoteRef:
        key: secret/data/prod/keycloak
        property: idp_client_secret

  uiClient:
    externalSecret:
      enabled: true
      secretStoreRef:
        name: vault-backend
        kind: ClusterSecretStore
      remoteRef:
        key: secret/data/prod/caipe-ui
        property: oidc_client_secret

  platformClient:
    externalSecret:
      enabled: true
      secretStoreRef:
        name: vault-backend
        kind: ClusterSecretStore
      remoteRef:
        key: secret/data/prod/caipe-platform
        property: oidc_client_secret

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
├── secret.yaml                          # admin Secret (literal) — only when no secretRef AND no ESO
├── external-secret.yaml                 # admin ExternalSecret  — when admin.externalSecret.enabled
│                                        #                          OR legacy externalSecrets.enabled
├── idp-external-secret.yaml             # idp ExternalSecret    — when idp.externalSecret.enabled
├── ui-client-external-secret.yaml       # caipe-ui ExternalSecret  — when uiClient.externalSecret.enabled
├── platform-client-external-secret.yaml # caipe-platform ExternalSecret — when platformClient.externalSecret.enabled
├── bot-secret.yaml                      # bot Secret (random)   — when no secretRef AND no ESO
├── bot-external-secret.yaml             # bot ExternalSecret    — when tokenExchange.externalSecret.enabled
├── job-init-idp.yaml                    # consumes admin + (optional) idp/ui/platform Secrets
├── job-auth-reconcile.yaml              # PreSync/post-install reconcile — same env vars as init-idp
└── job-init-token-exchange.yaml         # consumes admin + (optional) bot Secret; PUTs bot secret to Keycloak
```

The `_helpers.tpl` defines `keycloak.adminSecretName`, `keycloak.idpSecretName`,
`keycloak.uiClientSecretName`, `keycloak.platformClientSecretName`, and
`keycloak.botSecretName` — all five honor their `*.secretRef` override so an
external Secret name flows through all consumers without duplication.

## Migrating from the dev placeholder (`caipe-platform`) {#migrating-from-the-dev-placeholder-caipe-platform}

The `caipe-platform` confidential client in `realm-config.json` ships with
the literal placeholder `caipe-platform-dev-secret`. That value was — and
still is, for local dev — perfectly fine: docker-compose stacks rely on
it, the integration test matrix relies on it, and Helm's first-boot import
needs *something* in the realm JSON for the client to be created.

In production, however, the rendered realm ConfigMap is plaintext. Anyone
with `kubectl get cm -o yaml` permission in the Keycloak namespace can
read the dev secret and mint `client_credentials` tokens for the
supervisor's audience — exactly the same risk class we already mitigated
for `caipe-ui` and the bot OBO clients.

The `init-idp` (post-install) and `auth-reconcile` (PreSync) Jobs now
re-read `KEYCLOAK_PLATFORM_CLIENT_SECRET` on every run and `PUT` it to
the `caipe-platform` client via the Admin API, so the real secret never
lives in a ConfigMap. The script behaves exactly like the existing
`caipe-ui` reconciliation:

* env var **unset** → no change, dev placeholder stays in place (current
  behaviour);
* env var **set** → reconciles on every Job run, idempotent against the
  same value, transparent rotation on change.

### Existing installs

Pick one of the two paths below. Both produce the same end-state and can
be rolled out without downtime — the supervisor reads the secret from a
mounted Secret, not from Keycloak, so the cutover is just:

1. Decide the new secret value (or reuse what your existing supervisor
   pod is already configured with — see *Pre-flight* below).
2. Make sure the supervisor's `KEYCLOAK_CLIENT_SECRET` and the new
   Keycloak Secret hold the **same** value.
3. `helm upgrade` — `auth-reconcile` runs first (PreSync) and pushes
   the value into Keycloak.
4. The placeholder in the realm ConfigMap becomes inert (Keycloak only
   reads the realm import on a fresh database).

#### Pre-flight: what secret is the supervisor currently using?

If your supervisor is running, check what it thinks the client_secret is.
The simplest, safest check is:

```bash
# Resolve via whatever variable / secret the supervisor reads.
# In the default chart, that's KEYCLOAK_CLIENT_SECRET on the
# supervisor (caipe-platform) deployment.
kubectl -n caipe get deploy ai-platform-engineering-supervisor \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="KEYCLOAK_CLIENT_SECRET")]}'
```

If the result references `caipe-platform-dev-secret`, you are running
on the placeholder today — start from a fresh random value below.
Otherwise reuse the existing value so no other pod restarts are needed.

#### Path A — manually managed K8s Secret

```bash
# 1. Pick (or reuse) the real client secret.
PLATFORM_CLIENT_SECRET="$(openssl rand -hex 32)"   # or: existing value

# 2. Create the K8s Secret the init Jobs will read.
kubectl -n caipe create secret generic caipe-keycloak-platform-client \
  --from-literal=OIDC_CLIENT_SECRET="${PLATFORM_CLIENT_SECRET}"

# 3. (If different) update the supervisor's own client_secret source
#    to the SAME value, so no pod is mismatched after step 4.
#    e.g. if the supervisor reads from caipe-platform-secret:
kubectl -n caipe create secret generic caipe-platform-secret \
  --from-literal=KEYCLOAK_CLIENT_SECRET="${PLATFORM_CLIENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -
```

Add to your values.yaml:

```yaml
keycloak:
  platformClient:
    secretRef: caipe-keycloak-platform-client
```

Run the upgrade:

```bash
helm upgrade caipe ./charts/ai-platform-engineering -n caipe -f values.yaml
```

The `auth-reconcile` Job logs

```
[init-idp] Reconciling client_secret on 'caipe-platform' from KEYCLOAK_PLATFORM_CLIENT_SECRET ...
[init-idp]   caipe-platform client_secret reconciled.
```

If you see `KEYCLOAK_PLATFORM_CLIENT_SECRET not set — leaving caipe-platform
client_secret unchanged`, the env var did not propagate — check
`platformClient.secretRef` or `platformClient.externalSecret.enabled` is set,
re-render with `helm template … | grep KEYCLOAK_PLATFORM_CLIENT_SECRET`, and
confirm the Secret exists in the same namespace as the Job.

#### Path B — External Secrets Operator

Store the value in your secrets backend (Vault / AWS-SM / GCP-SM / Azure
Key Vault), then enable the chart-emitted ExternalSecret:

```yaml
keycloak:
  platformClient:
    externalSecret:
      enabled: true
      secretStoreRef:
        name: vault-backend
        kind: ClusterSecretStore
      remoteRef:
        key: secret/data/prod/caipe-platform
        property: oidc_client_secret
```

ESO reconciles `<release>-keycloak-platform-client` from the backend; the
init Jobs read it and push it to Keycloak on the next `helm upgrade` /
ArgoCD sync.

### New installs

Just include `platformClient.secretRef` (or `platformClient.externalSecret`)
from day one — the dev placeholder will be overwritten on the very first
`init-idp` Job, before any supervisor pod has ever produced a token.

### Rotation

```bash
# 1. Write the new value into Vault (or whichever backend).
vault kv put secret/prod/caipe-platform oidc_client_secret="$(openssl rand -hex 32)"

# 2. Within ESO's refreshInterval the K8s Secret is updated.

# 3. Re-run init-idp / auth-reconcile so Keycloak picks up the new value.
helm upgrade caipe ./charts/ai-platform-engineering -n caipe -f values.yaml

# 4. Restart the supervisor pod so it reads the new value (or use
#    stakater/Reloader on the supervisor deployment for hands-off rotation).
kubectl -n caipe rollout restart deploy/ai-platform-engineering-supervisor
```

The order matters: **always rotate Keycloak first**, then the consumer.
The init Job's PUT is atomic from the Admin API's perspective; in-flight
tokens issued under the previous secret remain valid until expiry.

### Verifying the reconcile path locally

A throwaway end-to-end test ships in the repo. It boots Keycloak 26.3 in
Docker, imports the chart's `realm-config.json`, runs `init-idp.sh` with
and without `KEYCLOAK_PLATFORM_CLIENT_SECRET` set, and asserts that:

* the dev placeholder is in place after import,
* the env-unset path is a no-op,
* the env-set path reconciles, is idempotent, and the new secret mints
  `client_credentials` tokens,
* the **old placeholder is rejected** after rotation (no leftover
  acceptance of the dev value).

```bash
# Default port is 18080; override if it clashes with your local stack:
make test-keycloak-reconcile                      # uses port 28080
KC_PORT=29080 make test-keycloak-reconcile        # custom port
KEEP=1 KC_PORT=29080 ./tests/integration/test_keycloak_platform_client_reconcile.sh
# (KEEP=1 leaves the Keycloak container running for manual poking)
```

Runs in ~16 seconds on a warm cache. Wired into CI via
`.github/workflows/ci-keycloak-init.yml` (`reconcile-test` job) and blocks
the release-notification path so a broken reconcile fails the build.

### Rollback

If anything goes wrong you can fall back to the dev placeholder without
re-deploying Keycloak:

```bash
# Roll back the chart values to remove platformClient.secretRef /
# externalSecret, then run init-idp by hand:
KC_TOKEN=$(curl -sf -X POST "$KC_URL/realms/master/protocol/openid-connect/token" \
  -d "grant_type=password&client_id=admin-cli&username=admin&password=$ADMIN_PWD" \
  | jq -r .access_token)

CLIENT_UUID=$(curl -sf -H "Authorization: Bearer $KC_TOKEN" \
  "$KC_URL/admin/realms/caipe/clients?clientId=caipe-platform" | jq -r '.[0].id')

curl -sf -X PUT \
  -H "Authorization: Bearer $KC_TOKEN" \
  -H "Content-Type: application/json" \
  "$KC_URL/admin/realms/caipe/clients/$CLIENT_UUID" \
  -d '{"clientId":"caipe-platform","secret":"caipe-platform-dev-secret"}'
```

(This is exactly what `init-idp.sh` does when
`KEYCLOAK_PLATFORM_CLIENT_SECRET` is empty and the realm has just been
freshly imported.)

---

## Production hardening — strict client-secret mode

> **TL;DR:** Set `keycloak.strictClientSecrets: true` in your production
> values. The init Jobs will then **fail loudly** if Keycloak still
> accepts any of the four dev placeholder client_secrets, instead of
> silently leaving them live.

The realm import in `charts/.../keycloak/realm-config.json` ships four
confidential clients with dev-only placeholder secrets so the realm can
import cleanly on first boot:

| Client            | Placeholder secret              | Reconciled by                | Real source              |
| ----------------- | ------------------------------- | ---------------------------- | ------------------------ |
| `caipe-ui`        | `caipe-ui-dev-secret`           | `init-idp.sh`                | `uiClient.*`             |
| `caipe-platform`  | `caipe-platform-dev-secret`     | `init-idp.sh`                | `platformClient.*`       |
| `caipe-slack-bot` | `caipe-slack-bot-dev-secret`    | `init-token-exchange.sh`     | `tokenExchange.*`        |
| `caipe-webex-bot` | `caipe-webex-bot-dev-secret`    | `init-token-exchange.sh`     | `webexTokenExchange.*`   |

Each reconciliation helper is opt-in: it only PUTs a new value to
Keycloak when the matching env var is present in the Job. If an operator
forgets to set the matching `secretRef` / `externalSecret`, the
reconciliation silently logs "leaving … unchanged" — and Keycloak
**keeps accepting the dev placeholder forever**.

### What strict mode does

`strictClientSecrets: true` adds a final guard to each init script:

* `init-idp.sh` issues a `client_credentials` request to Keycloak using
  the dev placeholders for `caipe-ui` and `caipe-platform`.
* `init-token-exchange.sh` does the same for `caipe-slack-bot` and
  `caipe-webex-bot`.

If Keycloak returns an `access_token` for any of them, the Job logs:

```
[init-idp]   ERROR: Keycloak still accepts the dev placeholder client_secret for 'caipe-ui'.
[init-idp]          Set the matching secretRef or externalSecret for this client and retry.
[init-idp] Strict mode FAILED: 1 client(s) still accept dev placeholder secrets.
```

…and exits non-zero, which fails the Helm install / GitOps sync. The
operator has to fix the missing `secretRef` / `externalSecret` and
re-sync before the realm becomes usable.

### Enabling it

Append to your prod values:

```yaml
keycloak:
  strictClientSecrets: true
  # Must also set ALL FOUR client_secret sources or strict mode will fail.
  uiClient:
    secretRef: caipe-keycloak-ui-client       # or .externalSecret
  platformClient:
    secretRef: caipe-keycloak-platform-client # or .externalSecret
  tokenExchange:
    secretRef: caipe-keycloak-bot             # or .externalSecret
  webexTokenExchange:
    secretRef: caipe-keycloak-webex-bot       # or .externalSecret
```

The default is `false` to keep the `docker-compose.dev.yaml` flow and
the CI matrix runs (which intentionally use placeholders) working
unchanged. Turn it on **only** for production / customer-facing
clusters.

### Verifying strict mode locally

A second end-to-end integration test ships in the repo,
`tests/integration/test_keycloak_strict_client_secrets.sh`. It boots a
throwaway Keycloak, sanity-checks that all four placeholders are
initially accepted, then exercises both the failure path (strict mode
without rotation env vars) and the success path (rotation + strict mode
passes). Final step asserts **all four placeholders are rejected**
after the full reconcile.

```bash
make test-keycloak-strict-secrets
# or, with a custom port:
KC_PORT=29080 ./tests/integration/test_keycloak_strict_client_secrets.sh
```

Runs in ~16 seconds on a warm cache. Wired into CI via the same
`.github/workflows/ci-keycloak-init.yml` workflow as the platform
reconcile test, and blocks the release-notification path.

### Recommended adoption order

1. Adopt `secretRef` / `externalSecret` for one client at a time, with
   `strictClientSecrets: false`.
2. Verify each rotation works (see the per-client "Verifying the
   reconcile path locally" sections above).
3. Once all four are wired, set `strictClientSecrets: true` in the same
   PR that bumps your chart values. The Helm upgrade will fail
   immediately if any of them is still missing — which is the entire
   point.

---

## SSO bootstrap — `kc_idp_hint` and the IdP redirector

CAIPE's SSO experience is built on Keycloak's **identity provider
redirector**: instead of presenting Keycloak's own username/password
page, the realm bounces the browser straight to the upstream IdP (Okta /
Duo SSO / Azure AD / Cisco Customer Identity / …). Two pieces of
machinery together produce that behaviour, and they each have a dedicated
test that locks the contract in CI.

### How the redirect path is wired

1. `init-idp.sh` runs the `Setting '<alias>' as default IdP redirector`
   block. That looks up the realm's `identity-provider-redirector`
   execution in the browser flow and attaches an authentication-config
   entry whose `config.defaultProvider == ${IDP_ALIAS}`. The result:
   anyone hitting `/realms/caipe/protocol/openid-connect/auth` is
   funnelled to `/realms/caipe/broker/${IDP_ALIAS}/login`.
2. When `KEYCLOAK_FORCE_IDP_REDIRECT=true`, the same script then runs
   `Enforcing '<alias>' as the only browser login path`, which flips the
   redirector execution requirement from `ALTERNATIVE` to `REQUIRED` and
   drops the local forms execution. The browser can no longer fall back
   to a username/password prompt — every login *must* round-trip through
   the upstream IdP.
3. The UI's NextAuth provider in `ui/src/lib/auth-config.ts` injects
   `kc_idp_hint=${OIDC_IDP_HINT}` into the authorization params *only
   when* `OIDC_IDP_HINT` is set. That lets the BFF override Keycloak's
   default redirector per-deployment (e.g. force a specific alias in
   prod, leave it unset in a dev box). The conditional spread is
   important — passing `kc_idp_hint=""` confuses some Keycloak builds.

### Verifying the kc_idp_hint plumbing locally

Two complementary tests cover the path:

* **UI unit test** (`ui/src/lib/__tests__/auth-config.test.ts`, describe
  `OIDC kc_idp_hint forwarding`) pins the conditional spread: hint
  forwarded when `OIDC_IDP_HINT` is set, omitted when it is unset or
  empty.

  ```bash
  cd ui && npx jest --testPathPatterns auth-config.test.ts -t "kc_idp_hint"
  ```

* **End-to-end integration test**
  (`tests/integration/test_keycloak_idp_hint_redirect.sh`) boots a
  throwaway Keycloak, runs `init-idp.sh` against it with
  `KEYCLOAK_FORCE_IDP_REDIRECT=true`, and asserts:

  1. The redirector requirement is `REQUIRED` and its default provider
     is the configured alias.
  2. `GET /realms/caipe/protocol/openid-connect/auth` (no hint) returns
     `302/303` to `/broker/${IDP_ALIAS}/login`.
  3. `GET /realms/caipe/protocol/openid-connect/auth?kc_idp_hint=${IDP_ALIAS}`
     produces the same broker redirect.
  4. `GET …?kc_idp_hint=does-not-exist` does **not** 5xx — Keycloak
     gracefully falls back rather than crashing the realm.
  5. A second init-idp.sh run with `KEYCLOAK_FORCE_IDP_REDIRECT=false`
     leaves the default provider wired (regression guard).

  ```bash
  make test-keycloak-idp-hint
  # or with a custom port:
  KC_PORT=21080 ./tests/integration/test_keycloak_idp_hint_redirect.sh
  # or run all Keycloak SSO bootstrap tests together:
  make test-keycloak-sso-all
  ```

  Runs in ~18 seconds on a warm Docker cache. Wired into CI via the
  `idp-hint-test` job in `.github/workflows/ci-keycloak-init.yml`, and
  blocks the release-notification path alongside the reconcile and
  strict-secrets tests.

### Known issue exposed by the test

The integration test currently observes that the bundled
`init-idp.sh` log line `WARNING: failed to update IdP redirector
config.` actually does prevent the default provider from being wired
on a fresh realm in some POSIX-shell builds. The test compensates by
writing the authenticationConfig directly via the Admin API before
running the redirect assertions, so the *Keycloak behaviour* is still
validated end-to-end. The shell-side fix (switching the `read -r`
parse off whitespace-only IFS) is tracked separately.

---

## Dynamic-agents Keycloak/OIDC env-var contract

The dynamic-agents service validates every incoming Bearer token against
Keycloak's JWKS endpoint
(`ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/jwks_validate.py`).
Two env vars drive that flow and are the most common source of "all
requests 401" in production-shaped deployments:

| Env var       | Purpose                                                                 | Default when unset                                       |
|---------------|-------------------------------------------------------------------------|----------------------------------------------------------|
| `KEYCLOAK_URL` | In-cluster URL the pod uses for the server-to-server JWKS fetch.        | `http://localhost:7080` — connection-refused inside a pod |
| `OIDC_ISSUER` | Public issuer string that MUST match the `iss` claim Keycloak puts in JWTs. | Derived from `KEYCLOAK_URL` — fine in dev (where they coincide), wrong in any deployment where the in-cluster service URL differs from the browser-facing issuer (Keycloak's `KC_HOSTNAME`) |

Both can be overridden by the alternates `KEYCLOAK_ISSUER` (legacy
`OIDC_ISSUER` alias) and `KEYCLOAK_JWKS_URL` / `OIDC_JWKS_URL` (full
override of the derived JWKS URI). Resolution order is pinned by
`ai_platform_engineering/dynamic_agents/tests/test_jwks_validate.py`.

### Failure mode this prevents

The validator computes the expected issuer from `OIDC_ISSUER` if set,
otherwise from `KEYCLOAK_URL`. When `OIDC_ISSUER` is *unset* and
`KEYCLOAK_URL` is the in-cluster service (e.g.
`http://ai-platform-engineering-keycloak:8080`), the validator expects
issuer `http://ai-platform-engineering-keycloak:8080/realms/caipe`, but
Keycloak bakes whatever `KC_HOSTNAME` was configured with into the JWT's
`iss` claim (e.g. `https://idp.example.com/realms/caipe`). PyJWT then
rejects the token with `InvalidIssuerError`, and every authenticated
request lands in the 401 path. Pod logs look like JWKS fetch is healthy
(it is — that's `KEYCLOAK_URL`'s job) but tokens still fail validation.

### Chart wiring

The `dynamic-agents` subchart exposes both keys under `config:`:

```yaml
dynamic-agents:
  config:
    KEYCLOAK_URL: "http://ai-platform-engineering-keycloak:8080"
    OIDC_ISSUER:  "https://idp.example.com/realms/caipe"
```

The umbrella `charts/ai-platform-engineering/values.yaml` defaults
`KEYCLOAK_URL` to the bundled Keycloak service so a vanilla install
works out of the box; `OIDC_ISSUER` is intentionally left empty because
it depends on the deployment's public hostname.

The subchart's `templates/configmap.yaml` skips keys whose value is the
empty string — that way leaving `OIDC_ISSUER: ""` in `values.yaml` does
NOT clobber the in-code default with an empty env var (which would be a
sharper failure mode than just unsetting it). To opt out of the
in-code default explicitly, set the value to a single space.

`templates/NOTES.txt` prints a non-blocking warning at `helm install` /
`helm upgrade` time when either is empty, with the exact YAML snippet
to drop into the operator's overrides. Three warning branches exist
(both empty, only `OIDC_ISSUER` empty, only `KEYCLOAK_URL` empty) so
the message is always actionable.

### Test coverage

| Layer | Test | What it pins |
|-------|------|--------------|
| Vendored validator (the actual runtime path) | `ai_platform_engineering/dynamic_agents/tests/test_jwks_validate.py` | `_kc_base_url()`, `_kc_issuer()`, `_kc_jwks_uri()` resolution order + end-to-end validation: token with public issuer + `OIDC_ISSUER` set → valid; same token without `OIDC_ISSUER` → `InvalidIssuerError`; explicit `KEYCLOAK_JWKS_URL` / `OIDC_JWKS_URL` overrides win |
| Helm chart | `tests/test_dynamic_agents_chart_keycloak_env.py` | Both keys propagate into the rendered ConfigMap when set; empty defaults are omitted; NOTES.txt warns on every empty-value branch; umbrella chart defaults `KEYCLOAK_URL` to the bundled Keycloak service |
| Shared validator (used by supervisor + RAG, not dynamic-agents) | `tests/rbac/unit/py/test_jwks_validate.py` | Same contract pinned for `ai_platform_engineering.utils.auth.jwks_validate` |

The vendored and shared copies MUST stay in sync — if you change one,
update the other and run both test suites.

---

## R1: BFF Keycloak Admin token — production-safety gate

### Problem

`ui/src/lib/rbac/keycloak-admin.ts::fetchFreshAdminToken` is the BFF's
sole code path for getting an Admin REST token. Historically, if
`KEYCLOAK_ADMIN_CLIENT_ID` / `KEYCLOAK_ADMIN_CLIENT_SECRET` were unset
(which is the default everywhere — the chart never sets them, see the
"current gap" rows in `file-map.md`), the BFF silently fell back to a
`password` grant against `/realms/master` with the literal credentials
`username=admin`, `password=admin`.

In a cluster where the Keycloak bootstrap admin password is still the
default, that's **master-realm admin escalation from the BFF**. In
Kevin's install it just 401'd (because the bootstrap admin had been
rotated), but the code path is still wrong: the BFF was attempting an
escalation it shouldn't have been allowed to attempt in the first place.

### Failure mode

| Operator state | What happened before R1 | What happens after R1 |
|----------------|------------------------|------------------------|
| `client_credentials` env unset, bootstrap admin = default password (`admin/admin`) | **Silent success** against `/realms/master` — BFF gets a master-realm admin token | **Throws** at the first admin call: `Keycloak admin credentials missing: ... ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK=true to opt in for local dev only` |
| `client_credentials` env unset, bootstrap admin rotated | 401 from `/realms/master` (Kevin's symptom) | Same throw as above; no `/realms/master` call attempted at all |
| `client_credentials` env set but pointing at stale `caipe-platform-dev-secret`, master rotated | 401 from realm → fallback → 401 from `/realms/master` (`Keycloak token (password (admin-cli)) failed: 401 invalid_grant`) | Realm 401 propagates verbatim; no master fallback |

### Gate semantics

The gate lives in `adminPasswordFallbackAllowed()` and follows this
precedence:

| `ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK` | `NODE_ENV` | Fallback allowed? |
|------------------------------------------|------------|-------------------|
| `"true"` or `"1"`                        | any        | **yes** (explicit opt-in) |
| `"false"` or `"0"`                       | any        | **no** (explicit opt-out) |
| empty / unset                            | `production` | **no** (the safe default in the chart) |
| empty / unset                            | anything else (`development`, `test`, …) | **yes** (docker-compose dev default) |

### Chart wiring

The `caipe-ui` subchart exposes both keys under `config:`:

```yaml
caipe-ui:
  config:
    NODE_ENV: "production"  # chart default; do NOT change for prod installs
    ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK: ""  # default: gate closed in prod
```

For a throwaway dev cluster where the operator has accepted the risk
(e.g. the Keycloak bootstrap admin password is known not to be the
default), the flag can be flipped on:

```yaml
caipe-ui:
  config:
    ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK: "true"
```

`docker-compose.dev.yaml` defaults the flag to `true` (and runs with
`NODE_ENV=development` anyway) so the local stack continues to boot a
fresh Keycloak without requiring the operator to first wire a service
account.

### How to do this properly in production

Don't rely on the fallback — give the BFF a real service-account client.
**As of the R1 upstream fix (May 2026, see below), the chart now does
this auto-wiring out of the box** — no manual `existingSecret` plumbing
required. Operators only need to provide the `caipe-platform-secret`
itself (via K8s Secret or ESO).

### R1 upstream fix (May 2026) — chart auto-wires `caipe-platform-secret`

Before this fix, even operators who did everything right (rotated the
`caipe-platform` client secret in Keycloak via
`keycloak.platformClient.secretRef`) still had to manually plumb the
**same** secret into the caipe-ui pod — typically via an
`extraDeploy:` mirror Secret or a `caipe-ui.existingSecret` override
that surfaced the value under the wrong env-var name (`OIDC_CLIENT_SECRET`
instead of `KEYCLOAK_ADMIN_CLIENT_SECRET`). This was the half-fix Sri
documented at 3:41 PM in the Slack thread and the upstream gap Kevin
flagged at 4:09 PM.

The chart now does this automatically:

1.  The umbrella `values.yaml` defaults
    `keycloak.platformClient.secretRef = "caipe-platform-secret"` AND
    `caipe-ui.keycloakAdminClient.secretName = "caipe-platform-secret"`.
2.  The caipe-ui Deployment template gained a
    `keycloakAdminClient` block that, when `secretName` is non-empty,
    injects `KEYCLOAK_ADMIN_CLIENT_SECRET` via `valueFrom.secretKeyRef`
    (key `OIDC_CLIENT_SECRET`) and `KEYCLOAK_ADMIN_CLIENT_ID` via the
    ConfigMap.
3.  The caipe-ui ConfigMap template skips its `KEYCLOAK_ADMIN_CLIENT_ID`
    auto-injection if the operator has already set it under
    `caipe-ui.config.KEYCLOAK_ADMIN_CLIENT_ID` (no-clobber).

The on-the-wire result of a `helm install` with just
`keycloak.platformClient.secretRef=caipe-platform-secret` (or even the
defaults alone) is now:

```yaml
# caipe-ui Deployment env (rendered)
env:
  - name: KEYCLOAK_ADMIN_CLIENT_SECRET
    valueFrom:
      secretKeyRef:
        name: caipe-platform-secret
        key: OIDC_CLIENT_SECRET

# caipe-ui ConfigMap data (rendered)
KEYCLOAK_ADMIN_CLIENT_ID: caipe-platform
```

The BFF's `fetchFreshAdminToken` reads both vars and uses
`client_credentials` against the realm — never `/realms/master`, never
`admin/admin`.

#### Migration path for existing users

| Persona | Old behaviour | New behaviour (after upgrade) | Action required |
|---------|---------------|-------------------------------|-----------------|
| **Path 1 (DEV)** — local docker-compose, no in-cluster Keycloak | BFF fell back to `admin/admin` against the bundled Keycloak; `NODE_ENV=development` kept the gate open | Unchanged at runtime (the gate is still open when `NODE_ENV!=production`). Chart render now also injects `KEYCLOAK_ADMIN_CLIENT_SECRET` pointing at `caipe-platform-secret`, but you won't notice unless you `helm template` | **None.** Existing dev installs keep working. |
| **Path 2 (PROD K8s Secrets)** — operator pre-created `caipe-platform-secret` and set `keycloak.platformClient.secretRef=caipe-platform-secret` | Realm reconciled correctly; BFF still missing `KEYCLOAK_ADMIN_CLIENT_SECRET`; fell back to `admin/admin` (which 401'd post-bootstrap-admin-rotation — Kevin's symptom) | BFF picks up the same Secret automatically; admin REST works on first call. Any manual `caipe-ui.existingSecret=caipe-platform-secret` or `extraDeploy:` patch you added as a workaround keeps working alongside the auto-wiring (Pin 2 covers this — no env-var collision because they're projected under different names) | **None.** Optional cleanup: remove the `existingSecret` workaround or the `extraDeploy:` mirror; both became redundant. |
| **Path 2 (PROD K8s Secrets) with a custom secret name** — operator pre-created `my-custom-platform-secret` and set `keycloak.platformClient.secretRef=my-custom-platform-secret` | Same as above (BFF missing creds) | The auto-wiring still defaults to **`caipe-platform-secret`** (the conventional name), so the BFF would point at a non-existent Secret and the pod fails to start with `CreateContainerConfigError` | **Required:** also set `caipe-ui.keycloakAdminClient.secretName: my-custom-platform-secret`. Helm cannot substitute the value across subchart boundaries — both halves must be set explicitly. |
| **Path 3 (PROD ESO)** — operator set `keycloak.platformClient.externalSecret.enabled=true` with no `secretRef` override | ESO emitted a Secret named `<release>-keycloak-platform-client`; BFF had no wiring to it; fell back to `admin/admin` | ESO now emits the Secret as **`caipe-platform-secret`** (the umbrella default for `platformClient.secretRef` propagates into the helper that resolves the ESO target name). The BFF picks it up automatically | **One-time migration:** see "ESO target rename" below. Existing rotation pipelines continue to write to the *upstream* secret store unchanged; only the in-cluster Secret name changes. |
| **Path 3 (PROD ESO) with a custom secret name** — operator set both `externalSecret.enabled=true` AND `keycloak.platformClient.secretRef=my-custom-platform-secret` | Same as above | The ESO emits `my-custom-platform-secret`; the BFF defaults to `caipe-platform-secret` and would fail to start | **Required:** also set `caipe-ui.keycloakAdminClient.secretName: my-custom-platform-secret`, same as the PROD K8s Secrets case. |

##### Path 3 — ESO target rename, one-time migration

If you previously ran on Path 3 with the default `secretRef=""`, the
in-cluster Secret name changes from `<release>-keycloak-platform-client`
to `caipe-platform-secret` on the next `helm upgrade`. ESO will:

1.  Create a new Secret named `caipe-platform-secret` with the same
    payload (same `OIDC_CLIENT_SECRET` value from your secrets backend).
2.  Leave the old `<release>-keycloak-platform-client` Secret orphaned
    until you `kubectl delete secret/<release>-keycloak-platform-client`
    (or until the release is reinstalled).

There is **no service downtime** because:

- The keycloak init Jobs read from
  `keycloak.platformClientSecretName` which now resolves to
  `caipe-platform-secret` and write the **same value** back into
  Keycloak via the Admin API.
- The caipe-ui Deployment reads from `caipe-platform-secret` via the
  new env wiring.
- The old `<release>-keycloak-platform-client` Secret has no consumers
  after the upgrade.

If your rotation pipeline or out-of-band tooling **directly references
the old Secret name** (e.g. `kubectl get secret <release>-keycloak-platform-client`),
update it to `caipe-platform-secret`. To preserve the old name verbatim,
pin it explicitly:

```yaml
keycloak:
  platformClient:
    secretRef: ""   # explicit empty → revert to old helper behaviour
caipe-ui:
  keycloakAdminClient:
    secretName: ""  # disable the BFF auto-wiring (also re-introduces the
                    # R1 admin/admin fallback gap in production —
                    # NOT recommended; see "Gate semantics" above)
```

The recommended path is to let the rename happen and update tooling.

##### Standalone caipe-ui subchart users

If you install the `caipe-ui` subchart directly (not via the umbrella —
e.g. running caipe-ui against an external Keycloak with its own
credentials in `existingSecret`), the auto-wiring is **off by default**
in the standalone chart (`caipe-ui.values.yaml` ships
`keycloakAdminClient.secretName: ""`). No migration needed; behaviour
is unchanged.

### Test coverage

| Layer | Test | What it pins |
|-------|------|--------------|
| BFF unit (legacy fallback chain) | `ui/src/lib/rbac/__tests__/keycloak-admin-token.test.ts` (`fallback chain` describe) | 4 branches: admin client env unset → `/realms/master` succeeds; first call 401 → fallback succeeds; both 401 → exact Kevin error string; happy path → no `/realms/master` call |
| BFF unit (R1 gate) | `ui/src/lib/rbac/__tests__/keycloak-admin-token.test.ts` (`production safety gate (R1)` describe) | 4 branches: prod-default-deny with no `/realms/master` call; first-call-401 re-raises verbatim in prod; explicit `=true` re-enables fallback even in prod; explicit `=false` disables fallback even in dev |
| Helm chart (R1 BFF gate) | `tests/test_caipe_ui_keycloak_admin_client_env.py` (Pin 5, Pin 6) | Default chart render has `NODE_ENV=production` AND never defaults `ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK=true`; operator-supplied override propagates to the ConfigMap |
| Helm chart (R1 upstream fix) | `tests/test_caipe_ui_keycloak_admin_client_env.py` (Pin 1–4, 7–9) | **Default install** auto-wires `KEYCLOAK_ADMIN_CLIENT_ID/SECRET`; explicit `platformClient.secretRef` and ESO paths render identically; operator override of `keycloakAdminClient.secretName` is honoured; explicit `secretName=""` skips the wiring cleanly (standalone caipe-ui); explicit `config.KEYCLOAK_ADMIN_CLIENT_ID` wins over auto-injection (no-clobber) |

If a regression silently re-enables the `admin/admin` fallback, the
production-gate describe will trip; if the chart ever defaults the flag
to `true`, Pin 5 will trip; if the R1 upstream auto-wiring breaks,
Pin 1 (default install) will trip. Together they pin the contract
end-to-end.

---

## R4: NEXTAUTH_SECRET — strict mode

### Problem

`NEXTAUTH_SECRET` HS256-signs **two** distinct credential surfaces:

1.  **NextAuth session cookies** — used by every authenticated browser
    request to the BFF.
2.  **Internal skills-API tokens** — minted by
    `ui/src/lib/jwt-validation.ts::signLocalSkillsToken`, used by the
    Skills page and any external automation that exchanges a long-lived
    key for a Bearer token. (The token's `iat`, `exp`, and `scope` are
    all signed under the same key.)

If two operators ship the same value (very easy to do — `caipe-dev-secret`
was hardcoded in `Makefile:199` and `caipe-dev-secret-change-in-production`
shipped as the default in `docker-compose.yaml`), then **a session cookie
or skills-API token forged on install A is byte-for-byte valid on install B**.
That's a one-line cross-install identity compromise.

### Strict-mode gate

The gate lives in `ui/src/lib/nextauth-secret-guard.ts` and is
consumed by `jwt-validation.ts` (both `signLocalSkillsToken` and
`validateLocalSkillsJWT`). It rejects:

| Input                                                              | Strict mode (prod) | Dev mode      |
|--------------------------------------------------------------------|--------------------|---------------|
| Unset / empty                                                      | **throws**         | **throws**    |
| Known placeholder (`caipe-dev-secret`, `changeme`, `your-secret-here`, …) | **throws**         | warns + accepts |
| Shorter than 32 characters                                         | **throws**         | accepts       |
| ≥32 characters, not in the placeholder set                         | accepts            | accepts       |

The full placeholder set is the constant
`KNOWN_NEXTAUTH_PLACEHOLDERS` in `nextauth-secret-guard.ts`. Adding to
it is a one-way ratchet (we never remove entries); if a postmortem
surfaces a new leaked value, add it there.

### Gate semantics

Strict mode follows the same `ALLOW_*` / `NODE_ENV` precedence as the
R1 gate:

| `ALLOW_NEXTAUTH_DEV_SECRET` | `NODE_ENV`     | Strict mode? |
|-----------------------------|----------------|--------------|
| `"true"` or `"1"`           | any            | **off** (explicit opt-out) |
| `"false"` or `"0"`          | any            | **on** (explicit opt-in)   |
| empty / unset               | `production`   | **on**       |
| empty / unset               | anything else  | **off**      |

In strict mode, `signLocalSkillsToken` throws at mint time and
`validateLocalSkillsJWT` returns `null` (so the caller falls through
to OIDC instead of 5xx-ing the request).

### Chart wiring

`charts/.../caipe-ui/values.yaml` ships `NODE_ENV: "production"` by
default, so the gate is implicitly **on** for every Helm install. The
chart does NOT provide a default `NEXTAUTH_SECRET` value (`existingSecret`
or `externalSecrets` is required) — see the comment block at the
`existingSecret:` key for the supported wiring patterns.

### Install-path coverage

| Surface                         | Before R4                            | After R4                                            |
|---------------------------------|--------------------------------------|-----------------------------------------------------|
| `Makefile :: run-caipe-ui-docker` | `-e NEXTAUTH_SECRET=caipe-dev-secret` (literal!) | Refuses to start unless `$$NEXTAUTH_SECRET` is set AND not a placeholder |
| `docker-compose.yaml`            | `${NEXTAUTH_SECRET:-caipe-dev-secret-change-in-production}` | `${NEXTAUTH_SECRET:?...must be set...}` aborts compose-up |
| `docker-compose.dev.yaml`        | (already default-falls-back to a placeholder)        | Unchanged; BFF gate accepts in dev               |
| `ui/env.example`                 | `NEXTAUTH_SECRET=your-secret-here`   | Updated to call out R4 and link the secrets doc       |
| `docs/docs/ui/auth-flow.md`      | `NEXTAUTH_SECRET=your-secret-here`   | Updated with explicit `openssl rand -base64 48` cue   |

### Test coverage

| Layer | Test | What it pins |
|-------|------|--------------|
| Guard unit tests | `ui/src/lib/__tests__/nextauth-secret-guard.test.ts` | 24 tests covering `isStrictSecretMode` precedence (NODE_ENV + override flag, both directions, `"1"`/`"0"` aliases), strict-mode rejection of every placeholder (including the exact `caipe-dev-secret` and `caipe-dev-secret-change-in-production` strings), trim-before-compare, length floor, dev-mode warn-but-accept, and `SKILLS_API_SECRET` precedence in `getSafeNextAuthSecret` |
| Downstream consumer | `ui/src/lib/__tests__/jwt-validation.test.ts` | All existing 7 tests still pass with the guard wired in (no behavioral regression in dev) |
| Operator surface | Compose `docker compose up` against `docker-compose.yaml` without `NEXTAUTH_SECRET` set | Aborts with the embedded error message (test by hand: `unset NEXTAUTH_SECRET && docker compose up`) |

If a regression weakens the strict-mode floor, the guard unit tests
trip; if the Makefile target ever re-introduces the literal placeholder,
the embedded shell-level placeholder check refuses to run.

### How to do this properly

```yaml
# values-prod.yaml — production install
caipe-ui:
  existingSecret: caipe-ui-runtime-secrets
  externalSecrets:
    enabled: false
```

Then create the Secret with a real value:

```bash
NEXTAUTH_SECRET="$(openssl rand -base64 48)"
kubectl create secret generic caipe-ui-runtime-secrets \
  --from-literal=NEXTAUTH_SECRET="$NEXTAUTH_SECRET" \
  --from-literal=OIDC_CLIENT_SECRET="…" \
  --from-literal=MONGODB_URI="…"
```

For ESO/Vault, point `caipe-ui.externalSecrets.data[*]` at your
`NEXTAUTH_SECRET` key in the secret store — see
`charts/.../caipe-ui/values-external-secrets.yaml` for the template.

---

## R3: MongoDB rootPassword strict mode

**Background.** The `caipe-ui-mongodb` subchart shipped
`auth.rootPassword: "changeme"` as its chart default. The default got
materialised directly into the in-cluster Secret by
`templates/secret.yaml`, so any operator who ran `helm install` without
either overriding `auth.rootPassword` or enabling
`externalSecrets.enabled=true` would ship `admin/changeme` to MongoDB.
The same `changeme` then propagated into every `MONGODB_URI` consumer
(dynamic-agents, supervisor, caipe-ui session store).

This is the same class of issue we fixed for Keycloak `caipe-*-dev-secret`
under `strictClientSecrets`. R3 introduces the parallel
`strictPasswords` flag on the MongoDB subchart.

### How it works

When `caipe-ui-mongodb.strictPasswords: true` AND
`caipe-ui-mongodb.externalSecrets.enabled: false`, the template helper
`mongodb.assertStrictPasswords` calls `{{ fail }}` if
`auth.rootPassword` is in the known-placeholder set:

```
"changeme", "change-me", "please-change-me",
"admin", "password", "password123",
"mongo", "mongodb", "root",
"test", "dev", "development",
"secret", "your-password-here", "replace-me"
```

The helper also enforces an 8-character minimum so very-short
dev-leftover values like `mongo` get rejected even when they aren't in
the placeholder list verbatim. The check is case-insensitive
(`ChangeMe`, `CHANGEME` both fail).

When `externalSecrets.enabled: true`, the in-cluster Secret is built
from the external store (Vault, AWS Secrets Manager, GCP Secret
Manager, …) by ESO — the chart's `auth.rootPassword` value never lands
in etcd, so the strict-mode gate skips its check unconditionally. An
operator who points ESO at a secret that itself contains `"changeme"`
is solving a different problem than this gate addresses.

### Migration

Production GitOps installs:

```yaml
# values.yaml
caipe-ui-mongodb:
  strictPasswords: true
  auth:
    rootPassword: ""    # operator MUST set a real value or use ESO
  # OR (preferred for prod):
  externalSecrets:
    enabled: true
    data:
      - secretKey: MONGO_INITDB_ROOT_PASSWORD
        remoteRef:
          key: prod/caipe/mongodb
          property: password
```

Generate a CSPRNG password with:

```bash
openssl rand -base64 24
```

Default ships `strictPasswords: false` so the docker-compose dev flow
and CI matrix runs (which intentionally use the placeholder) keep
working unchanged.

### Tests

* `tests/test_mongodb_strict_passwords.py` — 14 chart-render pins
  covering: default-off (placeholder allowed), per-placeholder
  rejection, case-insensitive rejection, length floor, real-password
  acceptance, ESO bypass, and back-compat short-password allowance
  with strict off.
* `tests/integration/test_mongodb_strict_passwords.sh` — 4-step
  `helm template` walk: strict-on + placeholder fails with the docs
  link in stderr; strict-on + real password renders the Secret;
  strict-on + ESO bypasses the gate; strict-off (default) preserves
  the docker-compose flow.

---

## R2: setup-caipe.sh MongoDB random password

**Background.** The `setup-caipe.sh` workshop on-ramp installed the
bitnami/mongodb chart with `auth.rootPassword=changeme` and baked
`mongodb://admin:changeme@caipe-mongodb:27017/caipe?authSource=caipe`
into four cluster-internal config destinations:

| Site | Destination |
|------|-------------|
| `helm upgrade ... bitnami/mongodb` | `auth.rootPassword=changeme`, `auth.passwords[0]=changeme` |
| `caipe-dynamic-agents-config` ConfigMap | `MONGODB_URI` |
| `caipe-supervisor-agent-env` ConfigMap | `MONGODB_URI` |
| `caipe-single-node-agent-env` ConfigMap | `MONGODB_URI` |
| `caipe-ui-secret` Secret | `MONGODB_URI` |
| Seed values file (dynamic-agents Helm seed) | `dynamic-agents.config.MONGODB_URI` |

Every operator who ran the workshop on-ramp inherited the same admin
password and the same connection string.

### How the fix works

A new helper, `_resolve_mongodb_password`, runs before the
`helm install` and mirrors the existing `LANGFUSE_PASSWORD` pattern
that was added earlier:

1. **Read existing.** Try to read
   `caipe-mongodb-credentials.MONGODB_ROOT_PASSWORD` (base64-decoded)
   from the `caipe` namespace. If present, reuse it — re-runs of the
   script stay idempotent and the running MongoDB pod keeps working.
2. **Generate.** Otherwise generate a fresh password with
   `openssl rand -hex 24` — 48 hex chars (24 bytes of entropy). Hex is
   chosen deliberately so the value is URL-safe inside the
   `mongodb://admin:<pw>@...` connection string (no `@`, `/`, `:`, `?`
   that would need percent-encoding).
3. **Persist.** Write the password into the
   `caipe-mongodb-credentials` Secret via the standard
   `kubectl create … --dry-run=client -o yaml | kubectl apply -f -`
   idempotent-upsert pattern.

The variable `$MONGODB_ROOT_PASSWORD` is then read by every other
site in the script that previously hardcoded `changeme`. The "Services
Ready" banner prints a one-liner for recovering the password later:

```bash
kubectl get secret caipe-mongodb-credentials -n caipe -o jsonpath='{.data}' \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin); \
      print('\n'.join(f'{k}: {base64.b64decode(v).decode()}' for k,v in sorted(d.items())))"
```

### Tests

`tests/integration/test_setup_caipe_mongodb_password.sh` runs the
helper in isolation by extracting its definition from `setup-caipe.sh`
and mocking `kubectl` on PATH. The 5 pins cover:

1. First run with no existing Secret → fresh password generated and
   persisted.
2. Second run with existing Secret → same password reused (idempotent).
3. Password is exactly 48 hex chars, URL-safe.
4. Password is never the literal `"changeme"` (R2 regression guard).
5. Grep-based check: `changeme` no longer appears in any non-comment
   line of `setup-caipe.sh`.

### Bypass / debug

There is no bypass — every install gets a randomised password. If an
operator deliberately wants a known password (e.g. for debugging a
backup-restore flow), the simplest path is:

```bash
kubectl -n caipe create secret generic caipe-mongodb-credentials \
  --from-literal=MONGODB_ROOT_USERNAME=admin \
  --from-literal=MONGODB_ROOT_PASSWORD='your-debug-password' \
  --from-literal=MONGODB_DATABASE=caipe
./setup-caipe.sh ...
```

The helper will read the existing Secret and reuse the chosen value.

---

## What is NOT covered here

* **Realm-import secrets** baked into the realm JSON — these are
  consumed before the init Jobs run, so they live in a ConfigMap. If
  you need to inject sensitive values into the realm itself (e.g.
  pre-seeded service-account credentials), use a Vault Sidecar +
  `kubectl create configmap --from-file=…` workflow instead.
* **OIDC IdP-side configuration** (creating the OIDC client app in
  Okta/Duo/etc.) — that's owned by your IdP admin. CAIPE only consumes
  the resulting `client_id` + `client_secret`.
