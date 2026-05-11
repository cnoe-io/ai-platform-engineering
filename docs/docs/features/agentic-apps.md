# Agentic Apps

CAIPE can host external agentic web apps through a manifest-driven platform. Apps run outside the host, while CAIPE owns install policy, launch access, app-scoped tokens, webhook forwarding, assistant context, health checks, and audit trails.

## Feature Gates

Agentic Apps are gated by server-side environment variables. Public `NEXT_PUBLIC_*` values do not enable install, admin, user, or proxy routes.

- `AGENTIC_APPS_INSTALL_ENABLED=true` turns on the Agentic Apps platform routes and admin install APIs. When unset or not exactly `true`, Agentic Apps routes return hidden/404 states.
- `AGENTIC_APPS_ENABLED=<app-id>[,<app-id>]` lists the app IDs that should be visible and launchable after installation policy, RBAC, and health checks pass.
- `AGENTIC_APP_<UPPER_ID>_ORIGIN=http://host:port` points a given app ID at its runtime.
- `AGENTIC_APP_<UPPER_ID>_DISABLED=true` force-disables one app without editing the global list.
- `SHIP_LOOP_ENABLED=true` is an additional kill switch for the Agentic SDLC app. The app must also be listed in `AGENTIC_APPS_ENABLED`.
- `SHIP_LOOP_ASSISTANT_ENABLED=true` enables the Agentic SDLC assistant panel. It has no effect unless `SHIP_LOOP_ENABLED=true`.

## App Contract

Each app provides an `AgenticAppManifest` with:

- Runtime: public mount path and upstream origin.
- Surfaces: Apps Hub, top navigation, overlays, and home eligibility.
- Access: required roles/groups, token scopes, and policy actions.
- Optional assistant bridge and webhook channels.
- Health endpoint and launch-blocking policy.

Manifests must be public and secret-free. Runtime origins, signing keys, webhook provider secrets, and environment-specific policy stay in deployment config or Mongo-backed installation records.

## Runtime Flow

1. Operators import and install a package.
2. Users discover allowed apps in `/apps`.
3. CAIPE evaluates install state, access, health, and PDP policy.
4. Allowed proxy/webhook calls receive a short-lived app-scoped token.
5. The app verifies the token locally and treats CAIPE headers as metadata only.

## Quick Setup

1. Configure storage and auth.

   Set `MONGODB_URI`, `MONGODB_DATABASE`, `NEXTAUTH_SECRET`, and your normal OIDC or local auth settings. Agentic app packages, installations, decisions, health snapshots, and audit records are stored server-side.

2. Enable the platform gate.

   ```bash
   AGENTIC_APPS_INSTALL_ENABLED=true
   AGENTIC_APP_TOKEN_SECRET=<dedicated-random-secret>
   ```

   Use a dedicated token secret in shared or production environments. If unset, local development falls back to the app's existing auth secret.

3. Enable one or more apps.

   ```bash
   AGENTIC_APPS_ENABLED=weather,finops
   AGENTIC_APP_WEATHER_ORIGIN=http://localhost:3020
   AGENTIC_APP_FINOPS_ORIGIN=http://localhost:3010
   ```

   App IDs map to environment variables by uppercasing and replacing hyphens with underscores.

4. Start app runtimes.

   Reference runtimes live under `ui/apps/agentic-apps/<app-id>/`. In local development, run the app runtime and the CAIPE UI together through the dev compose profile or separate terminals.

5. Enable Agentic SDLC, if needed.

   ```bash
   AGENTIC_APPS_ENABLED=agentic-sdlc,weather,finops
   SHIP_LOOP_ENABLED=true
   SHIP_LOOP_ASSISTANT_ENABLED=false
   ```

   Turn on `SHIP_LOOP_ASSISTANT_ENABLED=true` only when the backing Dynamic Agent is configured.

6. Verify.

   Open `/apps`. Enabled apps should appear in the hub. Launching an app should load the CAIPE shell and iframe. If an app is hidden, check the platform gate, app ID list, runtime origin, health state, and RBAC policy.

## Installing Internal Apps

Internal or company-specific apps should not be committed to the open source repo. Keep their manifests and runtime deployment values in the private deployment repo or a secure catalog source.

Recommended flow:

1. Store the app manifest outside the OSS source tree.
2. Import or seed the manifest into the package catalog.
3. Create an installation record with the app ID, mount path, runtime origin, visibility, and enabled state.
4. Add the app ID to `AGENTIC_APPS_ENABLED`.
5. Configure `AGENTIC_APP_<UPPER_ID>_ORIGIN` and any app-owned secrets in deployment config.
6. Keep manifests secret-free. Store credentials in environment variables, Kubernetes secrets, or your deployment secret manager.

## User Guide

Users open the Agentic Apps hub at `/apps`.

- Launch: select an enabled app card. CAIPE opens the app in the host shell and proxies allowed routes to the runtime.
- Assistant: apps with assistant support show an Ask button. The app can publish page context to CAIPE, and CAIPE passes that context to the configured assistant.
- Access denied: users may see a hidden/404 or blocked launch state when the app is disabled, unhealthy, not installed, or not allowed by role policy.
- Health: operators can block launch when an app reports degraded or unreachable health, based on the manifest policy.
- Audit: platform decisions, token grants, webhook deliveries, assistant contexts, and health snapshots are recorded for operator review.

## Developer Integrations

- SDK: `ui/src/packages/agentic-app-sdk`
- UI kit: `ui/src/packages/agentic-app-ui`
- Webhook endpoint: `/api/agentic-apps/webhooks/{appId}/{provider}/{channel}`
- Authorization endpoint: `/api/agentic-apps/{appId}/authorize`

Reference apps live under `ui/apps/` and should import only the SDK/UI kit boundaries, not private CAIPE host modules.

## Operations

Use `GET /api/admin/agentic-apps/audit` to filter app events by `appId`, `decisionId`, `correlationId`, `reasonCode`, and event `type`. Technical records for PDP decisions, token grants, webhook deliveries, assistant contexts, and health snapshots are stored separately and can be retained for shorter periods.
