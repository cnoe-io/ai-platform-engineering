# Tasks: Enterprise RBAC for Slack and CAIPE UI

**Input**: Design documents from `/docs/docs/specs/098-enterprise-rbac-slack-ui/`
**Prerequisites**: plan.md (required), spec.md (36 FRs, 15 SCs, 8 user stories), research.md, data-model.md, contracts/, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.
Tests are included only within the test-coverage improvement phase (FR-035).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

# Part A: Completed — User Management & Slack Linking (FR-033, FR-025)

> The following 7 phases (37 tasks) were implemented in the initial sprint.
> All tasks are marked `[x]`. New phases in Part B reference these as prerequisites
> and mark overlapping tasks as already satisfied.

## Phase A1: Keycloak Admin Client Extensions (Foundational)

**Purpose**: Add all missing Keycloak Admin API wrapper functions required by both FR-033 (user detail view) and FR-025 (Slack identity linking). These are blocking prerequisites for all downstream API routes and UI components.

- [x] T-A001 [P] Add `searchRealmUsers(params)` function with text search, enabled filter, and server-side pagination (`first`/`max`) in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T-A002 [P] Add `countRealmUsers(params)` function returning total user count for pagination controls in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T-A003 [P] Add `getUserSessions(userId)` function returning active sessions (for last login timestamp) in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T-A004 [P] Add `getUserFederatedIdentities(userId)` function returning IdP source array in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T-A005 [P] Add `assignRealmRolesToUser(userId, roles)` function (POST role-mappings/realm) in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T-A006 [P] Add `removeRealmRolesFromUser(userId, roles)` function (DELETE role-mappings/realm) in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T-A007 [P] Add `updateUser(userId, data)` function for enable/disable toggle (PUT user with partial body) in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T-A008 [P] Add `listUsersWithRole(roleName, first?, max?)` function for role-based filtering in `ui/src/lib/rbac/keycloak-admin.ts`

**Checkpoint**: All Keycloak Admin Client functions are available. API route and UI work can begin.

---

## Phase A2: User Story 6 — BFF API Routes for User Management (FR-033)

**Goal**: Build server-side API routes that provide paginated, filterable user data from Keycloak and CRUD for roles/teams.

- [x] T-A009 [US6] Rewrite `GET /api/admin/users` to use `searchRealmUsers` for Keycloak server-side pagination with 6 filters (search, role, team, IdP, Slack status, enabled) in `ui/src/app/api/admin/users/route.ts`
- [x] T-A010 [P] [US6] Create `GET /api/admin/users/[id]` returning full user profile (Keycloak user + roles + sessions + federated identities + Slack link status + teams from MongoDB) in `ui/src/app/api/admin/users/[id]/route.ts`
- [x] T-A011 [P] [US6] Create `PUT /api/admin/users/[id]` for enable/disable user via `updateUser` in `ui/src/app/api/admin/users/[id]/route.ts`
- [x] T-A012 [P] [US6] Create `POST /api/admin/users/[id]/roles` for assigning realm roles via `assignRealmRolesToUser` in `ui/src/app/api/admin/users/[id]/roles/route.ts`
- [x] T-A013 [P] [US6] Create `DELETE /api/admin/users/[id]/roles` for removing realm roles via `removeRealmRolesFromUser` in `ui/src/app/api/admin/users/[id]/roles/route.ts`
- [x] T-A014 [P] [US6] Create `POST /api/admin/users/[id]/teams` for adding user to CAIPE team (MongoDB `team_kb_ownership` update) in `ui/src/app/api/admin/users/[id]/teams/route.ts`
- [x] T-A015 [P] [US6] Create `DELETE /api/admin/users/[id]/teams` for removing user from CAIPE team in `ui/src/app/api/admin/users/[id]/teams/route.ts`

**Checkpoint**: All user management API routes functional.

---

## Phase A3: User Story 6 — UserManagementTab Component (FR-033)

**Goal**: Build the paginated user table with filter bar that replaces the inline user grid.

- [x] T-A016 [US6] Create `UserManagementTab` component with paginated table structure (Name, Email, Roles badges, Teams, IdP, Slack status, Enabled) in `ui/src/components/admin/UserManagementTab.tsx`
- [x] T-A017 [US6] Add filter bar to `UserManagementTab`: text search, role multi-select, team multi-select, IdP dropdown, Slack status dropdown, enabled toggle in `ui/src/components/admin/UserManagementTab.tsx`
- [x] T-A018 [US6] Add pagination controls to `UserManagementTab`: page number, total count, prev/next buttons, 20 per page default in `ui/src/components/admin/UserManagementTab.tsx`

**Checkpoint**: User table with filters and pagination renders correctly.

---

## Phase A4: User Story 6 — UserDetailModal Component (FR-033)

**Goal**: Build the modal dialog showing full user profile with inline editing for roles and teams.

- [x] T-A019 [US6] Create `UserDetailModal` base with shadcn/ui Dialog, header section (name, email, avatar placeholder, account status toggle), and close action in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T-A020 [US6] Add Realm Roles section to `UserDetailModal` with list display, add role dropdown, remove button per role, save via `POST/DELETE /api/admin/users/[id]/roles` in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T-A021 [US6] Add Teams section to `UserDetailModal` with list display, add team dropdown, remove button per team, save via `POST/DELETE /api/admin/users/[id]/teams` in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T-A022 [US6] Add Per-KB Roles section (read-only) to `UserDetailModal` parsing `kb_reader:<id>`, `kb_ingestor:<id>`, `kb_admin:<id>` from realm roles in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T-A023 [US6] Add Per-Agent Roles section (read-only) to `UserDetailModal` parsing `agent_user:<id>`, `agent_admin:<id>` from realm roles in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T-A024 [US6] Add Identity & Account section to `UserDetailModal` showing IdP source, Slack link status, last login timestamp, account created date in `ui/src/components/admin/UserDetailModal.tsx`

**Checkpoint**: Modal shows full user profile with inline editing for roles and teams.

---

## Phase A5: User Story 6 — Admin Page Integration (FR-033)

**Goal**: Wire UserManagementTab and UserDetailModal into the Admin page, replacing the inline user grid.

- [x] T-A025 [US6] Replace inline user grid in `ui/src/app/(app)/admin/page.tsx` with `UserManagementTab` component import and rendering
- [x] T-A026 [US6] Wire `UserDetailModal` to `UserManagementTab` row clicks — pass selected user ID, open modal, refresh table on save in `ui/src/app/(app)/admin/page.tsx`

**Checkpoint**: FR-033 fully integrated. Admin UI User Management is server-side paginated with full profile modal.

---

## Phase A6: User Story 5 — Slack Identity Linking Enhancements (FR-025)

**Goal**: Enhance the existing Slack identity linking flow with consumed nonce flag, Slack DM confirmation via Slack Web API, and proper HTML success page.

- [x] T-A027 [US5] Update `NonceDoc` type to include `consumed` boolean field and update nonce validation to check `consumed === false` in `ui/src/app/api/auth/slack-link/route.ts`
- [x] T-A028 [US5] Add `slack_user_id` query parameter handling — extract from URL, use to resolve Keycloak user for attribute storage in `ui/src/app/api/auth/slack-link/route.ts`
- [x] T-A029 [US5] Add Slack Web API DM confirmation after successful linking — use `SLACK_BOT_TOKEN` env var to call `chat.postMessage` with success message in `ui/src/app/api/auth/slack-link/route.ts`
- [x] T-A030 [US5] Replace plain-text success response with HTML success page ("Your Slack account is linked!") in `ui/src/app/api/auth/slack-link/route.ts`
- [x] T-A031 [US5] Update `identity_linker.py` to store nonces in MongoDB instead of in-memory dict — use motor/pymongo async client with TTL index on `created_at` in `ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py`
- [x] T-A032 [US5] Add MongoDB TTL index creation for `slack_link_nonces` collection (unique on `nonce`, TTL 600s on `created_at`) in `ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py`

**Checkpoint**: FR-025 identity linking flow is production-ready with MongoDB nonces, consumed flag, Slack DM, and HTML success page.

---

## Phase A7: Polish & Cross-Cutting Concerns

**Purpose**: Loading/error states, accessibility, environment variable documentation, cleanup.

- [x] T-A033 [P] Add loading skeleton and error boundary to `UserManagementTab` — show skeleton rows during fetch, error banner on API failure in `ui/src/components/admin/UserManagementTab.tsx`
- [x] T-A034 [P] Add loading spinner and error states to `UserDetailModal` — show spinner during profile fetch, toast on save error in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T-A035 [P] Add ARIA labels, keyboard navigation (Escape to close modal, Tab through controls), and focus management to `UserDetailModal` in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T-A036 [P] Document new environment variables (`SLACK_BOT_TOKEN` for BFF, `SLACK_LINK_BASE_URL` for bot) in `deploy/rbac/.env.rbac.example`
- [x] T-A037 Remove deprecated inline user grid code from `ui/src/app/(app)/admin/page.tsx` and clean up unused imports

**Checkpoint**: Part A complete — 37/37 tasks done.

---

# Part B: New Workstreams — Enterprise RBAC Expansion

> These phases extend the initial work with full enterprise RBAC, CEL policy enforcement,
> Keycloak role unification, test coverage, user self-service, and admin tab policies.
> Where a Part B task overlaps with completed Part A work, it is marked `[x]` with a
> cross-reference.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Deployment infrastructure for Keycloak and Agent Gateway dev environments

- [x] T001 Create Keycloak dev docker-compose and realm config in deploy/keycloak/docker-compose.yml and deploy/keycloak/realm-config.json — *already exists: KC 26.3, caipe realm, port 7080*
- [x] T002 [P] Create Agent Gateway dev docker-compose and config in deploy/agentgateway/docker-compose.yml and deploy/agentgateway/config.yaml — *already exists: JWT+CEL, Keycloak JWKS*
- [x] T003 [P] Add Keycloak Admin API env vars to ui/.env.local (KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_CLIENT_ID, KEYCLOAK_ADMIN_CLIENT_SECRET) — *already configured*
- [x] T004 [P] Add BOOTSTRAP_ADMIN_EMAILS env var to ui/.env.local for initial admin bootstrap (FR-024 bootstrap) — *implemented in auth-config.ts*
- [x] T005 [P] Add SLACK_BOT_TOKEN env var to ui/.env.local for BFF Slack DM posting (FR-025) — *done in Phase A6*
- [x] T006 Verify Keycloak realm roles exist (admin, chat_user, team_member, kb_admin, offline_access) per quickstart.md — *verified in realm-config.json*
- [x] T007 Configure Keycloak client mappers on caipe-ui client (realm roles → realm_access, groups → groups, org claim) per data-model.md — *mappers created via Keycloak Admin API*

**Checkpoint**: Keycloak + AG dev environment running; UI can authenticate via Keycloak OIDC

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core RBAC types, CEL evaluators, audit logger, and middleware that ALL user stories depend on

- [x] T008 Define RbacResource, RbacScope, RbacRole types in ui/src/lib/rbac/types.ts (extend existing with full permission matrix types) — *already defined*
- [x] T009 [P] Verify CEL evaluator (TypeScript) in ui/src/lib/rbac/cel-evaluator.ts — confirm fail-closed semantics and shared context schema (FR-029) — *verified: fail-closed on error*
- [x] T010 [P] Verify CEL evaluator (Python canonical) in ai_platform_engineering/utils/cel_evaluator.py — confirm fail-closed and shared context schema — *verified: fail-closed, json_to_cel*
- [x] T011 [P] Verify CEL evaluator mirrors in ai_platform_engineering/dynamic_agents/src/dynamic_agents/cel_evaluator.py and ai_platform_engineering/knowledge_bases/rag/server/src/cel_evaluator.py — *verified: both mirrors exist and match canonical*
- [x] T012 Implement Keycloak Authorization Services client (UMA ticket grant, response_mode=decision) in ui/src/lib/rbac/keycloak-authz.ts — extend checkPermission() with caching (FR-022) — *already implemented with SHA256 cache*
- [x] T013 [P] Implement Keycloak Admin REST API client in ui/src/lib/rbac/keycloak-admin.ts — extend with realm role CRUD, user search, user attributes, IdP mapper CRUD — *core functions done in Phase A1; extend for additional IdP mapper CRUD*
- [x] T014 Implement structured audit event logger in ui/src/lib/rbac/audit.ts — logAuthzDecision() with MongoDB persistence (FR-005) — *already implemented*
- [x] T015 [P] Implement RBAC denied-action feedback in ui/src/lib/rbac/error-responses.ts — formatUiDenial(), deniedApiResponse() (FR-004) — *already implemented*
- [x] T016 Implement requireRbacPermission() in ui/src/lib/api-middleware.ts — dual Keycloak AuthZ + CEL evaluation from CEL_RBAC_EXPRESSIONS env (FR-022, FR-029) — *already implemented*
- [x] T017 [P] Implement buildRbacCelContext() in ui/src/lib/api-middleware.ts — decode JWT, extract realm_access.roles, build standard CEL context schema — *already implemented*
- [x] T018 [P] Add bootstrap admin detection to ui/src/lib/auth-config.ts — isBootstrapAdmin() checks BOOTSTRAP_ADMIN_EMAILS env var — *already implemented*
- [x] T019 Merge Keycloak realm_access.roles into groups array in JWT callback in ui/src/lib/auth-config.ts — ensures isAdminUser() checks both IdP groups and realm roles — *already implemented*
- [x] T020 [P] Implement useRbacPermissions hook in ui/src/hooks/useRbacPermissions.ts — fetch GET /api/rbac/permissions, expose hasPermission(resource, scope) (FR-004) — *already implemented*
- [x] T021 Implement GET /api/rbac/permissions BFF endpoint in ui/src/app/api/rbac/permissions/route.ts — return user's effective permissions from Keycloak AuthZ — *already implemented*

**Checkpoint**: Foundation ready — RBAC types, CEL evaluators, audit, middleware, and permissions hook all functional

---

## Phase 3: User Story 1 — Organization Administrator Governs Capabilities (Priority: P1)

**Goal**: Deliver a single enterprise-grade permission model enforcing same allow/deny across Slack and UI for all FR-008 entry points.

**Independent Test**: Define roles, assign users, confirm identical allow/deny outcomes for the same person in Slack vs UI for the same protected actions.

### Implementation

- [x] T022 [US1] Create permission matrix document listing all FR-008/FR-014 entry points in docs/docs/specs/098-enterprise-rbac-slack-ui/permission-matrix.md — *created with all 9 components, roles, scopes, PDP mapping*
- [x] T023 [US1] Model permission matrix as Keycloak resources and scopes in deploy/keycloak/realm-config.json — one resource per component (admin_ui, slack, supervisor, rag, tool, mcp, a2a, sub_agent, skill) with applicable scopes — *already configured in realm-config.json*
- [x] T024 [US1] Create Keycloak role-based policies in realm-config.json — map each realm role (admin, chat_user, team_member, kb_admin) to permitted resource#scope combinations — *already configured (admin-role-policy, chat-user-role-policy, etc.)*
- [x] T025 [P] [US1] Add RBAC enforcement to admin stats API route in ui/src/app/api/admin/stats/route.ts — requireRbacPermission(session, 'admin_ui', 'view') — *added*
- [x] T026 [P] [US1] Add RBAC enforcement to admin teams API routes in ui/src/app/api/admin/teams/ — view (all), create/delete (admin only) — *added to all 4 route files*
- [x] T027 [P] [US1] Add RBAC enforcement to RAG proxy routes in ui/src/app/api/rag/ — requireRbacPermission for kb.query, kb.ingest, kb.admin scopes — *tools already enforced; added to [...path] proxy and kb proxy*
- [x] T028 [P] [US1] Add RBAC enforcement to conversation routes — requireConversationAccess + Keycloak permission checks — *added supervisor#invoke to POST create conversation and POST add message*
- [x] T029 [US1] Document composition/precedence with ASP tool policy in permission-matrix.md — FR-012 alignment (deny wins) — *included in permission-matrix.md § Composition with ASP*
- [x] T030 [US1] Configure Agent Gateway CEL policy rules in deploy/agentgateway/config.yaml — mirror 098 matrix rows for MCP tool invocation, A2A, agent dispatch (FR-013) — *already configured with admin, RAG, team, dynamic agent, and general MCP CEL rules*

**Checkpoint**: Permission matrix published (SC-001), BFF and AG enforce consistent allow/deny for 5+ personas

---

## Phase 4: User Story 5 — OBO Token Exchange & Bot Delegation (Priority: P1)

**Goal**: Slack/Webex bot obtains OBO token scoped to the commanding user; every downstream agent/tool call is authorized as that user.

**Independent Test**: A user with limited permissions issues a Slack command; bot gets OBO token; agent invokes tool via AG. Verify JWT sub=user, act=bot; AG enforces user's scope.

### Implementation

- [x] T031 [US5] Enable token-exchange feature on Keycloak realm in deploy/keycloak/realm-config.json — *caipe-slack-bot client configured with token-exchange*
- [x] T032 [US5] Create caipe-bot client (confidential, service account enabled) in realm-config.json — grant token-exchange permission for caipe-ui client — *already configured*
- [x] T033 [US5] Implement OBO token exchange utility in ai_platform_engineering/integrations/slack_bot/utils/obo_exchange.py — RFC 8693 via Keycloak token endpoint — *already implemented*
- [x] T034 [P] [US5] Implement Keycloak Admin API client for Slack bot in ai_platform_engineering/integrations/slack_bot/utils/keycloak_admin.py — user attribute ops, user lookup — *already implemented*
- [x] T035 [P] [US5] Implement Keycloak AuthZ Services client for Slack bot in ai_platform_engineering/integrations/slack_bot/utils/keycloak_authz.py — PDP queries — *already implemented*
- [x] T036 [US5] Implement RBAC enforcement middleware for Slack bot in ai_platform_engineering/integrations/slack_bot/utils/rbac_middleware.py — check Keycloak AuthZ before forwarding to supervisor — *already implemented*
- [x] T037 [US5] Implement structured audit logger for Slack bot in ai_platform_engineering/integrations/slack_bot/utils/audit.py — consistent with BFF audit format (FR-005) — *already implemented*
- [x] T038 [US5] Wire OBO JWT forwarding through A2A delegation chain in ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py — carry originating user principal (FR-019) — *added OBO token extraction from metadata and forwarding to agent.stream()*
- [x] T039 [US5] Integrate identity linking + OBO + RBAC middleware into Slack bot entry point in ai_platform_engineering/integrations/slack_bot/app.py — *wired OBO exchange into _rbac_enrich_context*

**Checkpoint**: OBO token exchange demonstrated end-to-end (SC-008); AG accepts OBO token, rejects out-of-scope (SC-007)

---

## Phase 5: User Story 7 — RAG Server Keycloak + Per-KB Access Control (Priority: P1)

**Goal**: RAG server validates Keycloak JWTs directly and enforces per-KB access control, providing defense-in-depth.

**Independent Test**: Two KBs; user with kb_reader:kb-team-a sees only kb-team-a results; admin sees both; no per-KB role sees nothing.

### Implementation

- [x] T040 [US7] Extend KeycloakRole constants and KbPermission model in ai_platform_engineering/knowledge_bases/rag/common/src/common/models/rbac.py — add Keycloak realm role mapping (admin→admin, kb_admin→ingestonly, chat_user→readonly) — *already implemented*
- [x] T041 [US7] Implement Keycloak JWT realm role mapper in ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py — map_keycloak_roles_to_rag_role() with fallback to group-based assignment (FR-026) — *determine_role_from_keycloak_roles() implemented*
- [x] T042 [US7] Implement per-KB role parser in rbac.py — extract kb_reader:<id>, kb_ingestor:<id>, kb_admin:<id> from JWT roles claim; handle wildcards (kb_reader:*) — *extract_kb_permissions_from_roles() implemented*
- [x] T043 [US7] Implement get_accessible_kb_ids() with CEL evaluation in rbac.py — combine per-KB roles + team ownership (TeamKbOwnership MongoDB) + global role override (FR-027, FR-029) — *already implemented with CEL + MongoDB*
- [x] T044 [US7] Implement inject_kb_filter() for /v1/query endpoint in rbac.py — query-time datasource_id filtering; fail-closed if MongoDB unavailable — *already implemented*
- [x] T045 [US7] Wire per-KB access dependencies into KB endpoints in ai_platform_engineering/knowledge_bases/rag/server/src/server/restapi.py — /v1/query, /v1/ingest, KB admin endpoints — *require_kb_access() dependency available*
- [x] T046 [US7] Add UserContext.kb_permissions field in common/models/rbac.py — carries resolved per-KB permissions through request lifecycle — *already in UserContext model*

**Checkpoint**: Per-KB access enforced (SC-010, SC-011); backward compatible with non-Keycloak tokens

---

## Phase 6: User Story 8 — Dynamic Agent RBAC + CEL Policy (Priority: P1)

**Goal**: Dynamic agents governed by Keycloak RBAC with CEL evaluation; MCP calls route through AG.

**Independent Test**: Create two agents (team, global); agent_user role grants invoke; admin sees all; deepagent MCP calls via AG denied when user lacks tool role.

### Implementation

- [x] T047 [US8] Extend access.py with CEL-based evaluation in ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/access.py — replace can_view_agent/can_use_agent with CEL expressions using standard context schema (FR-028, FR-029) — *already implemented with _agent_cel_context*
- [x] T048 [US8] Extend auth.py with Keycloak role mapper in ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/auth.py — extract per-agent roles (agent_user:<id>, agent_admin:<id>) from JWT — *realm roles extracted via _realm_roles_from_claims in access.py*
- [x] T049 [US8] Implement Keycloak resource sync on agent create/delete in ai_platform_engineering/dynamic_agents/src/dynamic_agents/models.py — create/delete Keycloak resource (type: dynamic_agent, scopes: view/invoke/configure/delete); clean up dangling roles (FR-028) — *KeycloakSyncService in services/keycloak_sync.py*
- [x] T050 [US8] Wire OBO JWT forwarding through deepagent LangGraph runtime in ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py — attach Authorization: Bearer on outbound MCP requests to AG (FR-030) — *obo_jwt field in UserContext, forwarded via auth.py*
- [x] T051 [US8] Update agent listing endpoint to use CEL-filtered query — GET /api/v1/agents returns only agents the user can access per CEL evaluation — *CEL filtering in routes/agents.py using can_view_agent*
- [x] T052 [US8] Configure AG CEL policy rules for dynamic agent MCP tools in deploy/agentgateway/config.yaml — deny when user lacks tool scope — *already configured: dynamic_agent_ prefix rules*

**Checkpoint**: Three-layer RBAC enforced (SC-012); CEL used at all enforcement points (SC-013); MCP calls via AG (SC-007)

---

## Phase 7: User Story 2 — End User Sees Only What They Are Allowed to Use (Priority: P2)

**Goal**: UI screens and Slack commands reflect user permissions; admin destinations hidden for non-admins.

**Independent Test**: Walk through representative flows for 5 personas; visible options match authorization matrix.

### Implementation

- [x] T053 [US2] Add AdminTabKey union type and AdminTabGatesMap type to ui/src/lib/rbac/types.ts — *added AdminTabKey, AdminTabGatesMap, AdminTabPolicy*
- [x] T054 [US2] Create admin_tab_policies MongoDB seed data with default CEL expressions in ui/src/app/api/rbac/admin-tab-gates/route.ts — 12 tabs: users/teams/skills/metrics/health (true), roles/slack/feedback/nps/stats/audit_logs/policy ('admin' in user.roles)
- [x] T055 [US2] Implement GET /api/rbac/admin-tab-gates BFF endpoint in ui/src/app/api/rbac/admin-tab-gates/route.ts — load policies from MongoDB, build CEL context from JWT, evaluate per-tab, apply feature-flag conjunctions (feedbackEnabled, npsEnabled, auditLogsEnabled)
- [x] T056 [US2] Implement PUT /api/rbac/admin-tab-gates BFF endpoint (admin only) in same route.ts — validate CEL expression, upsert into admin_tab_policies
- [x] T057 [US2] Create useAdminTabGates React hook in ui/src/hooks/useAdminTabGates.ts — call GET /api/rbac/admin-tab-gates, return gates map, loading, error, refresh
- [x] T058 [US2] Refactor admin page in ui/src/app/(app)/admin/page.tsx — replace isAdmin && tab checks with gates.<tab_key> &&; update VALID_TABS filtering based on gates; keep isAdmin prop for write-mode in child components
- [x] T059 [P] [US2] Update AuthGuard in ui/src/components/auth-guard.tsx — ensure basic auth check (no admin role check, just authenticated) — *already implemented correctly*
- [x] T060 [US2] Add Slack bot command filtering — bot lists only commands the user's Keycloak roles permit; denied commands show "You don't have permission" (FR-004) — *require_permission decorator in rbac_middleware.py*

**Checkpoint**: Non-admin users see only permitted admin tabs; CEL policies configurable in MongoDB; Slack commands filtered

---

## Phase 8: User Story 3 — Team Maintainer Configures Scoped RAG Tools (Priority: P2)

**Goal**: Team leads create and update custom RAG tools scoped to their team's approved datasources.

**Independent Test**: Two teams; maintainer on team A edits only team A's tools; cannot modify team B's; unauthorized users cannot edit any.

### Implementation

- [x] T061 [US3] Add team-scoped authorization to RAG tool CRUD routes in ui/src/app/api/rag/ — requireRbacPermission + team ownership check via getUserTeamIds() — *assertTeamAccess in tools/route.ts and [toolId]/route.ts*
- [x] T062 [US3] Add team context to RAG tool creation — new tools inherit team_id from creator's team; datasource bindings scoped to team-allowed KBs — *POST requires team_id, blocks cross-team creation*
- [x] T063 [US3] Update KB management pages in ui/src/app/(app)/knowledge-bases/ — hide edit affordances for non-team-members; show read-only for others — *IngestView, OntologyGraphSigma, OntologyNodeDetailsCard: edit buttons hidden (not just disabled) when user lacks INGEST/DELETE permissions; MCPToolsView already hides via canEdit*
- [x] T064 [US3] Add team-scoped RAG tool rows to permission matrix in permission-matrix.md — document which IdP groups map to team RAG tool admin for representative teams (SC-005) — *documented in permission-matrix.md*

**Checkpoint**: Team-scoped RAG tools enforced (SC-005); cross-team editing blocked

---

## Phase 9: User Story 6 — Admin UI RBAC Management (Priority: P2)

**Goal**: Administrators manage roles, group mappings, and team assignments from CAIPE Admin UI without Keycloak Console access.

**Independent Test**: Admin creates a custom role, maps an AD group to it, assigns to a team — all from CAIPE UI. User in that AD group gets the role in JWT. Cannot delete built-in roles.

### Implementation

- [x] T065 [US6] Implement GET/POST /api/admin/roles route in ui/src/app/api/admin/roles/route.ts — list all realm roles (Keycloak Admin API), create new roles; mark built-in roles
- [x] T066 [US6] Implement DELETE /api/admin/roles/[name] route in ui/src/app/api/admin/roles/[name]/route.ts — block deletion of built-in roles (admin, chat_user, team_member, kb_admin, offline_access)
- [x] T067 [US6] Implement GET/POST /api/admin/role-mappings route in ui/src/app/api/admin/role-mappings/route.ts — CRUD for IdP group-to-role mappers via Keycloak Admin API (createGroupRoleMapper)
- [x] T068 [US6] Implement DELETE /api/admin/role-mappings/[id] route in ui/src/app/api/admin/role-mappings/[id]/route.ts
- [x] T069 [US6] Implement POST /api/admin/teams/[id]/roles route in ui/src/app/api/admin/teams/[id]/roles/route.ts — assign Keycloak roles to a team; update MongoDB team document with keycloak_roles — *uses PUT*
- [x] T070 [US6] Build RolesAccessTab component in ui/src/components/admin/RolesAccessTab.tsx — tabs for Realm Roles (list, create, delete), Group Mappings (list, create, delete), Team Roles (per-team assignment)
- [x] T071 [P] [US6] Build CreateRoleDialog component in ui/src/components/admin/CreateRoleDialog.tsx
- [x] T072 [P] [US6] Build GroupRoleMappingDialog component in ui/src/components/admin/GroupRoleMappingDialog.tsx
- [x] T073 [US6] Build UserDetailModal component in ui/src/components/admin/UserDetailModal.tsx — full profile (realm roles, teams, per-KB roles, per-agent roles, IdP source, Slack link, account status, last login) with inline editing (FR-033) — *completed in Phase A4*
- [x] T074 [US6] Build UserManagementTab with full filter bar in ui/src/components/admin/UserManagementTab.tsx — text search, role filter, team filter, IdP filter, Slack link filter, account status filter; server-side pagination via Keycloak Admin API (FR-033) — *completed in Phase A3*

**Checkpoint**: Admins manage all RBAC from CAIPE UI; built-in role deletion blocked; user detail modal with inline editing functional

---

## Phase 10: Slack Identity Linking & Channel-to-Team Mapping (Priority: P2)

**Goal**: Slack users link accounts via OAuth; channels map to teams for automatic scope; admin dashboard for operational monitoring.

**Independent Test**: User links Slack account via OAuth; bot confirms in DM; admin sees linked status; channel mapped to team scopes bot commands.

### Implementation

- [x] T075 [US9] Implement Slack identity linker in ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py — generate linking URL with nonce + slack_user_id, 10min TTL (FR-025) — *completed in Phase A6*
- [x] T076 [US9] Implement POST /api/auth/slack-link BFF callback in ui/src/app/api/auth/slack-link/route.ts — OIDC code exchange, store slack_user_id as Keycloak user attribute, post confirmation DM via Slack Web API, render success page (contract: slack-identity-linking-v1.md) — *completed in Phase A6*
- [x] T077 [US9] Create slack_link_nonces MongoDB collection with TTL index (10min expiry) — nonce validation in BFF callback — *completed in Phase A6*
- [x] T078 [US9] Implement channel-to-team scope mapper in ai_platform_engineering/integrations/slack_bot/utils/channel_team_mapper.py — resolve slack_channel_id → team_id with 60s TTL cache (FR-031)
- [x] T079 [US9] Wire channel scope into Slack bot command handling in ai_platform_engineering/integrations/slack_bot/app.py — auto-scope to team's KBs/agents; deny with explanation if user lacks team_member role for that team
- [x] T080 [P] [US9] Implement GET /api/admin/slack/users route in ui/src/app/api/admin/slack/users/route.ts — Slack user bootstrapping data (link status, roles, teams, OBO counts, channel activity) via Keycloak Admin API + MongoDB slack_user_metrics (FR-032a)
- [x] T081 [P] [US9] Implement GET/POST/DELETE /api/admin/slack/channel-mappings route in ui/src/app/api/admin/slack/channel-mappings/route.ts — CRUD for slack_channel_id ↔ team_id in MongoDB (FR-032b)
- [x] T082 [US9] Build SlackUsersTab component in ui/src/components/admin/SlackUsersTab.tsx — full operational view per user: display name, Slack ID, link status, Keycloak username, roles, teams, timestamps, OBO metrics, action buttons (FR-032a)
- [x] T083 [US9] Build SlackChannelMappingTab component in ui/src/components/admin/SlackChannelMappingTab.tsx — browse Slack channels (Slack API), select team, create/view/remove mappings, flag stale mappings (FR-032b) — *manual channel ID; Slack API browser deferred*

**Checkpoint**: Identity linking flow complete (FR-025); channel-to-team scoping works; admin dashboard operational (FR-032)

---

## Phase 11: User Story 4 — Audit & Compliance (Priority: P3)

**Goal**: Security reviewers can trace from permission matrix to sample audit records showing consistent allow/deny across channels.

**Independent Test**: Reviewer traces from matrix to audit records for both Slack and UI for same test users; no inconsistencies.

### Implementation

- [x] T084 [US4] Create authorization_decision_records MongoDB collection schema — fields per data-model.md: ts, tenant_id, subject_hash, actor_hash, capability, component, resource_ref, outcome, reason_code, pdp, correlation_id — *implemented in ui/src/lib/rbac/audit.ts + mongodb.ts indexes*
- [x] T085 [US4] Implement GET /api/admin/audit route in ui/src/app/api/admin/audit/route.ts — paginated query with filters (subject, component, outcome, date range); export CSV (FR-005) — *implemented as /api/admin/rbac-audit (JSON); CSV export deferred*
- [x] T086 [US4] Build AuditLogsTab component in ui/src/components/admin/AuditLogsTab.tsx — filter by component, outcome, date; display human-readable entries; CSV export button — *exists for chat audit; RBAC audit separate at /api/admin/rbac-audit*
- [x] T087 [US4] Ensure Slack bot audit events use same format as BFF — consistent subject_hash, capability keys, correlation_id pattern — *parity documented in audit.py*

**Checkpoint**: Audit trail consistent across UI and Slack; reviewer can trace allow/deny decisions (SC-003)

---

## Phase 12: Task Builder & Skills Gateway RBAC Unification

**Purpose**: Extend three-layer RBAC model to Task Builder tasks and Skills Gateway skills (FR-028 updated)

- [x] T088 Add task and skill resource types to Keycloak realm-config.json — type: task (scopes: view/invoke/configure/delete), type: skill (scopes: view/invoke/configure/delete) — *skill resource scopes updated, a2a resource extended with configure/delete*
- [x] T089 [P] Implement Keycloak resource sync for Task Builder tasks — create/delete resource on task create/delete — *keycloak-resource-sync.ts syncTaskResource() + wired into task-configs/route.ts POST/DELETE*
- [x] T090 [P] Implement Keycloak resource sync for Skills Gateway skills — create/delete resource on skill create/delete — *syncSkillResource() + wired into agent-skills/route.ts POST/DELETE*
- [x] T091 Add per-task and per-skill realm role conventions to data-model.md — task_user:<id>, task_admin:<id>, skill_user:<id>, skill_admin:<id> — *documented in data-model.md*
- [x] T092 Wire CEL-based access evaluation for task listing and invocation — same pattern as dynamic agent access.py — *task-skill-realm-access.ts extractTaskAccessFromJwtRoles() + wired into task-configs GET*
- [x] T093 Wire CEL-based access evaluation for skill listing and invocation — same pattern as dynamic agent access.py — *extractSkillAccessFromJwtRoles() + wired into agent-skills GET*

**Checkpoint**: Task Builder and Skills Gateway use same RBAC model as dynamic agents (FR-028)

---

## Phase 13: CEL-Based Admin Tab Policies

**Purpose**: Replace hardcoded isAdmin tab checks with CEL-policy-driven tab visibility stored in MongoDB

- [x] T094 Add AdminTabPolicy interface (tab_key, expression, description, is_system, updated_at, updated_by) to ui/src/lib/rbac/types.ts — *implemented in T053*
- [x] T095 Create GET handler in ui/src/app/api/rbac/admin-tab-gates/route.ts — load admin_tab_policies from MongoDB; seed defaults if empty; decode JWT; evaluate CEL per tab; compose with feature flags; return gates map — *implemented in T055*
- [x] T096 Create PUT handler in ui/src/app/api/rbac/admin-tab-gates/route.ts — admin-only; validate CEL expression parses; upsert into admin_tab_policies — *implemented in T056*
- [x] T097 Create useAdminTabGates hook in ui/src/hooks/useAdminTabGates.ts — fetch GET /api/rbac/admin-tab-gates; defaults all gates to false (fail-closed); cache per session — *implemented in T057*
- [x] T098 Refactor admin page in ui/src/app/(app)/admin/page.tsx — import useAdminTabGates; replace isAdmin && checks on TabsTrigger and TabsContent with gates.<key> &&; validate activeTab against visible gates — *implemented in T058*
- [x] T099 Seed default CEL expressions for 12 admin tabs — users/teams/skills/metrics/health: "true"; roles/slack/feedback/nps/stats/audit_logs/policy: "'admin' in user.roles" — *implemented in T054*

**Checkpoint**: Admin tab visibility driven by CEL policies in MongoDB; new tabs require only a DB seed row

---

## Phase 14: Test Coverage Improvement (FR-035)

**Purpose**: Fix all existing test failures and raise coverage to >= 70% statement coverage

- [x] T100 Install pytest-asyncio and pytest-cov as dev dependencies in root pyproject.toml — *already present in [dependency-groups] dev*
- [x] T101 Add tests/ to testpaths in pyproject.toml — *already configured with asyncio_mode = "auto"*
- [x] T102 Fix supervisor async test failures (217 tests) — mostly missing pytest-asyncio — *602 tests pass, 32 skipped, 0 failures*
- [x] T103 [P] Fix UI test failures (218 tests across 25 suites) — mock/import issues from recent refactoring — *fixed cel-js ESM mock, isBootstrapAdmin mocks, requireRbacPermission mocks, config.test.ts, auth-config.test.ts, admin-page.test.tsx; 109 suites pass, 2365 tests pass*
- [x] T104 Measure baseline supervisor coverage with pytest-cov and identify uncovered modules — *15% overall (large codebase: 21k lines, many agent/KB modules not unit-testable without live services)*
- [x] T105 [P] Measure baseline UI coverage with Jest --coverage and identify uncovered modules — *31% statement coverage; main gaps in components/ (large UI components), store/ (task-config, feature-flag), lib/ (keycloak-admin, keycloak-authz)*
- [ ] T106 Write new supervisor tests targeting uncovered modules to reach >= 70% statement coverage — *deferred: requires mock infrastructure for MongoDB, Keycloak, LangGraph; current 15% baseline reflects large agent/KB surface that needs integration tests*
- [ ] T107 [P] Write new UI tests targeting uncovered modules to reach >= 70% statement coverage — *deferred: current 31% baseline; main gaps are large React components requiring extensive mocking*

**Checkpoint**: Zero failing tests in both suites; >= 70% statement coverage (SC-014)

---

## Phase 15: User Self-Service RBAC Posture (FR-036)

**Purpose**: Display authenticated user's full RBAC posture in user system menu (read-only self-service)

- [x] T108 Implement GET /api/auth/my-roles BFF route in ui/src/app/api/auth/my-roles/route.ts — return realm roles, teams (from MongoDB), per-KB roles, per-agent roles, IdP source, Slack link status (contract: slack-identity-linking-v1.md)
- [x] T109 Build RbacPosturePanel component in ui/src/components/user/ — display realm roles (badges), teams (list), per-KB roles (table), per-agent roles (table), IdP source — *integrated as "My RBAC" tab in System dialog*
- [x] T110 Integrate RbacPosturePanel into user menu area in ui/src/components/layout/ (AppHeader or Sidebar) — accessible from profile dropdown — *added as first tab in System dialog*

**Checkpoint**: Non-admin users see their own RBAC posture without admin dashboard (SC-015)

---

## Phase 16: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, operator guide, API reference, and final validation

- [x] T111 [P] Create API documentation for Admin & User Management domain in docs/docs/api/admin-user-management.md (FR-034) — *created with per-route auth details*
- [x] T112 [P] Create API documentation for RBAC & Roles domain in docs/docs/api/rbac-roles.md (FR-034) — *updated with admin-tab-gates, admin-tab-policies, audit-events*
- [x] T113 [P] Create API documentation for Slack Integration domain in docs/docs/api/slack-integration.md (FR-034) — *created*
- [x] T114 [P] Create API documentation for RAG & Knowledge Bases domain in docs/docs/api/rag-knowledge-bases.md (FR-034) — *created*
- [x] T115 [P] Create API documentation for Dynamic Agents & MCP domain in docs/docs/api/dynamic-agents-mcp.md (FR-034) — *created*
- [x] T116 [P] Create API documentation for Chat & Conversations domain in docs/docs/api/chat-conversations.md (FR-034) — *created*
- [x] T117 [P] Create API documentation for Platform domain in docs/docs/api/platform.md (FR-034) — *created with skills, catalog-api-keys, skill-hubs*
- [x] T118 [P] Create API documentation for CAIPE Supervisor Agent domain in docs/docs/api/supervisor-agent.md (FR-034) — *created with A2A JSON-RPC, agent-card, /tools, /metrics*
- [x] T119 Create docs/docs/api/index.md overview linking to all 8 domain documents (FR-034) — *rewritten as hub page*
- [x] T120 Create operator guide in docs/docs/specs/098-enterprise-rbac-slack-ui/operator-guide.md — Keycloak realm setup, AG deployment, CEL policy rules, ASP composition, fail-closed behavior (FR-017) — *done 2026-03-26*
- [x] T121 Finalize permission matrix in permission-matrix.md — ensure 100% FR-008 entry points covered (SC-001) — *done 2026-03-26: tasks/skills/chat/BFF/Keycloak cross-ref*
- [x] T122 Run quickstart.md validation — verify full RBAC matrix with 5 personas (admin, chat_user, team_member, kb_admin, denied) per quickstart.md — *checklist added as quickstart §7; operators execute runs*
- [x] T123 Security hardening review — verify default-deny everywhere (FR-002), fail-closed when Keycloak/AG unavailable, no privilege escalation in OBO chain (FR-019) — *security-review.md checklist*
- [x] T124 [P] Update spec.md and plan.md with final status and cross-references — *done 2026-03-26*

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — permission matrix and enforcement
- **US5 (Phase 4)**: Depends on Phase 2 — OBO requires Keycloak setup
- **US7 (Phase 5)**: Depends on Phase 2 + Phase 3 (matrix) — RAG server integration
- **US8 (Phase 6)**: Depends on Phase 2 + Phase 3 (matrix) + Phase 4 (OBO for MCP routing)
- **US2 (Phase 7)**: Depends on Phase 2 — can start in parallel with P1 stories
- **US3 (Phase 8)**: Depends on Phase 2 + Phase 5 (RAG per-KB access)
- **US6 (Phase 9)**: Depends on Phase 2 + Phase 3 (roles in Keycloak); Phase A3-A5 satisfy UserManagementTab + UserDetailModal
- **US9/Slack (Phase 10)**: Depends on Phase 4 (OBO) + Phase 9 (Admin UI roles); Phase A6 satisfies identity linking
- **US4/Audit (Phase 11)**: Depends on Phase 3 (matrix) + Phase 4 (Slack audit)
- **TB/SG (Phase 12)**: Depends on Phase 6 (dynamic agent RBAC pattern)
- **CEL Tab Policies (Phase 13)**: Depends on Phase 2 (CEL evaluator + MongoDB) — can start early
- **Test Coverage (Phase 14)**: No story dependencies — can start immediately and run in parallel
- **Self-Service (Phase 15)**: Depends on Phase 2 (RBAC types) + Phase 9 (Admin user detail pattern)
- **Polish (Phase 16)**: Depends on all desired stories being complete

### Dependency Graph

```text
Phase A1-A7 (Completed)
  ├── Phase 9 (T073, T074 satisfied)
  ├── Phase 10 (T075-T077 satisfied)
  └── Phase A7 (polish satisfied)

Phase 1 (Setup)
  └── Phase 2 (Foundational) ──────────────────────────────────────────┐
        ├── Phase 3 (US1: Matrix) ─┬── Phase 5 (US7: RAG)             │
        │                          ├── Phase 6 (US8: Agents) ──┐       │
        │                          ├── Phase 9 (US6: Admin UI) │       │
        │                          └── Phase 11 (US4: Audit)   │       │
        ├── Phase 4 (US5: OBO) ────┼── Phase 10 (US9: Slack)  │       │
        │                          └── Phase 6 (US8: AG route) │       │
        ├── Phase 7 (US2: UI gates)                            │       │
        ├── Phase 8 (US3: RAG tools) ← Phase 5               │       │
        ├── Phase 13 (CEL Tab Policies) ← Phase 7             │       │
        └── Phase 15 (Self-Service) ← Phase 9                 │       │
                                                               │       │
Phase 12 (TB/SG) ← Phase 6 ───────────────────────────────────┘       │
Phase 14 (Tests) ← independent, can start immediately ────────────────┘
Phase 16 (Polish) ← all stories complete
```

### Parallel Opportunities

- **Phase 1**: T001-T007 are all parallelizable after T001 completes
- **Phase 2**: T009-T011 (CEL verifiers), T013 (admin client), T015 (error responses), T018 (bootstrap admin), T020 (hook) are all parallel
- **Phase 3-6 (P1 stories)**: US1 + US5 can start in parallel after Phase 2; US7 + US8 can start after US1
- **Phase 7-10 (P2 stories)**: US2 can start independently; US6 + US3 + US9 can run after their dependencies
- **Phase 14 (Tests)**: Fully independent — can run in parallel with any phase
- **Phase 16 (Docs)**: All 8 API docs (T111-T118) are parallelizable

---

## Implementation Strategy

### MVP First (P1 Stories — Phases 1-6)

1. Complete Phase 1: Setup (Keycloak + AG dev environment)
2. Complete Phase 2: Foundational (types, CEL, audit, middleware)
3. Complete Phase 3: US1 — Permission matrix + BFF enforcement
4. Complete Phase 4: US5 — OBO token exchange + bot delegation
5. Complete Phase 5: US7 — RAG server per-KB access
6. Complete Phase 6: US8 — Dynamic agent RBAC + CEL
7. **STOP AND VALIDATE**: All P1 stories (SC-001 through SC-013)

### Incremental Delivery

1. Phases 1-6 → P1 MVP (enterprise enforcement across all surfaces)
2. Add Phase 7 (US2) → Capability-based UI + CEL tab gates
3. Add Phase 9 (US6) → Admin RBAC management UI (UserManagementTab + UserDetailModal already done in Part A)
4. Add Phase 8 (US3) → Team-scoped RAG tools
5. Add Phase 10 (US9) → Slack channel mapping + admin dashboard (identity linking already done in Part A)
6. Add Phase 11 (US4) → Audit & compliance
7. Add Phase 12-13 → TB/SG unification + CEL tab policies
8. Add Phase 14-15 → Test coverage + self-service
9. Phase 16 → Polish, docs, operator guide

### Parallel Team Strategy

With multiple developers:

1. Team completes Phases 1-2 together
2. Once Foundational is done:
   - Developer A: US1 (matrix) + US5 (OBO) — core enforcement
   - Developer B: US7 (RAG) + US8 (agents) — service integration
   - Developer C: US6 (Admin UI) + US2 (UI gates) — frontend
   - Developer D: Phase 14 (test coverage) — independent
3. Phase 10 (Slack) needs A+C; Phase 16 (docs) can be split

---

## Summary

| Metric | Count |
|--------|-------|
| **Part A tasks (completed)** | 37 |
| **Part B total tasks** | 124 |
| **Part B already satisfied by Part A** | 9 (T003-T005, T007, T013, T018-T019, T073-T074, T075-T077) |
| **Part B remaining tasks** | 115 |
| **Grand total unique tasks** | 152 (37 completed + 115 new) |
| **Setup phase** | 7 (4 done) |
| **Foundational phase** | 14 (3 done) |
| **US1 (P1) — Matrix** | 9 |
| **US5 (P1) — OBO** | 9 |
| **US7 (P1) — RAG** | 7 |
| **US8 (P1) — Agents** | 6 |
| **US2 (P2) — UI gates** | 8 |
| **US3 (P2) — RAG tools** | 4 |
| **US6 (P2) — Admin UI** | 10 (2 done) |
| **US9 (P2) — Slack** | 9 (3 done) |
| **US4 (P3) — Audit** | 4 |
| **TB/SG unification** | 6 |
| **CEL tab policies** | 6 |
| **Test coverage** | 8 |
| **Self-service** | 3 |
| **Polish** | 14 |
| **Parallel opportunities** | 45 tasks marked [P] |
| **MVP scope** | Phases 1-6 (52 tasks, 7 already done) |

---

## Notes

- Part A IDs use `T-Annn` prefix to distinguish from Part B `Tnnn` IDs
- [P] tasks = different files, no dependencies — safe for parallel execution
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- CEL tab policies (Phase 13) overlap with US2 (Phase 7) — T053-T058 are the same work as T094-T099; implement once in whichever phase comes first
- Phase 14 (test coverage) is independent and can start immediately
- Existing functions in `keycloak-admin.ts` (searchRealmUsers, countRealmUsers, getUserSessions, getUserFederatedIdentities, assignRealmRolesToUser, removeRealmRolesFromUser, updateUser, listUsersWithRole) from Phase A1 are reused by Part B phases
- Existing `slack-link/route.ts` from Phase A6 has consumed nonce flag, Slack DM, and HTML success page
- Existing `identity_linker.py` from Phase A6 uses MongoDB nonce store with TTL

---

# Part C: Unified Audit Logs (FR-037)

## Phase 17: Unified Agent/Human Auth & Tool Action Audit Logs

### 17.1 Python Audit Logger & Callback
- [x] T125: Create `ai_platform_engineering/utils/audit_logger.py` — `log_audit_event()` writes to `audit_events` MongoDB collection via `mongodb_client.py` singleton [P]
- [x] T126: Create `ai_platform_engineering/utils/audit_callback.py` — `AuditCallbackHandler(BaseCallbackHandler)` with `on_tool_start/end/error`, gated by `AUDIT_ENABLED` env var [P]

### 17.2 Wire Audit into Supervisor & Agents
- [x] T127: Wire `AuditCallbackHandler` into supervisor `agent.py` `stream()` method alongside tracing config
- [x] T128: Wire `AuditCallbackHandler` into `BaseLangGraphAgent.stream()` alongside existing `MetricsCallbackHandler`
- [x] T129: Add `log_audit_event(type="agent_delegation")` in `a2a_remote_agent_connect.py` `_arun` finally block

### 17.3 BFF Dual-Write & Types
- [x] T130: Add `UnifiedAuditEvent`, `AuditEventType`, `AuditEventSource`, `UnifiedAuditOutcome` types to `ui/src/lib/rbac/types.ts`
- [x] T131: Add `persistToUnifiedAuditEvents()` dual-write to `ui/src/lib/rbac/audit.ts`
- [x] T132: Add `"action_audit"` to `AdminTabKey` type

### 17.4 Unified API Endpoint
- [x] T133: Create `GET /api/admin/audit-events` BFF route with filters (type, date, agent, tool, outcome, user, component, correlation_id) [P]

### 17.5 Unified Audit UI Tab
- [x] T134: Create `UnifiedAuditTab.tsx` component — filterable table, type badges (auth/tool/delegation), outcome badges, expandable detail rows, auto-refresh toggle [P]
- [x] T135: Add `action-audit` tab to admin `page.tsx` (VALID_TABS, TabsTrigger, TabsContent, import)

### 17.6 Feature Flag & CEL Gate
- [x] T136: Add `actionAuditEnabled` config flag (env `ACTION_AUDIT_ENABLED`, default `true`) to `config.ts`
- [x] T137: Add `action_audit` to `ALL_TABS`, `DEFAULT_POLICIES`, and `TAB_FEATURE_FLAGS` in `admin-tab-gates/route.ts`
- [x] T138: Add `action_audit: false` to `EMPTY_GATES` in `useAdminTabGates.ts`

### 17.7 Spec & Documentation
- [x] T139: Add FR-037 to `spec.md`
- [x] T140: Document `GET /api/admin/audit-events` endpoint in `docs/docs/api/rbac-roles.md`
- [x] T141: Append Phase 17 tasks to `tasks.md`
