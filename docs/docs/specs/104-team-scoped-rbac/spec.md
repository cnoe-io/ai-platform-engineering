# Feature Specification: Team-scoped RBAC for Tools, Agents, and Knowledge Bases

**Feature Branch**: `104-team-scoped-rbac`
**Created**: 2026-04-23
**Status**: Stories 1, 2, 4 implemented; Story 3 (Slack OBO) pending

## Implementation Status

| Story | Status | Notes |
|-------|--------|-------|
| 1 — Resource-scoped CEL rules | ✅ Done | New rules added inline in `deploy/agentgateway/config.yaml` (search for "Spec 104"). Existing rules unchanged → no regression. |
| 2 — Keycloak seed for demo path | ✅ Done | `seed_spec104_main` in `init-idp.sh` creates the role bundle and assigns it to every email in `BOOTSTRAP_ADMIN_EMAILS`. |
| 3 — Slack bot OBO | ⏳ Pending | Token-exchange config exists (`deploy/keycloak/init-token-exchange.sh`) and `obo_exchange.py` has the impersonation helper, but the Slack chat path still presents the SA token. Tracked separately. |
| 4 — Admin UI: assign agents/tools to teams | ✅ Done | `Admin → Teams → <team> → Resources` tab. API at `ui/src/app/api/admin/teams/[id]/resources/route.ts`; UI in `TeamDetailsDialog.tsx`. Materializes `agent_user:<id>` / `tool_user:<server>_*` roles per member; Mongo store keeps a denormalized view for the picker. Jest coverage in `ui/src/app/api/__tests__/admin-team-resources.test.ts`. |
**Input**: User description: "We need to define team roles beyond `chat_user`, and assign team roles to tools and dynamic-agents that can be verified. This is purely wiring — once a team is created or dynamic agents are assigned to teams, teams can also be given access to tools, so the checks happen independently."

## Background and Motivation

Today CAIPE's enforcement at AgentGateway (PDP-2) is gated on a flat set of realm roles: `chat_user`, `team_member`, `kb_admin`, `admin`. Every authenticated user with `chat_user` can invoke every MCP tool, and every dynamic agent. There is no way to:

- Restrict which **MCP tools** (`jira_*`, `argocd_*`, `github_*`, …) a given team can use.
- Restrict which **dynamic agents** (`test-april-2025`, `incident-bot`, …) a given team can chat with.
- Restrict which **RAG knowledge bases** a given team can query (Spec 098 began this with KB ownership but did not surface it as roles in JWTs).

The existing AG config already comments these intentions (see `deploy/agentgateway/config.yaml` lines 80–99), with placeholder rules for `team_member` and `agent_user:<agent-id>`. This spec turns those placeholders into a working, wired model.

The trigger for landing this now is a concrete bug: chatting with the dynamic agent `test-april-2025` from Slack (and the web UI) fails to load `jira` MCP tools because:

1. The Slack bot uses its own service-account `client_credentials` token (`caipe-slack-bot`) to call Dynamic Agents on behalf of the user.
2. That SA token has `realm_access: null` — no roles at all.
3. Every `mcpAuthorization` rule in the AG config requires a role like `chat_user` to be present, so the SA is denied.

We need (a) a role model that lets *resources* (tools, agents, KBs) be assigned to *teams*, and (b) the wiring across Keycloak, AG, the Slack bot, and the Admin UI so that the right roles end up in the right tokens.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Resource-scoped CEL rules (Priority: P1)

As a platform operator, I can configure AgentGateway with CEL rules that allow MCP tool invocation only when the caller's JWT carries a `tool_user:<tool_name>` role (and similar rules for `agent_user:<agent_id>`, `team_member:<team_id>`). These rules are no-ops until anyone is granted those roles, so they are safe to roll out immediately.

**Why this priority**: This is the smallest unit of change that makes the new model expressible. Nothing else can land without it. It is also pure config — no service code change, no migration. Safe to ship behind everyone's existing access because nobody has the new roles yet.

**Independent Test**: Can be tested by:
1. Adding the rule and reloading AG.
2. Hitting `/mcp/jira` with a JWT that has only `chat_user` → existing allow rule still matches → 2xx (no regression).
3. Hitting `/mcp/jira` with a JWT that has `tool_user:jira_search_issues` only (no `chat_user`) → the new rule matches → 2xx.
4. Hitting `/mcp/jira` with a JWT that has neither → 403 (no change from today).

### User Story 2 — Keycloak seed for the demo path (Priority: P1)

As a developer running the dev compose stack, I want the `keycloak-init` job to create realm roles `tool_user:jira_*`, `agent_user:test-april-2025`, and `team_member:demo-team`, and assign them to every email listed in `BOOTSTRAP_ADMIN_EMAILS`. This unblocks the test-april-2025 demo today without touching application code.

**Why this priority**: Without this, the new CEL rules in Story 1 are unverifiable end-to-end in dev. It also gives us a known set of roles for the integration tests in Story 4 to assert against. `BOOTSTRAP_ADMIN_EMAILS` is already used as the canonical "default admins" env var in CAIPE.

**Independent Test**: Can be tested by:
1. Setting `BOOTSTRAP_ADMIN_EMAILS=sraradhy@cisco.com`.
2. Force-recreating the `keycloak-init` job.
3. Logging in via the web UI as `sraradhy@cisco.com`.
4. Decoding the access token and confirming `realm_access.roles` contains `tool_user:jira_search_issues`, `agent_user:test-april-2025`, `team_member:demo-team`.
5. Sending a chat message that triggers a jira tool — DA loads jira tools without warning.

### User Story 3 — Slack bot uses OBO instead of service-account for chat (Priority: P2)

As a CAIPE user chatting from Slack, my actual user identity (and roles) reach the Dynamic Agents service so AG enforces the same RBAC against me as the web UI does. The Slack bot's own service-account token is reserved for system tasks (channel discovery, Slack API calls) and is never accepted as a chat caller.

**Why this priority**: Without OBO, every Slack chat presents the SA's token. The SA either has *no* roles (today, returns 403), *too many* roles (admin-equivalent if we paper over it), or a static set that breaks per-user/per-team scoping. OBO is the only way to keep fine-grained RBAC working from Slack. Today's blocker — Keycloak rejecting `caipe-slack-bot` token exchange — is in scope.

**Independent Test**: Can be tested by:
1. Configuring Keycloak to allow `caipe-slack-bot` to perform token exchange to impersonate any user (admin-fine policy: only emails in `BOOTSTRAP_ADMIN_EMAILS` allowed in dev; broader policy for prod).
2. From Slack, as a linked user with `tool_user:jira_search_issues` role, sending a chat that triggers jira → tool call succeeds.
3. From Slack, as a linked user **without** that role → tool call denied at AG with 403; UI shows a clear "you don't have access to jira" message.
4. The Slack bot SA token, presented directly to DA, is rejected (DA refuses chat requests from bare SA tokens).

### User Story 4 — Admin UI: assign agents and tools to teams (Priority: P2)

As a CAIPE admin, I can in the Admin UI:
1. Create a team and add members (Keycloak users).
2. Assign one or more dynamic agents to a team.
3. Assign one or more MCP tools (or whole MCP servers) to a team.

The UI translates each assignment to the corresponding Keycloak realm role(s), so the resulting JWTs carry the assignments without any service needing to query Mongo on the auth path.

**Why this priority**: Without this, every team/agent/tool assignment is a manual `kcadm` command. Story 4 makes the model usable by humans — but Stories 1+2+3 already deliver value (CLI-driven), so this can ship after.

**Independent Test**: Can be tested by:
1. Admin logs in to the Admin UI.
2. Admin creates team `team-platform` and adds user `bob@example.com`.
3. Admin assigns agent `test-april-2025` to `team-platform`.
4. Admin assigns tool `jira_search_issues` to `team-platform`.
5. Bob logs out and back in; his token now contains `team_member:team-platform`, `agent_user:test-april-2025`, `tool_user:jira_search_issues`.
6. Bob can chat with `test-april-2025` and trigger jira_search_issues; trying to chat with a different agent he isn't assigned to is denied.

## Functional Requirements *(mandatory)*

### Role naming convention (FR-001 — frozen)

| Pattern | Meaning | Example |
|---|---|---|
| `tool_user:<tool_name>` | Caller may invoke this MCP tool name (e.g. `jira_search_issues`). The tool name is the LangChain-prefixed name `<server_id>_<tool>` produced by Dynamic Agents. | `tool_user:jira_search_issues` |
| `tool_user:*` | Caller may invoke any MCP tool (admin convenience role; do not grant in prod outside admins). | `tool_user:*` |
| `agent_user:<agent_id>` | Caller may chat with this dynamic agent. | `agent_user:test-april-2025` |
| `agent_admin:<agent_id>` | Caller may modify the agent's config (Admin UI / API). Implies `agent_user:<agent_id>`. | `agent_admin:test-april-2025` |
| `team_member:<team_id>` | Caller belongs to the team. Existing AG team-scoped rules already use this prefix. | `team_member:team-platform` |
| `team_admin:<team_id>` | Caller can manage team membership and resource assignments. | `team_admin:team-platform` |
| `admin_user` | Realm-wide superuser for the team-scoped model. Distinct from the existing flat `admin` role; equivalent to `tool_user:*` + `agent_admin:*` + `team_admin:*`. Granted automatically to every email in `BOOTSTRAP_ADMIN_EMAILS`. | `admin_user` |

Separator is `:` (matches the convention already commented in `deploy/agentgateway/config.yaml`). Role names in Keycloak may contain `:` — verified.

### CEL changes (FR-002)

`deploy/agentgateway/config.yaml` `mcpAuthorization.rules` must add:

- `("tool_user:" + mcp.tool.name) in jwt.realm_access.roles` — fine-grained per-tool allow.
- `"tool_user:*" in jwt.realm_access.roles` — wildcard for admins.
- `"admin_user" in jwt.realm_access.roles` — superuser bypass for the new model.

These are *added* to the existing rule set (allow-if-any-match). Existing `chat_user` etc. rules remain so that Stories 1+2 do not require everyone's roles to migrate at once.

`agent_user:<agent_id>` is checked at the Dynamic Agents service (PDP-3), not at AG, because AG does not know which agent is being chatted with at the `/mcp/<server_id>` boundary. The DA service already extracts `agent_id` from the request and can match against `realm_access.roles`.

### Keycloak seed (FR-003)

`charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh` must:

1. Create realm roles (idempotent): `admin_user`, `tool_user:*`, `team_member:demo-team`, `agent_user:test-april-2025`, `agent_admin:test-april-2025`, plus per-tool roles for the demo MCP servers (`jira_*`, `github_*`, `argocd_*`, `confluence_*`, `pagerduty_*`, `backstage_*`, `komodor_*`).
2. For every email in `BOOTSTRAP_ADMIN_EMAILS`, assign `admin_user` and the demo team/agent/tool roles. The user must already exist in the realm (created by IdP brokering on first login or by a separate seed).
3. Print a summary listing the roles created and the users they were assigned to.

The full per-tool enumeration is acceptable today (a few dozen roles). When the Admin UI lands (Story 4), tool roles will be created on-demand instead of seeded.

### Slack bot OBO (FR-004)

1. `caipe-slack-bot` Keycloak client gains `token-exchange` permission with a fine-grained policy: in dev, only emails in `BOOTSTRAP_ADMIN_EMAILS` may be impersonated; in prod, the policy is "any linked Slack user with a verified email".
2. The Slack bot's chat caller (`ai_platform_engineering/agents/slack/agent_slack/...`) must perform the OBO exchange and present the resulting user token (not the SA token) when calling `/api/v1/chat/stream/start` on Dynamic Agents.
3. Dynamic Agents' JWT middleware must reject any request to `/api/v1/chat/*` whose token has `azp == "caipe-slack-bot"` and no `act` claim (i.e. a bare SA token, not an exchanged user token). System endpoints (channel discovery) remain SA-callable.

### Admin UI (FR-005)

The Admin UI must expose CRUD for:
- Teams (members).
- Team → agent assignments.
- Team → tool assignments (per individual tool name).

Each mutation calls the Keycloak Admin API to create/delete realm roles and role mappings. A reconciler job (cron or on-write) keeps Mongo's denormalized "Team Foo owns…" view in sync for the UI to display, but Keycloak is the source of truth for enforcement.

## Non-Functional Requirements

- **Backward compatibility**: existing `chat_user`/`team_member`/`kb_admin`/`admin` rules remain in AG. No user loses access on rollout.
- **Audit**: every role grant/revoke from the Admin UI is logged with admin email, target user/team, role, timestamp.
- **Performance**: AG CEL evaluation is in-process; the added rules add <1ms per request. Keycloak Admin API mutations from the UI are async with optimistic UI.
- **Security**: only `admin_user` (or the legacy `admin`) can grant roles. The Admin UI checks this server-side. `BOOTSTRAP_ADMIN_EMAILS` remains the emergency bypass and must be removed in prod once a real admin exists.

## Migration Notes

- Stories 1+2 are pure additions — no existing user is affected.
- Story 3 (Slack OBO) is a behaviour change for Slack users. Cutover path: deploy AG + Keycloak changes first; flip Slack bot to OBO behind a `SLACK_USE_OBO` env flag default `false`; verify per-user; flip default to `true`; remove flag.
- Story 4 (Admin UI) is additive UI; no migration.

## Acceptance Criteria

- [ ] AG CEL config contains the three new rule patterns (FR-002) and reloads without error.
- [ ] `keycloak-init` creates the seeded roles and assigns them to `BOOTSTRAP_ADMIN_EMAILS` users (FR-003).
- [ ] A user listed in `BOOTSTRAP_ADMIN_EMAILS` can chat with `test-april-2025` from the web UI and successfully trigger a `jira_*` tool. (Story 1+2 demo unblocked.)
- [ ] A user not granted any of the new roles can still chat with the agent (legacy `chat_user` rule still allows non-`admin_*`/`rag_ingest`/`supervisor_config` tools).
- [ ] Slack bot, after OBO is enabled, presents a user token (verified by `azp != "caipe-slack-bot"` or presence of `act` claim) to DA. (Story 3.)
- [ ] Admin UI can assign and revoke `team_member`, `agent_user`, `tool_user` roles, and changes are reflected in the next user JWT after re-login. (Story 4.)
- [ ] `docs/docs/specs/098-enterprise-rbac-slack-ui/how-rbac-works.md` is updated to document the new role categories (mandated by `CLAUDE.md` "RBAC Living Documentation Rule").

## Out of Scope

- Per-row data-plane enforcement inside MCP servers (e.g. "Bob can see jira issue X but not Y"). MCPs already do this via their own auth; this spec only governs *which tools* Bob may invoke, not *which records* the tool returns.
- Replacing the existing `chat_user`/`team_member`/`kb_admin`/`admin` realm roles. Those remain as the broad-strokes baseline; the new roles are additive fine-grained scopes.
- Migrating Spec 098's KB ownership (Mongo `kb_owner_team`) into Keycloak roles. Tracked separately; can use `tool_user:rag_query_<kb_id>` later.

## Dependencies

- Spec 098 (Enterprise RBAC + Slack UI) — provides Keycloak realm, slack-bot client, BOOTSTRAP_ADMIN_EMAILS env wiring.
- Spec 102 (Comprehensive RBAC tests) — test harness will gain new cases for the team-scoped roles.
- Spec 103 (Slack JIT user creation) — JIT user must end up in the realm before OBO can target them.

## Open Questions (capture as `/speckit.clarify` before implementation)

1. Should `tool_user:*` and `admin_user` be composite roles (Keycloak feature: one role automatically grants others) or evaluated as wildcards in CEL? (Leaning composite — easier to revoke.)
2. For agent assignments, do we need both `agent_user` and `agent_admin`, or is one tier enough for v1? (Leaning both — admin can edit, user can only chat.)
3. Where does the per-tool authorization decision live for tools whose name does not include the `<server_id>` prefix (e.g. third-party MCPs that publish bare tool names)? (Likely a server-side rewrite in Dynamic Agents to always prefix.)
