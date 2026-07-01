# Multi-Webex bot registry and shared MCP plan

**Status:** Proposed
**Date:** 2026-07-01
**Initial scope:** Bot identities are created through deployment configuration. The Admin UI can select configured bots but cannot create, edit, or delete them yet.

## Summary

Introduce one config-driven Webex bot registry that represents every platform bot identity. Each registry entry references an encrypted Credentials `secret_ref`; it never contains a token value.

The registry drives two independent capabilities:

1. The inbound Webex integration can run multiple bot sessions and let an administrator select which bot is used when discovering or onboarding a space.
2. The platform exposes one logical Webex MCP server per bot while routing every logical server to the same Webex MCP deployment.

User OAuth remains separate. A Connected App such as `Webex (Pam)` can continue supplying the caller's OAuth token to `webex_meetings`; it is not a Webex bot identity and is not part of this registry.

## Identity boundaries

The implementation must preserve these distinct credential types:

| Identity | Credential type | Consumer | Example |
| --- | --- | --- | --- |
| Webex user | OAuth provider connection | `webex_meetings` MCP | Connected App `Webex (Pam)` |
| Default Webex bot | Saved bearer-token secret | Default Webex MCP and inbound integration | `webex-default-bot-token` |
| Named Webex bot | Saved bearer-token secret | Named Webex MCP and inbound integration | `webex-pam-bot-token` |
| Platform workload | Keycloak service account | Credentials retrieval and CAIPE API calls | `caipe-webex-bot` |

Bot bearer tokens must never be modeled as OAuth Providers or user Connected Apps.

## Current state

The repository already provides most of the runtime primitives:

- A Webex MCP implementation that accepts a request-scoped bearer token and can run as one shared HTTP service.
- Dynamic Agents `credential_sources` support for resolving a `secret_ref` before an MCP call.
- AgentGateway routes and request transformations for forwarding provider credentials upstream.
- An encrypted Credentials store with saved-secret metadata, payload encryption, rotation, sharing, and OpenFGA enforcement.
- Config-driven MCP server seeding.
- A Webex bot integration and Admin Webex space-management surface.
- Webex space-to-team mappings, routes, diagnostics, and OpenFGA resources.

The missing pieces are:

- No generic deployment-time importer from a Kubernetes/Compose secret into the Credentials store.
- No first-class Webex bot profile registry.
- The inbound Webex service accepts one `WEBEX_INTEGRATION_BOT_ACCESS_TOKEN` and one workspace alias.
- Admin space discovery assumes one server-level token.
- Space mappings and runtime routes do not consistently carry a bot identity.
- There is no automatic materialization of one logical Webex MCP server per configured bot.
- UI-created saved secrets default to user ownership; phase one will not add UI bot creation.

## Goals

1. Configure any number of Webex bots at deployment time without adding bot-specific application code.
2. Keep token values in Vault, Kubernetes Secrets, Compose secrets, or equivalent secret backends.
3. Import bot tokens into the encrypted Credentials store through one generic mechanism.
4. Run all Webex MCP identities through one Webex MCP pod and service.
5. Run multiple inbound Webex bot sessions from one Webex bot workload.
6. Let administrators select a configured bot before discovering or onboarding spaces.
7. Keep bot-scoped mappings, routes, diagnostics, audits, and OpenFGA resources isolated.
8. Preserve existing user OAuth behavior for `webex_meetings`.
9. Use the same domain logic for Helm and Docker Compose.

## Non-goals for phase one

- Creating, editing, or deleting bot profiles through the UI.
- Pasting or displaying bot token values in the Admin UI.
- Running one MCP pod per bot.
- Modeling bot tokens as OAuth connectors.
- Horizontal scaling or sharding of inbound bot sessions across multiple replicas.
- Migrating unrelated deployment secrets into the Credentials store.

## Proposed configuration

### Bot registry

Add `webex_bots` to the application configuration schema. Helm values can populate `caipe-ui.appConfig.webex_bots`; Docker Compose mounts the same application-config format.

```yaml
webex_bots:
  - id: default
    name: Default Webex Bot
    credential_ref: webex-default-bot-token
    default: true
    enabled: true
    inbound:
      enabled: true
      workspace_alias: default
    mcp:
      enabled: true
      server_id: webex

  - id: pam
    name: Pam
    credential_ref: webex-pam-bot-token
    enabled: true
    inbound:
      enabled: true
      workspace_alias: pam
    mcp:
      enabled: true
      server_id: webex_pam

  - id: phil
    name: Phil
    credential_ref: webex-phil-bot-token
    enabled: true
    inbound:
      enabled: true
      workspace_alias: phil
    mcp:
      enabled: true
      server_id: webex_phil
```

Validation rules:

- `id`, `workspace_alias`, `credential_ref`, and `mcp.server_id` must be stable OpenFGA-safe identifiers.
- Bot IDs and MCP server IDs must be unique.
- Exactly one enabled bot may set `default: true`.
- Every enabled capability must reference an existing or declaratively bootstrapped credential.
- Config-driven bot profiles are read-only in phase one.
- Removing a config-driven bot disables its sessions and MCP route before metadata cleanup.

The default bot is special only for backward-compatible naming and fallback behavior. Its stored bot ID is `default`, while its MCP server ID remains `webex`. Other MCP IDs use `webex_<bot-id>`.

### Generic credential bootstrap

Add a generic deployment-time saved-secret manifest owned by the Credentials subsystem:

```yaml
caipe-ui:
  credentialBootstrap:
    savedSecrets:
      - id: webex-default-bot-token
        name: Default Webex Bot Token
        type: bearer_token
        owner:
          type: organization
          id: caipe
        grants:
          serviceAccounts:
            - caipe-webex-bot
          teams:
            - caipe-internal-demo-users
        valueFrom:
          secretKeyRef:
            name: caipe-webex-tokens
            key: WEBEX_BOT_TOKEN
        rotationPolicy: create-only

      - id: webex-pam-bot-token
        name: Pam Webex Bot Token
        type: bearer_token
        owner:
          type: organization
          id: caipe
        grants:
          serviceAccounts:
            - caipe-webex-bot
          teams:
            - caipe-internal-demo-users
        valueFrom:
          secretKeyRef:
            name: caipe-webex-tokens
            key: WEBEX_PAM_TOKEN
        rotationPolicy: create-only
```

Requirements for the bootstrap implementation:

- Values contain only Secret names and keys, never plaintext token values.
- One reusable Credentials command performs validation, payload encryption, metadata writes, and OpenFGA reconciliation.
- Helm invokes the command through an idempotent Job after required services and secrets are available.
- Docker Compose invokes the same command through a one-shot service.
- The command uses Credentials service/domain APIs rather than duplicating MongoDB and OpenFGA write logic.
- `create-only` creates missing payloads but never overwrites an existing token.
- An explicit rotation policy or operator action is required to replace existing payload material.
- Failures must not print plaintext or reversible token material.
- Partial failure must be retryable and converge safely.

This generic mechanism replaces all bot-specific migration scripts.

## Persistent model

Add a `webex_bot_profiles` collection containing metadata only:

```text
id
name
credential_ref
default
enabled
inbound.enabled
inbound.workspace_alias
mcp.enabled
mcp.server_id
config_driven
created_at
updated_at
```

Token values remain in `credential_encrypted_payloads`; profile documents contain only the `secret_ref` identifier.

Application-config seeding must:

- Upsert config-driven bot profiles by stable ID.
- Mark them `config_driven: true`.
- Reconcile derived MCP server rows.
- Reconcile required OpenFGA metadata and use relationships.
- Disable removed profiles before deleting stale derived routes.
- Never delete UI-managed profiles when UI creation is added later.

## Shared MCP design

Every bot with `mcp.enabled: true` produces one logical MCP server document:

```yaml
id: webex_pam
name: Webex (Pam Bot)
transport: http
endpoint: http://caipe-agentgateway:4000/mcp/webex_pam
agentgateway_target_endpoint: http://caipe-mcp-webex-mcp:8000/mcp
credential_sources:
  - kind: secret_ref
    name: X-CAIPE-Provider-Token
    secret_ref: webex-pam-bot-token
    target: header
```

All generated records use the same upstream:

```text
webex       ----+
webex_pam   ----+--> AgentGateway --> caipe-mcp-webex-mcp:8000/mcp
webex_phil  ----+
```

Dynamic Agents resolves the route's `secret_ref` for the caller. AgentGateway rewrites `X-CAIPE-Provider-Token` into upstream `Authorization: Bearer ...`. The Webex MCP pod receives the selected bot identity per request.

The default `webex` route must also move to a `secret_ref`. Once migration is complete, the shared MCP deployment should not require a pod-level default `WEBEX_TOKEN` in Kubernetes. Removing that fallback prevents accidental use of the wrong bot when credential resolution fails.

Expected tool namespaces:

```text
webex_<tool>
webex_pam_<tool>
webex_phil_<tool>
```

Adding a bot must not create another MCP Deployment, Service, image, or listening port.

## Multi-bot inbound runtime

The Webex bot integration must load enabled profiles and start one isolated Webex session task per profile with `inbound.enabled: true`.

Each session must carry `bot_id` and `workspace_alias` through the entire event pipeline:

```text
bot profile
  -> retrieve credential through Credentials API
  -> start WDM/Mercury session
  -> receive message with bot_id context
  -> resolve (bot_id, space_id) mapping
  -> perform identity/OBO/OpenFGA checks
  -> dispatch to selected agent
  -> reply using the same bot session/token
```

Runtime requirements:

- A failure or expired token for one bot must not stop other bot sessions.
- Health and diagnostics must report status per bot without exposing token material.
- Token retrieval uses the workload's Keycloak service account and an explicit `secret_ref#use` grant.
- Token refresh/rotation triggers a targeted session restart for that bot.
- Audit events include `bot_id`, `workspace_alias`, and `space_id`.
- Phase one keeps the Webex bot workload at one replica to avoid duplicate event consumption.

`WEBEX_INTEGRATION_BOT_ACCESS_TOKEN` remains only as a temporary legacy default-bot fallback. New multi-bot code must not require one environment variable per bot.

## Admin API and UI

### API

Introduce bot-scoped control-plane endpoints:

```text
GET  /api/admin/webex/bots
GET  /api/admin/webex/bots/{bot_id}/available-spaces
GET  /api/admin/webex/bots/{bot_id}/status
POST /api/admin/webex/spaces/onboard
```

The onboarding request includes the selected bot:

```json
{
  "bot_id": "pam",
  "space_id": "<webex-space-id>",
  "team_id": "<team-slug>",
  "agent_id": "<agent-id>"
}
```

For one compatibility release, the existing unscoped `available-spaces` endpoint may resolve the configured default bot. It must not use a logged-in user's Connected App.

The UI backend retrieves the selected bot's token server-side through the Credentials subsystem. Browser responses never contain token values or secret payloads.

### Phase-one UI

Admin -> Integrations -> Webex will:

- Show a selector containing enabled config-driven bot profiles.
- Mark profiles as `Config-driven` and read-only.
- Discover only spaces visible to the selected bot.
- Include `bot_id` when onboarding a space.
- Display per-bot discovery and runtime health.
- Continue allowing manual space IDs when discovery is unavailable.

It will not offer Add Bot, Edit Bot, Delete Bot, or token-entry controls in phase one.

## Space and authorization model

Space records, routes, defaults, diagnostics, and audit lookups must use `(bot_id, space_id)` rather than `space_id` alone.

MongoDB uniqueness requirements:

```text
webex_space_team_mappings: unique(bot_id, space_id)
webex_space_agent_routes:  unique(bot_id, space_id, agent_id)
```

Use each bot's workspace alias as the existing OpenFGA workspace dimension:

```text
webex_workspace:pam
webex_space:pam--<space-id>

webex_workspace:phil
webex_space:phil--<space-id>
```

This permits multiple bots to participate in the same physical Webex space without sharing mappings, routes, or permissions accidentally.

Authorization requirements:

- Admin discovery requires permission to manage the selected Webex workspace/bot profile.
- The inbound workload gets `use` only for bot credentials it must run.
- MCP callers get bot-token `use` through explicit organization/team grants.
- The Credentials API returns token material only to trusted server-side callers.
- No bot credential is returned to browser JavaScript or stored in MCP/profile metadata.

## Reconciliation and ordering

Deployment convergence order:

1. External Secrets or Compose secrets make token source values available.
2. MongoDB, OpenFGA, Keycloak, and the UI/Credentials service become healthy.
3. The generic credential-bootstrap command creates missing saved secrets and grants.
4. Application-config seeding upserts Webex bot profiles and derived MCP server rows.
5. AgentGateway config bridge creates or updates logical Webex MCP routes.
6. The inbound Webex bot runtime retrieves enabled credentials and starts sessions.
7. Admin discovery reports per-bot readiness.

Every step must be idempotent. A retry after partial failure must converge without duplicating profiles, encrypted payloads, routes, or OpenFGA tuples.

## Backward compatibility and migration

1. Bootstrap `webex-default-bot-token` from the existing default Webex bot Vault property.
2. Bootstrap `webex-pam-bot-token` from the existing special Pam Vault property.
3. Seed `default` and `pam` bot profiles.
4. Materialize `webex` and `webex_pam` MCP records against the existing shared Webex MCP service.
5. Add `bot_id=default` to existing inbound Webex space mappings and routes.
6. Preserve the working `webex_meetings -> provider_connection:webex_pam` user OAuth path unchanged.
7. Keep legacy singleton environment-token behavior for one compatibility release.
8. Verify all default and Pam flows.
9. Remove legacy MCP pod token fallback and singleton discovery-token dependency.
10. Remove any bot-specific migration scripts, hardcoded Pam credential mappings, and manual bot-token runbooks.

The migration must not reinterpret the OAuth provider named `Webex (Pam)` as the Pam bot credential.

## Implementation phases

### Phase 1: Generic credentials bootstrap

- Add manifest types and validation.
- Add reusable Credentials reconcile command/domain service.
- Add create-only and explicit-rotation behavior.
- Reconcile owner, team, and service-account OpenFGA relationships.
- Add Helm Job and Compose one-shot invocation.
- Add status and failure reporting without secret disclosure.

### Phase 2: Bot registry and MCP materialization

- Add `webex_bots` app-config schema.
- Add `webex_bot_profiles` persistence and config-driven seeding.
- Derive logical MCP records from enabled profiles.
- Reconcile AgentGateway routes to one shared upstream.
- Convert the default Webex MCP to request-scoped `secret_ref` authentication.

### Phase 3: Multi-bot inbound runtime

- Load enabled bot profiles.
- Retrieve each credential through the Credentials API.
- Run isolated concurrent Webex sessions.
- Carry bot context through space resolution, authorization, dispatch, reply, health, and audit paths.
- Add safe targeted reload for token rotation.

### Phase 4: Admin selection and bot-scoped spaces

- Add read-only bot list and selector.
- Scope discovery by bot.
- Include `bot_id` in onboarding and management requests.
- Migrate MongoDB indexes and OpenFGA workspace identifiers.
- Update diagnostics, defaults, team bindings, and runtime controls.

### Phase 5: Cleanup

- Remove Pam-specific shortcuts and migration code.
- Deprecate and then remove singleton token environment variables.
- Remove pod-level Webex MCP default token fallback.
- Update operational documentation and examples.

## Test plan

### Credential bootstrap

- Creates metadata, encrypted payload, and OpenFGA relationships once.
- Re-running is idempotent.
- `create-only` does not rotate an existing payload.
- Explicit rotation updates only the selected secret.
- Missing source Secret/key fails clearly without leaking values.
- Helm and Compose invoke the same domain implementation.

### Registry and MCP

- Rejects duplicate bot IDs, credential refs where required, MCP IDs, and multiple defaults.
- Creates one logical MCP record for each enabled profile.
- Every generated MCP record uses the same upstream service.
- Each route resolves only its configured bot credential.
- Disabled/removed bots lose their route without affecting other bots.
- Adding bots does not increase the Webex MCP Deployment replica or pod count.

### Inbound integration

- Starts one session per enabled inbound bot.
- A failed Pam token does not stop Default or Phil.
- Incoming events retain the correct bot ID.
- Replies use the same bot identity that received the message.
- `(bot_id, space_id)` selects the correct team and agent route.
- Rotation reloads only the affected bot session.

### Admin and authorization

- Bot selector lists config-driven profiles without mutation controls.
- Discovery results differ correctly by selected bot token.
- Onboarding persists `bot_id` and writes bot-scoped OpenFGA tuples.
- The same physical space can be onboarded independently for two bots.
- Unauthorized users cannot discover spaces or retrieve credential material.
- Browser payloads and logs contain no token values.

### Regression

- `webex_meetings` continues using the caller's Connected App OAuth token.
- Default Webex MCP behavior remains available under `webex`.
- Existing default space mappings migrate to the default bot.
- AgentGateway authorization and per-agent tool grants remain enforced.

## Acceptance criteria

- A deployment can define Default, Pam, and Phil using only generic registry and credential-bootstrap configuration.
- The Admin Webex tab can select each configured bot and discover that bot's spaces.
- A space can be onboarded with an explicit bot identity.
- `webex`, `webex_pam`, and `webex_phil` appear as separate logical MCP servers.
- All three logical MCP servers use one Webex MCP pod and service.
- Tool calls from each logical MCP use the correct bot token.
- The inbound integration listens and replies as each enabled bot.
- User OAuth for `webex_meetings` remains unchanged.
- No Pam-, Phil-, or persona-specific migration code exists.
- No plaintext bot token appears in values, application config, MongoDB metadata, logs, or browser responses.

## Later UI-managed extension

After deployment-configured bots are stable, the same registry model can support UI-managed profiles:

- Admin creates an organization/team-owned saved secret.
- Admin creates a bot profile that references the saved secret.
- The platform reconciles its MCP route and inbound session dynamically.
- Config-driven profiles remain read-only; UI-managed profiles are editable.
- No chart or application restart is required for UI-managed additions.

This later phase must reuse the same profile, credential, routing, and authorization domain services rather than introduce a second implementation path.
