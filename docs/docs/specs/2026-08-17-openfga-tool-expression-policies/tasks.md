---
sidebar_label: Tasks
title: CAIPE Authorization Service and Expression Policies - Tasks
description: Dependency-ordered, test-first tasks for parallel migration and expression policies.
---

# Tasks: CAIPE Authorization Service and Expression Policies

## Format

- Every task is executable and names its target path.
- [P] means the task can proceed in parallel with other [P] tasks in the same
  phase because it changes different files and has no unfinished dependency.
- Story labels map to spec.md: US0 migration, US1 argument restriction, US2 safe
  authoring, US3 effectiveness, US4 operations/audit, and US5 expression rollout.
- Tests are written before their corresponding implementation and must fail for
  the expected reason first.

## Phase 1 - Setup and Current-Behavior Inventory

- [x] T001 Create the Authz package skeleton and ownership README in ai_platform_engineering/authz/__init__.py and ai_platform_engineering/authz/README.md.
- [x] T002 [P] Inventory BFF decisions, mappings, reasons, timeouts, caches, flags, and owners in docs/docs/specs/2026-08-17-openfga-tool-expression-policies/inventory-bff.md.
- [x] T003 [P] Inventory gateway, agent-use, server, exact/wildcard tool checks, flags, and owners in docs/docs/specs/2026-08-17-openfga-tool-expression-policies/inventory-gateway.md.
- [x] T004 [P] Capture neutral BFF golden requests/results in ai_platform_engineering/authz/tests/fixtures/bff_decisions.json.
- [x] T005 [P] Capture neutral bridge golden CheckRequest/results in ai_platform_engineering/authz/tests/fixtures/gateway_decisions.json.
- [x] T006 Record active OpenFGA store/model/hash and action-to-relation mappings in ai_platform_engineering/authz/tests/fixtures/model_descriptor.json.
- [x] T007 Add Authz test configuration and neutral fixture factories in ai_platform_engineering/authz/tests/conftest.py.
- [x] T008 Add the feature validation commands and coverage gate to ai_platform_engineering/authz/README.md.

Checkpoint: the existing behavior and ownership surface are reviewable; no
runtime code path has changed.

## Phase 2 - Foundational Canonical Service

- [x] T009 [P] Add failing canonical request/result and unknown-field contract tests in ai_platform_engineering/authz/tests/contract/test_contract.py.
- [x] T010 [P] Add failing stable reason-code and fail-closed mapping tests in ai_platform_engineering/authz/tests/contract/test_reasons.py.
- [x] T011 Implement typed canonical request/result models in ai_platform_engineering/authz/core/contract.py.
- [x] T012 Implement stable allow/deny/invalid/unavailable reason mapping in ai_platform_engineering/authz/core/reasons.py.
- [x] T013 [P] Add failing provider selection and disabled Cedar/OPA tests in ai_platform_engineering/authz/tests/contract/test_registry.py.
- [x] T014 Define the provider protocol and server-owned resource/action registry in ai_platform_engineering/authz/providers/base.py and ai_platform_engineering/authz/core/registry.py.
- [x] T015 Implement only the openfga-cel runtime binding and reject public provider overrides in ai_platform_engineering/authz/providers/openfga.py and ai_platform_engineering/authz/core/registry.py.
- [x] T016 [P] Add failing trusted identity/request/resource context tests in ai_platform_engineering/authz/tests/contract/test_context.py.
- [x] T017 Implement trusted context construction and advisory-context narrowing rules in ai_platform_engineering/authz/core/context.py.
- [x] T018 [P] Add failing transport-neutral decision and fail-closed dependency tests in ai_platform_engineering/authz/tests/contract/test_decision.py.
- [x] T019 Implement the single canonical decision pipeline in ai_platform_engineering/authz/core/decision.py.
- [x] T020 [P] Add failing HTTP single/batch normalization tests in ai_platform_engineering/authz/tests/contract/test_http.py.
- [x] T021 [P] Add failing Envoy Check normalization tests in ai_platform_engineering/authz/tests/contract/test_ext_authz.py.
- [x] T022 Implement single/batch HTTP adapters in ai_platform_engineering/authz/api/http.py.
- [x] T023 Implement Envoy v3 ext_authz adapter in ai_platform_engineering/authz/api/ext_authz.py.
- [x] T024 Add independent HTTP/gRPC health, readiness, timeout, saturation, and bounded-concurrency configuration in ai_platform_engineering/authz/config.py and ai_platform_engineering/authz/main.py.

Checkpoint: HTTP, batch HTTP, and gRPC call one decision core, but no current
enforcement point routes traffic to it.

## Phase 3 - User Story 0: Parallel Migration Without Behavior Change

Goal: deploy Authz dark, compare beside both current paths, promote bounded
cohorts, and roll back without changing policy data.

Independent test: one neutral scope moves LEGACY to SHADOW to CANARY and back to
SHADOW while unrelated scopes and tuples remain unchanged.

### Tests first

- [ ] T025 [P] [US0] Add failing rollout-config validation, specificity, default-LEGACY, and caller-override tests in ai_platform_engineering/authz/tests/contract/test_migration_config.py.
- [ ] T026 [P] [US0] Add cross-process deterministic cohort vectors in ai_platform_engineering/authz/tests/fixtures/canary_vectors.json and failing Python tests in ai_platform_engineering/authz/tests/contract/test_cohort.py.
- [ ] T027 [P] [US0] Add failing comparison classification tests for NONE, ALLOW_DENY, DENY_ALLOW, ERROR_RESULT, REASON_ONLY, and LATENCY in ai_platform_engineering/authz/tests/contract/test_comparator.py.
- [ ] T028 [P] [US0] Add failing authority/no-fallback/mode-transition tests in ai_platform_engineering/authz/tests/integration/test_migration_authority.py.
- [ ] T029 [P] [US0] Add failing exactly-one-decision/at-most-one-comparison event tests in ai_platform_engineering/authz/tests/integration/test_migration_events.py.
- [x] T030 [US0] Add failing BFF LEGACY/SHADOW/CANARY/router rollback tests in ui/src/lib/authz/__tests__/migration-router.test.ts.
- [x] T031 [US0] Add failing bridge shadow/canary/timeout/body-limit tests in deploy/openfga/bridge/tests/test_migration_router.py.

### Implementation

- [x] T032 [US0] Implement immutable rollout revision parsing and scope selection in ai_platform_engineering/authz/migration/config.py.
- [x] T033 [US0] Implement language-neutral keyed cohort selection matching canary_vectors.json in ai_platform_engineering/authz/migration/cohort.py.
- [x] T034 [US0] Implement canonical comparison and mismatch classification in ai_platform_engineering/authz/migration/comparator.py.
- [x] T035 [US0] Implement decision/comparison/revision event construction without sensitive values in ai_platform_engineering/authz/migration/events.py.
- [x] T036 [US0] Implement BFF Authz HTTP client with bounded shadow timeout in ui/src/lib/authz/client.ts.
- [x] T037 [US0] Implement the deployment-controlled BFF migration router while preserving current endpoints in ui/src/lib/authz/migration-router.ts and ui/src/lib/authz/index.ts.
- [x] T038 [US0] Implement the bridge Authz CheckRequest client and migration router without changing the external gRPC response contract in deploy/openfga/bridge/authz_client.py and deploy/openfga/bridge/main.py.
- [x] T039 [US0] Strip/reject untrusted migration/provider fields at BFF and Authz boundaries in ui/src/lib/authz/http.ts and ai_platform_engineering/authz/api/http.py.
- [x] T040 [P] [US0] Create the caipe-authz Helm chart defaulting all routing to LEGACY in charts/ai-platform-engineering/charts/caipe-authz/Chart.yaml, charts/ai-platform-engineering/charts/caipe-authz/values.yaml, and charts/ai-platform-engineering/charts/caipe-authz/templates/.
- [x] T041 [P] [US0] Add dark Authz deployment to Docker Compose without changing current traffic targets in docker-compose/docker-compose.dev.yaml and docker-compose/.env.example.
- [x] T042 [US0] Add BFF rollout values, revision checks, and canary seed reference in charts/ai-platform-engineering/charts/caipe-ui/values.yaml and charts/ai-platform-engineering/charts/caipe-ui/templates/deployment.yaml.
- [x] T043 [US0] Add gateway bridge rollout values and Authz target while keeping legacy authority in charts/ai-platform-engineering/charts/openfga-authz-bridge/values.yaml and charts/ai-platform-engineering/charts/openfga-authz-bridge/templates/deployment.yaml.
- [x] T044 [US0] Add rollout revision, authoritative path, mismatch, error, timeout, and latency metrics in ai_platform_engineering/authz/metrics.py.
- [x] T045 [US0] Add comparison filters and promotion-gate summaries to the existing Audit UI in ui/src/components/admin/audit/ and ui/src/app/api/admin/audit/.
- [ ] T046 [US0] Add end-to-end replay tests proving independent BFF and gateway scopes and no tuple mutation on rollback in tests/authz/test_parallel_migration.py.
- [x] T047 [US0] Document the operator mode transitions, gates, and emergency rollback in ai_platform_engineering/authz/README.md and deploy/openfga/bridge/README.md.

Checkpoint: the parallel-migration MVP is independently deployable. Legacy is
still available, and one cohort can be promoted or rolled back explicitly.

## Phase 4 - User Story 1: Restrict an Exact Tool by Argument

Goal: OpenFGA evaluates an exact tool relationship plus a reviewed native CEL
condition using trusted request context.

Independent test: project_key PRIMARY allows the exact mutation tool; OTHER,
missing, wrong-type, stale, malformed, and oversized inputs deny before MCP.

### Tests first

- [x] T048 [P] [US1] Add failing model DSL/JSON parity and backward-compatibility tests in deploy/openfga/tests/test_model_conditions.py.
- [x] T049 [P] [US1] Add failing condition-context Check/BatchCheck tests against the pinned OpenFGA image in ai_platform_engineering/authz/tests/integration/test_openfga_conditions.py.
- [x] T050 [P] [US1] Add failing condition-aware tuple read/write/replacement/compensation tests in ai_platform_engineering/authz/tests/integration/test_conditional_tuples.py.
- [x] T051 [P] [US1] Add failing MCP argument parsing, duplicate-key, truncation, size, JSON Pointer, and typed-projection tests in ai_platform_engineering/authz/tests/contract/test_tool_context.py.

### Implementation

- [x] T052 [US1] Add versioned named conditions and conditional_caller while preserving existing grants in deploy/openfga/model.fga.
- [x] T053 [US1] Generate the matching model artifact and pin compatible OpenFGA configuration in charts/ai-platform-engineering/charts/openfga/authorization-model.json and charts/ai-platform-engineering/charts/openfga/values.yaml.
- [x] T054 [US1] Add active store/model/hash/template descriptors in ai_platform_engineering/authz/providers/openfga.py and ai_platform_engineering/authz/core/registry.py.
- [x] T055 [US1] Implement context-aware Check/BatchCheck and condition-preserving tuple reads/writes in ai_platform_engineering/authz/providers/openfga.py.
- [x] T056 [US1] Implement verified delete/write/verify/compensate tuple replacement in ai_platform_engineering/authz/policy/reconciliation.py.
- [x] T057 [US1] Implement bounded duplicate-key-safe MCP parsing and typed argument projection in ai_platform_engineering/authz/core/tool_context.py.
- [x] T058 [US1] Send byte-equivalent trusted context to required caller and agent tool checks in ai_platform_engineering/authz/api/ext_authz.py.
- [ ] T059 [US1] Add exact-tool matching/non-matching end-to-end tests proving denied calls do not reach MCP in tests/authz/test_exact_tool_expression.py.

Checkpoint: native OpenFGA conditions work in an isolated fixture scope; no
production expression grant is enabled.

## Phase 5 - User Story 2: Build a Policy Safely

Goal: administrators author typed template instances derived from sanitized MCP
schemas, never executable source.

Independent test: the editor exposes only compatible fields/templates, treats
CEL-like literals as data, and marks schema drift stale.

### Tests first

- [x] T060 [P] [US2] Add failing schema sanitization/hash/eligibility/JSON Pointer tests in ui/src/lib/rbac/__tests__/mcp-tool-catalog-policy.test.ts.
- [x] T061 [P] [US2] Add failing template canonicalization, bounds, and code-like-literal tests in ai_platform_engineering/authz/tests/contract/test_templates.py.
- [x] T062 [P] [US2] Add failing policy CRUD, optimistic concurrency, authorization, and reconciliation tests in ai_platform_engineering/authz/tests/integration/test_policy_api.py.
- [x] T063 [P] [US2] Add failing typed editor and stale-schema UI tests in ui/src/components/admin/rebac/__tests__/expression-policy-editor.test.tsx.

### Implementation

- [x] T064 [US2] Extend the tool catalog with bounded sanitized schemas, hashes, eligible fields, and drift status in ui/src/lib/rbac/mcp-tool-catalog.ts.
- [x] T065 [US2] Implement the reviewed template registry and canonical policy hashing in ai_platform_engineering/authz/policy/templates.py.
- [x] T066 [US2] Add MongoDB policy metadata models/indexes and optimistic versions in ai_platform_engineering/authz/policy/models.py and ai_platform_engineering/authz/policy/repository.py.
- [x] T067 [US2] Implement schema, validate, CRUD, explain, and evaluate admin operations in ai_platform_engineering/authz/api/policy.py.
- [x] T068 [US2] Implement the BFF policy administration client/routes in ui/src/lib/authz/policy-client.ts and ui/src/app/api/admin/openfga/policies/.
- [x] T069 [US2] Implement typed field/operator/value controls and read-only preview in ui/src/components/admin/rebac/expression-policy-editor.tsx.
- [x] T070 [US2] Implement schema-drift refresh and fail-closed policy status in ai_platform_engineering/authz/policy/reconciliation.py.

Checkpoint: a typed policy can be created and reconciled in a test scope without
exposing CEL, Cedar, or Rego.

## Phase 6 - User Story 3: Understand Policy Effectiveness

Goal: an administrator can distinguish an exclusive restriction from an
additive condition shadowed by another allow path.

Independent test: an exclusive exact policy is rejected while an unconditional
exact or wildcard grant already permits the subject.

### Tests first

- [ ] T071 [P] [US3] Add failing direct exact/wildcard/userset shadow detection tests in ai_platform_engineering/authz/tests/integration/test_shadowing.py.
- [ ] T072 [P] [US3] Add failing bounded effective-access simulation tests in ai_platform_engineering/authz/tests/integration/test_simulation.py.
- [ ] T073 [P] [US3] Add failing additive/exclusive warning UI tests in ui/src/components/admin/rebac/__tests__/policy-effectiveness.test.tsx.

### Implementation

- [x] T074 [US3] Implement known broader-path analysis and exclusive-save rejection in ai_platform_engineering/authz/policy/shadowing.py.
- [x] T075 [US3] Implement bounded read-only effective-access simulation in ai_platform_engineering/authz/inspection/simulation.py.
- [x] T076 [US3] Return additive/exclusive, wildcard, drift, and known transitive warnings from ai_platform_engineering/authz/api/policy.py.
- [x] T077 [US3] Display policy effectiveness and derived-access disclaimers in ui/src/components/admin/rebac/policy-effectiveness.tsx.

Checkpoint: the control plane cannot claim a condition is restrictive while a
known broader allow remains.

## Phase 7 - User Story 4: Operate, Audit, and Visualize

Goal: operators can correlate current OpenFGA state, expression metadata,
migration comparisons, and history without exposing sensitive values.

Independent test: create/update/exercise/delete one policy, interrupt Audit
Service, recover delivery idempotently, and inspect sanitized graph/history.

### Tests first

- [x] T078 [P] [US4] Add failing event schema, redaction, and one-event-per-decision tests in ai_platform_engineering/authz/tests/contract/test_audit_events.py.
- [x] T079 [P] [US4] Add failing outbox capacity/strict-mode/retry/idempotency/recovery tests in ai_platform_engineering/authz/tests/integration/test_audit_outbox.py.
- [x] T080 [P] [US4] Add failing model/relationship/graph pagination/truncation/authz tests in ai_platform_engineering/authz/tests/integration/test_inspection_api.py.
- [x] T081 [P] [US4] Add failing legacy cas_* query compatibility tests in ai_platform_engineering/audit_service/test_audit_service.py.
- [ ] T082 [P] [US4] Add failing conditional-edge and audit-overlay UI tests in ui/src/components/admin/rebac/__tests__/authz-graph-layers.test.tsx.

### Implementation

- [x] T083 [US4] Implement normalized decision, comparison, policy, relationship, and revision event models in ai_platform_engineering/authz/audit/events.py.
- [x] T084 [US4] Implement bounded durable outbox with strict allow semantics in ai_platform_engineering/authz/audit/outbox.py.
- [x] T085 [US4] Implement idempotent batch publishing to POST /v1/audit/events in ai_platform_engineering/authz/audit/publisher.py.
- [x] T086 [US4] Add normalized event validation and legacy query mapping in ai_platform_engineering/audit_service/models.py and ai_platform_engineering/audit_service/storage.py.
- [x] T087 [US4] Implement privileged bounded model, relationship, graph, Check, policy, and simulation projections in ai_platform_engineering/authz/inspection/ and ai_platform_engineering/authz/api/inspection.py.
- [x] T088 [US4] Replace direct BFF OpenFGA admin reads with the Authz inspection client in ui/src/lib/rbac/rebac-graph.ts and ui/src/app/api/admin/openfga/.
- [ ] T089 [US4] Add conditional edges, revisions, drift, shadowing, migration comparison, and history layers in ui/src/components/admin/rebac/.
- [x] T090 [US4] Add separate inspection concurrency/size budgets and outbox backlog metrics in ai_platform_engineering/authz/config.py and ai_platform_engineering/authz/metrics.py.
- [ ] T091 [US4] Add a sensitive-value scan over logs/events/graph fixtures in tests/authz/test_authz_redaction.py.

Checkpoint: decisions, migrations, policies, and relationships are auditable;
current graph state is separate from historical evidence.

## Phase 8 - User Story 5: Roll Out Expressions Without Broadening Access

Goal: enable one exact expression only after its runtime checks are
Authz-authoritative, then expand or roll back independently.

Independent test: deploy conditions with no tuples, shadow expression context,
enable one exact policy, roll routing back without tuple mutation, and roll the
policy back without restoring broad access.

### Tests first

- [ ] T092 [P] [US5] Add failing no-conditional-tuple/no-behavior-change tests in tests/authz/test_expression_rollout.py.
- [ ] T093 [P] [US5] Add failing promotion-gate tests for model/context mismatch, audit loss, semantic mismatch, and missing ownership in tests/authz/test_promotion_gates.py.
- [ ] T094 [P] [US5] Add failing independent routing-versus-policy rollback tests in tests/authz/test_rollback_separation.py.
- [ ] T095 [P] [US5] Add failing AUTHZ_ONLY retention and legacy-removal precondition tests in tests/authz/test_legacy_retirement.py.

### Implementation

- [x] T096 [US5] Add deployment validation that blocks expression enforcement before required caller/agent scopes are Authz-authoritative in ai_platform_engineering/authz/migration/config.py.
- [x] T097 [US5] Add exact-resource expression off/shadow/enforce controls separate from migration mode in charts/ai-platform-engineering/charts/caipe-authz/values.yaml.
- [x] T098 [US5] Implement promotion-gate reporting from comparison, SLO, descriptor, audit, rollback, and owner signals in ai_platform_engineering/authz/migration/gates.py.
- [x] T099 [US5] Add the selected exact-tool rollout and both rollback runbooks in docs/docs/specs/2026-08-17-openfga-tool-expression-policies/quickstart.md.
- [ ] T100 [US5] Switch AgentGateway directly to Authz ext_authz only after all gateway cohorts reach AUTHZ_ONLY in charts/ai-platform-engineering/charts/agentgateway/templates/configmap.yaml.
- [ ] T101 [US5] Remove the BFF in-process evaluator only after all BFF-backed callers pass AUTHZ_ONLY retention in ui/src/lib/authz/engines/openfga.ts and ui/src/lib/authz/index.ts.
- [ ] T102 [US5] Remove independent policy evaluation from the old bridge only after gateway retention in deploy/openfga/bridge/main.py.

Checkpoint: the first exact expression boundary is enforced safely, and legacy
removal is a final consequence of completed migration rather than a prerequisite.

## Phase 9 - Cross-Cutting Quality and Documentation

- [x] T103 [P] Run and fix uv run ruff check ai_platform_engineering/authz.
- [x] T104 [P] Run and fix uv run pytest ai_platform_engineering/authz/tests with at least 80 percent coverage for new modules.
- [x] T105 [P] Run and fix bridge tests in deploy/openfga/bridge using its uv project.
- [x] T106 [P] Run and fix UI lint and unit tests from ui/.
- [x] T107 Run and fix the UI production build from ui/.
- [x] T108 Run and fix the Docusaurus build from docs/.
- [ ] T109 Validate the full LEGACY to SHADOW to CANARY to AUTHZ to AUTHZ_ONLY sequence and both rollback paths using docs/docs/specs/2026-08-17-openfga-tool-expression-policies/quickstart.md.
- [x] T110 Update architecture, configuration, and operator documentation in docs/docs/specs/2026-08-17-openfga-tool-expression-policies/ and the component READMEs with verified implementation details.

## Dependencies

~~~text
Phase 1 inventory
  -> Phase 2 canonical service
     -> US0 parallel migration MVP
        -> US1 OpenFGA conditions/runtime context
           -> US2 typed policy authoring
              -> US3 effectiveness analysis
                 -> US4 audit and visualization completion
                    -> US5 expression enforcement and legacy retirement
                       -> Cross-cutting release gates
~~~

- US0 can ship before expression-policy work and is the recommended MVP.
- US1 requires a promoted Authz test cohort but not production expression
  enforcement.
- US2 depends on condition/template contracts from US1.
- US3 depends on policy metadata and APIs from US2.
- US4 audit foundations begin in Phase 2; its full UI/inspection slice depends on
  policy and migration event contracts.
- US5 requires US0 through US4 promotion, audit, and rollback gates.

## Parallel Execution Examples

- T002 through T005 can proceed together after T001.
- T009, T010, T013, T016, and T018 can proceed together before their paired
  implementations.
- T025 through T029 can proceed together; BFF T030 and bridge T031 can proceed
  together.
- Helm T040 and Compose T041 can proceed together after the service skeleton.
- Each story's test files marked [P] can be authored together before
  implementation.
- UI, Audit Service, and Authz inspection implementation can proceed in parallel
  after their shared contracts are frozen.

## Suggested MVP

Stop after T047 for the first reviewable delivery:

- Authz is a real independently deployed service.
- Current behavior is still authoritative by default.
- BFF and gateway can shadow it safely.
- One bounded cohort can be promoted and explicitly rolled back.
- No expression tuple, broader-grant change, or legacy removal is required.
