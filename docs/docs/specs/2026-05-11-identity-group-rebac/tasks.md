# Tasks: Enterprise Identity Group Sync and Universal ReBAC

**Input**: Design documents from `docs/docs/specs/2026-05-11-identity-group-rebac/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, `mongodb-migration.md`

**Tests**: Test tasks are included because the specification defines independent test criteria for every user story and the implementation plan requires Jest, Playwright, pytest, and RBAC matrix coverage.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently after the shared foundation is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and does not depend on incomplete same-story work
- **[Story]**: User story label for traceability
- **File paths**: Every task includes exact repository paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the shared file layout and test fixtures needed by the identity sync and universal ReBAC work.

- [ ] T001 Create Identity Group Sync API, component, and test directory skeletons in `ui/src/app/api/admin/identity-group-sync/`, `ui/src/components/admin/identity-group-sync/`, and `ui/src/lib/rbac/__tests__/identity-group-sync/`
- [ ] T002 Create Universal ReBAC API, component, and test directory skeletons in `ui/src/app/api/admin/rebac/`, `ui/src/components/admin/rebac/`, and `ui/src/lib/rbac/__tests__/rebac/`
- [ ] T003 Create Slack ReBAC API and test directory skeletons in `ui/src/app/api/admin/slack/channels/` and `ui/src/lib/rbac/__tests__/slack/`
- [ ] T004 [P] Add representative identity-group fixture data in `tests/rbac/fixtures/identity_groups.ts`
- [ ] T005 [P] Add representative Python identity-group fixture data in `tests/rbac/fixtures/identity_groups.py`
- [ ] T006 [P] Add Slack channel multi-resource fixture data in `tests/rbac/fixtures/slack_rebac.ts`
- [ ] T007 [P] Add universal resource fixture data in `tests/rbac/fixtures/rebac_resources.ts`
- [ ] T008 [P] Add feature-specific E2E fixture helpers in `tests/rbac/e2e/identity-group-rebac-fixture.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement shared models, validators, OpenFGA model support, storage helpers, and authorization gates that all user stories depend on.

**Critical**: No user story work should begin until this phase is complete.

- [ ] T009 Define shared universal ReBAC TypeScript types in `ui/src/types/rbac-universal.ts`
- [ ] T010 Define identity group sync TypeScript types in `ui/src/types/identity-group-sync.ts`
- [ ] T011 Define Slack ReBAC TypeScript types in `ui/src/types/slack-rebac.ts`
- [ ] T012 Implement MongoDB collection constants and typed helpers for new RBAC collections in `ui/src/lib/rbac/mongo-collections.ts`
- [ ] T013 Implement deterministic team slug normalization and collision helpers in `ui/src/lib/rbac/team-slugs.ts`
- [ ] T014 Implement standard action/resource catalog in `ui/src/lib/rbac/resource-model.ts`
- [ ] T015 Implement shared ReBAC relationship validation and unsupported-action errors in `ui/src/lib/rbac/relationship-validator.ts`
- [ ] T016 Implement relationship-to-OpenFGA tuple conversion helpers in `ui/src/lib/rbac/tuple-builders.ts`
- [ ] T017 Extend OpenFGA read/write/check helpers for universal resource relations in `ui/src/lib/rbac/openfga.ts`
- [ ] T018 Add OpenFGA model support for universal resource types and Slack channel relations in `deploy/openfga-experiment/model.fga`
- [ ] T019 Mirror the OpenFGA authorization model changes in `deploy/openfga-experiment/init/authorization-model.json`
- [ ] T020 Implement ReBAC admin API authorization helpers in `ui/src/app/api/admin/rebac/_lib.ts`
- [ ] T021 Implement Identity Group Sync API authorization helpers in `ui/src/app/api/admin/identity-group-sync/_lib.ts`
- [ ] T022 Implement Slack ReBAC API authorization helpers in `ui/src/app/api/admin/slack/channels/_lib.ts`
- [ ] T023 Implement audit event emitters for sync, policy, graph, access-check, and Slack changes in `ui/src/lib/rbac/audit.ts`
- [ ] T024 Implement MongoDB index initialization script for new RBAC collections in `scripts/init-rbac-mongo-indexes.ts`
- [ ] T025 Add RBAC matrix resource/action entries for new resource types in `tests/rbac/rbac-matrix.yaml`
- [ ] T026 Add unit tests for resource/action catalog and tuple validation in `ui/src/lib/rbac/__tests__/rebac/resource-model.test.ts`
- [ ] T027 Add unit tests for OpenFGA tuple conversion helpers in `ui/src/lib/rbac/__tests__/rebac/tuple-builders.test.ts`
- [ ] T028 Add documentation stubs for implementation changes in `docs/docs/security/rbac/file-map.md`

**Checkpoint**: The repository has shared types, storage/index support, relationship validation, OpenFGA model coverage, admin API gates, audit helpers, and baseline tests.

---

## Phase 3: User Story 1 - Sync Enterprise Groups Into CAIPE Teams (Priority: P1) MVP

**Goal**: Configure ordered enterprise group mapping clusters, preview dry-runs, apply approved sync, create teams, record membership sources, and materialize user-team ReBAC relationships without granting unrelated resources.

**Independent Test**: Configure fixture groups and mapping rules, run a dry-run, apply it, and verify created teams, membership source records, skipped users, conflicts, and OpenFGA user-team tuples.

### Tests for User Story 1

- [ ] T029 [P] [US1] Add BFF contract tests for Identity Group Sync provider and rule endpoints in `ui/src/app/api/admin/identity-group-sync/__tests__/rules-route.test.ts`
- [ ] T030 [P] [US1] Add BFF contract tests for dry-run and apply endpoints in `ui/src/app/api/admin/identity-group-sync/__tests__/sync-run-route.test.ts`
- [ ] T031 [P] [US1] Add unit tests for regex mapping clusters, priority resolution, excludes, and slug collisions in `ui/src/lib/rbac/__tests__/identity-group-sync/rule-matcher.test.ts`
- [ ] T032 [P] [US1] Add unit tests for source-preserving membership reconciliation in `ui/src/lib/rbac/__tests__/identity-group-sync/membership-reconciler.test.ts`
- [ ] T033 [P] [US1] Add Playwright dry-run and apply scenario for enterprise group sync in `tests/rbac/e2e/story-identity-group-sync.spec.ts`

### Implementation for User Story 1

- [ ] T034 [P] [US1] Implement identity provider repository helpers in `ui/src/lib/rbac/identity-provider-store.ts`
- [ ] T035 [P] [US1] Implement identity group sync rule repository helpers in `ui/src/lib/rbac/identity-group-sync-rule-store.ts`
- [ ] T036 [P] [US1] Implement external group and group-team link repository helpers in `ui/src/lib/rbac/external-group-store.ts`
- [ ] T037 [P] [US1] Implement team membership source repository helpers in `ui/src/lib/rbac/team-membership-source-store.ts`
- [ ] T038 [US1] Implement ordered regex mapping cluster evaluator in `ui/src/lib/rbac/identity-group-rule-matcher.ts`
- [ ] T039 [US1] Implement dry-run planner for matched groups, generated teams, membership diffs, skipped users, conflicts, and tuple diffs in `ui/src/lib/rbac/identity-group-sync-planner.ts`
- [ ] T040 [US1] Implement apply reconciler for approved runs and OpenFGA user-team tuple writes in `ui/src/lib/rbac/identity-group-sync-reconciler.ts`
- [ ] T041 [US1] Implement provider health endpoint in `ui/src/app/api/admin/identity-group-sync/providers/route.ts`
- [ ] T042 [US1] Implement rule list/create endpoint in `ui/src/app/api/admin/identity-group-sync/rules/route.ts`
- [ ] T043 [US1] Implement rule update endpoint in `ui/src/app/api/admin/identity-group-sync/rules/[ruleId]/route.ts`
- [ ] T044 [US1] Implement dry-run endpoint in `ui/src/app/api/admin/identity-group-sync/dry-run/route.ts`
- [ ] T045 [US1] Implement apply endpoint in `ui/src/app/api/admin/identity-group-sync/apply/route.ts`
- [ ] T046 [US1] Implement run details endpoint in `ui/src/app/api/admin/identity-group-sync/runs/[runId]/route.ts`
- [ ] T047 [US1] Implement skipped-user remediation endpoint in `ui/src/app/api/admin/identity-group-sync/skipped-users/[sourceId]/resolve/route.ts`
- [ ] T048 [US1] Implement Identity Group Sync admin tab shell in `ui/src/components/admin/identity-group-sync/IdentityGroupSyncTab.tsx`
- [ ] T049 [US1] Implement mapping cluster editor component in `ui/src/components/admin/identity-group-sync/MappingClusterEditor.tsx`
- [ ] T050 [US1] Implement dry-run preview component with conflicts and skipped users in `ui/src/components/admin/identity-group-sync/DryRunPreview.tsx`
- [ ] T051 [US1] Wire Identity Group Sync tab into the admin page in `ui/src/app/(app)/admin/page.tsx`

**Checkpoint**: User Story 1 is independently functional as the MVP and can sync approved enterprise groups into CAIPE teams with explainable membership provenance.

---

## Phase 4: User Story 2 - Manage Teams and Members Manually (Priority: P1)

**Goal**: Preserve manual teams and memberships as first-class sources, enforce scoped team administration, and ensure sync removes only managed sources.

**Independent Test**: Create a team manually, add members/admins, run sync for overlapping users, and verify manual membership persists unless explicitly removed by an authorized admin.

### Tests for User Story 2

- [ ] T052 [P] [US2] Add BFF tests for manual team creation source metadata in `ui/src/app/api/admin/teams/__tests__/manual-team-source.test.ts`
- [ ] T053 [P] [US2] Add BFF tests for manual membership source preservation in `ui/src/app/api/admin/teams/[id]/members/__tests__/membership-sources.test.ts`
- [ ] T054 [P] [US2] Add Playwright scoped team admin membership scenario in `tests/rbac/e2e/story-manual-team-management.spec.ts`

### Implementation for User Story 2

- [ ] T055 [US2] Update team creation API to set source/status/owner metadata in `ui/src/app/api/admin/teams/route.ts`
- [ ] T056 [US2] Update team detail API to return membership source summaries in `ui/src/app/api/admin/teams/[id]/route.ts`
- [ ] T057 [US2] Update team members API to create and remove manual `team_membership_sources` records in `ui/src/app/api/admin/teams/[id]/members/route.ts`
- [ ] T058 [US2] Implement team membership source read endpoint in `ui/src/app/api/admin/identity-group-sync/teams/[teamId]/membership-sources/route.ts`
- [ ] T059 [US2] Implement scoped team-admin authorization checks for manual membership edits in `ui/src/lib/rbac/team-admin-guards.ts`
- [ ] T060 [US2] Update Team Details membership UI to display manual, synced, stale, and pending identity-link sources in `ui/src/components/admin/TeamDetailsDialog.tsx`
- [ ] T061 [US2] Add manual membership source preservation to the sync reconciler in `ui/src/lib/rbac/identity-group-sync-reconciler.ts`

**Checkpoint**: Manual teams and memberships can be administered safely and remain intact across automated sync.

---

## Phase 5: User Story 3 - Represent Every Protected Resource in ReBAC (Priority: P1)

**Goal**: Represent all protected CAIPE resources and actions in the catalog, OpenFGA model, access checker, enforcement status, and RBAC matrix.

**Independent Test**: Select representative resources for every type, create read/manage checks, and verify missing relationships deny by default.

### Tests for User Story 3

- [ ] T062 [P] [US3] Add catalog contract tests for every protected resource type in `ui/src/app/api/admin/rebac/__tests__/catalog-route.test.ts`
- [ ] T063 [P] [US3] Add enforcement-status contract tests in `ui/src/app/api/admin/rebac/__tests__/enforcement-status-route.test.ts`
- [ ] T064 [P] [US3] Add RBAC matrix tests for deny-by-default and representative read/manage checks in `tests/rbac/unit/ts/universal-rebac-matrix.test.ts`

### Implementation for User Story 3

- [ ] T065 [US3] Implement canonical ReBAC resource discovery service in `ui/src/lib/rbac/resource-catalog.ts`
- [ ] T066 [US3] Implement ReBAC catalog endpoint in `ui/src/app/api/admin/rebac/catalog/route.ts`
- [ ] T067 [US3] Implement enforcement status store and helpers in `ui/src/lib/rbac/enforcement-status.ts`
- [ ] T068 [US3] Implement enforcement status endpoint in `ui/src/app/api/admin/rebac/enforcement-status/route.ts`
- [ ] T069 [US3] Update OpenFGA catalog endpoint to include all universal resource types in `ui/src/app/api/admin/openfga/catalog/route.ts`
- [ ] T070 [US3] Update team resource assignment API to use universal tuple builders for agents, tools, knowledge bases, skills, and tasks in `ui/src/app/api/admin/teams/[id]/resources/route.ts`
- [ ] T071 [US3] Update RBAC matrix fixtures with universal resource examples in `tests/rbac/fixtures/rebac_resources.ts`

**Checkpoint**: Every resource type from the authorization matrix can be discovered, checked, and represented with at least read/manage enforcement metadata.

---

## Phase 6: User Story 4 - Create and Update ReBAC Policies in the UI (Priority: P2)

**Goal**: Provide guided ReBAC policy authoring with staged grants/revocations, validation, graph interactions, atomic apply semantics, and audit records.

**Independent Test**: Create a staged policy update through the UI, validate it, apply it, verify OpenFGA tuples and provenance, then revoke it.

### Tests for User Story 4

- [ ] T072 [P] [US4] Add change-set contract tests in `ui/src/app/api/admin/rebac/__tests__/change-sets-route.test.ts`
- [ ] T073 [P] [US4] Add relationship validation tests for unsupported actions and privilege escalation in `ui/src/lib/rbac/__tests__/rebac/policy-change-validator.test.ts`
- [ ] T074 [P] [US4] Add Playwright policy builder staged diff scenario in `tests/rbac/e2e/story-policy-authoring.spec.ts`

### Implementation for User Story 4

- [ ] T075 [P] [US4] Implement policy rule repository helpers in `ui/src/lib/rbac/policy-rule-store.ts`
- [ ] T076 [P] [US4] Implement policy change-set repository helpers in `ui/src/lib/rbac/policy-change-set-store.ts`
- [ ] T077 [US4] Implement change-set validator for delegated scope, action support, circular grants, and last-admin risk in `ui/src/lib/rbac/policy-change-validator.ts`
- [ ] T078 [US4] Implement change-set create endpoint in `ui/src/app/api/admin/rebac/change-sets/route.ts`
- [ ] T079 [US4] Implement change-set validate endpoint in `ui/src/app/api/admin/rebac/change-sets/[changeSetId]/validate/route.ts`
- [ ] T080 [US4] Implement change-set apply endpoint with OpenFGA tuple writes and audit records in `ui/src/app/api/admin/rebac/change-sets/[changeSetId]/apply/route.ts`
- [ ] T081 [US4] Implement relationship list endpoint for a resource in `ui/src/app/api/admin/rebac/resources/[type]/[id]/relationships/route.ts`
- [ ] T082 [US4] Implement guided policy builder component in `ui/src/components/admin/rebac/RebacPolicyBuilder.tsx`
- [ ] T083 [US4] Implement staged policy diff component in `ui/src/components/admin/rebac/PolicyChangeSetDiff.tsx`
- [ ] T084 [US4] Update OpenFGA ReBAC admin tab to use validated change sets in `ui/src/components/admin/OpenFgaRebacTab.tsx`

**Checkpoint**: Administrators can create, validate, apply, and revoke ReBAC relationships without typing raw tuples.

---

## Phase 7: User Story 5 - Visualize All Relationships and Explain Access (Priority: P2)

**Goal**: Provide graph visualization, filtering, pagination, all-relationships scope, and access explanations for allow and deny outcomes.

**Independent Test**: Create known resources and relationships, render all and filtered graphs, run access checks, and verify explanation paths or missing prerequisites.

### Tests for User Story 5

- [ ] T085 [P] [US5] Add graph endpoint contract tests for all/team/resource/subject/Slack scopes in `ui/src/app/api/admin/rebac/__tests__/graph-route.test.ts`
- [ ] T086 [P] [US5] Add access-check explanation tests in `ui/src/app/api/admin/rebac/__tests__/check-route.test.ts`
- [ ] T087 [P] [US5] Add Playwright graph filtering and access checker scenario in `tests/rbac/e2e/story-graph-and-access-checker.spec.ts`

### Implementation for User Story 5

- [ ] T088 [US5] Implement relationship graph query service with pagination and source metadata in `ui/src/lib/rbac/rebac-graph.ts`
- [ ] T089 [US5] Implement graph endpoint with scope filters in `ui/src/app/api/admin/rebac/graph/route.ts`
- [ ] T090 [US5] Implement access explanation service that combines OpenFGA checks and MongoDB provenance in `ui/src/lib/rbac/access-explainer.ts`
- [ ] T091 [US5] Implement access checker endpoint in `ui/src/app/api/admin/rebac/check/route.ts`
- [ ] T092 [US5] Update existing OpenFGA graph endpoint to delegate to universal graph service in `ui/src/app/api/admin/openfga/graph/route.ts`
- [ ] T093 [US5] Implement graph filter controls component in `ui/src/components/admin/rebac/RebacGraphFilters.tsx`
- [ ] T094 [US5] Implement access checker UI component in `ui/src/components/admin/rebac/RebacAccessChecker.tsx`
- [ ] T095 [US5] Update graph editor to display source, enforcement status, and missing-prerequisite explanations in `ui/src/components/admin/OpenFgaRebacTab.tsx`

**Checkpoint**: Administrators can inspect full or scoped relationship graphs and explain both allows and denies.

---

## Phase 8: User Story 6 - Gate Slack Channels to Multiple Agents, Tools, and Knowledge Bases (Priority: P2)

**Goal**: Replace one-channel-to-one-agent assumptions with ReBAC-governed Slack channel access to multiple agents, tools, and knowledge bases.

**Independent Test**: Grant one Slack channel multiple resources, invoke allowed and disallowed resources from Slack as different users, and verify channel and user resource checks are both enforced.

### Tests for User Story 6

- [ ] T096 [P] [US6] Add Slack channel admin API contract tests in `ui/src/app/api/admin/slack/channels/__tests__/channel-resources-route.test.ts`
- [ ] T097 [P] [US6] Add Slack runtime ReBAC tests in `ai_platform_engineering/integrations/slack_bot/tests/test_slack_channel_rebac.py`
- [ ] T098 [P] [US6] Add Playwright Slack channel multi-resource admin scenario in `tests/rbac/e2e/story-slack-channel-rebac.spec.ts`

### Implementation for User Story 6

- [ ] T099 [P] [US6] Implement Slack channel grant repository helpers in `ui/src/lib/rbac/slack-channel-grant-store.ts`
- [ ] T100 [P] [US6] Implement Slack channel ReBAC decision helpers for UI/BFF checks in `ui/src/lib/rbac/slack-channel-rebac.ts`
- [ ] T101 [US6] Implement Slack channels list endpoint in `ui/src/app/api/admin/slack/channels/route.ts`
- [ ] T102 [US6] Implement Slack channel resources read/write endpoint in `ui/src/app/api/admin/slack/channels/[workspaceId]/[channelId]/resources/route.ts`
- [ ] T103 [US6] Implement Slack channel access-check endpoint in `ui/src/app/api/admin/slack/channels/[workspaceId]/[channelId]/access-check/route.ts`
- [ ] T104 [US6] Implement Slack channel ReBAC admin component in `ui/src/components/admin/rebac/SlackChannelRebacPanel.tsx`
- [ ] T105 [US6] Implement Python Slack runtime ReBAC evaluator in `ai_platform_engineering/integrations/slack_bot/utils/slack_rebac.py`
- [ ] T106 [US6] Integrate Slack runtime ReBAC checks into middleware in `ai_platform_engineering/integrations/slack_bot/utils/rbac_middleware.py`
- [ ] T107 [US6] Update Slack channel mapping utilities to emit channel resource context in `ai_platform_engineering/integrations/slack_bot/utils/channel_agent_mapper.py`
- [ ] T108 [US6] Update Slack channel-team mapper to support many resource grants in `ai_platform_engineering/integrations/slack_bot/utils/channel_team_mapper.py`

**Checkpoint**: A Slack channel can expose many agents, tools, and knowledge bases, and runtime access is denied unless channel and user/resource checks pass.

---

## Phase 9: User Story 7 - Maintain Keycloak Realm Roles During the Transition (Priority: P3)

**Goal**: Keep Keycloak roles bounded and understandable during migration while making ReBAC authoritative for resource types marked ReBAC-enforced.

**Independent Test**: Compare legacy role and ReBAC decisions side by side, mark a resource ReBAC-enforced, and verify stale resource roles no longer grant access by themselves.

### Tests for User Story 7

- [ ] T109 [P] [US7] Add Keycloak transition helper tests in `ui/src/lib/rbac/__tests__/rebac/keycloak-transition.test.ts`
- [ ] T110 [P] [US7] Add enforcement comparison API tests in `ui/src/app/api/rbac/__tests__/enforcement-comparison-route.test.ts`
- [ ] T111 [P] [US7] Add RBAC matrix migration-state coverage in `tests/rbac/unit/ts/keycloak-rebac-transition.test.ts`

### Implementation for User Story 7

- [ ] T112 [US7] Implement Keycloak role classification and transitional-role helpers in `ui/src/lib/rbac/keycloak-transition.ts`
- [ ] T113 [US7] Implement role-vs-ReBAC comparison service in `ui/src/lib/rbac/enforcement-comparison.ts`
- [ ] T114 [US7] Implement enforcement comparison endpoint in `ui/src/app/api/rbac/enforcement-comparison/route.ts`
- [ ] T115 [US7] Update task and skill role helpers to honor ReBAC-enforced resource state in `ui/src/lib/rbac/task-skill-realm-access.ts`
- [ ] T116 [US7] Update Keycloak resource sync to stop creating permanent per-resource roles for ReBAC-enforced resources in `ui/src/lib/rbac/keycloak-resource-sync.ts`
- [ ] T117 [US7] Update AgentGateway config template to document ReBAC shadow/enforced mode boundaries in `deploy/agentgateway/config.yaml.j2`
- [ ] T118 [US7] Implement enforcement status UI panel in `ui/src/components/admin/rebac/RebacEnforcementStatusPanel.tsx`
- [ ] T119 [US7] Add role drift detection helpers in `ui/src/lib/rbac/drift-detection.ts`

**Checkpoint**: Administrators can see migration state, compare role and ReBAC decisions, and rely on ReBAC for resource types that are marked enforced.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Complete documentation, migration guardrails, performance checks, and end-to-end validation across the implemented stories.

- [ ] T120 [P] Update RBAC architecture reference for identity sync, universal ReBAC resources, Slack channel many-to-many access, and Keycloak transition in `docs/docs/security/rbac/architecture.md`
- [ ] T121 [P] Update RBAC workflow diagrams for dry-run/apply sync, policy authoring, graph access check, Slack invocation, and migration modes in `docs/docs/security/rbac/workflows.md`
- [ ] T122 [P] Update RBAC usage guide with quickstart/demo steps for identity sync and policy graph administration in `docs/docs/security/rbac/usage.md`
- [ ] T123 [P] Update RBAC file map with every new auth-relevant file in `docs/docs/security/rbac/file-map.md`
- [ ] T124 Update OpenFGA experiment README with model migration and tuple backfill instructions in `deploy/openfga-experiment/README.md`
- [ ] T125 Add migration/backfill operational script for membership sources and Slack grants in `scripts/backfill-universal-rebac.ts`
- [ ] T126 Add rollback helper for source-scoped tuple deletion in `scripts/rollback-universal-rebac-tuples.ts`
- [ ] T127 Add performance test for 500-group dry-run preview in `tests/rbac/unit/ts/identity-group-sync-performance.test.ts`
- [ ] T128 Add performance test for filtered graph load in `tests/rbac/unit/ts/rebac-graph-performance.test.ts`
- [ ] T129 Run and document RBAC docs validation in `tests/test_validate_rbac_docs.py`
- [ ] T130 Run and document UI unit tests for identity sync, ReBAC, and Slack ReBAC in `ui/src/lib/rbac/__tests__/`
- [ ] T131 Run and document Python Slack bot RBAC tests in `ai_platform_engineering/integrations/slack_bot/tests/`
- [ ] T132 Run and document RBAC E2E tests in `tests/rbac/e2e/`
- [ ] T133 Run and document final quality gates from `docs/docs/specs/2026-05-11-identity-group-rebac/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1) has no dependencies.
- Foundational (Phase 2) depends on Setup and blocks all user stories.
- P1 stories (US1, US2, US3) can start after Foundation; US2 and US3 can run in parallel with US1 after shared stores and validators are stable.
- P2 stories (US4, US5, US6) depend on Foundation and benefit from US3 resource catalog completion; US5 depends on US4 only for staged change provenance, not for basic graph reads.
- P3 story (US7) depends on US3 enforcement status and can run after the first ReBAC-enforced resource type exists.
- Polish depends on whichever user stories are included in the implementation increment.

### User Story Dependencies

- US1 is the MVP: enterprise group sync into CAIPE teams and team membership relationships.
- US2 can be delivered independently after Foundation but must interoperate with US1 membership source records.
- US3 can be delivered independently after Foundation and should be completed before broad policy authoring.
- US4 depends on US3 resource/action catalog for complete validation.
- US5 depends on Foundation for graph reads and on US3 for complete resource coverage.
- US6 depends on US3 for Slack channel and resource types.
- US7 depends on US3 enforcement status and migration-state semantics.

### Within Each User Story

- Tests should be written first and verified failing where practical.
- Repository/model helpers before services.
- Services before API routes.
- API routes before UI components.
- Runtime enforcement changes after decision helpers and tests.
- Story checkpoint before moving to the next implementation increment.

## Parallel Opportunities

- Setup fixture tasks T004-T008 can run in parallel.
- Foundation tasks T014-T016 can run in parallel after shared types T009-T011 exist.
- Foundation tests T026-T027 can run in parallel after their target helpers are stubbed.
- US1 repository helpers T034-T037 can run in parallel.
- US1 tests T029-T033 can run in parallel.
- US2 tests T052-T054 can run in parallel.
- US3 tests T062-T064 can run in parallel.
- US4 repository helpers T075-T076 can run in parallel.
- US4 tests T072-T074 can run in parallel.
- US5 tests T085-T087 can run in parallel.
- US6 helpers T099-T100 can run in parallel, and tests T096-T098 can run in parallel.
- US7 tests T109-T111 can run in parallel.
- Documentation updates T120-T123 can run in parallel.

## Parallel Example: User Story 1

```bash
Task: "Add BFF contract tests for Identity Group Sync provider and rule endpoints in ui/src/app/api/admin/identity-group-sync/__tests__/rules-route.test.ts"
Task: "Add BFF contract tests for dry-run and apply endpoints in ui/src/app/api/admin/identity-group-sync/__tests__/sync-run-route.test.ts"
Task: "Add unit tests for regex mapping clusters, priority resolution, excludes, and slug collisions in ui/src/lib/rbac/__tests__/identity-group-sync/rule-matcher.test.ts"
Task: "Add unit tests for source-preserving membership reconciliation in ui/src/lib/rbac/__tests__/identity-group-sync/membership-reconciler.test.ts"
Task: "Add Playwright dry-run and apply scenario for enterprise group sync in tests/rbac/e2e/story-identity-group-sync.spec.ts"
```

## Parallel Example: User Story 6

```bash
Task: "Add Slack channel admin API contract tests in ui/src/app/api/admin/slack/channels/__tests__/channel-resources-route.test.ts"
Task: "Add Slack runtime ReBAC tests in ai_platform_engineering/integrations/slack_bot/tests/test_slack_channel_rebac.py"
Task: "Add Playwright Slack channel multi-resource admin scenario in tests/rbac/e2e/story-slack-channel-rebac.spec.ts"
Task: "Implement Slack channel grant repository helpers in ui/src/lib/rbac/slack-channel-grant-store.ts"
Task: "Implement Slack channel ReBAC decision helpers for UI/BFF checks in ui/src/lib/rbac/slack-channel-rebac.ts"
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1) only.
3. Validate dry-run, apply, membership sources, and OpenFGA team membership tuples.
4. Demo enterprise group sync without granting any application resources from group existence alone.

### Incremental Delivery

1. Deliver US1 to establish identity-to-team ReBAC membership.
2. Deliver US2 to protect manual exceptions and scoped team administration.
3. Deliver US3 to create complete resource/action coverage.
4. Deliver US4 and US5 to make policy authoring and explainability operable.
5. Deliver US6 to migrate Slack channel access to many-to-many ReBAC.
6. Deliver US7 to make Keycloak role migration state explicit and bounded.

### Final Validation

1. Run targeted Jest tests for identity sync, ReBAC policy APIs, graph, and Slack APIs.
2. Run Slack bot pytest coverage for runtime ReBAC checks.
3. Run RBAC matrix tests and Playwright E2E scenarios.
4. Run docs validation for the canonical RBAC reference.
5. Run the quality gates listed in `quickstart.md`.
