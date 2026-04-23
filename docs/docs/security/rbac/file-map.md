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
| RAG server team/KB scope filter (`inject_kb_filter`) — datasource-level RBAC | `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py` |
| RAG hybrid ACL — per-document `acl_tags` filter (opt-in: `RBAC_DOC_ACL_TAGS_ENABLED`) | `ai_platform_engineering/knowledge_bases/rag/server/src/server/doc_acl.py` |
| RAG hybrid ACL backfill — assigns `acl_tags=["__public__"]` to existing Milvus rows before flipping the flag | `scripts/rag-doc-acl-migration.py` |
