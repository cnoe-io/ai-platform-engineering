# Research: RBAC / PDP Inventory and CAS Migration Map

**Date:** 2026-06-06
**Purpose:** Inventory every authorization surface in the codebase, document its current approach, and map how it migrates to CAS.

---

## 1. Surface inventory

### 1.1 BFF — `ui/src/`

| File | Function | PDP | Resource / Action | Anti-patterns |
|------|----------|-----|-------------------|---------------|
| `lib/rbac/openfga-agent-authz.ts` | `requireAgentUsePermission` | OpenFGA direct + team-union | `agent:id / can_use` | Returns `NextResponse\|null` (mixed concerns); leaks `agent#use` + `pdp_denied` in error body |
| `lib/rbac/pdp-shared.ts` | `evaluateAgentAccess` | OpenFGA direct + parallel team-union | `agent:id / can_use` | Second independent agent-use algorithm; different return shape from above |
| `lib/rbac/resource-authz.ts` | `requireResourcePermission` `requireAgentPermission` `requireSkillPermission` `filterResourcesByPermission` | OpenFGA via `checkOpenFgaTuple` | All resource types / all actions | Action→relation map lives here (not in adapter); `openFgaRelationForResourceAction` is FGA-internal logic in a shared module |
| `lib/rbac/openfga-team-membership.ts` | `listUserTeamSlugs` | OpenFGA list-objects | `team#member` | Per-subject 60s LRU cache — not shared with decision cache |
| `lib/rbac/conversation-implicit-authz.ts` | `requireConversationResourcePermission` `filterConversationsByImplicitOrExplicitPermission` | OpenFGA + implicit owner bypass | `conversation / write` | Implicit owner logic embedded in authz module |
| `lib/rbac/keycloak-authz.ts` | `checkPermission` `checkPermissions` `getEffectivePermissions` | Keycloak UMA (legacy) | Any | Deprecated; kept for legacy compatibility |
| `app/api/user/check_agent_access/route.ts` | POST handler | BFF in-process (calls `evaluateAgentAccess`) | `agent:id / can_use` | Ad-hoc PDP endpoint; not versioned; used by Slack/Webex bots |

### 1.2 Dynamic Agents — `ai_platform_engineering/dynamic_agents/`

| File | Function | PDP | Resource / Action | Anti-patterns |
|------|----------|-----|-------------------|---------------|
| `auth/openfga_authz.py` | `require_agent_use_permission` | OpenFGA direct | `agent:id / can_use` | Store ID re-resolved per call via HTTP; own Mongo audit writes; JWT base64-decoded without re-verification; leaks `agent#use` + `pdp_denied` in HTTP error detail |
| `auth/keycloak_authz.py` | `require_da_permission` | Shared util Keycloak → OpenFGA | `dynamic_agent:id#scope` | Thin wrapper; calls shared utils path |
| `auth/access.py` | `can_view_agent` `can_use_agent` `can_access_conversation` | In-memory (no PDP) | `agent / visibility` | Visibility enum check only; no tuple enforcement; deprecated for fine-grained |
| `auth/jwt_middleware.py` | `JwtAuthMiddleware.dispatch` | Keycloak JWKS validation | Bearer token | Lenient mode allows `X-User-Context` fallback when `DA_REQUIRE_BEARER=false` — #1730 vector |

### 1.3 RAG Server — `ai_platform_engineering/knowledge_bases/rag/`

| File | Function | PDP | Resource / Action | Anti-patterns |
|------|----------|-----|-------------------|---------------|
| `server/rbac.py:556` | `authorize_search` | OpenFGA `organization#can_search` | org / search | `RBAC_TEAM_SCOPE_ENABLED` flag scattered; client-creds bypass inline |
| `server/rbac.py:678` | `authorize_mcp_tool_manage` | OpenFGA `mcp_tool#can_manage` | mcp_tool / manage | Coarse ADMIN bypass inline |
| `server/rbac.py:716` | `authorize_mcp_tool_create` | OpenFGA `team#can_use` | mcp_tool / create | Mongo team-membership lookup in hot path |
| `server/rbac.py:918` | `check_datasource_access` | OpenFGA `data_source#can_read/can_ingest/can_manage` | data_source / read, ingest, manage | Redundant org-admin bypass |
| `server/rbac.py:874` | `get_accessible_datasource_ids` | OpenFGA list-objects | data_source / read | N sequential checks before list-objects added |
| `server/rbac.py:831` | `derive_team_for_request` | MongoDB lookup (`channel_team_mappings → teams`) | — (team resolution) | Mongo query per request; degrades silently on Mongo failure |
| `server/rbac.py:1101` | `inject_kb_filter` | Delegates to `get_accessible_datasource_ids` | data_source / read | Mutates query in-place; early-exit on empty set |
| `server/rbac.py:973` | `authorize_datasource_create` | OpenFGA `team#can_use` + tuple write | data_source / create | Mongo team-slug resolution; own tuple write after create |
| `server/auth.py` | `OIDCProvider.validate_token` `AuthManager.validate_token` | Keycloak JWKS | Bearer JWT | Dual-provider chain (UI + ingestor); 1h JWKS cache |

### 1.4 Slack Bot — `ai_platform_engineering/integrations/slack_bot/`

| File | Function | PDP | Resource / Action | Anti-patterns |
|------|----------|-----|-------------------|---------------|
| `utils/rbac_middleware.py` | `require_permission` | Shared util → Keycloak → OpenFGA | `resource#scope` (org-level) | Tenant extracted from OBO JWT `org` claim; decorator pattern leaks detail into Slack ephemeral messages |
| `utils/dm_authz_client.py` | `DmAuthzClient.check_agent_access` | BFF `/api/user/check_agent_access` (HTTP) | `agent:id / can_use` | Calls the ad-hoc unversioned BFF PDP endpoint; fail-closed on transport error |

### 1.5 Shared Utils — `ai_platform_engineering/utils/auth/`

| File | Function | PDP | Resource / Action | Anti-patterns |
|------|----------|-----|-------------------|---------------|
| `keycloak_authz.py:250` | `require_rbac_permission` | OpenFGA `organization#<relation>` | org-level resource+scope → computed relation | Store ID re-resolved per-call (no env var set → HTTP lookup every time); token-hash cache (60s) |
| `keycloak_authz.py:321` | `require_rbac_permission_dep` | Same, FastAPI dependency wrapper | — | Reads from `current_bearer_token` ContextVar |

---

## 2. Duplication map

The same decision logic is implemented independently across surfaces:

| Decision | Implementations | Lines |
|----------|----------------|-------|
| `user can_use agent` | `openfga-agent-authz.ts` · `pdp-shared.ts` · `openfga_authz.py` | ~300 lines × 3 |
| OpenFGA store-id resolution | `openfga.ts` (BFF) · `openfga_authz.py` (DA) · `rbac.py` (RAG) · `keycloak_authz.py` (utils) | 4× |
| OpenFGA HTTP client setup | Same 4 files | 4× |
| Mongo audit write | `openfga_authz.py` (DA) · `rbac.py` (RAG) | 2× separate schemas |
| Action→relation map | `resource-authz.ts` (`openFgaRelationForResourceAction`) · `keycloak_authz.py` (`_organization_relation_for`) | 2× |
| JWT payload decode (unsigned) | `openfga_authz.py` · `keycloak_authz.py` · `rbac_middleware.py` | 3× |

---

## 3. Anti-patterns by severity

| Severity | Anti-pattern | Location |
|----------|-------------|----------|
| **P1 — Security** | `X-User-Context` trusted when `DA_REQUIRE_BEARER=false` — forgeable identity [#1730] | `jwt_middleware.py` lenient mode |
| **P1 — Security** | `agent#use` + `pdp_denied` leaked in HTTP error body → reveals PDP internals to caller | `openfga_authz.py:433`, `openfga-agent-authz.ts` |
| **P2 — Reliability** | OpenFGA store-id re-resolved via HTTP on every authz call (4 separate implementations) | DA, RAG, utils, BFF |
| **P2 — Reliability** | New `httpx.AsyncClient` per request in RAG `rbac.py` | `rbac.py:_openfga_check_object` |
| **P2 — Reliability** | Mongo channel→team lookup in hot path; silent degradation on failure | `rbac.py:derive_team_for_request` |
| **P3 — Correctness** | Two independent `user can_use agent` algorithms in BFF with different return shapes | `openfga-agent-authz.ts` vs `pdp-shared.ts` |
| **P3 — Correctness** | `RBAC_TEAM_SCOPE_ENABLED` conditional scattered across 3 functions in `rbac.py` | lines 570, 925, 996 |
| **P3 — Maintainability** | Action→relation map duplicated; each site could drift independently | `resource-authz.ts` vs `keycloak_authz.py` |
| **P3 — Maintainability** | Mongo audit schema differs between DA and RAG; no shared shape | `openfga_authz.py` vs `rbac.py` |

---

## 4. CAS migration map

Each surface migrates in two steps: (1) CAS ships standalone, (2) surface flips from its current PDP to calling CAS. Step 1 is the spec in `spec.md`. Step 2 is per-surface work.

### 4.1 BFF agent-use (two algorithms → one)

**Current:** `requireAgentUsePermission` (openfga-agent-authz.ts) + `evaluateAgentAccess` (pdp-shared.ts) — two independent implementations, different return shapes.

**Migration:** Both become thin wrappers over `authorizeOrThrow` / `authorize` from `lib/authz/index.ts`. The direct+team-union algorithm moves into `lib/authz/index.ts` as the canonical implementation. The bot-facing `/api/user/check_agent_access` route calls `authorize()` and returns its `Decision`.

**What changes:** Delete `openfga-agent-authz.ts`; `pdp-shared.ts` becomes a re-export shim then deleted. Zero behavior change.

### 4.2 BFF resource authz

**Current:** `resource-authz.ts` — `requireResourcePermission`, `filterResourcesByPermission`, action→relation map.

**Migration:** `requireResourcePermission` → `authorizeOrThrow`. `filterResourcesByPermission` → `filterAccessible`. The action→relation map moves into `engines/openfga.ts`; `resource-authz.ts` stops knowing about FGA strings.

**What changes:** `resource-authz.ts` becomes a thin call-through; action→relation map is internal to the adapter. Exported function signatures unchanged for existing callers.

### 4.3 BFF bot-facing PDP endpoint

**Current:** `POST /api/user/check_agent_access` — ad-hoc, unversioned, calls `evaluateAgentAccess`.

**Migration:** 
- **Option A (preferred):** Slack/Webex bots switch from `/api/user/check_agent_access` to `POST /api/authz/v1/decisions` with `resource.type=agent, action=use`. The new endpoint is versioned and carries `ReasonCode`.
- **Option B (interim):** `/api/user/check_agent_access` internally calls `authorize()` from the core (one-line change), keeping the old URL alive until bots migrate.

**What changes (option A):** `DmAuthzClient` updated to call the v1 endpoint. Old route deprecated.

### 4.4 Dynamic Agents — `require_agent_use_permission`

**Current:** Own OpenFGA HTTP client; store-id re-resolved per call; own Mongo audit writes; own OTEL spans.

**Migration:** Replace the entire function body with `POST /api/authz/v1/decisions` (Transport B). DA sends `{subject, resource:{type:agent,id}, action:use}` with its Bearer token. CAS evaluates and audits; DA enforces the `Decision`.

**What's deleted:** `openfga_authz.py` — the entire file. DA drops `httpx` OpenFGA calls, Mongo audit client, OTEL authz span export. Only the HTTP call to CAS remains.

**What stays:** `jwt_middleware.py` (DA still validates its own inbound Bearer JWT). `keycloak_authz.py` coarse wrapper stays until org-level Keycloak gates also migrate.

**Prerequisite:** `DA_REQUIRE_BEARER=true` must be enforced first to close [#1730] before DA can trust `token.sub` as the subject it sends to CAS.

### 4.5 RAG — search, datasource, MCP tool gates

**Current:** `rbac.py` (1158 lines) — roles + OpenFGA + Mongo channel→team lookup, all inline.

**Migration path:**

| RAG Function | CAS Call |
|---|---|
| `authorize_search` | `POST /api/authz/v1/decisions` `{resource:{type:knowledge_base,id:org},action:discover}` |
| `authorize_datasource_create` | `POST /api/authz/v1/decisions` `{resource:{type:data_source,id:owner_team},action:ingest}` |
| `check_datasource_access` | `POST /api/authz/v1/decisions` `{resource:{type:data_source,id},action:read\|ingest\|manage}` |
| `get_accessible_datasource_ids` | `POST /api/authz/v1/decisions:batch` `{resource_type:data_source,action:read,ids:[…]}` |
| `authorize_mcp_tool_manage` | `POST /api/authz/v1/decisions` `{resource:{type:mcp_tool,id},action:manage}` |
| `inject_kb_filter` | calls `filterAccessible` equivalent via `:batch` |

**Channel→team lookup:** `derive_team_for_request` moves into CAS `domains/slack-channel.ts` + `domains/webex-space.ts`. RAG stops reading `channel_team_mappings` from Mongo; sends `X-Channel-Id` as context to CAS, which resolves the team internally.

**Coarse roles:** `READONLY/INGESTONLY/ADMIN` demoted to a local pre-filter for client-credentials/automation tokens only. Human-path decisions go to CAS.

**What's deleted from `rbac.py`:** OpenFGA client, store-id resolution, Mongo channel-team lookup, audit writes. What remains: role enum, `require_authenticated_user`, coarse pre-filter, thin CAS HTTP calls.

### 4.6 Slack bot middleware

**Current:** `rbac_middleware.py` → shared util `require_rbac_permission` → OpenFGA `organization#<relation>`.

**Migration:** Replace `check_permission(RbacCheckRequest)` call with `POST /api/authz/v1/decisions`. The decorator keeps the same interface; only the underlying HTTP call changes.

**`DmAuthzClient`:** Migrates to v1 endpoint per §4.3 option A.

### 4.7 Shared utils `keycloak_authz.py`

**Current:** `require_rbac_permission` — org-level OpenFGA gate with token-hash cache; re-resolves store-id.

**Migration:** `require_rbac_permission` → `POST /api/authz/v1/decisions` for resource+action pairs that map to CAS `ResourceType`. The token-hash cache is subsumed by CAS's own decision cache (15s TTL). The function becomes a thin HTTP wrapper.

**Store-id re-resolution:** Eliminated — CAS caches this at boot.

---

## 5. Migration priority

| Priority | Surface | Driver |
|----------|---------|--------|
| **1** | DA `require_agent_use_permission` | Closes [#1730] P1 (after `DA_REQUIRE_BEARER=true`); eliminates riskiest OpenFGA reimplementation |
| **2** | BFF agent-use consolidation (two algos → one) | Correctness; prerequisite for DA migration to trust BFF decision |
| **3** | Bot-facing endpoint `/api/user/check_agent_access` → v1 | Removes unversioned ad-hoc PDP surface |
| **4** | RAG datasource + search gates | Removes Mongo-in-hot-path; largest volume of OpenFGA reimplementation |
| **5** | BFF `resource-authz.ts` wrappers | Low risk; behavior-neutral refactor |
| **6** | Slack bot middleware | Depends on shared utils migration |
| **7** | Shared utils `keycloak_authz.py` | Last; many callers; broadest blast radius |

---

## 6. What CAS does NOT replace

| Component | Stays as-is | Reason |
|-----------|------------|--------|
| `auth/jwt_middleware.py` (DA) | DA still validates its own inbound JWT | CAS validates the CAS-caller token; DA's inbound user JWT is a separate responsibility |
| `server/auth.py` (RAG `OIDCProvider`) | RAG still validates its own inbound JWT | Same reason |
| Tuple write paths (`write_datasource_ownership`, etc.) | CAS is evaluate-only | Ownership reconciliation stays in existing modules |
| `openfga-authz-bridge` | Data-plane PEP; not BFF-resident | Aligning its vocabulary/adapter/audit to match the CAS contract is a separate step |
| Keycloak UMA `keycloak-authz.ts` | Legacy compatibility shim | Delete only when all callers are confirmed migrated |
| `access.py` visibility checks (DA) | In-memory coarse filter | Not a PDP call; used for list-endpoint visibility only |

---

<!-- assisted-by claude code claude-sonnet-4-6 -->
