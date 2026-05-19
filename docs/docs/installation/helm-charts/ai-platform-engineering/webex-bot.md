---
id: webex-bot-chart
sidebar_label: webex-bot
---

::::caution Auto-generated
This page follows the generated Helm chart reference format. Regenerate with
`make docs-helm-charts` after the Webex chart is published.
::::

# webex-bot

Webex bot integration for AI Platform Engineering using A2A protocol and
OpenFGA-backed space ReBAC.

| | |
|---|---|
| **Version** | `0.5.1-rc.7` |
| **Type** | application |

## Quick Start

```bash
helm install webex-bot oci://ghcr.io/cnoe-io/charts/webex-bot --version 0.5.1-rc.7
helm upgrade webex-bot oci://ghcr.io/cnoe-io/charts/webex-bot --version 0.5.1-rc.7
```

## Required Secrets

Set sensitive values through `existingSecret` or `externalSecrets`; do not place
real values in chart values:

| Secret key | Purpose |
| --- | --- |
| `WEBEX_INTEGRATION_BOT_ACCESS_TOKEN` | Webex integration bot API token |
| `WEBEX_WEBHOOK_SECRET` | Webex webhook signature secret |
| `KEYCLOAK_WEBEX_BOT_CLIENT_SECRET` | OBO token-exchange client secret |
| `KEYCLOAK_WEBEX_BOT_ADMIN_CLIENT_SECRET` | Internal admin API audience client secret |
| `MONGODB_URI` | MongoDB connection string for route/team/link stores |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `replicaCount` | int | `1` | Number of bot replicas |
| `image.repository` | string | `ghcr.io/cnoe-io/caipe-webex-bot` | Bot image repository |
| `image.tag` | string | `""` | Overrides chart appVersion when set |
| `serviceAccount.automount` | bool | `false` | Disables service account token automount |
| `config.CAIPE_API_URL` | string | `http://ai-platform-engineering-caipe-ui:3000` | CAIPE UI/BFF URL used for access checks |
| `config.WEBEX_WORKSPACE_ALIAS` | string | `CAIPE-WEBEX` | Trusted Webex policy namespace alias |
| `config.WEBEX_AGENT_ROUTES_MODE` | string | `db_prefer` | Route source mode: `config`, `db_prefer`, or `db_only` |
| `config.WEBEX_AUTO_ASSIGN_UNMAPPED_SPACES` | string | `false` | Opt-in first-message auto-assignment for unmapped spaces |
| `config.WEBEX_ADMIN_API_ENABLED` | string | `false` | Enables internal bot admin API |
| `config.WEBEX_ADMIN_JWT_AUDIENCE` | string | `caipe-webex-bot-admin` | Required JWT audience for admin API calls |
| `config.KEYCLOAK_URL` | string | `http://ai-platform-engineering-keycloak:8080` | Internal Keycloak URL |
| `config.OPENFGA_HTTP` | string | `http://ai-platform-engineering-openfga:8080` | Internal OpenFGA HTTP URL |
| `keycloakBot.clientSecretFromSecret.key` | string | `KC_WEBEX_BOT_CLIENT_SECRET` | Keycloak-managed Webex bot client secret key |
| `existingSecret` | string | `webex-bot-secrets` | Secret containing bot tokens and client secrets |
| `externalSecrets.enabled` | bool | `false` | Enables ExternalSecret rendering |
| `securityContext.runAsUser` | int | `1001` | Non-root runtime UID |
| `securityContext.allowPrivilegeEscalation` | bool | `false` | Prevents privilege escalation |
| `securityContext.capabilities.drop` | list | `[ALL]` | Drops Linux capabilities |
