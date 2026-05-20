# Using RBAC in Practice

How to bring up the stack, log in as different roles, verify denials, run the demo, and answer the questions you'll inevitably get from teammates. For the architecture and request flows, see [Architecture](./architecture.md) and [Workflows](./workflows.md).

---

## Start the Stack

```bash
COMPOSE_PROFILES='rbac,caipe-ui,caipe-mongodb' \
  docker compose -f docker-compose.dev.yaml up -d

# Confirm Keycloak is healthy before logging in
docker compose -f docker-compose.dev.yaml ps keycloak
```

Keycloak admin console: `http://localhost:7080/admin` (admin / admin)

When the `rbac` profile is selected, `caipe-ui` has an optional `depends_on`
health dependency on `keycloak`. This keeps UI startup seed/scope sync from
racing Keycloak realm import while preserving non-RBAC UI runs where Keycloak is
not selected.

The local `.env` mirrors the Grid RBAC defaults that affect auth behavior:
`KEYCLOAK_FORCE_IDP_REDIRECT=true`, `OIDC_GROUP_CLAIM=members,groups`,
deployment-specific access/admin group settings, and the RAG ingestor
`INGESTOR_OIDC_*` client-credentials settings. The compose `keycloak-init` service passes
`KEYCLOAK_FORCE_IDP_REDIRECT` through to `charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh`, so a
fresh `rbac` profile start configures the same IdP-only app-realm login path as
the Helm deployment. `OIDC_GROUP_CLAIM` and upstream access/admin group settings
feed identity sync and team membership reconciliation; RAG runtime authorization
does not map AD/OIDC groups directly to datasource roles.

For local ReBAC testing, the browser authenticates to the Web UI backend, the
backend enforces OpenFGA for KB/Data Sources/RAG MCP screens, and then
`caipe-ui` forwards the Keycloak bearer token to RAG. RAG validates the token
against Keycloak and repeats OpenFGA checks for direct API/MCP requests. Non-admin
datasource lists and search/MCP invocations are constrained to the caller's
readable `knowledge_base:<id>` relationships before the proxy call and again in
RAG. Grant Data Sources tab administration through **Settings → Knowledge Bases**, which writes
`team:<slug>#member manager admin_surface:rag_datasources`. Configure individual
datasource read/ingest/admin grants through the Team Knowledge Base assignment
or Data Sources UI for non-admin callers. Platform admins can administer concrete
datasource operations such as re-ingest through the BFF admin bypass.
`RBAC_DEFAULT_AUTHENTICATED_ROLE` is deprecated and does not grant broad RAG
access by itself.

> **Heads-up: `caipe-ui` host port is hard-pinned to `3000`.** Keycloak's `caipe-ui` client only allow-lists `http://localhost:3000/*` as a redirect URI (see `deploy/keycloak/realm-config.json`). Remapping the UI breaks the OIDC redirect dance and login fails with `Invalid redirect_uri`. The spec-102 e2e lane (`make test-rbac-up`) honours this — it remaps Mongo (`28017`) and supervisor (`28000`) to a `28xxx` band, but leaves `caipe-ui:3000` and Keycloak (`7080/7443`) untouched. See [spec 102 quickstart › E2E port band](../../specs/102-comprehensive-rbac-tests-and-completion/quickstart.md#e2e-port-band) for the full table and env-var contract.

---

## Optional Test Users (`caipe` realm)

Shared and production realms should not contain sample password users. The
Keycloak Helm chart disables them by default with `keycloak.demoUsers.enabled=false`.
Enable demo users only in an isolated local/CI RBAC test stack.

| Username | Password | Roles | Boundary to test |
|----------|----------|-------|-----------------|
| `admin-user` | `admin` | admin, chat_user | Full admin UI access |
| `standard-user` | `standard` | chat_user, team_member | Chat only, no admin UI |
| `kb-admin-user` | `kbadmin` | chat_user, team_member, kb_admin | RAG management |
| `denied-user` | `denied` | (none) | 403 on all protected routes |
| `org-b-user` | `orgb` | chat_user (tenant: globex) | Tenant isolation — sees only Globex data |

---

## Verify Role Enforcement

```bash
# Login as denied-user, try to hit a protected API directly
TOKEN=$(curl -s -X POST http://localhost:7080/realms/caipe/protocol/openid-connect/token \
  -d "grant_type=password&client_id=caipe-ui&client_secret=caipe-ui-dev-secret&username=denied-user&password=denied" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/.well-known/agent.json
# → 200 (public endpoint)

curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/rag/v1/query
# → 403 (AgentGateway ext_authz/OpenFGA denies)
```

---

## Verify ReBAC Transition Mode

Use the engineer-facing enforcement comparison endpoint to prove stale
resource-specific realm roles do not allow access once a resource type is
marked `rebac_enforced`. This migration check is not exposed in the admin UI.

```bash
curl -s -X POST http://localhost:3000/api/rbac/enforcement-comparison \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": {"type":"user","id":"alice"},
    "resource": {"type":"agent","id":"incident-agent"},
    "action": "use",
    "realm_roles": ["agent_user:incident-agent"]
  }' | python3 -m json.tool
```

Expected result for `agent=rebac_enforced`: `legacy.allowed=false`,
`legacy.ignored_roles=["agent_user:incident-agent"]`, and
`effective.source="rebac"`.

---

## Demo Walkthrough — Prove Every Gate

This script exercises **all three RBAC outcomes** at AgentGateway: `200` (ext_authz allow), `403` (ext_authz deny), `401` (jwtAuth reject). It's the cleanest live demo of the system because it shows you *which layer* fired in each case.

```bash
# 1) Get a real chat_user token from Keycloak (no UI involved)
TOKEN=$(curl -s -X POST http://localhost:7080/realms/caipe/protocol/openid-connect/token \
  -d 'grant_type=password' \
  -d 'client_id=caipe-ui' \
  -d 'client_secret=caipe-ui-dev-secret' \
  -d 'username=standard-user' \
  -d 'password=standard' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 2) Inspect the claims — prove iss, aud, roles match AG's jwtAuth expectations
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool \
  | grep -E '"(iss|aud|exp|realm_access)"'

# 3) Call AG with a valid token → ext_authz allows → proxied to RAG MCP
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST http://localhost:4000/rag/v1/query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"hello"}'
# → HTTP 200 (jwtAuth passed, OpenFGA allows)

# 4) Call AG with a denied-user token → ext_authz evaluates → 403
DENIED=$(curl -s -X POST http://localhost:7080/realms/caipe/protocol/openid-connect/token \
  -d 'grant_type=password&client_id=caipe-ui&client_secret=caipe-ui-dev-secret' \
  -d 'username=denied-user&password=denied' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $DENIED" \
  http://localhost:4000/rag/v1/query
# → HTTP 403 (jwtAuth passed — denied-user is authenticated — but OpenFGA denies)

# 5) Call AG with a forged token → jwtAuth rejects before ext_authz even runs
FORGED_JWT="not.a.real.jwt"
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $FORGED_JWT" \
  http://localhost:4000/rag/v1/query
# → HTTP 401 (signature verification fails against JWKS)

# 6) Show live config as AG sees it
curl -s http://localhost:15000/config | python3 -m json.tool | head -40
```

The three outcomes (200, 403, 401) map directly onto the distinct layers in the [per-request authorization diagram](./workflows.md#per-request-authorization-end-to-end): **ext_authz allow**, **ext_authz deny**, and **jwtAuth reject**.

---

## Enable Dynamic Agents Auth

`AUTH_ENABLED` controls the legacy Dynamic Agents user-context dependency. The
layered execution PDP also requires validated bearer identity at runtime and an
OpenFGA store with agent-use tuples. To test the full path:

```bash
# .env
AUTH_ENABLED=true
OIDC_ISSUER=http://localhost:7080/realms/caipe
OIDC_CLIENT_ID=caipe-ui
OIDC_REQUIRED_GROUP=caipe-users
DA_REQUIRE_BEARER=true
OPENFGA_HTTP=http://openfga:8080
OPENFGA_STORE_NAME=caipe-openfga
```

Use `OPENFGA_STORE_ID` instead of store-name discovery when your environment
pins the store id. With these settings, `POST /api/v1/chat/stream/start`,
`POST /api/v1/chat/invoke`, `POST /api/v1/chat/stream/resume`, and
`POST /api/v1/chat/stream/cancel` require `user:<sub> can_use agent:<agent_id>`
at the Web UI backend, and runtime start/invoke/resume repeat that check inside
Dynamic Agents.
If existing team data was seeded with email principals, both layers fallback to
`user:<email> can_use agent:<agent_id>` after the subject check fails.
The v1 chat routes and plain `/api/chat/stream` proxy also require write access
to the target conversation using implicit Mongo owner identity first and explicit
OpenFGA `conversation:<id>` relationships for non-owner access. Browser cookie
sessions are converted back into `Authorization: Bearer <accessToken>` when the
plain SSE proxy calls the supervisor backend.

The RBAC Audit tab records OpenFGA results as `OpenFGA ReBAC`. Filter by type
`OpenFGA ReBAC` to see `webui_backend` `dynamic_agent#use` checks, Dynamic Agents
runtime `dynamic_agent#use` checks, AgentGateway bridge `mcp#can_call` checks, and
admin graph/check/relationship activity from the OpenFGA ReBAC panel. The Admin UI
reads MongoDB `audit_events`, so this view works without Jaeger. To keep the
default feed useful, routine `admin_ui#view` checks are hidden unless the user
explicitly selects the `Authorization` type filter. The same default filter
applies to `admin_ui#audit.view` checks generated while viewing the audit page.

Use **Admin → Security & Policy → OpenFGA ReBAC → Access Manager** to check and
author access from one catalog-driven form without hand-writing tuple strings.
Pick a subject type (`team`, named `user`, Slack channel, Webex space, external
group, or service account), search/select the concrete subject, then pick any
universal ReBAC resource type from the catalog and one of that type's supported
actions. The panel shows the derived `can_*` check preview, a staged change-set
preview, and the operator-facing permission cheatsheet for base relationships.
Common debug paths include `team:<slug>#member can_use agent:<id>`,
`slack_channel:<workspace>--<channel> can_call tool:<server>/<tool>`, and
`user:<sub> can_call mcp_gateway:list`. When a check is denied and the current
operator has admin rights, **Grant this access** creates and applies a staged
change set for the selected base relationship, then re-runs the check. When a
check is allowed, admins can use **Revoke this access** from the same panel.

Use the subtle **View as** control beside the Admin top-level category tabs to
preview the Admin console as a real OpenFGA principal. The modal searches users by
email/name/Keycloak subject and teams by name/slug, with a `member`/`admin`
userset relation for team previews. The preview is read-only: tab visibility is
evaluated as the selected `user:<sub>` or `team:<slug>#relation`, but the browser
session remains the signed-in admin and Slack/Webex mutation controls are
disabled. Use this to answer "what would this manager see?" before granting or
revoking relationships in Access Manager.

Use **Admin → Security & Policy → OpenFGA ReBAC → Policy Graph** to inspect the
same relationships visually without starting from the full tuple blast radius.
The graph starts with teams and team usersets only; direct user nodes remain
hidden unless the user filter is applied. Use named-user search for normal
operators, or enter `user:*` / `user:<uuid>` and click **Use subject** when you
need a raw OpenFGA subject; the same scope and subject controls are available
above the canvas in the viewport-contained full-screen graph dialog. The
resource palette is searchable and multi-selectable: select any catalog-backed
resource such as agents, tools, knowledge bases, Slack channels, Webex spaces,
MCP servers, or `mcp_gateway:list`, or use
**Select all shown** / **Unselect all shown** against the current palette search
results. Selected catalog resources render on the canvas even before they have
existing OpenFGA relationships, so admins can drag/connect staged grants from a
clean starting point. Conversation resources are intentionally represented as
the typed wildcard `conversation:*` instead of one node per chat history to keep
the catalog and graph operationally readable. Slack channel → team and Webex
space → team ownership edges are shown as dashed, read-only routing metadata
from MongoDB mappings; they explain dispatch context but are not revocable
OpenFGA tuples from the graph editor. Knowledge-base entries use the canonical
RAG datasource display name when the RAG catalog is reachable, while the immutable
`knowledge_base:<datasource_id>` object remains visible as secondary text for
audits. The raw node and edge inventory sits below the graph and is collapsed by
default so operators can keep the canvas focused while still auditing the
underlying tuple list when needed.

### Authz Audit Storage

Authorization audit is MongoDB-backed in local dev. Use Admin → Security &
Policy → RBAC Audit as the durable view for OpenFGA checks and authorization
decisions; the dev compose stack does not start a separate trace backend.

See [Architecture › Component 5: Dynamic Agents](./architecture.md#component-5-dynamic-agents--the-workshop-floor) for the full env var table and what each one does.

### Slack and Webex Onboarding

Slack channel and Webex space setup use the same guided admin path:
**Discover → Configure → Apply → Verify**. The discovery step lists bot-visible
channels/spaces with row-level readiness labels:

- **Already managed** means the channel/space is already known to CAIPE; selecting
  it refreshes grants and routes.
- **Needs setup** means the bot can see the channel/space, but CAIPE still needs
  to import it, bind a team, grant the selected Dynamic Agent, and create route
  metadata.
- **Blocked** means the selected row is missing a team or Dynamic Agent and cannot
  be applied yet.

Use the outcome button (`Set up selected Slack channels` or `Set up selected
Webex spaces`) after every selected row has a team and Dynamic Agent. The apply
step flips successfully applied discovery rows back to **Already managed** in the
table, so admins can see the setup state change without opening a separate result
dialog. Use **Refresh setup status** to re-run discovery and reconcile the row
colors against the latest bot-visible state. The operation is intentionally
upsert-only: existing UI-managed or config-synced route metadata is preserved
while missing grants and default routes are ensured.

---

## Backfill OpenFGA Relationships

After enabling the Dynamic Agent execution gate, run the OpenFGA relationship
backfill so existing team/resource assignments and the configured default agent
are represented in the OpenFGA graph.

Dry-run first:

```bash
MONGODB_URI=mongodb://localhost:27017 \
MONGODB_DATABASE=caipe \
OPENFGA_HTTP=http://localhost:8080 \
OPENFGA_STORE_NAME=caipe-openfga \
APPLY=false \
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/backfill-universal-rebac.ts
```

Review the JSON summary for planned tuples, skipped identifiers, unmapped users,
and `defaultAgent`. If a dynamic default agent is configured, the active model
must allow `user:*` on `agent.can_use` and the summary should include the
default-agent grant.

Before applying in an environment that already has team members, make sure users
have logged in at least once through CAIPE so `users.keycloak_sub` is populated.
The backfill uses that persisted Keycloak subject for `user:<sub>
member/admin team:<slug>` tuples; email is only a compatibility fallback.

Apply once:

```bash
MONGODB_URI=mongodb://localhost:27017 \
MONGODB_DATABASE=caipe \
OPENFGA_HTTP=http://localhost:8080 \
OPENFGA_STORE_NAME=caipe-openfga \
APPLY=true \
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/backfill-universal-rebac.ts
```

The script records completion in MongoDB `rbac_migrations` with
`_id=openfga_relationship_backfill_v1`. Re-running with `APPLY=true` exits
without rewriting when that completed record exists. Use `FORCE=true` only when
intentionally reconciling again.

The migration writes:

- `user:<sub> member/admin team:<slug>` from team members.
- Team resource tuples for agents, tools, knowledge bases, skills, and tasks.
- `user:* can_use agent:<default_agent_id>` when the configured default is a
  dynamic agent.
- Mongo provenance in `team_membership_sources` and `rebac_relationships`.

Then backfill per-agent MCP tool restrictions so existing Dynamic Agents match
the enforcement that new agent create/update calls write automatically:

```bash
# Dry-run first
MONGODB_URI=mongodb://localhost:27017 \
MONGODB_DATABASE=caipe \
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/backfill-agent-tool-openfga.ts

# Apply after reviewing planned tuples. Apply mode reconciles existing
# agent-scoped tool tuples, including deleting stale wildcard grants that are
# no longer present in dynamic_agents.allowed_tools.
MONGODB_URI=mongodb://localhost:27017 \
MONGODB_DATABASE=caipe \
OPENFGA_HTTP=http://localhost:8080 \
OPENFGA_STORE_NAME=caipe-openfga \
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/backfill-agent-tool-openfga.ts --apply
```

This reconciles `agent:<agent_id> can_call tool:<server>/<tool>` tuples from
each agent's `allowed_tools`; empty tool arrays become `tool:<server>/*`, and
OpenFGA tuples for removed tools are deleted during apply mode.

### Admin Migration Cards

Admins can run schema-versioned migrations from **Admin → System → Migrations**.
The runtime seeds a DB-managed `migration_manifest`, compares it with
`data_schema_versions`, and shows every MongoDB collection with its current
recorded version. Collections without a `data_schema_versions` row show
`unknown`; collections that have a registered migration target also show the
runtime target version. The migration list below the version grid shows only
active pending/failed migrations by default. Use **Show completed migrations** to
review completed cards backed by `schema_migrations`. Dry-run each active card
first, review warnings and sample diffs, then type the exact confirmation phrase
shown by the UI before applying.
If an environment upgrades across multiple releases, every required migration
whose target version is newer than the collection's current DB version is
surfaced.

Bootstrap admins see a persistent **Migrations required** alert beside the header
connection status while blocking required migrations are pending. This alert is
not dismissible; it clears when migrations complete. A bootstrap admin can record
a break-glass override from the migration tab by entering a reason. Overrides are
stored in `migration_overrides`, are time-boxed, and change the alert to
**Migration override active** until the schema catches up or the override expires.

Release notes notifications are managed from **Admin → System → Settings →
Release notes**. Admins can enable the notification, set the active release
version, show a toast reminder, preview the dialog, and use **Show this on next
login for every user** to bump the announcement revision. Dismissals are stored
by announcement ID, so a new revision is shown again even when users dismissed a
previous revision. Admins can optionally show an **Open Migration Assistant**
action that deep-links to the Migrations tab; non-admins see feature notes only
and can permanently dismiss the active announcement.

The messaging additions add four cards:

- **Slack channel ReBAC grants** backfills active `slack_channel_grants` and
  route-owned `slack_channel_agent_routes` into OpenFGA tuples such as
  `slack_channel:<workspace>--<channel> user agent:<id>` and records
  `rebac_relationships` provenance.
- **Webex space ReBAC grants** mirrors that behavior for active
  `webex_space_grants` and `webex_space_agent_routes`, writing tuples such as
  `webex_space:<workspace>--<space> user agent:<id>`.
- **Messaging team mapping reconciliation** repairs missing denormalized
  `teams.slack_channels` and `teams.webex_spaces` entries from active
  `channel_team_mappings` and `webex_space_team_mappings` rows.
- **Messaging ReBAC indexes** creates the Webex messaging lookup and TTL
  indexes needed by Webex space mapping, route, grant, and link-nonce flows.

Verify the default-agent path:

```text
Check user:<any-authenticated-subject> can_use agent:<default_agent_id>
```

Expected result: allowed for the configured dynamic default agent; unrelated
agents remain denied unless the user has a direct or team-derived grant.

---

## Slack Identity Linking

**Auto mode (default):**

1. Send any message to the bot
2. Bot silently fetches your Slack email, matches it to your Keycloak account, links automatically
3. Subsequent messages: OBO exchange happens automatically — zero user action required

**Forced-link mode (`SLACK_FORCE_LINK=true`):**

1. DM the Slack bot with any message
2. If unlinked: one-time HMAC-signed link prompt (rate-limited by `SLACK_LINKING_PROMPT_COOLDOWN`)
3. Click link → SSO login → `slack_user_id` written to Keycloak via Admin API
4. Subsequent messages: OBO exchange happens automatically

The full sequence (HMAC URL shape, TTL enforcement, **JIT user creation** for unknown emails, what happens server-side) is in [Workflows › Slack identity linking](./workflows.md#slack-identity-linking-auto-bootstrap--jit--forced-link).

---

## Slack Channel Setup

Use **Admin → Integrations → Slack → Channel Setup** when onboarding an existing Slack bot workspace. The panel is split into five subtly tinted sections so operators can follow the path from discovery to verification to import:

1. **Step 1: Discover and Setup** — use **Find Slack Channels with Bot Integration** to find bot-member channels, select the channels to import, and override the team or Dynamic Agent per selected channel.
2a. **Step 2a: Verify Slack Channel ReBAC** — select the channel, inspect its team scope, OpenFGA reachability, tuple counts, runtime route candidates, and fix common drift.
2b. **Step 2b: Specify agent priority** — create or edit channel-agent associations, listen mode, and priority for the selected channel.
3. **Onboarding Default Selection** — choose only the team/agent values
   preselected in the onboarding form.
5. **Advanced Setup - Import/Sync with Slackbot** — inspect bot runtime state, reload caches, preview YAML import, and apply static Slackbot route config.

Use **Admin → Teams → Slack Channels** when assigning bot-visible channels to a
specific team. That tab auto-loads Slack discovery with `member_only=1`, so the
available list shows channels where the bot is already present. It requests the
first 50 matches on load, keeps search visible so admins can narrow large
workspaces, and uses **Load more** for additional pages. **Refresh bot channels**
invalidates the cache and re-runs discovery. The manual ID entry stays as a
fallback for private or newly-created channels that Slack discovery cannot return
yet.

If the Team or Dynamic Agent dropdown is empty, create the missing object in the
admin UI and reload the page. There is no implicit channel default at runtime:
each channel still needs an explicit setup action from discovery or the route
editor.

For runtime onboarding of new Slack channels, set `SLACK_AUTO_ASSIGN_UNMAPPED_CHANNELS=true` on the Slack bot together with `SLACK_DEFAULT_TEAM_SLUG` and `SLACK_DEFAULT_AGENT_ID`. On the first message from an unmapped group channel, the bot creates the same channel-team mapping, OpenFGA channel-agent tuple, and route metadata for the configured defaults. Keep this off unless the default team and agent are intentionally broad enough for newly invited channels.

## Slack Bot Runtime Sync

Use **Admin → Integrations → Slack → Advanced Setup - Import/Sync with Slackbot** for advanced operations: inspect the running Slack bot's route mode/cache, **Reload Bot Cache** after UI edits, or import static Slack bot YAML config into MongoDB/OpenFGA.

The legend explains the status cards and buttons inline: **Route mode** shows whether the bot is reading database routes, YAML routes, or both; **Static config** counts routes loaded from YAML; **Route cache** shows cached runtime routes and TTL; **Refresh Runtime Status** reloads those numbers; **Reload Bot Cache** makes the running bot pick up UI route edits; **Preview YAML Import** dry-runs the YAML import; and **Import from YAML Config** writes YAML routes into CAIPE/OpenFGA.

The sync flow is upsert-only:

- **Preview YAML Import** shows how many routes would be planned from the bot's loaded static config.
- **Import from YAML Config** creates missing `slack_channel_agent_routes` rows, updates matching channel/agent route metadata, and ensures the channel-agent OpenFGA tuple exists.
- Existing UI-managed associations that are not present in static config are left in place.

Use **Step 1: Discover and Setup → Find Slack Channels with Bot Integration** when the bot is already invited to Slack
channels that are not listed in static config. The UI first refreshes Slack
discovery with `member_only=1`, then renders the association table in section 1.
Newly discovered channels are selected by default; already-managed channels are
shown but left unselected unless there are no new channels. Admins can select or
clear individual rows and choose the team and Dynamic Agent for each selected
channel.
This flow preserves existing UI-managed and config-synced route metadata; it
only imports selected channel rows, writes each selected row's channel-team
mapping, ensures channel-agent OpenFGA grants, ensures the selected team-agent
grant, and creates missing default routes when route creation is enabled.

The two workflows are complementary: run **Import from YAML Config** for explicit YAML
routes, and run **Find Slack Channels with Bot Integration** to bootstrap bot-member channels
that the static config does not enumerate.

The Web UI backend must be configured with `SLACK_BOT_ADMIN_URL`, `SLACK_BOT_ADMIN_CLIENT_ID`, `SLACK_BOT_ADMIN_CLIENT_SECRET`, and `SLACK_BOT_ADMIN_AUDIENCE`. The Keycloak init job enables client credentials on `caipe-ui` and adds the `caipe-slack-bot-admin` audience mapper. The Slack bot must have `SLACK_ADMIN_API_ENABLED=true`, `SLACK_ADMIN_JWT_ISSUER`, `SLACK_ADMIN_JWKS_URL` when an internal JWKS URL is needed, `SLACK_ADMIN_JWT_AUDIENCE`, and `SLACK_ADMIN_ALLOWED_CLIENT_IDS` configured. Keep the Slack bot admin API internal to the cluster; it is not a browser-facing API.

If Slack replies with `Could not establish your team-scoped session` and bot logs show `Client not allowed to exchange`, verify the `caipe-slack-bot-token-exchange` policy is attached to all three Keycloak permissions: `caipe-slack-bot` token-exchange, users `impersonate`, and the `CAIPE_PLATFORM_AUDIENCE` target client's token-exchange permission (`caipe-platform` by default). Re-run `keycloak-init` / `keycloak-init-token-exchange` after deploying the init-script fix so existing Slack and Webex policy associations are merged instead of overwritten.

---

## Webex Spaces

Webex spaces are administered through **Admin → Integrations → Webex** and
**Admin → Teams → Webex Spaces**. They mirror Slack channel ReBAC with
Webex-specific names and storage.

### Configure the Bot

Set non-secret config in chart values or compose env:

```bash
WEBEX_WORKSPACE_ALIAS=CAIPE
KEYCLOAK_URL=http://keycloak:8080
KEYCLOAK_REALM=caipe
OPENFGA_HTTP=http://openfga:8080
OPENFGA_STORE_NAME=caipe-openfga
WEBEX_AGENT_ROUTES_MODE=db_prefer
WEBEX_THREAD_CONTEXT_ENABLED=true
WEBEX_THREAD_CONTEXT_MAX_MESSAGES=10
WEBEX_THREAD_CONTEXT_MAX_CHARS=4000
WEBEX_ADMIN_API_ENABLED=true
WEBEX_ADMIN_API_AUDIENCE=caipe-webex-bot-admin
```

When `WEBEX_INTEGRATION_BOT_ACCESS_TOKEN` is present, the bot starts its Webex
WDM websocket listener at process startup. No public webhook URL is required for
local development.

Store secrets in Kubernetes Secrets, ExternalSecrets, or local `.env`:

```bash
WEBEX_INTEGRATION_BOT_ACCESS_TOKEN=...
WEBEX_WEBHOOK_SECRET=...
WEBEX_LINK_HMAC_SECRET=...
KEYCLOAK_WEBEX_BOT_CLIENT_SECRET=...
WEBEX_BOT_ADMIN_CLIENT_SECRET=...
MONGODB_URI=...
```

`KEYCLOAK_URL`, `OPENFGA_HTTP`, and Webex workspace alias/id are ConfigMap
values. Bot tokens, webhook secrets, client secrets, and MongoDB credentials are
secrets.

### Webex Space Setup

Use **Admin → Integrations → Webex** when onboarding Webex spaces for the bot.
The tab follows a simplified Webex operator flow:

1. **Step 1: Discover and Setup** finds spaces the bot can see through
   `GET /api/admin/webex/available-spaces?refresh=1`, which calls Webex
   `/v1/rooms` with `WEBEX_INTEGRATION_BOT_ACCESS_TOKEN`. Use **Find Webex
   Spaces with Bot Integration**, select the spaces to import, and choose the
   team and Dynamic Agent per space.
2. **Step 2a: Verify Webex Space ReBAC** selects an onboarded space and runs
   the same OpenFGA/route diagnostics the Webex runtime depends on.
3. **Onboarding Default Selection** sets only the team and Dynamic Agent
   preselected during discovery-based onboarding.
4. **Advanced Setup - Import/Sync with Webex Bot** shows runtime route mode,
   static config counts, cache state, thread-context limits, and a legend
   explaining refresh, cache reload, preview, and YAML import actions.

Discovery onboarding converges through `POST /api/admin/webex/spaces/defaults`:
CAIPE records active
`webex_space_team_mappings`, denormalises the `webex_spaces` display list on the
team document, ensures the `webex_space` OpenFGA grant for the selected Dynamic
Agent, creates missing route metadata when enabled, and invalidates the Webex
bot route cache. Existing route metadata is preserved.

Webex public room IDs (`Y2lz...`) decode to
`ciscospark://us/ROOM/<uuid>`. CAIPE uses the raw UUID as the visual and
canonical `space_id` in MongoDB and OpenFGA, then re-encodes the public room ID
only when it sends messages through the Webex API.

### Grant Agents Through Onboarding

1. Open **Admin → Integrations → Webex**.
2. Use **Step 1: Discover and Setup** for bot-visible spaces.
3. Choose the team and Dynamic Agent before applying.

The UI writes `webex_space:<workspace_alias>--<raw_room_uuid> user agent:<agent_id>`
to OpenFGA and creates default dispatch metadata in `webex_space_agent_routes`.
The Webex panel no longer exposes a separate manual priority editor; route
metadata is created through onboarding/default convergence or repaired from the
diagnostics panel. MongoDB metadata is valid only while the matching OpenFGA tuple exists.
At runtime the bot reads OpenFGA route tuples with an `agent:` object-type
filter, then joins the matching MongoDB route metadata.

The **Step 2a: Verify Webex Space ReBAC** panel checks the selected space using the same
OpenFGA tuple read shape that runtime dispatch uses. If a space has no routeable
agent, diagnostics shows **Fix missing association with agent:<id>** when a
default Dynamic Agent is available. That repair creates the missing OpenFGA-backed
association with `listen: all`, priority `100`, and refreshes the diagnostics. If
the repair reports `fetch failed`, check that the UI server can reach OpenFGA with
`OPENFGA_HTTP` and the expected `OPENFGA_STORE_ID`.

Runtime denials, account-link prompts, and Dynamic Agent responses are sent as
threaded replies by preserving the incoming Webex message ID and using it as the
Webex `parentId`.

### Runtime Reload and Sync

Use **Advanced Setup - Import/Sync with Webex Bot** from the Webex Spaces panel
after editing routes or when migrating static config. The BFF uses `WEBEX_BOT_ADMIN_URL`,
`WEBEX_BOT_ADMIN_CLIENT_ID`, `WEBEX_BOT_ADMIN_CLIENT_SECRET`, and
`WEBEX_BOT_ADMIN_AUDIENCE` to call the internal Webex bot admin API with a
Keycloak client-credentials token.

### Common Denials

| Reason | Fix |
| --- | --- |
| `WEBEX_USER_NOT_LINKED` | Complete the Webex account-link flow so `webex_user_id` maps to a Keycloak user |
| `WEBEX_WORKSPACE_UNCONFIGURED` | Set `WEBEX_WORKSPACE_ALIAS` or `WEBEX_WORKSPACE_ID` |
| `WEBEX_SPACE_TEAM_NOT_FOUND` | Map the space to a team in Admin → Teams |
| `WEBEX_OBO_FAILED` | Check Keycloak Webex bot client secret, token-exchange policy, and active-team scope |
| `WEBEX_ROUTE_DENIED` | Add an enabled route for the selected space and agent |
| `missing_space_grant` | Ensure the `webex_space` OpenFGA tuple exists for the requested agent/resource |
| `pdp_unavailable` | Check CAIPE UI BFF, OpenFGA, and Webex bot route diagnostics |

If `WEBEX_OBO_FAILED` logs show `403 Forbidden`, verify the
`caipe-webex-bot-token-exchange` Keycloak policy is attached to all three
permissions: `caipe-webex-bot` token-exchange, users `impersonate`, and
the `CAIPE_PLATFORM_AUDIENCE` target client's token-exchange permission
(`caipe-platform` by default). If token exchange succeeds but the bot logs an
`active_team` mismatch, the `CAIPE_PLATFORM_AUDIENCE` client has multiple
`team-*` default client scopes; re-run the Webex BFF onboarding flow for the
space/team so it selects the expected `team-<slug>` scope.

If the bot replies `I could not complete the request. Please try again.` after
`WEBEX_DISPATCH_ALLOWED`, check the Webex bot logs for the downstream BFF
status. Webex dispatch creates or reuses a `client_type=webex` CAIPE
conversation before calling `/api/v1/chat/stream/start`; a `404 Conversation not
found` means that conversation upsert step did not run or failed.

Keep `WEBEX_AUTO_ASSIGN_UNMAPPED_SPACES=false` unless the configured default team
and agent are intentionally safe for newly observed spaces.

---

## Running the Test Suite

The comprehensive RBAC test matrix (helper unit tests + matrix-driver tests + Playwright e2e) lives under `tests/rbac/` and is owned by spec 102. Quick reference:

```bash
# Lint everything (matrix YAML, jest, ruff)
make test-rbac-lint

# Boot the full stack with the e2e port band (UI:3000, mongo:28017, supervisor:28000)
make test-rbac-up

# Run helper unit tests + the YAML-driven matrix tests (Python + Jest)
make test-rbac-pytest
make test-rbac-jest

# Run Playwright e2e (requires the stack from `make test-rbac-up`)
RBAC_E2E=1 make test-rbac-e2e

# Tear down (removes volumes)
make test-rbac-down
```

Full details — port band rationale, the `E2E_COMPOSE_ENV` contract, and how the rules-as-data matrix in `tests/rbac/rbac-matrix.yaml` flows into both pytest and Jest — are in [spec 102 quickstart](../../specs/102-comprehensive-rbac-tests-and-completion/quickstart.md).

For `caipe-ui` unit coverage, run `npm test -- --coverage --runInBand` from
`ui/`. The Jest coverage scope tracks the UI/BFF code that can be exercised
deterministically in unit tests and excludes heavyweight browser-only graph,
timeline, task-builder, RAG ingestion, and external admin-client shells that
belong in integration or browser tests.

---

## Common Questions

**Q: Why does the UI still work if Keycloak is down?**

The UI and all services cache the JWKS public key. Signature validation is local — no Keycloak call needed per request. Sessions already in flight remain valid until their `exp`. Only new logins (which need Keycloak's auth endpoint) fail.

**Q: What is `BOOTSTRAP_ADMIN_EMAILS` and when should I remove it?**

It's an emergency bypass that grants full admin regardless of JWT roles. Intended only for initial setup when Keycloak role mapping isn't yet configured. Once `admin-user` (or your real admin account) has the `admin` realm role and can log in successfully, remove `BOOTSTRAP_ADMIN_EMAILS` from your env. Leaving it in production is a standing privilege escalation risk.

**Q: Why are there both `access_token` and `obo_jwt` on `UserContext`?**

UI-sourced requests carry the user's own access token (`access_token`). Slack-sourced requests carry an OBO token (`obo_jwt` from the `X-OBO-JWT` header) — this preserves the delegator/delegatee distinction for audit purposes. The agent runtime prefers `obo_jwt` over `access_token` when forwarding to MCP tools.

**Q: What happens when the JWT expires mid-session?**

NextAuth holds the refresh token and silently refreshes before expiry. If the refresh fails (revoked session, Keycloak unavailable), the next API call returns 401 and the client redirects to login. OBO tokens issued by the Slack bot are short-lived; the bot re-exchanges on each message.

**Q: Can I add a custom role and enforce it at AgentGateway?**

Yes for application/UI roles. In Keycloak Admin: Realm Roles → Create. Add it to `default-roles-caipe` if it should be universal. Add an IdP mapper if it should come from an upstream group. For AgentGateway authorization, model the access as OpenFGA relationships instead of editing CEL rules.

**Q: Where do I look to change something?**

See [the file map](./file-map.md). Every auth-relevant file is listed with what changing it actually does.
