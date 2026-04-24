# RBAC File Map

When you need to change something in the auth path, this table tells you which file owns the behavior. Keep this file in sync whenever a new file enters the auth path — see the workspace rule in `CLAUDE.md` for the full update policy.

| What you want to change | File |
|-------------------------|------|
| Keycloak realm: roles, clients, test users | `deploy/keycloak/realm-config.json` |
| Keycloak runtime patches: silent flow, user profile, role composites, slack-bot audience mapper | `deploy/keycloak/init-idp.sh` |
| Export client secrets to env/dotenv/K8s Secret | `deploy/keycloak/export-client-secrets.sh` |
| UI session & NextAuth OIDC config | `ui/src/lib/auth.ts` |
| UI RBAC middleware (per-route role enforcement) | `ui/src/lib/api-middleware.ts` |
| Supervisor middleware stack (auth + JWT context) | `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/main.py` |
| Per-request user identity (contextvar) | `ai_platform_engineering/utils/auth/jwt_context.py` |
| JWT context middleware (Starlette) | `ai_platform_engineering/utils/auth/jwt_user_context_middleware.py` |
| Supervisor agent executor (`ENABLE_USER_INFO_TOOL`) | `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py` |
| Dynamic agents JWT validation & userinfo | `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/auth.py` |
| Dynamic agents agent-level authorization (CEL / visibility) | `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/access.py` |
| AgentGateway static CEL policies (rendered) | `deploy/agentgateway/config.yaml` |
| AgentGateway Jinja template (source of truth for rendering) | `deploy/agentgateway/config.yaml.j2` |
| `ag-config-bridge` (MongoDB → config.yaml sync + seed) | `deploy/agentgateway/config-bridge.py` |
| Admin UI: edit AG CEL policies at runtime | `ui/src/app/api/rbac/ag-policies/route.ts` |
| MongoDB collections: `ag_mcp_policies`, `ag_mcp_backends`, `ag_sync_state` | managed by `config-bridge.py` |
| Slack OBO token exchange (RFC 8693) | `ai_platform_engineering/integrations/slack_bot/utils/obo_exchange.py` |
| Slack identity auto-bootstrap + JIT branch + manual link fallback (spec 103) | `ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py` |
| Slack bot Keycloak Admin REST client — user-by-`slack_user_id` lookup, `set_user_attribute`, **and JIT `create_user_from_slack`** (spec 103). Uses `KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID/_SECRET` (surface-specific prefix leaves room for future Webex/Teams bots), distinct from UI BFF's `KEYCLOAK_ADMIN_*` | `ai_platform_engineering/integrations/slack_bot/utils/keycloak_admin.py` |
| Slack-bot email masking helper (privacy-safe log redaction, spec 103 FR-010) | `ai_platform_engineering/integrations/slack_bot/utils/email_masking.py` |
| JIT feature flags (`SLACK_JIT_CREATE_USER`, `SLACK_JIT_ALLOWED_EMAIL_DOMAINS`) — Helm | `charts/ai-platform-engineering/charts/slack-bot/values.yaml` (under `config:`) |
| JIT feature flags — Docker Compose (dev + prod) | `docker-compose.dev.yaml` and `docker-compose.yaml` (slack-bot service env) |
| Keycloak realm-management role pinning for `service-account-caipe-platform` ({view-users, query-users, manage-users}) — Helm runtime drift correction | `charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh` (`_ensure_caipe_platform_user_roles` block) |
| Keycloak realm-management role pinning — declarative source of truth | `charts/ai-platform-engineering/charts/keycloak/realm-config.json` and `deploy/keycloak/realm-config.json` (`clientRoles.realm-management` for `service-account-caipe-platform`) |
| Slack account linking UI callback | `ui/src/app/api/auth/slack-link/route.ts` |
| Slack channel → agent routing + RBAC | `ai_platform_engineering/integrations/slack_bot/utils/channel_agent_mapper.py` |
| Admin UI: channel-to-agent mappings | `ui/src/components/admin/SlackChannelMappingTab.tsx` |
| API: channel-to-agent mapping CRUD | `ui/src/app/api/admin/slack/channel-mappings/route.ts` |
| Admin API: Keycloak identities (RBAC mgmt) | `ui/src/app/api/admin/users/route.ts` |
| Admin API: per-user MongoDB activity stats (Keycloak `admin_ui#view`) | `ui/src/app/api/admin/users/stats/route.ts` |
| RBAC e2e port band + `E2E_COMPOSE_ENV` contract (spec 102) | `Makefile` (`test-rbac-up` target) + [spec 102 quickstart › E2E port band](../../specs/102-comprehensive-rbac-tests-and-completion/quickstart.md#e2e-port-band) |
| RBAC e2e env-var substitutions inside the dev compose file | `docker-compose.dev.yaml` (search for `MONGODB_HOST_PORT`, `SUPERVISOR_HOST_PORT`, `RBAC_FALLBACK_FILE`, `E2E_RUN`) |
| Shared custom MCP auth middleware — JWT/shared-key validation, localhost dev bypass, optional Keycloak PDP scope check for embedded MCPs | `ai_platform_engineering/agents/common/mcp-auth/mcp_agent_auth/middleware.py` and `ai_platform_engineering/agents/common/mcp-auth/mcp_agent_auth/pdp.py` |
| Shared custom MCP auth package docs / operator knobs for local and embedded MCP servers | `ai_platform_engineering/agents/common/mcp-auth/README.md` |
| Spec 104 team-scoped CEL rules (`tool_user:<tool>`, `tool_user:*`, `admin_user`) — added inline in MCP authorization rules block | `deploy/agentgateway/config.yaml` (search for "Spec 104") |
| Spec 104 Keycloak seed (creates `admin_user`, `tool_user:*`, `team_member:demo-team`, `agent_user:test-april-2025`, per-MCP `tool_user:<server>_*` roles; assigns the admin bundle to every email in `BOOTSTRAP_ADMIN_EMAILS`) | `charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh` (`seed_spec104_main` block; `deploy/keycloak/init-idp.sh` is a symlink to this) |
| Spec 104 spec / acceptance criteria | `docs/docs/specs/104-team-scoped-rbac/spec.md` |
| Spec 104 Story 4 — Admin UI **Team Resources** API: `GET/PUT /api/admin/teams/[id]/resources`, persists `team.resources = { agents, agent_admins, tools, tool_wildcard }` and reconciles `agent_user:<id>` / `agent_admin:<id>` / `tool_user:<prefix>` / `tool_user:*` assignments per member | `ui/src/app/api/admin/teams/[id]/resources/route.ts` |
| Spec 104 — Admin UI **Team Roles** API (catch-all realm-role assignment): `GET/PUT /api/admin/teams/[id]/roles`, surfaces the realm-role catalog grouped by prefix and reconciles `team.keycloak_roles` against members | `ui/src/app/api/admin/teams/[id]/roles/route.ts` |
| Spec 104 — Admin UI Team management dialog: Resources tab (Use+Manage per agent, MCP-server tool prefixes, `tool_user:*` wildcard) and Roles tab (MultiSelect over realm-role catalog) | `ui/src/components/admin/TeamDetailsDialog.tsx` |
| Spec 104 Story 4 — Keycloak Admin helpers used by the resources/roles APIs: idempotent `ensureRealmRole`, email→`sub` lookup `findUserIdByEmail`, `listRealmRoles` for the Roles-tab catalog | `ui/src/lib/rbac/keycloak-admin.ts` |
| Spec 104 Story 4 — `Team.resources = { agents, tools }` Mongo schema field | `ui/src/types/teams.ts` |
| Spec 098 US9 — Admin UI **Team Slack Channels** API: `GET/PUT /api/admin/teams/[id]/slack-channels`, idempotent full-replace into `channel_team_mappings` (+ optional `channel_agent_mappings` per-row), denormalises `team.slack_channels` for the team-card chip count, rejects channels already mapped to a different team (409), and validates `bound_agent_id` against `team.resources.agents` | `ui/src/app/api/admin/teams/[id]/slack-channels/route.ts` |
| Spec 098 US9 — Admin UI Slack channel discovery (server-side `conversations.list`, in-process 60s cache, 503 if `SLACK_BOT_TOKEN` unset so UI falls back to manual ID entry) | `ui/src/app/api/admin/slack/available-channels/route.ts` |
| Spec 098 US9 — Slack Channels tab inside the team-management dialog (live discovery picker, manual-ID fallback, per-row bound-agent dropdown sourced from `team.resources.agents`) | `ui/src/components/admin/TeamDetailsDialog.tsx` (`SlackChannelsPanel`) |
| Spec 098 US9 — `Team.slack_channels = [{ slack_channel_id, channel_name, slack_workspace_id, bound_agent_id }]` denormalised count for team-card chip | `ui/src/types/teams.ts` |
| Spec 104 Story 4 — Admin UI dialog with the **Resources** tab (checkboxes for agents + per-MCP tool prefixes) | `ui/src/components/admin/TeamDetailsDialog.tsx` |
| Spec 104 Story 4 — Jest coverage for resources API (auth gates, diff reconciliation, missing-KC-account handling) | `ui/src/app/api/__tests__/admin-team-resources.test.ts` |
| RAG server team/KB scope filter (`inject_kb_filter`) — datasource-level RBAC | `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py` |
| RAG hybrid ACL — per-document `acl_tags` filter (opt-in: `RBAC_DOC_ACL_TAGS_ENABLED`) | `ai_platform_engineering/knowledge_bases/rag/server/src/server/doc_acl.py` |
| RAG hybrid ACL backfill — assigns `acl_tags=["__public__"]` to existing Milvus rows before flipping the flag | `scripts/rag-doc-acl-migration.py` |
| RAG datasource **display name** (`DataSourceInfo.name`) — human-friendly label only, NEVER an authorization key. `datasource_id` remains the immutable RBAC/storage key used by Milvus filters, CEL rules, document metadata, and ingestor jobs. | `ai_platform_engineering/knowledge_bases/rag/common/src/common/models/rag.py` |
| RAG datasource name derivation helpers (`derive_friendly_name`, `derive_friendly_name_from_url`) — used by ingestors at creation and by the rag-server for lazy-backfill of legacy rows | `ai_platform_engineering/knowledge_bases/rag/common/src/common/utils.py` |
| RAG datasource rename API (`PATCH /v1/datasource/{datasource_id}` — display-label only, requires `Role.ADMIN` and `check_kb_datasource_access(scope="admin")`) | `ai_platform_engineering/knowledge_bases/rag/server/src/server/restapi.py` |
| RAG Data Sources card — show friendly `name` with monospace `datasource_id` as secondary line, inline pencil rename | `ui/src/components/rag/IngestView.tsx` |
| Spec 104 — `active_team` JWT claim design / sequence diagrams / spike notes | `docs/docs/specs/104-team-scoped-rbac/active-team-design.md` |
| Spec 104 — Per-team Keycloak client scope provisioning (`team-<slug>` + hardcoded `active_team` mapper) — Helm runtime | `charts/ai-platform-engineering/charts/keycloak/scripts/init-token-exchange.sh` (Section 10 `team-personal` block; per-team scopes are minted on demand by the BFF) |
| Spec 104 — BFF Keycloak Admin helpers for per-team client scopes: `ensureTeamClientScope`, `deleteTeamClientScope`, `isValidTeamSlug` | `ui/src/lib/rbac/keycloak-admin.ts` |
| Spec 104 — BFF startup auto-sync of slugs + KC scopes for existing teams | `ui/src/lib/rbac/team-scope-sync.ts` (called from `ui/src/instrumentation.ts`) |
| Spec 104 — Team `slug` field (immutable) + create/delete provisioning | `ui/src/types/teams.ts`, `ui/src/app/api/admin/teams/route.ts`, `ui/src/app/api/admin/teams/[id]/route.ts` |
| Spec 104 — Slack-bot OBO `impersonate_user(active_team=...)` with Keycloak scope `team-<slug>` / `team-personal` and signed-claim verification | `ai_platform_engineering/integrations/slack_bot/utils/obo_exchange.py` |
| Spec 104 — Slack channel → team-slug resolver + per-user team membership pre-check | `ai_platform_engineering/integrations/slack_bot/utils/channel_team_resolver.py` |
| Spec 104 — Slack-bot `_rbac_enrich_context` (DM → `__personal__`, group → resolver, hard-deny on missing mapping or OBO failure, no SA fallback) | `ai_platform_engineering/integrations/slack_bot/app.py` |
| Spec 104 — RAG server `UserContext.active_team` claim wiring + `extract_active_team_from_claims` | `ai_platform_engineering/knowledge_bases/rag/common/src/common/models/rbac.py`, `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py` (search for "Spec 104"), `ai_platform_engineering/knowledge_bases/rag/server/src/server/restapi.py` |
| Spec 104 — Dynamic-agents JWT middleware: accept `aud=agentgateway` + `aud=caipe-platform`, log `active_team` | `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/jwks_validate.py`, `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/jwt_middleware.py` |
| Spec 104 — AGW CEL rules require `team_member:<jwt.active_team>` for group channels (`__personal__` short-circuits team check; `admin_user` bypasses) | `deploy/agentgateway/config.yaml` (search for "active_team") |
