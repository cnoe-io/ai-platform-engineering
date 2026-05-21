# Tasks: MongoDB Envelope Credentials and Credential Exchange

**Input**: Design documents from `docs/docs/specs/2026-05-20-openbao-credential-exchange/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/credential-api.yaml`, `quickstart.md`, `mongodb-migration.md`

**Tests**: Included because FR-048 and SC-016 require automated coverage for allow/deny, browser retrieval denial, outages, provider refresh, connectors, impersonation mode, feature-toggle behavior, and migration preview.

**Organization**: Tasks are grouped by user story to enable independent implementation and validation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files or has no dependency on incomplete tasks.
- **[Story]**: Maps the task to a user story from `spec.md`.
- Every task includes at least one exact target file path.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish feature toggle, configuration, and shared scaffolding used by every credential story.

- [ ] T001 Create server-side credential feature flag helper in `ui/src/lib/feature-flags/credentials.ts`
- [ ] T002 [P] Document credential feature toggle and key-wrapper env vars in `ui/env.example`
- [ ] T003 [P] Add disabled-by-default credential feature values to `charts/ai-platform-engineering/values.yaml`
- [ ] T004 [P] Add CAIPE UI credential feature env wiring to `charts/ai-platform-engineering/charts/caipe-ui/values.yaml`
- [ ] T005 [P] Add Dynamic Agents credential exchange env wiring to `charts/ai-platform-engineering/charts/dynamic-agents/values.yaml`
- [ ] T006 Create credential module barrel and shared constants in `ui/src/lib/credentials/index.ts`
- [ ] T007 [P] Create PR #1282 selective-porting notes in `docs/docs/specs/2026-05-20-openbao-credential-exchange/pr-1282-porting-notes.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement core storage, crypto, policy, audit, and guardrail primitives that all stories depend on.

**Critical**: No user story implementation should begin until this phase is complete.

- [ ] T008 [P] Add credential domain types in `ui/src/lib/credentials/types.ts`
- [ ] T009 [P] Add credential MongoDB collection constants in `ui/src/lib/credentials/collections.ts`
- [ ] T010 [P] Add credential error and reason-code taxonomy in `ui/src/lib/credentials/errors.ts`
- [ ] T011 [P] Add credential index bootstrap script in `scripts/init-credential-mongo-indexes.ts`
- [ ] T012 [P] Add MongoDB index bootstrap tests in `ui/src/lib/credentials/__tests__/indexes.test.ts`
- [ ] T013 Implement key-wrapper interface, AWS KMS/CMK production wrapper, and dev-local wrapper in `ui/src/lib/credentials/key-wrapper.ts`
- [ ] T014 Implement MongoDB envelope credential store in `ui/src/lib/credentials/mongo-envelope-store.ts`
- [ ] T015 Add envelope store and key-wrapper unit tests for encrypt, decrypt, rotate, AWS KMS/CMK unwrap success, KMS access denied, KMS unavailable, and dev-local rejection in production mode in `ui/src/lib/credentials/__tests__/mongo-envelope-store.test.ts`
- [ ] T016 Implement credential masking helpers in `ui/src/lib/credentials/masking.ts`
- [ ] T017 [P] Add credential audit writer in `ui/src/lib/credentials/audit.ts`
- [ ] T018 Implement internal service caller classification, service/OBO audience enforcement, and browser-request guard in `ui/src/lib/credentials/internal-caller.ts`
- [ ] T019 Add browser retrieval/exchange denial tests for browser-origin, session-only, CSRF-shaped, wrong-audience, and browser-accessible token requests in `ui/src/lib/credentials/__tests__/internal-caller.test.ts`
- [ ] T020 Extend OpenFGA helper coverage for `secret_ref` use/manage/share/audit in `ui/src/lib/rbac/resource-authz.ts`
- [ ] T021 Add RBAC resource-model tests for credential actions in `ui/src/lib/rbac/__tests__/resource-authz.test.ts`
- [ ] T022 Implement credential dependency health helper in `ui/src/lib/credentials/health.ts`
- [ ] T023 Add credential health API route in `ui/src/app/api/credentials/health/route.ts`

**Checkpoint**: Feature flag, encrypted storage, audit, policy, health, and browser guardrails are ready for user stories.

---

## Phase 3: User Story 1 - Manage User and Team BYO Secrets (Priority: P1) MVP

**Goal**: Users and team admins can create, rotate, list, share, revoke, and delete secrets without exposing raw values after create/rotate ingestion.

**Independent Test**: Create a personal secret and a team-shared secret through the UI, verify only masked metadata is visible after save, grant and revoke team access, and confirm unauthorized users cannot discover or use the secret.

### Tests for User Story 1

- [ ] T024 [P] [US1] Add API tests for secret create/list/detail masking in `ui/src/app/api/credentials/secrets/__tests__/route.test.ts`
- [ ] T025 [P] [US1] Add API tests for rotate/share/revoke/delete behavior in `ui/src/app/api/credentials/secrets/__tests__/[secret_id]-route.test.ts`
- [ ] T026 [P] [US1] Add UI tests for Connections & Secrets list and create flows in `ui/src/components/credentials/__tests__/SecretsManager.test.tsx`

### Implementation for User Story 1

- [ ] T027 [US1] Implement secret list/create route in `ui/src/app/api/credentials/secrets/route.ts`
- [ ] T028 [US1] Implement secret detail/update route in `ui/src/app/api/credentials/secrets/[secret_id]/route.ts`
- [ ] T029 [US1] Implement secret lifecycle service in `ui/src/lib/credentials/secret-service.ts`
- [ ] T030 [P] [US1] Create Connections & Secrets page shell in `ui/src/app/(app)/credentials/page.tsx`
- [ ] T031 [P] [US1] Create secrets manager component in `ui/src/components/credentials/SecretsManager.tsx`
- [ ] T032 [P] [US1] Create create/rotate secret dialog in `ui/src/components/credentials/SecretValueDialog.tsx`
- [ ] T033 [US1] Add credential navigation entry gated by feature flag in `ui/src/app/(app)/admin/page.tsx`
- [ ] T034 [US1] Add team sharing UI and policy calls in `ui/src/components/credentials/SecretSharingPanel.tsx`
- [x] T034a [US1] Refactor the user credential page into `My Secrets` / `My Connections` tabs in `ui/src/components/credentials/CredentialsWorkspace.tsx`
- [x] T034b [US1] Move secret creation into a modal launched by an `Add Secret` button in `ui/src/components/credentials/SecretsManager.tsx`

**Checkpoint**: US1 is independently usable as the MVP for storing and managing BYO secrets.

---

## Phase 4: User Story 2 - Use Secrets Through a Standard Service Credential API (Priority: P1)

**Goal**: Approved internal services, Dynamic Agents, and MCP runtimes can retrieve credential material by reference through a standard service API, while browser clients are denied retrieval and exchange paths.

**Independent Test**: Configure one Dynamic Agent MCP server to use a `secret_ref`, invoke it as an allowed and denied user, verify allowed runtime receives the credential, and verify browser retrieval/exchange attempts are denied before decrypt.

### Tests for User Story 2

- [ ] T035 [P] [US2] Add contract tests for `/api/credentials/retrieve` service/OBO audience enforcement and browser denial in `ui/src/app/api/credentials/retrieve/__tests__/route.test.ts`
- [ ] T036 [P] [US2] Add contract tests for `/api/credentials/exchange` browser denial, session-only denial, and wrong-audience denial in `ui/src/app/api/credentials/exchange/__tests__/browser-deny.test.ts`
- [x] T036a [P] [US2] Add contract tests for `/api/credentials/inject/[provider]` AgentGateway caller enforcement and provider-token header injection in `ui/src/app/api/credentials/inject/[provider]/__tests__/route.test.ts`
- [ ] T037 [P] [US2] Add Dynamic Agents credential exchange client tests in `ai_platform_engineering/dynamic_agents/tests/test_credential_exchange_client.py`
- [ ] T038 [P] [US2] Add MCP client secret-ref resolution tests in `ai_platform_engineering/dynamic_agents/tests/test_mcp_client_credential_refs.py`

### Implementation for User Story 2

- [ ] T039 [US2] Implement standard retrieval API route with non-browser service/OBO caller enforcement in `ui/src/app/api/credentials/retrieve/route.ts`
- [ ] T040 [US2] Implement provider credential exchange API route shell with non-browser service/OBO caller enforcement in `ui/src/app/api/credentials/exchange/route.ts`
- [x] T040a [US2] Implement AgentGateway credential injector route in `ui/src/app/api/credentials/inject/[provider]/route.ts`
- [ ] T041 [US2] Implement retrieval request validation, caller-type validation, audience validation, and intended-use enforcement in `ui/src/lib/credentials/retrieval-service.ts`
- [ ] T042 [US2] Add Dynamic Agents credential exchange client in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/credential_exchange.py`
- [ ] T043 [US2] Extend Dynamic Agents MCP config models for credential source metadata in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/models.py`
- [ ] T044 [US2] Inject resolved secret references during MCP connection setup in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/mcp_client.py`
- [ ] T045 [US2] Extend MCP server editor credential source selector in `ui/src/components/dynamic-agents/MCPServerEditor.tsx`
- [ ] T046 [US2] Persist MCP server credential source metadata in `ui/src/app/api/mcp-servers/route.ts`

**Checkpoint**: US2 service API is usable by server-side consumers and blocked for browser-side credential material retrieval.

---

## Phase 5: User Story 3 - Connect External OAuth Providers for Impersonation (Priority: P1)

**Goal**: Users can connect GitHub, Atlassian, and Webex provider accounts using 3-legged OAuth, and server-side runtimes can exchange CAIPE identity for authorized provider credentials.

**Independent Test**: Connect one provider account through consent, verify only metadata is visible in the browser, invoke an authorized agent path, and confirm credential exchange returns or injects a server-side provider credential.

### Tests for User Story 3

- [ ] T047 [P] [US3] Add OAuth start and callback route tests in `ui/src/app/api/credentials/oauth/[provider_key]/__tests__/route.test.ts`
- [ ] T048 [P] [US3] Add provider connection lifecycle tests in `ui/src/lib/oauth-connectors/__tests__/provider-connections.test.ts`
- [ ] T049 [P] [US3] Add provider refresh rotation tests in `ui/src/lib/oauth-connectors/__tests__/provider-refresh.test.ts`
- [ ] T050 [P] [US3] Add provider connections UI tests in `ui/src/components/credentials/__tests__/ProviderConnections.test.tsx`

### Implementation for User Story 3

- [ ] T051 [US3] Add built-in GitHub, Atlassian, and Webex provider descriptors in `ui/src/lib/oauth-connectors/built-ins.ts`
- [ ] T052 [US3] Implement OAuth state and PKCE helper in `ui/src/lib/oauth-connectors/oauth-state.ts`
- [ ] T053 [US3] Implement OAuth token exchange and refresh helper in `ui/src/lib/oauth-connectors/oauth-client.ts`
- [ ] T054 [US3] Implement provider connection service in `ui/src/lib/oauth-connectors/provider-connections.ts`
- [ ] T055 [US3] Implement OAuth connect route in `ui/src/app/api/credentials/oauth/[provider_key]/connect/route.ts`
- [ ] T056 [US3] Implement OAuth callback route in `ui/src/app/api/credentials/oauth/[provider_key]/callback/route.ts`
- [ ] T057 [US3] Implement provider connections list/update routes in `ui/src/app/api/credentials/connections/route.ts`
- [ ] T058 [US3] Create My Connections UI in `ui/src/components/credentials/ProviderConnections.tsx`
- [ ] T059 [US3] Complete provider credential exchange service in `ui/src/lib/credentials/provider-exchange-service.ts`

**Checkpoint**: US3 supports provider connect, reconnect, disconnect, refresh, and server-side exchange without browser token exposure.

---

## Phase 6: User Story 4 - Admin Configures OAuth Connectors (Priority: P1)

**Goal**: Admins can configure built-in and bounded custom OAuth/OIDC connectors with encrypted client secrets and SSRF-safe validation.

**Independent Test**: Add a custom OAuth connector with required endpoints, client credentials, redirect URI, scopes, mappings, and refresh policy; enable it for a team; connect a user; verify only authorized users and agents can use it.

### Tests for User Story 4

- [ ] T060 [P] [US4] Add OAuth connector API tests in `ui/src/app/api/credentials/oauth-connectors/__tests__/route.test.ts`
- [ ] T061 [P] [US4] Add custom connector validation tests in `ui/src/lib/oauth-connectors/__tests__/connector-validation.test.ts`
- [ ] T062 [P] [US4] Add admin OAuth connector UI tests in `ui/src/components/admin/__tests__/OAuthConnectorsPanel.test.tsx`

### Implementation for User Story 4

- [ ] T063 [US4] Implement connector validation with HTTPS, host allowlist, and private-IP rejection in `ui/src/lib/oauth-connectors/connector-validation.ts`
- [ ] T064 [US4] Implement OAuth connector store and encrypted client-secret handling in `ui/src/lib/oauth-connectors/connector-store.ts`
- [ ] T065 [US4] Implement connector list/create route in `ui/src/app/api/credentials/oauth-connectors/route.ts`
- [ ] T066 [US4] Implement connector update/test/enable/disable route in `ui/src/app/api/credentials/oauth-connectors/[connector_id]/route.ts`
- [ ] T067 [US4] Create admin OAuth connector panel in `ui/src/components/admin/OAuthConnectorsPanel.tsx`
- [ ] T068 [US4] Add connector scope-change reconsent marking in `ui/src/lib/oauth-connectors/provider-connections.ts`
- [x] T068a [US4] Move OAuth provider configuration to the global Admin Credentials tab in `ui/src/components/credentials/AdminCredentialManagementPanel.tsx`
- [x] T068b [US4] Move OAuth provider creation into a modal launched by an `Add OAuth Provider` button in `ui/src/components/credentials/OAuthConnectorAdminPanel.tsx`
- [x] T068c [US4] Add OpenFGA-gated global admin secret metadata list/edit/delete APIs and UI in `ui/src/app/api/admin/credentials/secrets/` and `ui/src/components/credentials/AdminSecretsManager.tsx`

**Checkpoint**: US4 enables safe admin-managed built-in and custom OAuth connectors.

---

## Phase 7: User Story 5 - Govern Sharing, Audit, and Access Boundaries (Priority: P2)

**Goal**: Secrets and provider credentials follow CAIPE ReBAC and audit behavior for discover, metadata read, use, manage, share, and audit outcomes.

**Independent Test**: Grant and revoke `secret_ref` relationships for users, teams, and services, then verify allow/deny outcomes, audit events, and policy explanations match the graph.

### Tests for User Story 5

- [ ] T069 [P] [US5] Add `secret_ref` cases to RBAC matrix in `tests/rbac/rbac-matrix.yaml`
- [ ] T070 [P] [US5] Add credential audit tests in `ui/src/lib/credentials/__tests__/audit.test.ts`
- [ ] T071 [P] [US5] Add sensitive sharing preview tests in `ui/src/components/credentials/__tests__/SecretSharingPanel.test.tsx`

### Implementation for User Story 5

- [ ] T072 [US5] Extend OpenFGA model for credential sharing if needed in `deploy/openfga/model.fga`
- [ ] T073 [US5] Sync OpenFGA JSON model updates if needed in `deploy/openfga/init/authorization-model.json`
- [ ] T074 [US5] Sync Helm-packaged OpenFGA model updates if needed in `charts/ai-platform-engineering/charts/openfga/authorization-model.json`
- [ ] T075 [US5] Implement credential audit query route in `ui/src/app/api/credentials/audit/route.ts`
- [ ] T076 [US5] Implement credential audit UI in `ui/src/components/credentials/CredentialAuditPanel.tsx`
- [ ] T077 [US5] Add sensitive credential-sharing preview UI in `ui/src/components/credentials/SecretSharingPanel.tsx`

**Checkpoint**: US5 gives security reviewers and admins non-secret audit and policy visibility for credential use.

---

## Phase 8: User Story 6 - Operate Envelope Encryption and Credential Exchange in CAIPE Deployments (Priority: P2)

**Goal**: Operators can enable, deploy, monitor, back up, restore, and rotate the credential store safely in local, Helm, and GitOps environments.

**Independent Test**: Enable local and Helm credential settings, create a test secret, restart dependent services, render manifests, and verify credential metadata and encrypted payloads remain consistent with no hardcoded credentials.

### Tests for User Story 6

- [ ] T078 [P] [US6] Add Helm rendering tests for credential env vars in `deploy/openfga/bridge/tests/test_helm_values.py`
- [ ] T079 [P] [US6] Add CAIPE UI credential env rendering tests in `charts/ai-platform-engineering/charts/caipe-ui/templates/tests/credential-env_test.yaml`
- [ ] T080 [P] [US6] Add Dynamic Agents credential env rendering tests in `charts/ai-platform-engineering/charts/dynamic-agents/templates/tests/credential-env_test.yaml`

### Implementation for User Story 6

- [ ] T081 [US6] Add local compose credential feature settings to `docker-compose.dev.yaml`
- [ ] T082 [US6] Wire CAIPE UI credential env vars in `charts/ai-platform-engineering/charts/caipe-ui/templates/deployment.yaml`
- [ ] T083 [US6] Wire Dynamic Agents credential exchange env vars in `charts/ai-platform-engineering/charts/dynamic-agents/templates/deployment.yaml`
- [x] T083a [US6] Verify AgentGateway v0.12 route config compatibility and document that backend HTTP ext_authz injection is unsupported; keep active Jira provider-token injection in the Dynamic Agents/Jira connector path
- [ ] T084 [US6] Add External Secrets examples for credential KMS settings in `charts/ai-platform-engineering/values-external-secrets.yaml`
- [ ] T085 [US6] Document backup, restore, health, and key rotation in `docs/docs/security/rbac/usage.md`
- [ ] T086 [US6] Document credential architecture and env vars in `docs/docs/security/rbac/architecture.md`

**Checkpoint**: US6 makes the feature deployable and operable without introducing hardcoded credentials.

---

## Phase 9: User Story 7 - Migrate Existing Credential References Safely (Priority: P3)

**Goal**: Operators can preview and later migrate existing credential-shaped MCP, skill hub, and catalog API key references without breaking current deployments.

**Independent Test**: Run migration checks against sample MCP servers and skill hubs, preview candidate fields, migrate selected values to encrypted `secret_ref` records, and verify old plaintext values are removed or flagged.

### Tests for User Story 7

- [ ] T087 [P] [US7] Add migration preview API tests in `ui/src/app/api/credentials/migrations/preview/__tests__/route.test.ts`
- [ ] T088 [P] [US7] Add migration scanner unit tests in `ui/src/lib/credentials/__tests__/migration-preview.test.ts`
- [ ] T089 [P] [US7] Add migration UI tests in `ui/src/components/credentials/__tests__/CredentialMigrationPanel.test.tsx`

### Implementation for User Story 7

- [ ] T090 [US7] Implement credential-shaped field scanner in `ui/src/lib/credentials/migration-preview.ts`
- [ ] T091 [US7] Implement migration preview route in `ui/src/app/api/credentials/migrations/preview/route.ts`
- [ ] T092 [US7] Add migration panel for MCP, skill hub, and catalog candidates in `ui/src/components/credentials/CredentialMigrationPanel.tsx`
- [ ] T093 [US7] Add non-destructive migration script entry in `package.json`
- [ ] T094 [US7] Document staged migration behavior in `docs/docs/security/rbac/usage.md`

**Checkpoint**: US7 provides safe visibility into existing credential-shaped records before any destructive migration.

---

## Phase 10: User Story 8 - Gate Security UI V2 Integration Behind a Feature Toggle (Priority: P3)

**Goal**: Compatible pieces from PR #1282 are integrated behind the credential feature toggle without changing legacy behavior when disabled.

**Independent Test**: Start CAIPE with the toggle disabled and verify legacy credential/admin behavior remains unchanged; enable the toggle and verify the new credential surfaces appear only to authorized users.

### Tests for User Story 8

- [ ] T095 [P] [US8] Add feature-toggle disabled route tests in `ui/src/app/api/credentials/__tests__/feature-disabled.test.ts`
- [ ] T096 [P] [US8] Add feature-toggle admin navigation tests in `ui/src/app/api/rbac/admin-tab-gates/__tests__/route.test.ts`
- [ ] T097 [P] [US8] Add legacy behavior preservation tests in `ui/src/app/api/mcp-servers/__tests__/legacy-credentials.test.ts`

### Implementation for User Story 8

- [ ] T098 [US8] Port compatible PR #1282 feature-flag helpers into `ui/src/lib/feature-flags/credentials.ts`
- [ ] T099 [US8] Port compatible PR #1282 audit and rate-limit helpers into `ui/src/lib/credentials/audit.ts`
- [ ] T100 [US8] Port compatible PR #1282 admin UI foundations into `ui/src/components/admin/OAuthConnectorsPanel.tsx`
- [ ] T101 [US8] Port compatible PR #1282 MCP header handling into `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/mcp_client.py`
- [ ] T102 [US8] Record adopted PR #1282 commits and attribution in `docs/docs/specs/2026-05-20-openbao-credential-exchange/pr-1282-porting-notes.md`

**Checkpoint**: US8 lets operators safely enable or disable the new credential work while preserving legacy behavior.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, validation, and final quality gates that cut across all stories.

- [ ] T103 [P] Update RBAC workflow diagrams for service credential API and browser guardrails in `docs/docs/security/rbac/workflows.md`
- [ ] T104 [P] Update auth-relevant file map for all new credential files in `docs/docs/security/rbac/file-map.md`
- [ ] T105 [P] Update Dynamic Agents MCP API docs for credential refs and impersonation mode in `docs/docs/api/dynamic-agents-mcp.md`
- [ ] T106 [P] Update Helm install or upgrade notes for credential feature settings in `docs/docs/security/rbac/helm-install-upgrade.md`
- [ ] T107 Run OpenAPI parse validation for `docs/docs/specs/2026-05-20-openbao-credential-exchange/contracts/credential-api.yaml`
- [ ] T108 Run UI credential tests with `npm --prefix ui test -- credentials`
- [ ] T109 Run UI lint with `npm --prefix ui run lint`
- [ ] T110 Run Dynamic Agents credential tests with `PYTHONPATH=. uv run pytest ai_platform_engineering/dynamic_agents/tests/test_credential_exchange_client.py ai_platform_engineering/dynamic_agents/tests/test_mcp_client_credential_refs.py -v`
- [ ] T111 Run MCP auth regression tests with `PYTHONPATH=. uv run pytest tests/test_mcp_auth_middleware.py -v`
- [ ] T112 Run RBAC unit matrix tests with `make test-rbac-unit`
- [ ] T113 Render Helm manifests for credential env verification with `helm template caipe charts/ai-platform-engineering -f charts/ai-platform-engineering/values.yaml`
- [ ] T114 Run RBAC docs validator for credential file-map coverage with `python scripts/validate-rbac-doc.py`
- [ ] T115 [P] Record the MongoDB envelope encryption versus OpenBao architecture decision in `docs/docs/changes/2026-05-20-mongodb-envelope-credential-store.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup; blocks all user stories.
- **P1 stories (Phases 3-6)**: Depend on Foundational. US1 and US2 should be implemented first for MVP and service boundary; US3 and US4 can proceed in parallel after foundational connector scaffolding exists.
- **P2 stories (Phases 7-8)**: Depend on relevant P1 surfaces and Foundational.
- **P3 stories (Phases 9-10)**: Depend on Foundational and the relevant P1/P2 surfaces they extend.
- **Polish (Phase 11)**: Depends on the desired story set for the release.

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational; MVP for secret storage and management.
- **US2 (P1)**: Can start after Foundational; can run alongside US1 but needs the credential store and internal caller guard.
- **US3 (P1)**: Depends on Foundational and benefits from US4 connector store, but built-in provider descriptors can allow an initial path.
- **US4 (P1)**: Depends on Foundational and US1 encrypted connector client-secret storage.
- **US5 (P2)**: Depends on US1/US2 policy and audit flows.
- **US6 (P2)**: Can run after Foundational, then tracks env vars introduced by US1-US4.
- **US7 (P3)**: Depends on US1 secret refs and migration-preview collections.
- **US8 (P3)**: Depends on Setup feature toggle and should be applied around each adopted PR #1282 piece.

### Within Each User Story

- Tests first, and verify they fail before implementation.
- Shared types and services before routes.
- Routes before UI components that consume them.
- Server-side credential guardrails before any runtime injection.
- Story checkpoint validation before moving to the next priority group.

## Parallel Opportunities

- Setup tasks T002-T005 and T007 can run in parallel.
- Foundational tasks T008-T012, T016-T017, and T020-T023 can run in parallel after T006.
- Tests within each user story can run in parallel because they target different files.
- US1 and US2 can proceed in parallel after Foundational if the credential store interface is stable.
- US3 and US4 can proceed in parallel with coordination on `ui/src/lib/oauth-connectors/provider-connections.ts`.
- US6 Helm/compose work can proceed in parallel with US3/US4 after env var names are finalized.

## Parallel Examples

### User Story 1

```bash
Task: "Add API tests for secret create/list/detail masking in ui/src/app/api/credentials/secrets/__tests__/route.test.ts"
Task: "Add UI tests for Connections & Secrets list and create flows in ui/src/components/credentials/__tests__/SecretsManager.test.tsx"
Task: "Create Connections & Secrets page shell in ui/src/app/(app)/credentials/page.tsx"
```

### User Story 2

```bash
Task: "Add contract tests for /api/credentials/retrieve in ui/src/app/api/credentials/retrieve/__tests__/route.test.ts"
Task: "Add Dynamic Agents credential exchange client tests in ai_platform_engineering/dynamic_agents/tests/test_credential_exchange_client.py"
Task: "Add MCP client secret-ref resolution tests in ai_platform_engineering/dynamic_agents/tests/test_mcp_client_credential_refs.py"
```

### User Story 4

```bash
Task: "Add custom connector validation tests in ui/src/lib/oauth-connectors/__tests__/connector-validation.test.ts"
Task: "Implement connector validation with HTTPS, host allowlist, and private-IP rejection in ui/src/lib/oauth-connectors/connector-validation.ts"
Task: "Create admin OAuth connector panel in ui/src/components/admin/OAuthConnectorsPanel.tsx"
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete US1 to create and manage encrypted BYO secrets.
3. Complete the browser guardrail subset of US2 so raw credential material never returns to browser clients.
4. Stop and validate US1 and US2 independently before OAuth provider work.

### Incremental Delivery

1. Deliver US1 + US2 for encrypted static secret references and service credential API.
2. Add US3 + US4 for provider connections and connector administration.
3. Add US5 + US6 for governance and operations readiness.
4. Add US7 + US8 for migration preview and selective PR #1282 integration.
5. Run Phase 11 checks before PR completion.

### Parallel Team Strategy

With multiple developers:

1. One developer owns credential store and service API guardrails.
2. One developer owns UI and secret management.
3. One developer owns OAuth provider connections and connector validation.
4. One developer owns Dynamic Agents/MCP runtime integration.
5. One developer owns Helm, docs, and RBAC matrix updates.

## Task Summary

- **Total tasks**: 127
- **Setup**: 7
- **Foundational**: 16
- **US1 Manage User and Team BYO Secrets**: 11
- **US2 Standard Service Credential API**: 12
- **US3 External OAuth Provider Connections**: 13
- **US4 Admin OAuth Connector Configuration**: 9
- **US5 Governance, Audit, and Access Boundaries**: 9
- **US6 Deployment and Operations**: 9
- **US7 Safe Credential Migration**: 8
- **US8 Feature Toggle and PR #1282 Integration**: 8
- **Polish and Cross-Cutting**: 25

### Additional Completed Tasks

- [x] T116 Add env-driven OAuth connector startup bootstrap tests for GitHub, Atlassian/Confluence, and Webex
- [x] T117 Implement idempotent `caipe-ui` TypeScript OAuth connector bootstrap from `.env`/ESO-provided env vars
- [x] T118 Wire Docker Compose `.env` variables and Kubernetes ESO mappings for provider client IDs, secrets, and redirect URIs
- [x] T119 Update RBAC/spec documentation for ESO-vs-`.env` bootstrap behavior
- [x] T120 Add deep-linked user credential tabs for `?tab=connections|secrets`
- [x] T121 Add deep-linked admin credential tabs for `?tab=credentials&credentialsTab=oauth-providers|secrets`
- [x] T122 Add feature-gated user API for enabled OAuth connector metadata
- [x] T123 Show available providers with Connect actions on My Connections before a user grant exists
- [x] T124 Move Credential Audit out of the user secrets tab into the Super Admin Credentials page
- [x] T125 Add admin-only global credential audit tab and route under `admin_surface:credentials`
- [x] T126 Redirect browser OAuth connect requests to provider authorization URLs instead of returning JSON
- [x] T127 Verify PKCE S256 parameters include `code_challenge_method=S256` and a 43-character challenge

## Notes

- Tasks intentionally keep retrieval and exchange APIs server-to-server only; browser-facing tasks are limited to create, rotate, metadata, status, and admin flows.
- No task should introduce hardcoded secrets, DB-stored production master keys, or browser-readable credential material.
- Commits that port PR #1282 code should preserve author credit and follow repository DCO/AI attribution rules.
