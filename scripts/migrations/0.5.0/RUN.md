# 0.4.0 → 0.5.0 Migration Guide

> Status: pre-release. Cuts from `prebuild/feat/comprehensive-rbac` after the
> `origin/main` merge (commit `e67a3d5e`, 2026-04-24).
>
> Chart `appVersion` will be bumped from `0.4.1` to `0.5.0` by the release
> workflow. Until then the chart still reports `0.4.1`; treat 0.5.0 as the
> next-minor target for this branch.

This document describes:

1. What changed between 0.4.0 and 0.5.0 (high-level).
2. Which code paths we kept vs. dropped during the
   `feat/comprehensive-rbac` ↔ `main` merge.
3. MongoDB collection and index changes (and the migration scripts).
4. Required env-var / Helm value changes.
5. Rollout order, rollback procedure, and follow-ups.

---

## 1. What changed in 0.5.0

0.5.0 is the **comprehensive RBAC** release. It introduces an end-to-end
team-scoped authorization model that runs through every CAIPE surface:

- **Keycloak** — realm roles (`caipe_admin`, `caipe_readonly`,
  `caipe_ingestonly`, plus per-team roles), `active_team` user attribute,
  client scopes per team, RFC 8693 token exchange (OBO).
- **Web UI / BFF** — team-aware session, NextAuth callbacks that read
  `realm_access.roles`, role-based middleware on every API route.
- **Slack bot** — JIT user creation against Keycloak, OBO token exchange
  per request, no direct Mongo writes (everything via BFF).
- **Dynamic Agents** — JWT validation middleware, forward user JWT to
  AgentGateway/MCP, `active_team` propagation through agent runtime,
  team-scoped tool listing.
- **AgentGateway** — CEL `mcpAuthorization` policies that gate every MCP
  tool by `jwt.realm_access.roles.contains(...)`.
- **RAG server** — team-scoped data sources, audit decisions, OIDC ingest.
- **Spec 102 PDP cache** — Prometheus-instrumented decision cache for the
  policy decision point.
- **Spec 104 active-team** — explicit active-team JWT claim replacing the
  legacy `X-Team-Id` header across all services.

The merge of `origin/main` (v0.4.1) into the RBAC branch landed the
v0.4.0 release squash plus three follow-up fixes. We kept the RBAC
implementation everywhere it conflicted with main's reverts.

### Headline changes vs. 0.4.0

| Area | 0.4.0 | 0.5.0 |
|---|---|---|
| Auth model | OIDC group → fixed role | OIDC group + per-team roles + `active_team` claim |
| Slack bot writes | None (already removed in 0.4.0) | None, plus JIT user creation in Keycloak |
| Slack bot tokens | Service-account bearer | OBO exchange per request |
| Dynamic Agents auth | Bearer token forwarded as-is | JWT validated; `active_team` extracted; bearer forwarded to AGW with audience-correct token |
| AGW policy | None / coarse | CEL per-tool policies driven by realm roles |
| Admin UI | Read-only RBAC view | Team management, KB assignment, NPS, Slack user linking |
| Conversation `client_type` filter | Optional in UI | Default `client_type=webui` so Slack threads do not leak into the web list |
| RAG sources | Global | Team-scoped via `team_kb_ownership` |
| Audit logging | Stdout (optional) | `authorization_decision_records` collection + Prometheus metrics |
| Charts | Per-subchart `appVersion` 0.3.10-rc.1 | All synced to 0.5.0 |

---

## 2. Code we picked going forward (merge resolution)

This section pairs with
[`docs/docs/changes/2026-04-24-merge-main-into-comprehensive-rbac.md`](../../docs/docs/changes/2026-04-24-merge-main-into-comprehensive-rbac.md)
and explains the rationale behind every batch of resolutions.

### Lockfiles, Chart.yaml, release docs — took `origin/main`

- `charts/ai-platform-engineering/Chart.yaml` and the four sub-chart
  `Chart.yaml` files: upstream version bumps to `0.4.1`. The release
  workflow will bump these again to `0.5.0`.
- `scripts/migrations/0.4.0/RUN.md`: main has the expanded migration
  guide with the new "Step 4: Migrate slack_meta to flat metadata keys"
  section.
- `docs/docs/specs/shared-conversation-api/plan.md`: `<` → `&lt;` MDX
  escape only.
- `uv.lock` (×2) and `ui/package-lock.json`: took main; **must regenerate
  per Section 5 below** to pick up branch-specific deps
  (`python-jose`, `cel-python`, etc.).

### Documentation references — honored main's deletion of DCO skill

- `skills/dco-ai-attribution/SKILL.md` was removed in main commit
  `0db78030`. We honored the deletion and inlined the DCO + AI
  attribution policy in `AGENTS.md` and `CLAUDE.md`. Spec 103 plan was
  updated to point at `AGENTS.md`.

### Config / infra — took HEAD (with a few merges)

| File | Picked | What HEAD adds that main does not |
|---|---|---|
| `Makefile` | HEAD | `test-rbac-*` targets, `E2E_PROFILES`, `E2E_COMPOSE_ENV` for spec 102 RBAC e2e suite |
| `config/app-config.yaml` | HEAD | Expanded comments and seed config for `models: []` and `mcp_servers: []` |
| `charts/ai-platform-engineering/values.yaml` | manual merge | Kept HEAD's RBAC env vars; accepted main's `skills-bootstrap` mount + `SKILLS_BOOTSTRAP_FILE` env var |
| `charts/.../slack-bot/values.yaml` | HEAD | `SLACK_JIT_CREATE_USER`, `SLACK_JIT_ALLOWED_EMAIL_DOMAINS`, `oauth2`, `keycloakAdmin` blocks |
| `charts/.../slack-bot/templates/deployment.yaml` | HEAD | Conditional `env` block for `OAUTH2_CLIENT_SECRET` + Keycloak admin client secret |
| `docker-compose.dev.yaml` | HEAD | RBAC env vars on `caipe-ui`; `AGENT_GATEWAY_URL` and `DA_REQUIRE_BEARER` on `dynamic-agents`; watchfiles hot-reload wrapper for `slack-bot`; `rag-server` (vs main's `ragserver` typo) in `depends_on` |

### `dynamic_agents/` Python (10 files) — all `--ours`

Main brought *zero* changes here since our last sync (commit
`d4e1255f`). Taking HEAD preserves the entire spec 102/103/104 RBAC
rollout:

- `auth/access.py`, `auth/auth.py` — JWT validation, active-team
  extraction, role checks.
- `services/agent_runtime.py` — forward user JWT and `active_team` to
  AGW/MCP via the bearer-token context (spec 102 P8).
- `services/middleware.py` — configurable middleware system + RBAC
  middleware merged.
- `routes/__init__.py`, `routes/agents.py`, `services/config.yaml` —
  spec 098 dynamic agents API surface and seed config (these last two
  are net-new on our branch and never existed on main).
- `models.py`, `config.py`, `main.py` — `UserContext` model, RBAC env
  vars, RBAC middleware wiring.

### `slack_bot/` Python (8 files) — all `--ours`

Same rationale. HEAD has:

- JIT Keycloak user provisioning (spec 103).
- OBO token exchange per request (`utils/obo_exchange.py`).
- RBAC middleware (`utils/rbac_middleware.py`).
- Identity linking, channel-team mapping, log redaction, email masking.
- Audit logging (`utils/audit.py`).
- Keycloak admin / authz helpers (`utils/keycloak_admin.py`,
  `utils/keycloak_authz.py`).

> **Follow-up**: cherry-pick PR #1277 (`5e3fbd34` — humble-followup
> prompt fix and `escalation_policy` field) from main. Not yet on the
> branch.

### UI (13 files) — all `--ours`

Main's v0.4.0 release squash had stripped the RBAC enforcement we added.
The clearest example is `ui/src/app/api/chat/conversations/route.ts`,
where main removed `requireRbacPermission(session, 'supervisor', 'invoke')`.
Taking HEAD preserves:

- `requireRbacPermission` calls on every state-changing API route.
- `client_type=webui` default in `lib/api-client.ts` so Slack threads
  no longer leak into the web conversation list.
- Streaming adapters with team-aware authn.
- Dynamic agent components (editor, middleware picker, chat panel) with
  team scoping.

### Auto-applied (no conflict, taken from main)

These came in cleanly during the merge but are **currently orphan** in
HEAD — no `import` references:

- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/metrics/`
  (4 files: `__init__.py`, `agent_metrics.py`, `agent_middleware.py`,
  `http_middleware.py`).
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/middleware.py`.

Decision pending: either wire them into `main.py`/`routes/__init__.py`
or delete them in a follow-up commit. They do not break anything as-is.

Also deleted by main and verified unreferenced in HEAD:

- `ai_platform_engineering/integrations/slack_bot/utils/langfuse_client.py`.

---

## 3. MongoDB changes (this is the important section)

> All changes are **additive and idempotent**. The 0.5.0 startup path
> creates indexes and back-fills via `ui/src/lib/mongodb.ts` →
> `createIndexes()` → `migrateWebFeedback()` → `migrateAgentConfigsToAgentSkills()`.

### 3.1 New collections in 0.5.0

| Collection | Owner | Purpose | Spec |
|---|---|---|---|
| `teams` | UI / BFF | Team metadata (`name`, `slug`, `created_at`, `updated_at`); slug is the Keycloak client-scope key | 098 / 104 |
| `team_kb_ownership` | UI / RAG | Maps a team (`team_id`, `tenant_id`) to a Keycloak role granting access to a KB | 098 (FR-005..) |
| `team_rag_tools` | UI / RAG | Team-scoped RAG tool configurations (`tool_id`, `team_id`, `tenant_id`, `created_by`) | 098 (FR-039) |
| `authorization_decision_records` | All services (PDP) | Audit trail of every authorization decision (`subject_hash`, `capability`, `outcome`, `correlation_id`, `tenant_id`, `ts`) | 098 FR-005 / 102 |
| `ag_mcp_policies` | UI / AGW | Dynamic CEL policy management for AGW MCP backends (`backend_id`, `tool_pattern`, `enabled`) | 098 FR-039 |
| `ag_mcp_backends` | UI / AGW | Backend registration for AGW (`id` unique) | 098 FR-039 |
| `channel_team_mappings` | Slack bot / UI | `slack_channel_id` → team mapping for channel-scoped routing | 098 US9 |
| `slack_link_nonces` | UI / Slack bot | Single-use nonces for Slack ↔ Keycloak account linking; TTL-indexed at 600 s | 098 US9 |
| `slack_user_metrics` | UI / Slack bot | Per-`slack_user_id` aggregated metrics (interaction counts, last-seen) | 098 US9 |
| `nps_responses` | UI | NPS survey responses | (admin) |
| `nps_campaigns` | UI | NPS campaign definitions | (admin) |
| `task_configs` | UI | Task Builder configs | (admin) |
| `policies` | UI | Global ASP policies for system workflows | (admin) |
| `workflow_runs` | UI | Workflow run history | (admin) |
| `hub_skills` | UI | Per-hub crawled skills cache | (skills) |

### 3.2 Existing collections — schema additions in 0.5.0

| Collection | What changed |
|---|---|
| `conversations` | New optional `client_type` already added in 0.4.0. 0.5.0 adds `metadata.team_id`, `metadata.active_team`, and `sharing.team_ids` (array) for team-scoped sharing. |
| `users` | New `metadata.keycloak_user_id`, `metadata.linked_slack_user_id`, `metadata.last_active_team`. |
| `agent_skills` | New `metadata.required_roles` (array of Keycloak roles required to invoke). |
| `feedback` | Already has `source`. 0.5.0 adds `team_id` for filtered admin queries. |

### 3.3 New indexes in 0.5.0

Created automatically on startup by `createIndexes()` in
`ui/src/lib/mongodb.ts` (lines 264–293 in HEAD):

```text
team_kb_ownership:
  { team_id: 1, tenant_id: 1 }                 unique
  { tenant_id: 1 }
  { keycloak_role: 1 }

team_rag_tools:
  { tool_id: 1 }                                unique
  { team_id: 1, tenant_id: 1 }
  { tenant_id: 1 }
  { created_by: 1 }
  { updated_at: -1 }

authorization_decision_records:
  { tenant_id: 1, ts: -1 }
  { subject_hash: 1, ts: -1 }
  { capability: 1 }
  { outcome: 1, ts: -1 }
  { correlation_id: 1 }

ag_mcp_policies:
  { backend_id: 1, tool_pattern: 1 }            unique
  { backend_id: 1 }
  { enabled: 1 }

ag_mcp_backends:
  { id: 1 }                                     unique

channel_team_mappings:
  { slack_channel_id: 1 }                       unique

slack_link_nonces:
  { nonce: 1 }                                  unique
  { created_at: 1 }                             expireAfterSeconds: 600 (TTL)

slack_user_metrics:
  { slack_user_id: 1 }                          unique
```

> The TTL index on `slack_link_nonces.created_at` deletes nonces 10 min
> after creation. Operators do **not** need to clean these up manually.

### 3.4 Backwards compatibility with 0.4.0 collections

These collections from 0.4.0 are **unchanged** and continue to be read /
written exactly as before:

`conversations`, `turns`, `stream_events`, `messages` (legacy reads
only), `slack_sessions` (legacy reads only), `users`, `user_settings`,
`conversation_bookmarks`, `sharing_access`, `agent_skills`,
`skill_hubs`, `feedback`, `platform_config`, `llm_models`,
`agent_configs` (read-only source for one-time migration),
`checkpoints_conversation`, `checkpoint_writes_conversation`.

The 0.4.0 `messages` → `turns`/`stream_events` migration is **still
required** if you are coming from a pre-0.4.0 deployment. Run those
scripts first (`scripts/migrations/0.4.0/RUN.md`), then come back here.

### 3.5 Migration scripts for 0.5.0

> Re-running these is safe — every script is idempotent.

There are no destructive migrations for 0.5.0. The new collections and
indexes are created lazily by `createIndexes()` on first BFF startup.

If you are upgrading from a deployment that has been running multiple
0.4.x versions, run these one-time backfills:

#### Step 1 (optional): Backfill `client_type` on conversations

If any conversations are still missing `client_type` (e.g. created by
an older 0.4.0-rc build), run the 0.4.0 normalisation script — it is
idempotent:

```bash
python scripts/migrations/0.4.0/migrate_conversations_schema.py --verbose
```

#### Step 2 (required if you used `slack_meta`): Flatten `slack_meta` → `metadata`

Same idempotent script from the 0.4.0 run guide, re-run as a safety
measure — 0.5.0's admin dashboard and Slack user linking expect the
flat `metadata.*` shape:

```bash
python scripts/migrations/0.4.0/migrate_slack_meta_to_metadata.py --verbose
```

#### Step 3 (new in 0.5.0): Seed default teams

If you have any pre-existing `caipe_*` Keycloak roles that should be
treated as teams, create matching `teams` docs so
`syncTeamScopesOnStartup()` (in `ui/src/lib/rbac/team-scope-sync.ts`)
will provision the corresponding Keycloak client scopes on next BFF
boot:

```bash
mongosh "$MONGODB_URI/$MONGODB_DATABASE" --eval '
db.teams.insertMany([
  { name: "Platform",        slug: "platform",        created_at: new Date(), updated_at: new Date() },
  { name: "Data Engineering", slug: "data-eng",       created_at: new Date(), updated_at: new Date() }
]);'
```

> Slugs **must** match `^[a-z0-9-]{1,32}$` (validated by
> `isValidTeamSlug`). They become Keycloak client-scope names of the
> form `team_<slug>`.

#### Step 4 (new in 0.5.0): Seed `channel_team_mappings` (optional)

Map Slack channels to teams so the bot routes inbound messages with the
right `active_team`:

```bash
mongosh "$MONGODB_URI/$MONGODB_DATABASE" --eval '
db.channel_team_mappings.insertOne({
  slack_channel_id: "C12345",
  team_slug: "platform",
  created_at: new Date()
});'
```

#### Step 5 (new in 0.5.0): Verify

```bash
mongosh "$MONGODB_URI/$MONGODB_DATABASE" --eval '
print("=== teams ==="); print(db.teams.countDocuments());
print("=== team_kb_ownership ==="); print(db.team_kb_ownership.countDocuments());
print("=== team_rag_tools ==="); print(db.team_rag_tools.countDocuments());
print("=== ag_mcp_policies ==="); print(db.ag_mcp_policies.countDocuments());
print("=== ag_mcp_backends ==="); print(db.ag_mcp_backends.countDocuments());
print("=== channel_team_mappings ==="); print(db.channel_team_mappings.countDocuments());
print("=== authorization_decision_records (last hour) ==="); print(
  db.authorization_decision_records.countDocuments({ ts: { $gte: new Date(Date.now() - 3600000) } })
);
print("=== slack_link_nonces (live) ==="); print(db.slack_link_nonces.countDocuments());
print("=== slack_user_metrics ==="); print(db.slack_user_metrics.countDocuments());
'
```

A healthy 0.5.0 deployment should be writing to
`authorization_decision_records` continuously.

---

## 4. Required env-var / Helm value changes

### Keycloak

Run the updated `init-idp.sh` (in
`charts/ai-platform-engineering/charts/keycloak/scripts/`) once after
upgrade. It is idempotent. Key changes:

- Adds the standard `client roles` protocol mapper to the `roles`
  client scope so the `caipe-platform` service account token includes
  `resource_access.realm-management.roles`.
- Adds the `realm-roles` mapper writing to the **standard nested**
  `realm_access.roles` claim (instead of a flat custom claim).
- Adds the `active_team` user-attribute mapper.
- Adds per-team client scopes (`team_<slug>`) that
  `syncTeamScopesOnStartup` will create or refresh from the `teams`
  collection.

### BFF / UI

```bash
# OBO + Keycloak admin
KEYCLOAK_URL=http://keycloak:7080
KEYCLOAK_REALM=caipe
KEYCLOAK_ADMIN_CLIENT_ID=caipe-platform
KEYCLOAK_ADMIN_CLIENT_SECRET=...

# Default team scoping fall-back (used when active_team is missing)
RBAC_DEFAULT_TEAM=platform

# Skip the team-scope sync (useful for local dev without Keycloak)
SKIP_TEAM_SCOPE_SYNC=0

# OIDC group → role mapping (existing in 0.4.0; still required)
RBAC_ADMIN_GROUPS=caipe_admin
RBAC_READONLY_GROUPS=caipe_readonly
RBAC_INGESTONLY_GROUPS=caipe_ingestonly
```

### Dynamic Agents

```bash
AGENT_GATEWAY_URL=http://agent-gateway:8080
DA_REQUIRE_BEARER=true            # reject unauthenticated requests
DA_FORWARD_USER_JWT=true          # spec 102 P8
```

### Slack bot

```bash
# OBO via OAuth2 client credentials (replaces service-account bearer)
OAUTH2_TOKEN_URL=http://keycloak:7080/realms/caipe/protocol/openid-connect/token
OAUTH2_CLIENT_ID=caipe-slack-bot
OAUTH2_CLIENT_SECRET=...

# JIT user creation (spec 103)
SLACK_JIT_CREATE_USER=true
SLACK_JIT_ALLOWED_EMAIL_DOMAINS=cisco.com,outshift.com
KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID=caipe-slack-bot-admin
KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET=...

# RBAC enforcement on the Slack side
SLACK_RBAC_ENABLED=true
```

### AgentGateway

CEL `mcpAuthorization` rules in `deploy/agentgateway/config.yaml` now
use `jwt.realm_access.roles.contains(...)` instead of the standard CEL
`has()` / `in` / `.exists()` operators. This is **required** because
AGW's `cel-rust` fork does not implement those operators correctly for
dynamic JWT array claims. See
`docs/docs/specs/104-team-scoped-rbac/active-team-design.md` for the
full caveat.

---

## 5. Rollout order

1. **Backup MongoDB**
   ```bash
   mongodump --uri="$MONGODB_URI" --out=backup-pre-0.5.0
   ```
2. **Stop dependent services** (or accept brief 401s during the cutover):
   `caipe-supervisor`, `caipe-ui`, `dynamic-agents`, `slack-bot`,
   `agent-gateway`.
3. **Upgrade Keycloak realm** by re-running the bundled `init-idp.sh`.
   This is idempotent and only adds mappers and client scopes.
4. **Regenerate lockfiles** (we took main's during the merge):
   ```bash
   uv sync                                                                   # repo root
   (cd ai_platform_engineering/dynamic_agents && uv sync)
   (cd ai_platform_engineering/integrations/slack_bot && uv sync)
   (cd ui && npm install)
   ```
5. **Rebuild images** for the four services that changed:
   ```bash
   docker compose -f docker-compose.dev.yaml build \
     caipe-supervisor caipe-ui dynamic-agents slack-bot
   ```
6. **Run any required Mongo backfills** (Section 3.5, Steps 1–4).
7. **Start services**. The BFF will create indexes and run the legacy
   `migrateWebFeedback` / `migrateAgentConfigsToAgentSkills`
   migrations on first boot — they are no-ops on a clean 0.5.0 DB.
8. **Smoke-check** that
   `db.authorization_decision_records` is being written to and that
   `/api/chat/conversations` returns only `client_type=webui`
   conversations from the web UI.

---

## 6. Rollback

- **Code rollback**: deploy the previous image tags. The new collections
  (`teams`, `team_kb_ownership`, `team_rag_tools`,
  `authorization_decision_records`, `ag_mcp_policies`,
  `ag_mcp_backends`, `channel_team_mappings`, `slack_link_nonces`,
  `slack_user_metrics`) are unread by 0.4.x and can be left in place.
- **Mongo rollback**: not required. All schema additions are additive
  and 0.4.x ignores the new fields. If you must roll back to a clean
  0.4.0 state, restore the `mongodump` from Step 1.
- **Keycloak rollback**: roles, mappers, and client scopes added by
  `init-idp.sh` are inert when the consuming services are not running.
  No removal needed.
- **Branch rollback**: the merge commit on the RBAC branch is
  `e67a3d5e`. To undo on the PR:
  ```bash
  git reset --hard backup/comprehensive-rbac-pre-merge-20260424-091821
  git push --force-with-lease origin prebuild/feat/comprehensive-rbac
  ```

---

## 7. Known follow-ups before shipping 0.5.0

| # | Item | Owner | Severity |
|---|---|---|---|
| 1 | Cherry-pick PR #1277 (`5e3fbd34` — humble-followup prompt + `escalation_policy` field) into the RBAC branch | TBD | low |
| 2 | Decide fate of orphan modules: `dynamic_agents/metrics/*` and `dynamic_agents/routes/middleware.py` (wire in or remove) | TBD | low |
| 3 | Regenerate `uv.lock` (×2) and `package-lock.json` against branch deps | TBD | required before release |
| 4 | Investigate 13 pre-existing `ui/src/app/api/skills/` test failures already on `origin/main` (3 suites: `bootstrap`, `install.sh`, `helpers/caipe-skills.py`) | TBD | not a regression of 0.5.0 |
| 5 | Bump chart `version` and `appVersion` to `0.5.0` via the release workflow | release | required |
| 6 | Update `docs/docs/specs/098-enterprise-rbac-slack-ui/how-rbac-works.md` to reference the merge ADR | docs | done in this PR |

---

## 8. References

- Merge commit: `e67a3d5e` (2026-04-24)
- Backup branch: `backup/comprehensive-rbac-pre-merge-20260424-091821`
- ADR: [`docs/docs/changes/2026-04-24-merge-main-into-comprehensive-rbac.md`](../../docs/docs/changes/2026-04-24-merge-main-into-comprehensive-rbac.md)
- 0.4.0 migration: [`scripts/migrations/0.4.0/RUN.md`](../0.4.0/RUN.md)
- 0.3.0 migration: [`scripts/migrations/0.3.0/RUN.md`](../0.3.0/RUN.md)
- Spec 098 — Enterprise RBAC + Slack + UI
- Spec 102 — Comprehensive RBAC tests + PDP cache + decision metrics
- Spec 103 — Slack JIT user provisioning
- Spec 104 — Team-scoped RBAC with `active_team`
- AGW CEL caveat: [`docs/docs/specs/104-team-scoped-rbac/active-team-design.md`](../../docs/docs/specs/104-team-scoped-rbac/active-team-design.md)
- PR: <https://github.com/cnoe-io/ai-platform-engineering/pull/1257>
