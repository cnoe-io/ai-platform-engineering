# Migration Guide: 0.3.x to 0.4.0

This guide covers all breaking changes, Helm value restructuring, and environment variable changes when upgrading from **0.3.x** to **0.4.0**.

---

## Breaking Changes Summary

| Area | Change | Severity |
|------|--------|----------|
| Helm (all) | `env:` block removed — use `config:` flat map instead | **High** |
| Helm (caipe-ui) | `seedConfig.*` renamed to `appConfig.*` | **High** |
| Helm (caipe-ui) | `SEED_CONFIG_PATH` env var replaced by `APP_CONFIG_PATH` | **High** |
| Helm (slack-bot) | All named value keys (`appName`, `botMode`, `caipeApiUrl`, `silenceEnv`, `slackWorkspaceUrl`, `mongodb.*`, `auth.*`, `prompts.*`) removed — use `config:` flat map | **Breaking** |
| Helm (slack-bot) | `slack.tokenSecretRef` replaced by `existingSecret` | **Breaking** |
| Helm (slack-bot) | `CAIPE_BOT_CONFIG` env var replaced by `SLACK_INTEGRATION_BOT_CONFIG` | **Breaking** |
| Helm (slack-bot) | Bot config file renamed: `/etc/caipe/caipe-bot-config.yaml` -> `/etc/caipe/bot-config.yaml` | **Breaking** |
| Helm (slack-bot) | `botConfig.*.default` renamed to `botConfig.*.other` | Medium |
| Helm (dynamic-agents) | `env:` block removed, `AUTH_ENABLED` removed | **High** |
| Env (dynamic-agents) | `AUTH_ENABLED` replaced by `DEBUG=true` for dev bypass | Medium |

---

## Component-by-Component Migration

### 1. CAIPE UI (caipe-ui)

#### `env:` merged into `config:`

The separate `env:` block is removed. All environment variables now go in a single flat `config:` map.

**Before (0.3.x):**
```yaml
caipe-ui:
  env:
    A2A_BASE_URL: "http://ai-platform-engineering-supervisor-agent:8000"
    SKILLS_DIR: "/app/data/skills"
  config:
    SSO_ENABLED: "true"
    ENABLE_SUBAGENT_CARDS: "true"
    # ... other config
```

**After (0.4.0):**
```yaml
caipe-ui:
  config:
    A2A_BASE_URL: "http://ai-platform-engineering-supervisor-agent:8000"
    SKILLS_DIR: "/app/data/skills"
    SSO_ENABLED: "true"
    ENABLE_SUBAGENT_CARDS: "true"
    # ... other config
```

**Action:** Move all keys from `env:` into `config:`. Delete the `env:` block.

#### `seedConfig` renamed to `appConfig`

**Before (0.3.x):**
```yaml
caipe-ui:
  seedConfig:
    enabled: true
    models:
      - model_id: gpt-4o
        name: GPT-4o
        provider: openai
    mcp_servers: []
    agents: []
```

**After (0.4.0):**
```yaml
caipe-ui:
  appConfig:
    models:
      - model_id: gpt-4o
        name: GPT-4o
        provider: openai
    mcp_servers: []
    agents: []
```

**Action:**
1. Rename `seedConfig:` to `appConfig:`.
2. Remove `enabled: true/false` — the ConfigMap is auto-created when any of `models`, `mcp_servers`, or `agents` is non-empty.
3. The env var `SEED_CONFIG_PATH` is automatically replaced by `APP_CONFIG_PATH` by the chart; no manual change needed.

---

### 2. Dynamic Agents (dynamic-agents)

#### `env:` block removed

**Before (0.3.x):**
```yaml
dynamic-agents:
  env:
    SOME_CUSTOM_VAR: "value"
  config:
    MONGODB_DATABASE: "caipe"
    AUTH_ENABLED: "false"
```

**After (0.4.0):**
```yaml
dynamic-agents:
  config:
    MONGODB_DATABASE: "caipe"
    SOME_CUSTOM_VAR: "value"
```

**Action:** Move all keys from `env:` into `config:`. Delete the `env:` block.

#### `AUTH_ENABLED` removed

The `AUTH_ENABLED` config key is removed. It was being used as a development shortcut to bypass authentication.

**Replacement:** Use `DEBUG: "true"` in `config:` to enable the dev admin user bypass. In production, omit it (auth is always enabled when the UI passes a valid token).

#### OIDC and CORS config removed

In 0.4.0, all authentication is handled by the **UI gateway** (Next.js server). Dynamic-agents no longer validates tokens or accepts direct browser requests, so the following keys should be **removed** from `dynamic-agents.config:`:

- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_REQUIRED_ADMIN_GROUP`
- `CORS_ORIGINS`

These are now only needed on the `caipe-ui` side.

---

### 3. Slack Bot (slack-bot) -- **Most Breaking Changes**

The slack-bot Helm values have been **completely restructured** from named keys to a flat `config:` map with an `existingSecret:` reference. This is the most significant migration.

#### Full before/after mapping

**Before (0.3.x):**
```yaml
slack-bot:
  appName: "CAIPE"
  botMode: "socket"
  caipeApiUrl: "http://ai-platform-engineering-caipe-ui:3000"
  silenceEnv: "false"
  slackWorkspaceUrl: "https://mycompany.slack.com"

  env:
    CUSTOM_VAR: "value"

  slack:
    tokenSecretRef: "slack-bot-secrets"

  mongodb:
    uri: "mongodb://admin:changeme@mongodb:27017"
    database: "caipe"

  auth:
    enabled: true
    tokenUrl: "https://idp.example.com/oauth2/v1/token"
    clientId: "my-client-id"
    scope: "api://caipe"
    audience: ""

  prompts:
    responseStyle: "Be concise"
    qanda: ""
    overthinkQanda: ""
    mention: ""
    humbleFollowup: ""
    aiAlerts: ""

  botConfig:
    C012345678:
      name: "#my-channel"
      ai_enabled: true
      default:
        project_key: MYPROJ
        issue_type: Bug
```

**After (0.4.0):**
```yaml
slack-bot:
  config:
    APP_NAME: "CAIPE"
    SLACK_BOT_MODE: "socket"
    CAIPE_API_URL: "http://ai-platform-engineering-caipe-ui:3000"
    SLACK_INTEGRATION_SILENCE_ENV: "false"
    SLACK_WORKSPACE_URL: "https://mycompany.slack.com"
    MONGODB_URI: "mongodb://admin:changeme@mongodb:27017"
    MONGODB_DATABASE: "caipe"
    SLACK_INTEGRATION_ENABLE_AUTH: "true"
    OAUTH2_TOKEN_URL: "https://idp.example.com/oauth2/v1/token"
    OAUTH2_CLIENT_ID: "my-client-id"
    OAUTH2_SCOPE: "api://caipe"
    # OAUTH2_AUDIENCE: ""  # omit if empty
    SLACK_INTEGRATION_PROMPT_RESPONSE_STYLE: "Be concise"
    # CUSTOM_VAR: "value"  # any custom env vars go here too

  existingSecret: "slack-bot-secrets"

  botConfig:
    C012345678:
      name: "#my-channel"
      ai_enabled: true
      other:
        jira:
          project_key: MYPROJ
          issue_type: Bug
```

#### Field-by-field mapping reference

| Old key (0.3.x) | New key (0.4.0) in `config:` | Notes |
|---|---|---|
| `appName` | `APP_NAME` | |
| `botMode` | `SLACK_BOT_MODE` | |
| `caipeApiUrl` | `CAIPE_API_URL` | |
| `silenceEnv` | `SLACK_INTEGRATION_SILENCE_ENV` | |
| `slackWorkspaceUrl` | `SLACK_WORKSPACE_URL` | |
| `env.*` | Move into `config:` | |
| `slack.tokenSecretRef` | `existingSecret` | Top-level key, same secret name |
| `mongodb.uri` | `MONGODB_URI` | Sensitive -- consider moving to secret |
| `mongodb.database` | `MONGODB_DATABASE` | |
| `auth.enabled` | `SLACK_INTEGRATION_ENABLE_AUTH` | `"true"` / omit |
| `auth.tokenUrl` | `OAUTH2_TOKEN_URL` | |
| `auth.clientId` | `OAUTH2_CLIENT_ID` | |
| `auth.scope` | `OAUTH2_SCOPE` | Omit if empty |
| `auth.audience` | `OAUTH2_AUDIENCE` | Omit if empty |
| `prompts.responseStyle` | `SLACK_INTEGRATION_PROMPT_RESPONSE_STYLE` | Omit if empty |
| `prompts.qanda` | `SLACK_INTEGRATION_PROMPT_QANDA` | Omit if empty |
| `prompts.overthinkQanda` | `SLACK_INTEGRATION_PROMPT_OVERTHINK_QANDA` | Omit if empty |
| `prompts.mention` | `SLACK_INTEGRATION_PROMPT_MENTION` | Omit if empty |
| `prompts.humbleFollowup` | `SLACK_INTEGRATION_PROMPT_HUMBLE_FOLLOWUP` | Omit if empty |
| `prompts.aiAlerts` | `SLACK_INTEGRATION_PROMPT_AI_ALERTS` | Omit if empty |

#### Secret reference change

**Before:** `slack.tokenSecretRef: "slack-bot-secrets"`
**After:** `existingSecret: "slack-bot-secrets"`

The Secret itself does not change -- it still contains `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`, and optionally `OAUTH2_CLIENT_SECRET`. Only the Helm key that references it has moved.

#### Bot config file rename

| | 0.3.x | 0.4.0 |
|---|---|---|
| Env var | `CAIPE_BOT_CONFIG` | `SLACK_INTEGRATION_BOT_CONFIG` (auto-set by chart) |
| Mount path | `/etc/caipe/caipe-bot-config.yaml` | `/etc/caipe/bot-config.yaml` |
| ConfigMap name | `*-config` (shared with env) | `*-bot-config` (dedicated) |

The chart sets `SLACK_INTEGRATION_BOT_CONFIG` automatically when `botConfig` is non-empty. No manual action needed -- just ensure `botConfig:` is populated.

**Fallback behavior:** If neither `SLACK_INTEGRATION_BOT_CONFIG` nor the well-known path `/etc/caipe/bot-config.yaml` exists, the bot starts with no channel configuration and logs a warning. It will not crash.

#### `botConfig.*.default` renamed to `botConfig.*.other`

Per-channel extra data (Jira project keys, etc.) moved from `default:` to `other:` to avoid confusion with "default settings."

**Before:**
```yaml
botConfig:
  C012345678:
    default:
      project_key: MYPROJ
```

**After:**
```yaml
botConfig:
  C012345678:
    other:
      jira:
        project_key: MYPROJ
```

---

## Unified Config Pattern (All Components)

All three components now follow the same Helm config pattern:

```yaml
component:
  # 1. Flat env vars → ConfigMap → envFrom
  config:
    KEY: "value"

  # 2. Pre-existing K8s Secret → envFrom secretRef
  existingSecret: "my-secret"

  # 3. ExternalSecrets operator integration
  externalSecrets:
    enabled: false
    # ...

  # 4. Structured data → YAML file → volume mount (component-specific)
  appConfig: {}    # caipe-ui only
  botConfig: {}    # slack-bot only
```

**Key principle:** `config:` is always a flat key-value map where each key becomes an environment variable. No nesting, no `config.env:` sub-keys.

---

## Removed / Deprecated Values

| Component | Removed Value | Replacement |
|---|---|---|
| caipe-ui | `env:` | `config:` |
| caipe-ui | `seedConfig.enabled` | Auto-detected (non-empty = enabled) |
| caipe-ui | `seedConfig.*` | `appConfig.*` |
| dynamic-agents | `env:` | `config:` |
| dynamic-agents | `config.AUTH_ENABLED` | `config.DEBUG: "true"` for dev |
| dynamic-agents | `config.OIDC_ISSUER` | Removed (auth handled by UI gateway) |
| dynamic-agents | `config.OIDC_CLIENT_ID` | Removed (auth handled by UI gateway) |
| dynamic-agents | `config.OIDC_REQUIRED_ADMIN_GROUP` | Removed (auth handled by UI gateway) |
| dynamic-agents | `config.CORS_ORIGINS` | Removed (no direct browser access) |
| slack-bot | `env:` | `config:` |
| slack-bot | `appName` | `config.APP_NAME` |
| slack-bot | `botMode` | `config.SLACK_BOT_MODE` |
| slack-bot | `caipeApiUrl` | `config.CAIPE_API_URL` |
| slack-bot | `silenceEnv` | `config.SLACK_INTEGRATION_SILENCE_ENV` |
| slack-bot | `slackWorkspaceUrl` | `config.SLACK_WORKSPACE_URL` |
| slack-bot | `slack.tokenSecretRef` | `existingSecret` |
| slack-bot | `mongodb.uri` | `config.MONGODB_URI` |
| slack-bot | `mongodb.database` | `config.MONGODB_DATABASE` |
| slack-bot | `auth.*` | `config.SLACK_INTEGRATION_ENABLE_AUTH`, `config.OAUTH2_*` |
| slack-bot | `prompts.*` | `config.SLACK_INTEGRATION_PROMPT_*` |

---

## Image Tag Overrides

When deploying RC builds (pre-release), the chart's default `appVersion` may not match the desired image tag. You must explicitly override image tags for each component:

```yaml
caipe-ui:
  image:
    repository: "ghcr.io/cnoe-io/caipe-ui"
    tag: "0.4.0-rc.16"
    pullPolicy: "Always"

dynamic-agents:
  image:
    tag: "0.4.0-rc.16"
```

For stable releases, the chart's `appVersion` is set automatically and no override is needed — you can remove the `image.tag` overrides after upgrading to the final 0.4.0 release.

---

## Pre-Upgrade Checklist

- [ ] **Back up current values:** `helm get values ai-platform-engineering -o yaml > values-backup.yaml`
- [ ] **Migrate caipe-ui values:** merge `env:` into `config:`, rename `seedConfig` to `appConfig`
- [ ] **Migrate dynamic-agents values:** merge `env:` into `config:`, remove `AUTH_ENABLED`, remove OIDC/CORS keys
- [ ] **Migrate slack-bot values:** restructure all named keys into `config:` flat map (see mapping table above)
- [ ] **Verify secret name:** `existingSecret` points to the correct K8s Secret containing Slack tokens
- [ ] **Verify botConfig structure:** rename `default:` to `other:` if used
- [ ] **Helm diff:** `helm diff upgrade ai-platform-engineering ./charts/ai-platform-engineering -f new-values.yaml`
- [ ] **Deploy and verify:** check pod logs for config loading messages

---

## Rollback

If you need to roll back to 0.3.x:

```bash
helm rollback ai-platform-engineering <previous-revision>
```

Restore your backed-up values file. The 0.3.x chart templates expect the old value structure (`env:`, `seedConfig:`, `slack.tokenSecretRef:`, etc.), so the old values file will work as-is with the old chart version.

The slack bot will look for `CAIPE_BOT_CONFIG` again (the 0.3.x env var). No data migration is needed since these are configuration-only changes.
