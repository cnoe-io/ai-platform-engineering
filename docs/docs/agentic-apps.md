# Agentic Apps

CAIPE can host external agentic web apps through a manifest-driven platform. Apps run outside the host, while CAIPE owns install policy, launch access, app-scoped tokens, webhook forwarding, assistant context, health checks, and audit trails.

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

## Developer Integrations

- SDK: `ui/src/packages/agentic-app-sdk`
- UI kit: `ui/src/packages/agentic-app-ui`
- Webhook endpoint: `/api/agentic-apps/webhooks/{appId}/{provider}/{channel}`
- Authorization endpoint: `/api/agentic-apps/{appId}/authorize`

Reference apps live under `ui/apps/` and should import only the SDK/UI kit boundaries, not private CAIPE host modules.

## Operations

Use `GET /api/admin/agentic-apps/audit` to filter app events by `appId`, `decisionId`, `correlationId`, `reasonCode`, and event `type`. Technical records for PDP decisions, token grants, webhook deliveries, assistant contexts, and health snapshots are stored separately and can be retained for shorter periods.
