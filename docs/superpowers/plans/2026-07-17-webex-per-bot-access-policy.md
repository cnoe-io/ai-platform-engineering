# Webex Per-Bot Access Policy Plan

## Status

Proposed. This document defines the implementation plan only. It does not imply
that the configuration or runtime changes have been implemented.

## Goals

1. Make group-space and direct-message access policy explicit for every Webex
   bot identity.
2. Keep bot catalog, token references, policy, and policy defaults owned by the
   `webex-bot` service.
3. Let the UI discover sanitized bot metadata and policy from the authenticated
   Webex bot admin API instead of receiving duplicate configuration and tokens.
4. Keep each bot's advertised direct-message default authoritative at runtime.
5. Preserve existing OpenFGA authorization and bot-scoped group-space tuples.
6. Show inherited all-user access clearly in the UI while allowing explicit
   per-user administrative overrides.

## Current Problems

- `WEBEX_DM_ACCESS_MODE` is a deployment-wide setting, so every configured bot
  must use the same DM policy.
- `WEBEX_AUTO_ASSIGN_UNMAPPED_SPACES`, `WEBEX_DEFAULT_TEAM_SLUG`, and
  `WEBEX_DEFAULT_AGENT_ID` are also deployment-wide.
- The bot catalog, bot tokens, DM mode, and defaults are configured separately
  on `caipe-ui` and `webex-bot`.
- The UI calls Webex directly for bot and space discovery even though the
  runtime already owns and uses the bot tokens.
- UI and runtime configuration can drift, causing the UI to offer controls that
  runtime ignores or hide controls that runtime requires.
- In `all_users` mode the UI currently hides user rows rather than showing the
  inherited access and effective defaults.

## Canonical Configuration

The only deployment-owned bot catalog will be `webex-bot.bots`. Each bot must
declare separate group-space and direct-message modes.

```yaml
webex-bot:
  bots:
    - id: primary
      name: Primary Webex bot
      tokenEnv: WEBEX_PRIMARY_BOT_TOKEN
      spaces:
        accessMode: all_spaces
        defaultTeamSlug: platform
        defaultAgentId: agent-platform
      directMessages:
        accessMode: all_users
        defaultAgentId: agent-personal

    - id: restricted
      name: Restricted Webex bot
      tokenEnv: WEBEX_RESTRICTED_BOT_TOKEN
      spaces:
        accessMode: allowlist
      directMessages:
        accessMode: allowlist
```

### Group-Space Modes

| Mode | Behavior |
|---|---|
| `disabled` | Ignore group-space messages for this bot. Existing mappings remain stored but inactive at runtime. |
| `allowlist` | Handle only bot and space pairs explicitly onboarded by an administrator. The selected team and agent on the saved mapping are authoritative. |
| `all_spaces` | Automatically onboard each space where this bot receives an eligible message, using this bot's configured default team and agent. |

`all_spaces` requires both `spaces.defaultTeamSlug` and
`spaces.defaultAgentId`.

### Direct-Message Modes

| Mode | Behavior |
|---|---|
| `disabled` | Ignore direct messages for this bot. |
| `allowlist` | Handle only bot and user pairs explicitly enabled by an administrator. The saved per-user agent is authoritative. |
| `all_users` | Every enabled deployment user is inherited as enabled for this bot. Administrators may save per-user exceptions or overrides. |

`all_users` requires `directMessages.defaultAgentId` so every inherited row has
a final fallback. OpenFGA must still authorize the linked user for the selected
agent.

The old global settings will be removed:

- `WEBEX_DM_ACCESS_MODE`
- `WEBEX_AUTO_ASSIGN_UNMAPPED_SPACES`
- `WEBEX_DEFAULT_TEAM_SLUG`
- `WEBEX_DEFAULT_AGENT_ID`

No mode will be inferred from list order or from another bot. Each bot must
declare both modes explicitly.

## Effective Direct-Message Policy

The runtime resolves a bot and user pair in this order:

1. Resolve the bot by the event's explicit `bot_id`.
2. Read that bot's `directMessages.accessMode`.
3. If `disabled`, ignore the event.
4. Read any explicit `(bot_id, keycloak_user_id)` administrative override.
5. If an explicit override disables the user, ignore the event.
6. If mode is `allowlist`, require an active explicit record.
7. If mode is `all_users`, require an enabled deployment user when no explicit
   record exists.
8. Resolve the effective team and agent.
9. Verify the selected agent with the user's OBO token and OpenFGA before
   dispatch.

### Agent Resolution

For `all_users` rows without an explicit administrative override, use the
selected bot's live policy:

1. Temporary `use <agent>` override for this bot's DM room.
2. This bot's `directMessages.defaultAgentId`.

Each candidate continues to require an OpenFGA access decision. A denied
temporary override is cleared before the bot default is used. PDP
unavailability fails closed.

An explicit per-user administrative route overrides the inherited agent
default and is authoritative, matching current allowlist behavior.

### Team Resolution

- Preserve the current OpenFGA team-union behavior. A user may be authorized to
  use an agent through direct access or through one of their actual teams.
- Direct-message configuration never selects or stores a team. OpenFGA derives
  direct and team-mediated agent access from the linked user.
- The OBO token and resulting DM dispatch remain user-scoped. A team-mediated
  grant may authorize the agent, but it does not turn a 1:1 chat into team
  context.

## Effective Group-Space Policy

The group-space runtime resolves policy by event `bot_id`:

1. `disabled`: ignore group-space events for the bot.
2. `allowlist`: require the existing bot-scoped Mongo mapping, route, and
   OpenFGA installation tuples.
3. `all_spaces`: use the existing automatic assignment flow with the selected
   bot's `spaces.defaultTeamSlug` and `spaces.defaultAgentId`.

Automatic assignment must continue to write the existing bot-scoped identity:

```text
webex_bot_installation:<bot_id>--<workspace_id>--<space_id>
```

The existing MongoDB mapping, route, and OpenFGA writes remain unchanged apart
from receiving defaults from the selected bot rather than global environment
variables.

## Runtime-Owned Admin API

Extend the authenticated Webex bot admin API. Responses must never contain bot
tokens or token environment variable names.

### Bot Catalog

```text
GET /admin/webex/bots
```

Example response:

```json
{
  "bots": [
    {
      "id": "primary",
      "name": "Primary Webex bot",
      "available": true,
      "spaces": {
        "accessMode": "all_spaces",
        "defaultTeamSlug": "platform",
        "defaultAgentId": "agent-platform"
      },
      "directMessages": {
        "accessMode": "all_users",
        "defaultAgentId": "agent-personal"
      }
    }
  ]
}
```

### Space Discovery

```text
GET /admin/webex/bots/{bot_id}/spaces
```

The runtime uses the selected bot's token to call Webex and returns sanitized
space metadata. Pagination, refresh, search, and bot membership information
must retain the current UI behavior.

### Policy Lookup

Bot policy may be returned by the catalog endpoint and optionally by a focused
endpoint for mutation-time checks:

```text
GET /admin/webex/bots/{bot_id}/policy
```

UI mutations must validate against a fresh runtime policy response rather than
a cached deployment environment variable.

## UI Changes

Remove from the UI deployment:

- `caipe-ui.webexBots`
- Webex bot token environment variables and token Secret mounts used only for
  bot discovery
- `WEBEX_DM_ACCESS_MODE`
- `WEBEX_DEFAULT_TEAM_SLUG`
- `WEBEX_DEFAULT_AGENT_ID`

Change UI APIs as follows:

- `/api/admin/webex/bots` proxies the runtime bot catalog.
- `/api/admin/webex/available-spaces` proxies runtime space discovery.
- Group-space onboarding keeps the existing MongoDB and OpenFGA write paths and
  uses the exact bot ID returned by runtime.
- Direct-user management fetches the selected bot's policy from runtime before
  reading or mutating overrides.

### Direct-User Table

For the selected bot:

- `disabled`: show deployment users unchecked and read-only with a clear mode
  indicator.
- `allowlist`: show all deployment users unchecked unless an explicit active
  route exists. Admins select an agent when enabling a user.
- `all_users`: show all enabled deployment users checked by inheritance. Show
  the bot's live default agent in each row unless an administrative override
  supplies a more specific value.

Rows must distinguish:

- `Inherited`: enabled by the bot's `all_users` policy.
- `Overridden`: an administrator saved a user-specific agent or disabled
  exception.
- `Allowlisted`: explicitly enabled under `allowlist` mode.

For `all_users`, an admin may:

- Uncheck a row to create an explicit deny exception.
- Change agent to create an explicit per-user override.
- Reset a row to inherited defaults, which deletes the override document.

The UI should display both configured defaults and effective values. It must not
present inherited values as individually persisted records.

## Persistence

Continue using `webex_direct_user_routes`, keyed by
`(bot_id, keycloak_user_id)`, for explicit records.

Extend the record to represent both allowlist entries and all-user exceptions:

```json
{
  "bot_id": "primary",
  "keycloak_user_id": "user-id",
  "enabled": false,
  "agent_id": "agent-platform",
  "updated_by": "admin@example.com",
  "updated_at": "..."
}
```

Absence has mode-dependent meaning:

- `allowlist`: denied.
- `all_users`: enabled with inherited defaults.
- `disabled`: denied.

Do not copy deployment policy into MongoDB. Policy remains owned by the live
bot catalog; MongoDB stores only explicit per-user overrides.

## OpenFGA Guarantees

This refactor must not change existing OpenFGA object identities or tuple
formats.

- Group-space onboarding continues writing bot installation identity and agent
  tuples with the explicit `bot_id`.
- Group-space runtime checks continue sending `bot_id`, workspace, space, and
  agent to the BFF access-check endpoint.
- DM routes do not become authorization grants. They select a candidate agent
  and optional team context only.
- Every DM candidate still goes through the user's normal OpenFGA agent-access
  check using the OBO token.
- Bot defaults and admin overrides never bypass OpenFGA.
- Existing tuples and MongoDB routes remain usable because their bot IDs and
  object identities do not change.

## Helm Validation

Validate the canonical `webex-bot.bots` entries:

- Unique, valid `id`
- Non-empty `name`
- Valid `tokenEnv`
- Valid `spaces.accessMode`
- Valid `directMessages.accessMode`
- Required space team/agent defaults for `all_spaces`
- Required DM agent default for `all_users`
- No inline tokens

Validation should describe the supported schema. Do not add speculative checks
for fields that have never been part of the contract.

## Failure Behavior

- Invalid bot policy: fail chart rendering and fail runtime startup.
- Bot token unavailable: catalog reports the bot unavailable; that bot does not
  start a listener.
- Webex bot admin API unavailable: UI bot/space management becomes unavailable,
  but existing runtime routing and authorization continue.
- UI/BFF or OpenFGA unavailable during dispatch: fail closed.
- Unknown event `bot_id`: ignore and audit; never fall back to another bot.
- Missing required automatic defaults: fail configuration validation rather
  than selecting the first bot, team, or agent.

## Implementation Sequence

1. Define and test the per-bot policy types in the Python bot catalog.
2. Replace global group-space and DM mode/default reads with selected-bot policy
   reads.
3. Add sanitized bot catalog, policy, and space-discovery admin endpoints.
4. Change UI bot and space APIs to use the existing authenticated Webex bot
   admin client.
5. Remove the UI bot catalog, bot token handling, and duplicated policy/default
   environment variables.
6. Extend direct-user persistence and API behavior for inherited all-user rows,
   explicit deny exceptions, and per-user overrides.
7. Update the direct-user table to show inherited, allowlisted, and overridden
   states.
8. Preserve the current group-space MongoDB/OpenFGA writers and verify exact
   tuple compatibility.
9. Update Helm values, examples, Docker Compose configuration, and Webex bot
   documentation.
10. Build and test UI, Webex bot, and chart artifacts. Do not deploy as part of
    implementation verification.

## Required Tests

- Catalog parsing for mixed per-bot modes
- Required defaults for automatic modes
- Runtime isolation between bots with different policies
- `disabled`, `allowlist`, and automatic behavior for group spaces
- `disabled`, `allowlist`, and `all_users` behavior for DMs
- Live per-bot DM default resolution
- Per-bot fallback defaults and explicit per-user overrides
- Explicit deny exceptions under `all_users`
- OpenFGA denial and PDP-unavailable fail-closed behavior
- Exact bot-scoped OpenFGA tuple identities during group onboarding
- Sanitized admin API responses with no token or token-env leakage
- UI proxy authentication and runtime-unavailable handling
- UI all-user rows rendered checked with inherited defaults
- UI reset-to-inherited and explicit override behavior
- No Webex bot tokens or duplicated bot policy in the UI deployment

## Completion Criteria

- Every bot declares independent group-space and DM access modes.
- Automatic modes have complete per-bot defaults.
- UI receives bot metadata and policy only through the authenticated runtime
  admin API.
- UI no longer receives Webex bot tokens.
- All-user rows are visible, inherited as enabled, and individually overridable.
- The runtime and UI use the same live per-bot DM default.
- Existing OpenFGA tuple identities and authorization paths remain intact.
- Helm, Docker Compose, focused unit tests, UI tests, and runtime tests pass.
