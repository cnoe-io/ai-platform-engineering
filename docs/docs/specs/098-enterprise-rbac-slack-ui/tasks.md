# Tasks: Enterprise RBAC for Slack and CAIPE UI

**Input**: Design documents from `docs/docs/specs/098-enterprise-rbac-slack-ui/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US5)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dev environment initialization, infrastructure bootstrap, and project structure

- [x] T001 [P] Create Keycloak dev docker-compose in `deploy/keycloak/docker-compose.yml` (Keycloak 25+, port 7080, admin creds, volume for realm import)
- [x] T002 [P] Create Agent Gateway dev docker-compose in `deploy/agentgateway/docker-compose.yml` (latest AG image, port 4000, healthcheck, mount config dir)
- [x] T003 [P] Create Keycloak realm export skeleton in `deploy/keycloak/realm-config.json` (realm `caipe`, clients `caipe-ui` + `caipe-platform` + `caipe-slack-bot`, test users with roles, empty IdP broker stubs)
- [x] T004 [P] Create AG config in `deploy/agentgateway/config.yaml` (binds/listeners/routes with `jwtAuth` pointing to Keycloak JWKS, inline CEL `mcpAuthorization` rules)
- [x] T005 [P] Create AG docker-compose with JWKS fetcher init container in `deploy/agentgateway/docker-compose.yml`
- [x] T006 Create `ui/src/lib/rbac/` directory and add `ui/src/lib/rbac/types.ts` with permission matrix TypeScript types (resource names, scope names, `RbacCheckRequest`, `RbacCheckResult` per contracts/rbac-authorization-v1.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core auth infrastructure, shared clients, and permission model that ALL user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

### Keycloak Realm & Identity Federation

- [x] T007 Configure Keycloak realm `caipe` with OIDC settings, token lifetimes, and Authorization Services enabled on `caipe-platform` client in `deploy/keycloak/realm-config.json`
- [x] T008 [P] Configure Okta IdP broker stub in `deploy/keycloak/realm-config.json` (SAML or OIDC identity provider with Attribute Importer / Claim to User Attribute mappers for `groups`)
- [x] T009 [P] Configure Entra ID IdP broker stub in `deploy/keycloak/realm-config.json` (SAML or OIDC with group GUID mapping, Attribute Importer for `groups`)
- [x] T010 Configure IdP mappers for group-to-role resolution in `deploy/keycloak/realm-config.json`

### 098 Permission Matrix Definition

- [x] T011 Draft the 098 permission matrix document in `docs/docs/specs/098-enterprise-rbac-slack-ui/permission-matrix.md` listing ALL protected capabilities per component: `admin_ui`, `slack`, `supervisor`, `rag`, `sub_agent`, `tool`, `skill`, `a2a`, `mcp` — each with capability IDs, required roles, channels/APIs, and ASP relationship (FR-008, FR-014)

### Keycloak Authorization Services Modeling

- [x] T012 Model 098 permission matrix as Keycloak AuthZ resources (one per component: `admin_ui`, `slack`, `supervisor`, `rag`, `tool`, `mcp`, `a2a`, `sub_agent`, `skill`), scopes (capabilities from matrix), and role-based policies in `deploy/keycloak/realm-config.json` (FR-022, data-model.md)
- [x] T013 Configure decision strategy `UNANIMOUS` (default deny) on the `caipe-platform` resource server in `deploy/keycloak/realm-config.json` (FR-002)

### Shared Authorization Clients

- [x] T014 [P] Implement Keycloak Authorization Services client (TypeScript) in `ui/src/lib/rbac/keycloak-authz.ts` — `checkPermission(resource, scope, accessToken): Promise<RbacCheckResult>` using UMA ticket grant with `response_mode=decision` per contracts/rbac-authorization-v1.md
- [x] T015 [P] Implement Keycloak AuthZ Services client (Python) in `ai_platform_engineering/integrations/slack_bot/utils/keycloak_authz.py` — `async check_permission(resource, scope, access_token): RbacCheckResult` matching the same contract
- [x] T016 [P] Implement denied-action error response helpers in `ui/src/lib/rbac/error-responses.ts` (Admin UI toast/banner format) and `ai_platform_engineering/integrations/slack_bot/utils/rbac_middleware.py` (Slack ephemeral message format) per contracts/rbac-authorization-v1.md Error Responses (FR-004)

### Audit Event Loggers

- [x] T017 [P] Implement structured audit event logger (TypeScript) in `ui/src/lib/rbac/audit.ts` — emits JSON per data-model.md authorization decision record schema (FR-005, R-5)
- [x] T018 [P] Implement structured audit event logger (Python) in `ai_platform_engineering/integrations/slack_bot/utils/audit.py` — same schema, same field names (FR-005, R-5)

### Agent Gateway Policy Configuration

- [x] T019 Expand AG CEL authorization rules in `deploy/agentgateway/config.yaml` with `mcpAuthorization.rules` aligned to 098 matrix: role-based access for MCP tool invocation, A2A tasks, and agent dispatch; implicit default-deny for unmatched requests (FR-013, FR-016)
- [x] T020 Update AG config in `deploy/agentgateway/config.yaml` with Keycloak JWKS URI, issuer, audience, and finalized CEL rules

**Checkpoint**: Foundation ready — Keycloak realm configured, AuthZ resources/policies modeled, shared clients implemented, AG policy skeleton in place. User story implementation can now begin.

---

## Phase 3: User Story 1 — Admin governs Slack/UI capabilities (Priority: P1) MVP

**Goal**: Administrators can assign enterprise roles that consistently grant/deny capabilities across Slack and CAIPE Admin UI. The same permission matrix applies to both surfaces.

**Independent Test**: Define test roles (admin, chat_user, denied). Assign test users. Verify identical allow/deny outcomes for admin actions in Slack vs UI for each persona.

### Implementation for User Story 1

- [x] T021 [US1] Integrate NextAuth with Keycloak OIDC provider in `ui/src/lib/auth-config.ts` — configure Keycloak as the sole OIDC provider, include `groups`, `roles`, `org` in JWT session callback (FR-011)
- [x] T022 [US1] Update NextAuth route handler in `ui/src/app/api/auth/[...nextauth]/route.ts` to use Keycloak provider config from T021
- [x] T023 [US1] Extend BFF API middleware in `ui/src/lib/api-middleware.ts` to call Keycloak AuthZ (via `keycloak-authz.ts` from T014) on every protected Admin UI route; log audit events via `audit.ts` (FR-008, FR-022)
- [x] T024 [US1] Implement RBAC enforcement middleware for Slack bot in `ai_platform_engineering/integrations/slack_bot/utils/rbac_middleware.py` — wraps Slack event/command handlers; calls `keycloak_authz.check_permission()` before processing; returns ephemeral deny on failure; logs audit events (FR-008, FR-022)
- [x] T025 [US1] Wire RBAC middleware into Slack bot entry point in `ai_platform_engineering/integrations/slack_bot/app.py` — apply `rbac_middleware` to all command/event handlers
- [x] T026 [US1] Configure AG CEL authorization rules in `deploy/agentgateway/config.yaml` under `mcpAuthorization.rules` to enforce admin-only capabilities for supervisor routing, A2A task creation, and MCP admin operations aligned with the 098 matrix (FR-013, FR-014)
- [x] T027 [US1] Implement permission propagation verification: after role change in Keycloak, next token refresh picks up new roles; confirm BFF and Slack bot enforce updated deny/allow within 15 minutes (FR-006, SC-002)
- [x] T028 [US1] Implement fail-closed behavior: when Keycloak is unreachable, BFF middleware returns 503 (deny); when AG is unreachable, MCP/A2A requests return 503 (deny); Slack bot returns ephemeral error (architecture.md Fail-Closed)
- [x] T029 [US1] Add denied-action user feedback in BFF error handler (toast/banner in Admin UI) and Slack bot (ephemeral message) using helpers from T016 (FR-004)

**Checkpoint**: Admin governance operational — roles map to allow/deny on both Slack and UI surfaces.

---

## Phase 4: User Story 5 — Bot-to-agent delegation carries user identity (Priority: P1)

**Goal**: Slack/Webex bot obtains an OBO token scoped to the commanding user. Every downstream agent and tool call is authorized as that user, not the bot service account.

**Independent Test**: A user with limited permissions issues a Slack command. Verify: (a) OBO JWT has `sub`=user, `act`=bot; (b) AG enforces user's scope; (c) a tool outside the user's matrix row is denied.

### Implementation for User Story 5

- [x] T030 [P] [US5] Implement Keycloak Admin API client in `ai_platform_engineering/integrations/slack_bot/utils/keycloak_admin.py` — user attribute CRUD: `get_user_by_attribute(attr, value)`, `set_user_attribute(user_id, attr, value)` (FR-025, data-model.md Keycloak user attribute)
- [x] T031 [P] [US5] Implement OBO token exchange client in `ai_platform_engineering/integrations/slack_bot/utils/obo_exchange.py` — `async exchange_token(subject_token, bot_client_id, bot_client_secret): OboToken` per RFC 8693 grant type `urn:ietf:params:oauth:grant-type:token-exchange` (FR-018, contracts/rbac-authorization-v1.md OBO section)
- [x] T032 [US5] Implement Slack identity linking flow in `ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py` — generates single-use, time-bounded HTTPS linking URL; handles OAuth callback; calls `keycloak_admin.set_user_attribute()` to store `slack_user_id`; validates link URL freshness and single-use constraint (FR-025, architecture.md Sequence Diagram 1)
- [x] T033 [US5] Wire identity linking into Slack bot entry point in `ai_platform_engineering/integrations/slack_bot/app.py` — on first interaction, check `keycloak_admin.get_user_by_attribute("slack_user_id", slack_id)`; if not found, send "Link your account" message with linking URL; register callback route for OAuth redirect
- [x] T034 [US5] Implement OBO-based request flow in `ai_platform_engineering/integrations/slack_bot/app.py` — on subsequent commands: resolve `slack_user_id → keycloak_sub` via Keycloak Admin API, exchange for OBO token, attach OBO JWT to all downstream requests (architecture.md Sequence Diagram 2, steps ③–④)
- [x] T035 [US5] Forward OBO JWT through the delegation chain in `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py` — ensure `Authorization: Bearer <OBO_JWT>` propagates from supervisor → agent → AG → MCP (FR-019, architecture.md OBO Delegation Chain)
- [x] T036 [US5] Update AG config to validate OBO tokens in `deploy/agentgateway/config.yaml` — ensure AG accepts JWTs with `act` claim and enforces scope based on `sub` (user), not `act` (bot) (FR-019)
- [x] T037 [US5] Register bot service account in Keycloak as confidential client `caipe-slack-bot` with token-exchange permission in `deploy/keycloak/realm-config.json`; define scope ceiling per data-model.md Bot Service Account (FR-021)
- [x] T038 [US5] Enforce unlinked-user denial: all RBAC-protected Slack operations MUST be denied for users without a `slack_user_id` attribute; ephemeral message prompts linking (FR-025 edge case)

**Checkpoint**: OBO delegation chain working end-to-end — bot acts as user, AG enforces user scope.

---

## Phase 5: User Story 2 — End user sees only what they are allowed to use (Priority: P2)

**Goal**: Slack shortcuts/commands and UI screens/controls reflect the user's permissions. Users are not offered actions they cannot complete.

**Independent Test**: For each of several test personas, walk through Slack flows and UI pages; visible options must match the authorization matrix (no hidden-then-403 pattern).

### Implementation for User Story 2

- [x] T039 [P] [US2] Implement BFF capabilities endpoint in `ui/src/app/api/rbac/permissions/route.ts` — accepts user session JWT; calls Keycloak AuthZ to evaluate all resources/scopes; returns `{ [resource]: [scope1, scope2, ...] }` map representing the user's effective permissions
- [x] T040 [P] [US2] Create React hook `useRbacPermissions` in `ui/src/hooks/useRbacPermissions.ts` — fetches capabilities from BFF endpoint (T039); provides `hasPermission(resource, scope): boolean` and `loading` state; caches per session with invalidation on token refresh
- [x] T041 [US2] Create `RbacGuard` component in `ui/src/components/auth-guard.tsx` — wraps UI sections; renders children only if `useRbacPermissions.hasPermission(resource, scope)` returns true; renders nothing (or a minimal placeholder) otherwise
- [x] T042 [US2] Apply `RbacGuard` to admin pages in `ui/src/app/(app)/admin/` — hide admin navigation links, admin routes, and admin action buttons for non-admin users (FR-004, US2 acceptance scenario 1)
- [x] T043 [US2] Apply `RbacGuard` to KB management pages in `ui/src/app/(app)/knowledge-bases/` — hide KB admin/ingest controls for users without `rag#admin` or `rag#ingest` scope
- [x] T044 [US2] Implement Slack command/shortcut filtering in `ai_platform_engineering/integrations/slack_bot/app.py` — before presenting interactive elements (buttons, shortcuts, menus), evaluate user's capabilities via `keycloak_authz.check_permission()` and omit actions the user cannot perform (US2 acceptance scenario 2)
- [x] T045 [US2] Provide consistent denied-action feedback when a filtered action is attempted via deep link or stale UI: Admin UI shows "permission required" toast; Slack shows ephemeral denial (FR-004)

**Checkpoint**: UI and Slack surfaces reflect effective permissions — no ghost controls.

---

## Phase 6: User Story 3 — Team maintainer configures scoped RAG tools (Priority: P2)

**Goal**: Team leads create/update/delete custom RAG tools scoped to their team's approved datasources. Cross-team tool editing is blocked.

**Independent Test**: Two teams with distinct IdP groups. Team A maintainer can CRUD only team A's tools/KB bindings. Team B's tools are read-only or invisible. Unauthorized users cannot edit any team's tools.

### Implementation for User Story 3

- [x] T046 [P] [US3] Extend MongoDB team/KB ownership model in `ai_platform_engineering/knowledge_bases/rag/common/src/common/models/rbac.py` — add `TeamKbOwnership` (team_id, tenant_id, kb_ids, allowed_datasource_ids, keycloak_role) and `TeamRagToolConfig` (tool_id, team_id, datasource_ids, created_by) per data-model.md
- [x] T047 [P] [US3] Add Keycloak AuthZ resources for RAG tool operations in `deploy/keycloak/realm-config.json` — resource `rag` with scopes `tool.create`, `tool.update`, `tool.delete`, `tool.view`, `kb.admin`, `kb.ingest`, `kb.query`; role-based policies for `team_member(team-x)` and `kb_admin` (FR-009, FR-015)
- [x] T048 [US3] Implement RAG tool CRUD with RBAC in BFF API routes in `ui/src/app/api/rag/` — create/update/delete endpoints check `keycloak_authz.checkPermission("rag", "tool.create")` etc.; scope queries by `team_id` derived from JWT `roles` claim; reject cross-team edits (FR-009)
- [x] T049 [US3] Implement KB/datasource admin RBAC in BFF API routes in `ui/src/app/api/rag/` — admin/ingest/query operations on KBs check `keycloak_authz.checkPermission("rag", "kb.admin")` etc.; scope by team ownership from MongoDB (FR-015)
- [x] T050 [US3] Enforce datasource binding restrictions in `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py` — on RAG tool create/update, validate `datasource_ids ⊆ team.allowed_datasource_ids` from MongoDB team ownership record; reject bindings outside scope (data-model.md validation rules)
- [x] T051 [US3] Add tool-based runtime RBAC in AG CEL rules in `deploy/agentgateway/config.yaml` — `mcpAuthorization.rules` entries per tool ID or tool group, checking `jwt.realm_access.roles` against 098 matrix tool rows; deny if either enterprise RBAC or ASP denies (FR-016, R-7)
- [x] T052 [US3] Document composition and precedence of 098 RBAC and ASP tool policy in `docs/docs/specs/098-enterprise-rbac-slack-ui/permission-matrix.md` — add a section explaining deny-wins rule when both apply (FR-012)

**Checkpoint**: Team-scoped RAG tool management works — cross-team access blocked, datasource binding enforced.

---

## Phase 7: User Story 4 — Audit and access consistency (Priority: P3)

**Goal**: Security/compliance reviewers can verify that Slack and UI enforce the same permission rules and trace allow/deny decisions.

**Independent Test**: Reviewer traces from published permission matrix to sample audit records. No capability is permitted on one channel while forbidden on the other for the same user.

### Implementation for User Story 4

- [x] T053 [P] [US4] Implement audit log persistence in MongoDB — audit event logger (T017, T018) writes `authorization_decision_records` collection per data-model.md schema; indexed by `tenant_id`, `ts`, `subject_hash`, `capability` (FR-005)
- [x] T054 [P] [US4] Implement admin API endpoint for audit records in `ui/src/app/api/admin/audit/route.ts` — query by time range, principal, capability, outcome; paginated; RBAC-gated (only `admin` role); returns JSON (FR-005, FR-024)
- [x] T055 [US4] Publish the permission matrix as a versioned artifact — finalize `docs/docs/specs/098-enterprise-rbac-slack-ui/permission-matrix.md` with all FR-008/FR-014 rows, SC-001 coverage, and cross-reference to ASP/AG (SC-005, SC-006)
- [x] T056 [US4] Add audit UI page in `ui/src/app/(app)/admin/audit/` — table view of authorization decisions; filter by component, capability, outcome, time range; export CSV; gated by `admin_ui#audit.view` (FR-024)
- [x] T057 [US4] Verify cross-channel audit consistency — for each test persona, compare Slack and UI audit records for the same capability; confirm no discrepancy in allow/deny outcomes (SC-003, US4 acceptance scenario 1)

**Checkpoint**: Audit trail operational — reviewers can trace and verify access consistency.

---

## Phase 8: User Story 6 — Admin manages roles and group mappings (Priority: P2)

**Goal**: Administrators can create custom roles, map AD/IdP groups to roles, and assign roles to teams — all from the CAIPE Admin UI without needing Keycloak Admin Console access.

**Independent Test**: Admin creates a role, maps an AD group to it, assigns it to a team. A user in that group logs in and receives the role in their JWT. Built-in roles cannot be deleted.

### Implementation for User Story 6

- [ ] T106 [P] [US6] Create Keycloak Admin REST API client in `ui/src/lib/rbac/keycloak-admin.ts` — service-account auth (client_credentials grant or password grant for dev), functions: `listRealmRoles()`, `createRealmRole(name, description)`, `deleteRealmRole(name)`, `listIdpAliases()`, `listIdpMappers(alias)`, `createGroupRoleMapper(alias, group, role)`, `deleteIdpMapper(alias, mapperId)` (FR-024, FR-023)
- [ ] T107 [P] [US6] Create BFF API routes for role CRUD in `ui/src/app/api/admin/roles/route.ts` (GET list, POST create) and `ui/src/app/api/admin/roles/[name]/route.ts` (GET detail, DELETE with built-in role protection) — requires `requireAdmin(session)` (FR-024)
- [ ] T108 [P] [US6] Create BFF API routes for group-to-role mapping CRUD in `ui/src/app/api/admin/role-mappings/route.ts` (GET list across IdPs, POST create mapping) and `ui/src/app/api/admin/role-mappings/[id]/route.ts` (DELETE) — requires `requireAdmin(session)` (FR-024, FR-010)
- [ ] T109 [P] [US6] Create BFF API route for team role assignment in `ui/src/app/api/admin/teams/[id]/roles/route.ts` (GET roles, PUT set roles) — updates team doc in MongoDB with `keycloak_roles` field (FR-024, FR-023)
- [ ] T110 [US6] Extend `Team` interface in `ui/src/types/teams.ts` with `keycloak_roles?: string[]`
- [ ] T111 [US6] Add `'roles'` to `VALID_TABS` in `ui/src/app/(app)/admin/page.tsx` and render `<RolesAccessTab />`
- [ ] T112 [US6] Create `ui/src/components/admin/RolesAccessTab.tsx` — three sections: (A) Realm Roles table with create/delete, (B) Group-to-Role Mappings table with add/delete, (C) Team Role Assignments table with edit
- [ ] T113 [P] [US6] Create `ui/src/components/admin/CreateRoleDialog.tsx` — form: role name (slug), description; calls `POST /api/admin/roles`
- [ ] T114 [P] [US6] Create `ui/src/components/admin/GroupRoleMappingDialog.tsx` — form: IdP alias dropdown, group name text input, target role dropdown; calls `POST /api/admin/role-mappings`
- [ ] T115 [US6] Add `KEYCLOAK_ADMIN_CLIENT_ID` and `KEYCLOAK_ADMIN_CLIENT_SECRET` env vars to `docker-compose.dev.yaml` (UI service) and document in `ui/.env.local`

**Checkpoint**: RBAC Admin UI operational — admins can manage roles, group-to-role mappings, and team assignments without Keycloak Admin Console.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Multi-tenant isolation, edge-case hardening, documentation, performance, security, and final validation

### 9A — Multi-Tenant Isolation (FR-020, SC-009)

- [x] T058 [P] Implement multi-tenant isolation in AG CEL rules in `deploy/agentgateway/config.yaml` — add `jwt.org == mcp.tool.target` guard to every `mcpAuthorization.rules` entry; add HTTP-level deny rule for cross-tenant access; add test case: user in org-A requests tool in org-B → denied (FR-020, SC-009)
- [x] T059 [P] Implement multi-tenant isolation in Keycloak AuthZ policies in `deploy/keycloak/realm-config.json` — add JavaScript-based policy (or context attribute condition) that compares `jwt.org` against `resource.tenant_id`; test with two test tenants: user in realm `acme` cannot access resource scoped to realm `globex` (FR-020, SC-009)
- [x] T060 Add tenant context to BFF RBAC middleware in `ui/src/lib/api-middleware.ts` — extract `org` from JWT session; pass as context attribute to Keycloak AuthZ check; reject requests where tenant mismatch detected (FR-020)
- [x] T061 Add tenant context to Slack bot RBAC middleware in `ai_platform_engineering/integrations/slack_bot/utils/rbac_middleware.py` — extract `org` from OBO JWT; verify tenant match before dispatching to supervisor (FR-020)
- [x] T062 Verify multi-tenant isolation end-to-end: create two test tenants (org-A, org-B) in Keycloak; assign users to each; verify across UI, Slack, and AG-routed MCP that org-A user cannot access org-B resources (SC-009)

### 9B — Edge-Case Hardening (spec Edge Cases)

- [x] T063 [P] Handle invalidated Slack identity links in `ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py` — when Keycloak Admin API returns a disabled/deleted user for a `slack_user_id` lookup, treat the link as invalid; prompt user to re-link; deny RBAC operations until re-linked (spec edge case: "previously linked user's Keycloak account is disabled or deleted")
- [x] T064 [P] Handle multiple enterprise memberships in `ui/src/lib/rbac/keycloak-authz.ts` and `ai_platform_engineering/integrations/slack_bot/utils/rbac_middleware.py` — when JWT contains multiple `org` values or user switches org context, resolve permissions deterministically for the selected org only; reject ambiguous multi-org access attempts; no privilege leakage across tenants (spec edge case: "multiple enterprise memberships")
- [x] T065 [P] Handle stale elevated access on token refresh failure in `ui/src/lib/api-middleware.ts` — when Keycloak token refresh fails (network error, revoked session), fail closed: deny protected actions and force re-authentication rather than continuing with stale cached roles (spec edge case: "delay or partial failure when refreshing role information")
- [x] T066 [P] Handle stale elevated access on token refresh failure in `ai_platform_engineering/integrations/slack_bot/utils/obo_exchange.py` — when OBO token exchange fails or returns expired token, deny the Slack command with ephemeral error and prompt user to re-link if needed (spec edge case: "fail closed for protected actions")
- [x] T067 Prevent KB privilege expansion from tool use in `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py` — verify that having `tool#invoke` capability does NOT grant `rag#kb.admin` or `rag#kb.ingest` unless the permission matrix explicitly assigns those scopes; add explicit deny check (spec edge case: "KB vs custom RAG tool privilege expansion")
- [x] T068 Document stacked/brokered identity constraint in `docs/docs/specs/098-enterprise-rbac-slack-ui/operator-guide.md` — operators MUST define one canonical source of group claims; conflicting group sources from upstream Okta/Entra and Keycloak local groups MUST NOT combine to elevate privilege beyond documented mapping; provide example config (spec edge case: "stacked or brokered identity")
- [x] T069 Document layered authorization precedence in `docs/docs/specs/098-enterprise-rbac-slack-ui/permission-matrix.md` — add section: when 098 RBAC, ASP/tool policy, and AG policy all apply, effective access = intersection (deny wins); provide worked example showing deny from any layer results in overall deny (spec edge case: "layered authorization", FR-012)

### 9C — Operator Guide & Documentation (FR-017)

- [x] T070 Write operator guide — Keycloak realm setup section in `docs/docs/specs/098-enterprise-rbac-slack-ui/operator-guide.md` — step-by-step: create realm, configure IdP broker (Okta SAML, Okta OIDC, Entra SAML, Entra OIDC), set up Attribute Importer / Claim to User Attribute mappers, configure Hardcoded Role / SAML Attribute to Role mappers for group → role mapping, configure Protocol Mappers for `groups`, `roles`, `org` claims in JWT (FR-017a, architecture.md Keycloak Mapper Configuration table)
- [x] T071 Write operator guide — OBO token exchange section in `docs/docs/specs/098-enterprise-rbac-slack-ui/operator-guide.md` — configure `caipe-slack-bot` confidential client, enable token-exchange permission, set scope ceiling, configure bot service account (FR-017, FR-018, FR-021)
- [x] T072 Write operator guide — Keycloak Authorization Services section in `docs/docs/specs/098-enterprise-rbac-slack-ui/operator-guide.md` — create resources (components), scopes (capabilities), role-based policies per 098 matrix; set decision strategy to UNANIMOUS (default deny); explain how Admin UI writes to Keycloak Admin API (FR-017, FR-022, FR-024)
- [x] T073 Write operator guide — Agent Gateway deployment section in `docs/docs/specs/098-enterprise-rbac-slack-ui/operator-guide.md` — AG deployment (standalone Docker or Kubernetes per upstream docs); configure Keycloak as OIDC provider; reference [AG Keycloak tutorial](https://agentgateway.dev/docs/kubernetes/latest/mcp/auth/keycloak/); set JWKS URI, issuer, audience (FR-017b)
- [x] T074 Write operator guide — AG policy authoring section in `docs/docs/specs/098-enterprise-rbac-slack-ui/operator-guide.md` — write CEL rules that mirror 098 matrix rows; one rule per component/capability/role combination; include worked examples for MCP tool invocation, A2A task creation, agent dispatch (FR-017c, FR-016)
- [x] T075 Write operator guide — composition/precedence section in `docs/docs/specs/098-enterprise-rbac-slack-ui/operator-guide.md` — document how 098 RBAC, ASP/tool policy, and AG policy compose; deny-wins rule; worked example; troubleshooting when user is denied unexpectedly (FR-017d, FR-012)
- [x] T076 Write operator guide — fail-closed behavior section in `docs/docs/specs/098-enterprise-rbac-slack-ui/operator-guide.md` — document behavior when Keycloak is down (no new sessions, authz denied), when AG is down (MCP/A2A/agent denied, Slack/UI unaffected), when MongoDB is unavailable (PDP returns deny); runbook for each scenario (FR-017e, architecture.md Fail-Closed)
- [x] T077 Write operator guide — day-two operations section in `docs/docs/specs/098-enterprise-rbac-slack-ui/operator-guide.md` — adding new IdP groups, creating new roles, onboarding a new team/KB, rotating bot client secrets, upgrading AG policy, monitoring audit logs, re-linking invalidated Slack accounts

### 9D — Webex Bot Parity

- [x] T078 [P] Audit existing Webex bot integration in `ai_platform_engineering/integrations/` — identify if Webex bot exists; if yes, catalog entry points (commands, events, webhooks) that need RBAC middleware, identity linking, and OBO exchange (parity with Slack bot)
- [x] T079 [P] Implement Webex identity linking in `ai_platform_engineering/integrations/webex_bot/utils/identity_linker.py` (if Webex bot exists) — same pattern as Slack: store `webex_user_id` as Keycloak user attribute via Admin API; single-use linking URL; deny unlinked users
- [x] T080 Implement Webex RBAC middleware in `ai_platform_engineering/integrations/webex_bot/utils/rbac_middleware.py` (if Webex bot exists) — same pattern as Slack: call `keycloak_authz.check_permission()` before processing; ephemeral deny on failure; audit logging

### 9E — Performance Tuning (FR-022)

- [x] T081 [P] Implement RPT (Requesting Party Token) caching in `ui/src/lib/rbac/keycloak-authz.ts` — cache Keycloak AuthZ allow/deny decisions per user+resource+scope with TTL matching token expiry; invalidate on token refresh; measure p95 latency; target < 5ms (FR-022d)
- [x] T082 [P] Implement RPT caching in `ai_platform_engineering/integrations/slack_bot/utils/keycloak_authz.py` — in-memory TTL cache for authorization decisions keyed by `(sub, resource, scope)`; invalidate on OBO token re-exchange; measure p95 latency; target < 5ms (FR-022d)
- [x] T083 Benchmark Keycloak AuthZ decision latency under load — run 1000 concurrent permission checks with 5 test personas, 9 resources, 5 scopes each; report p50, p95, p99; tune Keycloak connection pooling and cache TTL if p95 > 5ms
- [x] T084 Benchmark AG policy evaluation latency — run 1000 concurrent MCP tool invocation requests through AG; report p50, p95, p99; tune CEL rule complexity if needed

### 9F — Quickstart Validation

- [x] T085 Validate quickstart step 1 (Keycloak startup) in `docs/docs/specs/098-enterprise-rbac-slack-ui/quickstart.md` — run `docker compose up` in `deploy/keycloak/`; verify admin console accessible; import realm config; update docs if commands changed
- [x] T086 Validate quickstart step 2 (AG startup) in `docs/docs/specs/098-enterprise-rbac-slack-ui/quickstart.md` — run `docker compose up` in `deploy/agentgateway/`; verify healthcheck; update docs if needed
- [x] T087 Validate quickstart steps 3–7 (token issuance, AuthZ check, AG policy, OBO exchange, identity link) in `docs/docs/specs/098-enterprise-rbac-slack-ui/quickstart.md` — run each `curl` command; verify expected output matches docs; fix any discrepancies in realm-config or quickstart
- [x] T088 Validate quickstart step 8 (UI BFF RBAC) in `docs/docs/specs/098-enterprise-rbac-slack-ui/quickstart.md` — run `npm run dev` in `ui/`; sign in via Keycloak; verify admin pages visible/hidden by role; update docs if needed
- [x] T089 Update quickstart acceptance criteria checklist in `docs/docs/specs/098-enterprise-rbac-slack-ui/quickstart.md` — mark all 8 checklist items as passing or document remaining gaps

### 9G — Code Cleanup & Consistency

- [x] T090 [P] Review all BFF API routes in `ui/src/app/api/` — verify every protected route calls `keycloak-authz.checkPermission()` before business logic; verify all return structured audit events; remove any leftover hard-coded role checks
- [x] T091 [P] Review all Slack bot command handlers in `ai_platform_engineering/integrations/slack_bot/app.py` — verify every handler is wrapped by `rbac_middleware`; verify no handler bypasses RBAC check; verify audit logging on every allow/deny
- [x] T092 [P] Review AG CEL authorization rules in `deploy/agentgateway/config.yaml` — verify every 098 matrix MCP/A2A/agent row has a corresponding `mcpAuthorization.rules` entry; verify no over-broad wildcard permits; verify default-deny covers all unlisted actions
- [x] T093 Verify consistent error handling across channels — compare denied-action messages from BFF (toast), Slack bot (ephemeral), and AG (403 JSON); ensure all include `{resource}#{scope}` context without leaking internal details; update `ui/src/lib/rbac/error-responses.ts` and `ai_platform_engineering/integrations/slack_bot/utils/rbac_middleware.py` if inconsistent (FR-004)

### 9H — Security Hardening

- [x] T094 [P] Verify Slack identity linking URL security in `ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py` — linking URL MUST be single-use (invalidated after first use or expiry), time-bounded (TTL ≤ 10 minutes), HTTPS-only (reject HTTP), and contain a CSPRNG nonce; add unit test for each constraint (FR-025)
- [x] T095 [P] Verify no PII in audit logs — grep all audit event emissions in `ui/src/lib/rbac/audit.ts` and `ai_platform_engineering/integrations/slack_bot/utils/audit.py`; verify `subject_hash` is salted hash (not raw sub/email); verify no raw JWT claims or usernames in info-level logs (R-5, OWASP logging)
- [x] T096 [P] Verify no secrets in codebase — scan `deploy/keycloak/`, `deploy/agentgateway/`, `ui/`, and `ai_platform_engineering/integrations/slack_bot/` for hardcoded credentials (client secrets, admin passwords, API keys); ensure all secrets reference env vars or vault; add `.env.example` files with placeholder values
- [x] T097 [P] Verify AG fail-closed behavior — stop AG container; send MCP tool call request through bot; verify request is denied with 503/timeout, not silently allowed; verify Slack and UI paths remain operational (architecture.md Fail-Closed)
- [x] T098 [P] Verify Keycloak fail-closed behavior — stop Keycloak container; attempt BFF auth check and Slack bot RBAC check; verify both deny (503, ephemeral error); verify existing valid JWTs are NOT used to allow admin operations after Keycloak is down (architecture.md Fail-Closed)
- [x] T099 Verify OBO scope ceiling enforcement — create a bot service account with limited `scope_ceiling` (e.g., only `chat`); attempt OBO exchange for a user with `admin` role; verify resulting OBO token scope = intersection (chat only, not admin); verify AG rejects admin-scoped MCP requests with this token (FR-019, FR-021)
- [x] T100 Verify AG cannot bypass enterprise RBAC — send a request directly to MCP server (bypassing AG) with a valid JWT; verify MCP server rejects or AG network policy prevents direct access; document network segmentation requirement in operator guide (spec edge case: "AG MUST not become a bypass")
- [x] T101 Verify CORS and CSRF protections on identity linking callback endpoint in `ai_platform_engineering/integrations/slack_bot/app.py` — callback MUST validate `state` parameter, enforce same-origin or strict referrer, and reject replay of auth codes

### 9I — CI Quality Gates

- [x] T102 Run `make lint` — fix all Ruff errors in `ai_platform_engineering/integrations/slack_bot/utils/` (new Python files)
- [x] T103 [P] Run `make test` — verify all existing supervisor, multi-agent, and agent tests still pass with new RBAC utilities
- [x] T104 [P] Run `make caipe-ui-tests` — verify all existing UI Jest tests pass with new `ui/src/lib/rbac/`, `ui/src/hooks/`, `ui/src/components/auth-guard.tsx` additions
- [x] T105 Run full end-to-end acceptance test with five personas (low, standard, elevated, admin, denied) across UI, Slack, and AG-routed MCP — verify SC-003: zero cases where a protected surface allows a high-risk action that the matrix marks as forbidden

---

## Phase 10: User Story 7 — RAG Server Keycloak RBAC + Per-KB Access Control (Priority: P1)

**Goal**: The RAG server validates Keycloak-issued JWTs, maps Keycloak realm roles to RAG server roles, and enforces per-KB access control by combining Keycloak per-KB roles with MongoDB team ownership. Query results are filtered to only include authorized KBs.

**Independent Test**: Configure two KBs (kb-platform, kb-team-a). Assign `kb_reader:kb-team-a` to a test user. Verify: (a) RAG server maps Keycloak realm roles correctly; (b) `/v1/query` returns only kb-team-a results; (c) admin sees all; (d) user with no role/ownership sees nothing.

### 10A — RAG Server OIDC + Keycloak Role Mapping (FR-026)

- [ ] T116 [US7] Configure RAG server OIDC environment to point to Keycloak in `docker-compose.dev.yaml` — add `OIDC_ISSUER_URL=http://keycloak:8080/realms/caipe`, `OIDC_AUDIENCE=caipe-platform`, `OIDC_JWKS_URL` to the RAG server service environment; verify RAG server `AuthManager` can discover and validate Keycloak tokens
- [ ] T117 [P] [US7] Add `KeycloakRole` constants class to `ai_platform_engineering/knowledge_bases/rag/common/src/common/models/rbac.py` — `ADMIN = "admin"`, `KB_ADMIN = "kb_admin"`, `TEAM_MEMBER = "team_member"`, `CHAT_USER = "chat_user"`, `DENIED = "denied"`; add `KbPermission` model with `kb_id: str`, `scope: str` (read/ingest/admin); add `kb_permissions: List[KbPermission]` field to `UserContext`
- [ ] T118 [US7] Implement `determine_role_from_keycloak_roles(roles: List[str]) -> str` in `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py` — maps Keycloak realm roles to RAG server roles: `admin` → `admin`, `kb_admin` → `ingestonly`, `team_member` → `readonly`, `chat_user` → `readonly`, no match → `anonymous`; most permissive wins (same pattern as `determine_role_from_groups`)
- [ ] T119 [US7] Update `_authenticate_from_token()` in `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py` — after JWT validation, check if `roles` claim is present in access_claims or userinfo; if present, call `determine_role_from_keycloak_roles()` instead of `determine_role_from_groups()`; fall back to group-based when `roles` claim absent (backward compatibility)

### 10B — Per-KB Keycloak Roles (FR-027)

- [ ] T120 [P] [US7] Add per-KB role examples to `deploy/keycloak/realm-config.json` — add realm roles: `kb_reader:*` (wildcard read), `kb_reader:kb-platform` (specific read), `kb_ingestor:kb-team-a` (specific ingest), `kb_admin:kb-ops` (specific admin); assign `kb_reader:kb-team-a` to `standard-user` test account and `kb_reader:*` to `kb-admin-user`
- [ ] T121 [US7] Implement `extract_kb_permissions_from_roles(roles: List[str]) -> List[KbPermission]` in `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py` — parses per-KB roles from JWT `roles` claim: `kb_reader:<id>` → `KbPermission(kb_id=<id>, scope="read")`, `kb_ingestor:<id>` → `KbPermission(kb_id=<id>, scope="ingest")`, `kb_admin:<id>` → `KbPermission(kb_id=<id>, scope="admin")`; supports wildcard `*` as kb_id
- [ ] T122 [US7] Populate `UserContext.kb_permissions` in `_authenticate_from_token()` — after role mapping, call `extract_kb_permissions_from_roles()` with the JWT `roles` claim and set `user_context.kb_permissions`

### 10C — Hybrid Per-KB Access Enforcement (FR-027)

- [ ] T123 [US7] Implement `get_accessible_kb_ids(user_context: UserContext, scope: str, tenant_id: str) -> List[str]` in `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py` — combines: (a) per-KB Keycloak roles from `user_context.kb_permissions` matching the requested scope; (b) `TeamKbOwnership.kb_ids` from MongoDB for the user's team; returns union; global roles (`admin`, `kb_admin`) return `["*"]` (all KBs); fails closed if MongoDB is unreachable and `RBAC_TEAM_SCOPE_ENABLED=true`
- [ ] T124 [US7] Implement `require_kb_access(kb_id: str, scope: str)` FastAPI dependency factory in `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py` — calls `get_accessible_kb_ids()`; raises `HTTPException(403)` if `kb_id` not in accessible set; passes through if user has global override
- [ ] T125 [US7] Wire `require_kb_access` into KB-specific endpoints in `ai_platform_engineering/knowledge_bases/rag/server/src/server/restapi.py` — add `require_kb_access` dependency to `/v1/datasource` (POST/DELETE), `/v1/ingest` (POST), and other KB-mutating endpoints where a `datasource_id` or KB identifier is in the request
- [ ] T126 [US7] Implement query-time KB filtering: add `inject_kb_filter(query_request, user_context, tenant_id)` in `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py` — calls `get_accessible_kb_ids(user_context, "read", tenant_id)`; adds `datasource_id` filter to vector DB query; if accessible list is empty, return empty results; if `["*"]` (admin), no filter applied; call this in the `/v1/query` handler in `restapi.py` before `VectorDBQueryService.query()`
- [ ] T127 [US7] Pass `X-Team-Id` header from BFF to RAG server in `ui/src/app/api/rag/kb/[...path]/route.ts` — extract team_id from session JWT `roles` claim (parse `team_member(team-x)` roles); add `X-Team-Id` header to proxied requests; RAG server reads this header in `get_accessible_kb_ids()` as fallback team_id when not derivable from JWT alone

**Checkpoint**: RAG server validates Keycloak JWTs, maps roles correctly, and enforces per-KB access control. Query results are filtered to authorized KBs.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — **BLOCKS all user stories**
- **User Story 1 (Phase 3, P1)**: Depends on Foundational (Phase 2)
- **User Story 5 (Phase 4, P1)**: Depends on Foundational (Phase 2); can run in parallel with US1
- **User Story 2 (Phase 5, P2)**: Depends on Foundational (Phase 2); benefits from US1 middleware being in place
- **User Story 3 (Phase 6, P2)**: Depends on Foundational (Phase 2); can run in parallel with US2
- **User Story 4 (Phase 7, P3)**: Depends on Foundational (Phase 2) and audit loggers (T017–T018 in Phase 2)
- **User Story 6 (Phase 8, P2)**: Depends on Foundational (Phase 2); can run in parallel with US2/US3
- **Polish (Phase 9)**: Depends on all user stories being functionally complete
- **User Story 7 (Phase 10, P1)**: Depends on Foundational (Phase 2) and Keycloak realm config (T007); can run in parallel with US1/US5; benefits from US3 (T046 TeamKbOwnership model) but can stub MongoDB lookups initially
- **User Story 8 (Phase 11, P1)**: Depends on Foundational (Phase 2) and Keycloak realm config (T007); benefits from Phase 10 CEL patterns; can run in parallel with US1/US5/US7 after Phase 2
- **User Story 9 (Phase 12, P2)**: Depends on Foundational (Phase 2) and Slack identity linking (Phase 4 / FR-025); can run in parallel with US6/US7/US8 after Phase 4 complete

### User Story Dependencies

- **US1 (P1)**: Requires Phase 2 only — no dependency on other stories
- **US5 (P1)**: Requires Phase 2 only — independent of US1 but benefits from shared Keycloak realm config
- **US7 (P1)**: Requires Phase 2 (Keycloak realm config, OIDC setup); independent of US1/US5; benefits from US3 T046 (TeamKbOwnership model) for hybrid access
- **US8 (P1)**: Requires Phase 2 (Keycloak realm config); benefits from US7 Phase 10 CEL patterns (T130 RAG CEL); T128 (CEL library) is a shared prerequisite for T130/T131/T135; can start T137 (AgentRuntime OBO) early, independent of CEL work
- **US2 (P2)**: Requires Phase 2; benefits from US1 BFF middleware (T023) being complete for consistent enforcement
- **US3 (P2)**: Requires Phase 2; independent of US1/US2 but uses same Keycloak AuthZ client
- **US6 (P2)**: Requires Phase 2; can run in parallel with US2/US3
- **US9 (P2)**: Requires Phase 2 + US5 Phase 4 (Slack identity linking / FR-025); T141–T146 (bot channel mapper) require Slack bot middleware from US1/US5; T147–T152 (Admin UI) require Keycloak Admin client from US6 T106; can run in parallel with US6/US7/US8
- **US4 (P3)**: Requires Phase 2 + audit loggers; benefits from US1 + US5 providing real audit events to query

### Within Each User Story

- Keycloak config before client implementation
- Shared clients (T014–T015) before middleware (T023–T025)
- Middleware before UI/Slack integration
- Core implementation before integration verification

### Parallel Opportunities

- All Phase 1 tasks (T001–T006) can run in parallel
- Phase 2: T008+T009 (IdP stubs) in parallel; T014+T015 (AuthZ clients) in parallel; T017+T018 (audit loggers) in parallel
- US1, US5, and US7 can run in parallel after Phase 2
- US2 and US3 can run in parallel after Phase 2
- Within US5: T030+T031 (Keycloak Admin + OBO clients) in parallel
- Within US2: T039+T040 (BFF endpoint + React hook) in parallel
- Within US3: T046+T047 (MongoDB model + Keycloak AuthZ resources) in parallel
- Phase 10 (US7): T117+T120 in parallel (models + realm config); T118 after T117; T119 after T118; T121 after T117; T122 after T121+T119; T123 after T122; T124 after T123; T125 after T124; T126 after T123; T127 independent
- Phase 8 (US6): T106+T107+T108 in parallel (keycloak-admin client + BFF routes); T109 after T110; T111+T112+T113+T114 after BFF routes
- Phase 11 (US8): T128+T129 in parallel (Python + TS CEL libraries); T130+T131 after T128/T129; T132 parallel with T128; T133 after T132; T134 after T132; T135 after T128; T136 after T135; T137 independent (start early); T138+T139 after T137; T140 after T138
- Phase 12 (US9): T141 first (schema); T142 after T141; T143 after T142; T144 after T143; T145+T146 after T142; T147+T148+T149 in parallel (BFF API routes); T150+T151 in parallel (UI components); T152 after T150+T151
- Phase 9: 9 sub-sections; within each, [P]-marked tasks run in parallel:
  - 9A (multi-tenant): T058+T059 in parallel; T060+T061 in parallel
  - 9B (edge cases): T063+T064+T065+T066+T067 in parallel
  - 9C (operator guide): T070–T077 sequential (single document)
  - 9D (Webex): T078+T079 in parallel
  - 9E (performance): T081+T082 in parallel; then T083+T084
  - 9F (quickstart): T085+T086 in parallel; then T087–T089 sequential
  - 9G (cleanup): T090+T091+T092 in parallel
  - 9H (security): T094+T095+T096+T097+T098 in parallel; then T099–T101 sequential
  - 9I (CI): T102 first; T103+T104 in parallel; then T105

---

## Parallel Example: User Story 5

```bash
# Parallel: Keycloak Admin API client and OBO exchange client
Task T030: "Implement Keycloak Admin API client in ai_platform_engineering/integrations/slack_bot/utils/keycloak_admin.py"
Task T031: "Implement OBO token exchange client in ai_platform_engineering/integrations/slack_bot/utils/obo_exchange.py"

# Sequential: Identity linking depends on both T030 and T031
Task T032: "Implement Slack identity linking flow in ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py"

# Sequential: Wire into bot app depends on T032
Task T033: "Wire identity linking into Slack bot entry in ai_platform_engineering/integrations/slack_bot/app.py"
```

---

## Implementation Strategy

### MVP First (US1 + US5 + US7 + US8 — P1 only)

1. Complete Phase 1: Setup (T001–T006)
2. Complete Phase 2: Foundational (T007–T020) — **critical path**
3. Complete Phase 3: User Story 1 (T021–T029) — admin governance
4. Complete Phase 4: User Story 5 (T030–T038) — OBO delegation
5. Complete Phase 10: User Story 7 (T116–T127) — RAG Keycloak RBAC + per-KB access
6. Complete Phase 11: User Story 8 (T128–T140) — Dynamic agent RBAC + CEL mandate
7. **STOP and VALIDATE**: Test US1 + US5 + US7 + US8 against quickstart.md
8. Deploy/demo: admin roles govern Slack + UI, bot delegates as user, RAG + dynamic agents enforce RBAC

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 → Admin governance MVP → Deploy/Demo
3. Add US5 → OBO delegation → Deploy/Demo
4. Add US7 → RAG Keycloak RBAC + per-KB access → Deploy/Demo
5. Add US8 → Dynamic agent RBAC + CEL → Deploy/Demo (P1 complete)
6. Add US2 → Conditional UI → Deploy/Demo
7. Add US3 → Team RAG tools → Deploy/Demo
8. Add US6 → RBAC Admin UI → Deploy/Demo
9. Add US9 → Slack channel RBAC + Admin dashboard → Deploy/Demo (P2 complete)
10. Add US4 → Audit + compliance → Deploy/Demo (P3 complete)
11. Polish → Multi-tenant isolation, edge-case hardening, operator guide, performance, security, CI → Final release

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (admin governance)
   - Developer B: User Story 5 (OBO delegation)
   - Developer C: User Story 7 (RAG Keycloak RBAC + per-KB access)
   - Developer D: User Story 8 (dynamic agent RBAC + CEL) — can start T137 early
3. Once P1 stories complete:
   - Developer A: User Story 2 (conditional UI)
   - Developer B: User Story 3 (team RAG tools)
   - Developer C: User Story 6 (RBAC Admin UI)
   - Developer D: User Story 9 (Slack channel RBAC + Admin dashboard)
4. Developer A or B: User Story 4 (audit)
5. All converge for Polish phase

---

## FR Coverage Map

| FR | Coverage | Tasks |
|----|----------|-------|
| FR-001 | Permission matrix definition | T011 |
| FR-002 | Default deny | T013, T019, T028 |
| FR-003 | Single conceptual model | T011, T055 |
| FR-004 | Denied feedback | T016, T029, T045, T093 |
| FR-005 | Audit events | T017, T018, T053, T054, T095 |
| FR-006 | Permission propagation | T027 |
| FR-007 | Least privilege separation | T011, T012 |
| FR-008 | All entry points identified | T011, T023, T024, T026, T090, T091, T092 |
| FR-009 | Team-scoped RAG tools | T048, T050 |
| FR-010 | IdP group → role mapping | T008, T009, T010, T070, T108, T114 |
| FR-011 | Keycloak required | T007, T021, T022, T070 |
| FR-012 | Composable with OBO/ASP | T052, T069, T075 |
| FR-013 | Agent Gateway required | T019, T020, T026, T036, T073, T074 |
| FR-014 | Full matrix per component | T011, T055, T092 |
| FR-015 | KB/datasource first-class | T047, T049, T067 |
| FR-016 | Tool-based runtime RBAC | T051, T074 |
| FR-017 | Deployment documentation | T070, T071, T072, T073, T074, T075, T076, T077 |
| FR-018 | OBO token exchange | T031, T034, T037, T071 |
| FR-019 | Multi-hop delegation | T035, T036, T099 |
| FR-020 | Multi-tenant isolation | T058, T059, T060, T061, T062 |
| FR-021 | Bot service account auth | T037, T038, T099 |
| FR-022 | Keycloak AuthZ PDP | T012, T013, T014, T015, T081, T082, T083 |
| FR-023 | Hybrid config store | T007, T046, T106 |
| FR-024 | CAIPE Admin UI for RBAC | T054, T056, T106, T107, T108, T109, T111, T112, T113, T114 |
| FR-025 | Slack identity linking | T030, T032, T033, T038, T063, T094 |
| FR-026 | RAG server Keycloak JWT integration | T116, T117, T118, T119, T122 |
| FR-027 | Per-KB access control (hybrid) | T120, T121, T123, T124, T125, T126, T127 |
| FR-028 | Dynamic agent RBAC (three-layer) | T132, T133, T134, T135, T136 |
| FR-029 | CEL as mandated policy engine | T128, T129, T130, T131 |
| FR-030 | Dynamic agent MCP routing via AG | T137, T138, T139, T140 |
| FR-031 | Slack channel-to-team scope mapping | T141, T142, T143, T144, T145, T146 |
| FR-032 | Admin UI Slack management dashboard | T147, T148, T149, T150, T151, T152 |

| SC | Verification | Tasks |
|----|-------------|-------|
| SC-001 | 100% matrix coverage | T011, T055, T092 |
| SC-002 | 15-minute propagation | T027 |
| SC-003 | Zero forbidden-action leaks | T057, T105 |
| SC-004 | Admin satisfaction | Post-launch survey |
| SC-005 | RAG tool matrix rows | T055 |
| SC-006 | KB/tool ASP cross-ref | T052, T055, T069 |
| SC-007 | AG JWT validation | T026, T036, T097 |
| SC-008 | OBO end-to-end demo | T034, T035, T099 |
| SC-009 | Multi-tenant denial | T058, T059, T062 |
| SC-010 | RAG Keycloak JWT role mapping | T118, T119 |
| SC-011 | Per-KB query-time filtering | T121, T123, T126 |
| SC-012 | Dynamic agent layered RBAC | T135, T136 |
| SC-013 | CEL at all enforcement points | T128, T129, T130, T131 |

---

## Phase 11: User Story 8 — Dynamic Agent RBAC + CEL Mandate (Priority: P1)

> **Depends on**: Phase 2 (Keycloak realm), Phase 10 (RAG CEL patterns)
> **Can run in parallel with**: US1/US5/US7 after Phase 2 complete
> **FR coverage**: FR-028 (T132–T136), FR-029 (T128–T131), FR-030 (T137–T140)
> **SC coverage**: SC-012 (T135–T136), SC-013 (T128–T131)

### 11A — CEL Library + Infrastructure (FR-029)

- [ ] T128 [US8] Create shared CEL evaluator library — Python package using `cel-python` with standard context schema (`user.roles`, `user.teams`, `user.email`, `resource.id`, `resource.type`, `resource.visibility`, `resource.owner_id`, `resource.shared_with_teams`, `action`). Include `evaluate(expression: str, context: dict) → bool` interface, error handling (fail closed on eval error), and unit tests. *Files*: `ai_platform_engineering/utils/cel_evaluator.py`
- [ ] T129 [US8] Create TypeScript CEL evaluator library — NPM package using `cel-js` with the same standard context schema. Include `evaluate(expression: string, context: Record<string, unknown>): boolean` interface. *Files*: `ui/src/lib/rbac/cel-evaluator.ts`
- [ ] T130 [US8] Integrate CEL evaluator into RAG server `rbac.py` — replace code-based per-KB access checks (`get_accessible_kb_ids`) with CEL evaluation using configurable expressions. Load per-KB access expression from config/env. Fall back to fail-closed on CEL errors. *Files*: `ai_platform_engineering/knowledge_bases/rag/server/src/server/rbac.py`
- [ ] T131 [US8] Integrate CEL evaluator into BFF `api-middleware.ts` — extend `requireRbacPermission` to evaluate CEL expressions for RBAC checks. Load expressions from config. Maintain backward compatibility with existing Keycloak AuthZ checks as CEL inputs. *Files*: `ui/src/lib/api-middleware.ts`

### 11B — Dynamic Agent Keycloak Integration (FR-028)

- [ ] T132 [US8] On agent create (`POST /api/v1/agents`), sync Keycloak resource — register new resource (type: `dynamic_agent`, name: agent ID) with scopes `view`, `invoke`, `configure`, `delete` via Keycloak Admin API. Auto-generate scope-based policies from visibility level. *Files*: `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/mongo.py`, new `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/keycloak_sync.py` [P with T128]
- [ ] T133 [US8] On agent delete, remove Keycloak resource + clean up dangling per-agent realm roles (`agent_user:<id>`, `agent_admin:<id>`) via Keycloak Admin API. *Files*: `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/keycloak_sync.py`, `mongo.py`
- [ ] T134 [US8] Add per-agent realm role management — Admin API endpoint to assign/remove `agent_user:<agent-id>` and `agent_admin:<agent-id>` realm roles to users. *Files*: `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/keycloak_sync.py`, Admin UI integration
- [ ] T135 [US8] Replace `can_view_agent`/`can_use_agent` code in `access.py` with CEL evaluation — load per-agent access CEL expression from config; build context from JWT roles + MongoDB visibility + team membership; evaluate. Fail closed on error. *Files*: `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/access.py`
- [ ] T136 [US8] Update `list_agents` query-time filtering to use CEL — evaluate per-agent CEL expression for each agent in listing; return only agents the user can access. Optimize with batch evaluation or pre-filtering. *Files*: `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/mongo.py`, `access.py`

### 11C — Deepagent MCP Gateway Routing (FR-030)

- [ ] T137 [US8] Update `AgentRuntime` to accept and store OBO JWT from `UserContext` — extend `AgentContext` to carry `obo_jwt` through the LangGraph execution graph. *Files*: `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py` [independent — can start early]
- [ ] T138 [US8] Configure deepagent MCP client to route through Agent Gateway — update MCP client config to use AG URL (from env/config) instead of direct MCP server URLs. *Files*: `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py`
- [ ] T139 [US8] Forward OBO JWT as `Authorization: Bearer` header to AG from MCP client — attach user's OBO JWT to all outbound MCP requests from LangGraph nodes. *Files*: `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py`
- [ ] T140 [US8] Add AG CEL rules for dynamic agent tool invocations — add policy rules in `deploy/agentgateway/config.yaml` for dynamic agent MCP tool access patterns. Validate that CEL evaluates user roles against tool permissions. *Files*: `deploy/agentgateway/config.yaml`

---

## Phase 12: User Story 9 — Slack Channel-to-Team RBAC + Admin UI Slack Dashboard (Priority: P2)

> **Depends on**: Phase 2 (Keycloak realm), Phase 3 (Slack identity linking / FR-025)
> **Can run in parallel with**: US6/US7/US8 after Phase 3 complete
> **FR coverage**: FR-031 (T141–T146), FR-032 (T147–T152)

### 12A — Slack Channel-to-Team Mapping Infrastructure (FR-031)

- [ ] T141 [US9] Create MongoDB `channel_team_mappings` collection schema — fields: `slack_channel_id` (unique), `team_id` (ref to teams), `slack_workspace_id`, `channel_name` (denormalized for display), `created_by`, `created_at`, `active` (boolean). Add index on `slack_channel_id`. *Files*: MongoDB schema documentation, `data-model.md` update
- [ ] T142 [US9] Implement `channel_team_mapper.py` in Slack bot — module with `resolve_team(channel_id) → team_id | None`, in-memory cache with 60-second TTL, MongoDB query on cache miss. Fall back to user's default team if no mapping exists. *Files*: `ai_platform_engineering/integrations/slack_bot/utils/channel_team_mapper.py`
- [ ] T143 [US9] Integrate channel-to-team resolution into Slack bot RBAC middleware — on every bot command, resolve channel → team, then verify user has `team_member(team_id)` Keycloak role. If mismatch, deny with explanation: "You don't have the required team role for this channel's team. Contact your admin." *Files*: `ai_platform_engineering/integrations/slack_bot/utils/rbac_middleware.py`
- [ ] T144 [US9] Add team context to OBO token exchange — when channel-to-team is resolved, pass `team_id` as additional context to downstream platform calls (RAG queries, agent invocations) so they scope to the correct team's resources. *Files*: `ai_platform_engineering/integrations/slack_bot/utils/obo_exchange.py`, `rbac_middleware.py`
- [ ] T145 [US9] Handle unlinked channels — when user issues a command in a channel with no mapping, use user's default team (from Keycloak user attributes or MongoDB profile) or prompt to select a team. Never default to unrestricted access. *Files*: `channel_team_mapper.py`, `rbac_middleware.py`
- [ ] T146 [US9] Handle stale mappings — if mapped team has been deleted from MongoDB, treat mapping as inactive; deny with explanation and log a warning. If mapped channel is archived in Slack, mapping is inert (no events arrive). *Files*: `channel_team_mapper.py`

### 12B — Admin UI Slack Management Dashboard (FR-032)

- [ ] T147 [US9] Create BFF API route `GET /api/admin/slack/users` — query Keycloak Admin API for users with `slack_user_id` attribute; join with bot operational metrics from MongoDB (last interaction, OBO success/fail count, active channels). Return paginated list with link status (`linked`/`pending`/`unlinked`). *Files*: `ui/src/app/api/admin/slack/users/route.ts`
- [ ] T148 [US9] Create BFF API routes for Slack user actions — `POST /api/admin/slack/users/:id/relink` (send re-link prompt), `DELETE /api/admin/slack/users/:id/link` (revoke link by removing Keycloak user attribute). *Files*: `ui/src/app/api/admin/slack/users/[id]/route.ts`
- [ ] T149 [US9] Create BFF API route `GET/POST/DELETE /api/admin/slack/channel-mappings` — CRUD for `channel_team_mappings` collection in MongoDB. `GET` returns all mappings with channel names (denormalized) and team names. `POST` creates new mapping. `DELETE` removes mapping. Browse Slack channels via Slack API for channel selection. *Files*: `ui/src/app/api/admin/slack/channel-mappings/route.ts`
- [ ] T150 [US9] Create `SlackUsersTab.tsx` component — full operational dashboard showing Slack user table with columns: display name, Slack ID, link status badge, Keycloak username, roles, teams, link date, last interaction, OBO counts. Action buttons: re-link, revoke. Filterable by status. *Files*: `ui/src/components/admin/SlackUsersTab.tsx`
- [ ] T151 [US9] Create `SlackChannelMappingTab.tsx` component — CRUD table for channel-to-team mappings. "Add Mapping" dialog with Slack channel browser (dropdown) and team selector. Stale mapping indicators (archived channel, deleted team). Remove button per row. *Files*: `ui/src/components/admin/SlackChannelMappingTab.tsx`
- [ ] T152 [US9] Add "Slack Integration" tab to Admin page — integrate `SlackUsersTab` and `SlackChannelMappingTab` as sub-tabs under a new "Slack Integration" section on the Admin page. Gate access with `admin` role via `requireRbacPermission`. *Files*: `ui/src/app/(app)/admin/page.tsx`

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Commit after each task or logical group (`git commit -s` with conventional commits)
- Stop at any checkpoint to validate story independently
- All secrets (bot client secret, Keycloak admin creds) via env vars or vault — never in code
