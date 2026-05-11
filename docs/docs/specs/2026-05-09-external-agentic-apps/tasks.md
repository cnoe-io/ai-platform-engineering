# Tasks: External Agentic Apps Platform

**Input**: Design documents from `docs/docs/specs/2026-05-09-external-agentic-apps/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, `mongodb-migration.md`

**Tests**: Included because the feature specification defines independent test criteria for each user story.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently after the shared foundation is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other tasks in the same phase because it touches different files and has no dependency on incomplete tasks.
- **[Story]**: Maps implementation tasks to user stories from `spec.md`.
- Every task includes an exact repository path.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the file structure and test fixtures required by later phases.

- [X] T001 Create agentic app package directories in `ui/src/packages/agentic-app-sdk/` and `ui/src/packages/agentic-app-ui/`
- [X] T002 [P] Create generic webhook route directory in `ui/src/app/api/agentic-apps/webhooks/[appId]/[provider]/[channel]/`
- [X] T003 [P] Create app-owned authorization route directory in `ui/src/app/api/agentic-apps/[appId]/authorize/`
- [X] T004 [P] Create Agentic SDLC external reference app directory in `ui/apps/agentic-sdlc/`
- [X] T005 [P] Create shared agentic app test fixture directory in `ui/src/__tests__/agentic-apps/fixtures/`
- [X] T006 Add external app test fixture manifests in `ui/src/__tests__/agentic-apps/fixtures/manifests.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extend shared types, validation, persistence, audit, and index infrastructure used by all user stories.

**CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundation

- [X] T007 [P] Add manifest validation tests for assistant, webhook, PDP, catalog, and secret-like field rejection in `ui/src/__tests__/agentic-apps/manifest-validation.test.ts`
- [X] T008 [P] Add store/index tests for package, installation, decision, token, webhook, context, health, and audit collections in `ui/src/__tests__/agentic-apps/store.test.ts`
- [X] T009 [P] Add audit redaction tests for safe metadata and forbidden token/cookie/provider fields in `ui/src/__tests__/agentic-apps/audit.test.ts`

### Implementation for Foundation

- [X] T010 Extend `AgenticAppManifest`, package, installation, PDP, token, webhook, assistant context, health, and audit types in `ui/src/types/agentic-app.ts`
- [X] T011 Extend secret-like field detection and schema checks for assistant, webhook, PDP, health policy, catalog, and provenance in `ui/src/lib/agentic-apps/manifest-validation.ts`
- [X] T012 Add collection constants and typed helpers for PDP decisions, token grants, webhook deliveries, assistant contexts, health snapshots, and audit events in `ui/src/lib/agentic-apps/store.ts`
- [X] T013 Implement safe audit event builder and redaction helpers in `ui/src/lib/agentic-apps/audit.ts`
- [X] T014 Add idempotent Mongo index creation for all agentic app collections in `ui/src/lib/mongodb.ts`
- [X] T015 Normalize route ownership and route-conflict detection helpers in `ui/src/lib/agentic-apps/registry.ts`
- [X] T016 Update built-in/sample manifests to satisfy the expanded manifest type in `ui/src/lib/agentic-apps/sample-manifests.ts`
- [X] T017 Update Agentic SDLC built-in manifest compatibility fields in `ui/src/lib/agentic-apps/builtin-packages.ts`

**Checkpoint**: Shared platform types, validation, persistence, and audit helpers are ready for user story implementation.

---

## Phase 3: User Story 1 - Install and Launch Any Trusted External App (Priority: P1) MVP

**Goal**: Admins can import a trusted manifest, install it, users can discover/launch it, and blocked states deny before contacting app runtimes.

**Independent Test**: Register a neutral external app manifest, install it for a test group, confirm an authorized user sees and launches it, and confirm an unauthorized user sees a non-leaking blocked reason.

### Tests for User Story 1

- [X] T018 [P] [US1] Add contract tests for admin package import validation in `ui/src/app/api/admin/agentic-apps/packages/__tests__/route.test.ts`
- [X] T019 [P] [US1] Add contract tests for admin installation, route conflict, enable, disable, and uninstall behavior in `ui/src/app/api/admin/agentic-apps/installations/__tests__/route.test.ts`
- [X] T020 [P] [US1] Add user app discovery and app detail API tests for allowed and blocked users in `ui/src/app/api/agentic-apps/__tests__/route.test.ts`
- [X] T021 [P] [US1] Add Apps Hub rendering tests for installed, disabled, unhealthy, unsupported, and unauthorized apps in `ui/src/__tests__/agentic-apps/apps-hub.test.tsx`
- [X] T022 [P] [US1] Add proxy launch denial tests proving blocked apps never call fetch in `ui/src/__tests__/agentic-apps/execution-gateway-route.test.ts`

### Implementation for User Story 1

- [X] T023 [US1] Implement package import validation, route conflict checks, and audit events in `ui/src/app/api/admin/agentic-apps/packages/route.ts`
- [X] T024 [US1] Implement installation state updates, runtime overrides, visible flag, route ownership, and audit events in `ui/src/app/api/admin/agentic-apps/installations/route.ts`
- [X] T025 [US1] Update package and installation persistence functions for visibility, validation status, route ownership, and audit metadata in `ui/src/lib/agentic-apps/store.ts`
- [X] T026 [US1] Update access evaluation to include visibility, health policy, route conflict, unsupported runtime, and access overrides in `ui/src/lib/agentic-apps/access.ts`
- [X] T027 [US1] Implement user discovery response with blocked reasons and safe manifest fields in `ui/src/app/api/agentic-apps/route.ts`
- [X] T028 [US1] Implement user app detail response with launch metadata and safe blocked reasons in `ui/src/app/api/agentic-apps/[appId]/route.ts`
- [X] T029 [US1] Update Apps Hub UI to render manifest-driven install, health, launch, and blocked states in `ui/src/components/agentic-apps/AgenticAppsHub.tsx`
- [X] T030 [US1] Update top navigation to use generic installed app visibility without app-specific branches in `ui/src/components/layout/AppHeader.tsx`
- [X] T031 [US1] Harden proxy route install/access/health denial paths and blocked responses in `ui/src/app/(app)/apps/[appId]/[[...path]]/route.ts`
- [X] T032 [US1] Document install and launch operator flow in `docs/docs/specs/2026-05-09-external-agentic-apps/quickstart.md`

**Checkpoint**: User Story 1 is independently functional and can be demoed as the MVP.

---

## Phase 4: User Story 2 - PDP Decisions and App-Scoped Tokens (Priority: P1)

**Goal**: All launch/proxy/app-owned authorization requests pass through a PDP boundary and allowed forwards carry short-lived app-scoped tokens.

**Independent Test**: Launch an installed app as users with different roles and resources, verify allowed requests receive an app-scoped token, and verify denied requests stop at CAIPE with auditable PDP metadata.

### Tests for User Story 2

- [X] T033 [P] [US2] Add PDP adapter tests for allow, deny, fail-closed, scoped decisions, and safe metadata in `ui/src/__tests__/agentic-apps/pdp.test.ts`
- [X] T034 [P] [US2] Add app-scoped token mint/verify/reject tests for audience, app id, scopes, expiry, and token hash storage in `ui/src/__tests__/agentic-apps/tokens.test.ts`
- [X] T035 [P] [US2] Add proxy forwarding tests for stripped headers, app token headers, decision id, and correlation id in `ui/src/__tests__/agentic-apps/execution-gateway-route.test.ts`
- [X] T036 [P] [US2] Add app-owned authorization endpoint tests in `ui/src/app/api/agentic-apps/[appId]/authorize/__tests__/route.test.ts`

### Implementation for User Story 2

- [X] T037 [US2] Implement PDP request/response types and local policy adapter in `ui/src/lib/agentic-apps/pdp.ts`
- [X] T038 [US2] Implement short-lived app-scoped token minting, verification helpers, token hashing, and claim builders in `ui/src/lib/agentic-apps/tokens.ts`
- [X] T039 [US2] Persist PDP decisions and token grant metadata through helpers in `ui/src/lib/agentic-apps/store.ts`
- [X] T040 [US2] Integrate PDP decisions into launch/proxy authorization in `ui/src/app/(app)/apps/[appId]/[[...path]]/route.ts`
- [X] T041 [US2] Replace upstream user ID token forwarding with app-scoped token forwarding in `ui/src/app/(app)/apps/[appId]/[[...path]]/route.ts`
- [X] T042 [US2] Add decision id and correlation id response/request metadata helpers in `ui/src/lib/agentic-apps/execution-gateway.ts`
- [X] T043 [US2] Implement app-owned resource authorization endpoint in `ui/src/app/api/agentic-apps/[appId]/authorize/route.ts`
- [X] T044 [US2] Add reference app JWT verification helper for app-scoped tokens in `ui/apps/_lib/jwt-verify.mjs`
- [X] T045 [US2] Update PDP and token contract docs with implemented issuer, audience, and env variable names in `docs/docs/specs/2026-05-09-external-agentic-apps/contracts/pdp-and-token.md`

**Checkpoint**: User Story 2 is independently testable through the proxy and authorization endpoint.

---

## Phase 5: User Story 3 - Generic Provider Webhook Gateway (Priority: P1)

**Goal**: Providers can send webhooks to a generic CAIPE endpoint that resolves installed apps, preserves raw bytes, enforces safeguards, and forwards to app-owned handlers.

**Independent Test**: Configure a provider webhook for an installed app, send a signed raw payload through CAIPE, verify CAIPE applies install/policy checks, forwards raw bytes and signature headers, and audits the result.

### Tests for User Story 3

- [X] T046 [P] [US3] Add webhook manifest validation tests for provider, channel, method, upstream path, verification owner, body limit, and duplicate channels in `ui/src/__tests__/agentic-apps/manifest-validation.test.ts`
- [X] T047 [P] [US3] Add webhook gateway unit tests for route resolution, size limit, rate limit, health policy, PDP deny, raw body hashing, and header filtering in `ui/src/__tests__/agentic-apps/webhook-gateway.test.ts`
- [X] T048 [P] [US3] Add generic webhook route tests for accepted, denied, unregistered, too-large, and upstream-unavailable deliveries in `ui/src/app/api/agentic-apps/webhooks/[appId]/[provider]/[channel]/__tests__/route.test.ts`

### Implementation for User Story 3

- [X] T049 [US3] Implement webhook channel lookup, host checks, raw body hashing, safe header filtering, and forwarding helpers in `ui/src/lib/agentic-apps/webhook-gateway.ts`
- [X] T050 [US3] Implement generic webhook route handlers in `ui/src/app/api/agentic-apps/webhooks/[appId]/[provider]/[channel]/route.ts`
- [X] T051 [US3] Persist webhook delivery outcomes and provider delivery IDs in `ui/src/lib/agentic-apps/store.ts`
- [X] T052 [US3] Integrate PDP decisions and app-scoped token forwarding into webhook forwarding in `ui/src/lib/agentic-apps/webhook-gateway.ts`
- [X] T053 [US3] Add a generic webhook receiver example to the Weather reference runtime in `ui/apps/agentic-apps/weather/server.mjs`
- [X] T054 [US3] Add a generic webhook receiver example to the FinOps reference runtime in `ui/apps/agentic-apps/finops/server.mjs`
- [X] T055 [US3] Update webhook contract docs with implemented status codes and header allowlist in `docs/docs/specs/2026-05-09-external-agentic-apps/contracts/webhook-gateway.md`

**Checkpoint**: User Story 3 can be validated independently with a test provider payload and an installed reference app.

---

## Phase 6: User Story 4 - Contextual CAIPE Assistant Overlay (Priority: P2)

**Goal**: Embedded apps can publish bounded context to CAIPE, and the CAIPE-owned assistant overlay uses only validated context for the active app session.

**Independent Test**: Open an embedded reference app, publish app context for a repo or work item, open the assistant overlay, and confirm the assistant receives only validated context for the active app and route.

### Tests for User Story 4

- [X] T056 [P] [US4] Add assistant context validation tests for frame source, app id, schema version, payload shape, size, expiry, and secret-like rejection in `ui/src/__tests__/agentic-apps/assistant-context.test.ts`
- [X] T057 [P] [US4] Add embedded app shell tests for overlay ownership and active context lifecycle in `ui/src/__tests__/agentic-apps/embed-shell.test.tsx`
- [X] T058 [P] [US4] Add assistant bridge integration tests for accepted and rejected postMessage payloads in `ui/src/__tests__/agentic-apps/assistant-bridge.test.tsx`

### Implementation for User Story 4

- [X] T059 [US4] Implement assistant context schema, source validation, secret rejection, TTL, and persistence helpers in `ui/src/lib/agentic-apps/assistant-context.ts`
- [X] T060 [US4] Update embedded app page to register frame source, receive bridge messages, and render host-owned assistant controls in `ui/src/app/(app)/apps/embed/[appId]/page.tsx`
- [X] T061 [US4] Implement app assistant overlay container for active app context in `ui/src/components/agentic-apps/AgenticAppAssistantOverlay.tsx`
- [X] T062 [US4] Add clear/open/close context controls for embedded apps in `ui/src/components/agentic-apps/AgenticAppAssistantOverlay.tsx`
- [X] T063 [US4] Integrate accepted app context into chat prompt metadata without treating it as instructions in `ui/src/components/chat/ChatPanel.tsx`
- [X] T064 [US4] Persist accepted and rejected assistant context audit events in `ui/src/lib/agentic-apps/audit.ts`
- [X] T065 [US4] Update assistant bridge docs with implemented message version and limits in `docs/docs/specs/2026-05-09-external-agentic-apps/contracts/assistant-context-bridge.md`

**Checkpoint**: User Story 4 can be validated with an embedded reference app and the CAIPE assistant overlay.

---

## Phase 7: User Story 5 - Stable SDK and Optional React UI Kit (Priority: P2)

**Goal**: External app developers can integrate through a framework-neutral SDK and optional React UI kit without importing CAIPE internals.

**Independent Test**: Build a small external app using the SDK to publish context and the UI kit for layout controls, then verify it runs independently and does not import CAIPE host source aliases or stores.

### Tests for User Story 5

- [X] T066 [P] [US5] Add SDK tests for bridge messages, assistant controls, claim parsing, and authorization requests in `ui/src/packages/agentic-app-sdk/__tests__/index.test.ts`
- [X] T067 [P] [US5] Add React UI kit component tests for buttons, badges, page header, metric card, empty state, tabs, toolbar, and assistant trigger in `ui/src/packages/agentic-app-ui/__tests__/components.test.tsx`
- [X] T068 [P] [US5] Add forbidden import boundary tests for SDK/UI kit and reference apps in `ui/src/__tests__/agentic-apps/package-boundary.test.ts`

### Implementation for User Story 5

- [X] T069 [US5] Implement framework-neutral SDK types and exports in `ui/src/packages/agentic-app-sdk/index.ts`
- [X] T070 [US5] Implement SDK assistant bridge helpers in `ui/src/packages/agentic-app-sdk/assistant.ts`
- [X] T071 [US5] Implement SDK claim parsing and authorization request helper in `ui/src/packages/agentic-app-sdk/auth.ts`
- [X] T072 [US5] Implement React UI kit components in `ui/src/packages/agentic-app-ui/index.tsx`
- [X] T073 [US5] Add local package documentation and compatibility policy in `ui/src/packages/agentic-app-sdk/README.md`
- [X] T074 [US5] Add UI kit documentation and component usage examples in `ui/src/packages/agentic-app-ui/README.md`
- [X] T075 [US5] Update SDK/UI kit contract docs with implemented exports and import paths in `docs/docs/specs/2026-05-09-external-agentic-apps/contracts/sdk-ui-kit.md`

**Checkpoint**: User Story 5 can be validated by a reference app importing only SDK/UI kit package boundaries.

---

## Phase 8: User Story 6 - Reference External Apps Without Host Pollution (Priority: P2)

**Goal**: FinOps, Weather, and Agentic SDLC run as external reference apps and exercise the same generic contracts as private or third-party apps.

**Independent Test**: Run each reference app as a separate runtime, install each through the same manifest/admin flow, and confirm disabling/removing one does not require CAIPE host source changes.

### Tests for User Story 6

- [X] T076 [P] [US6] Add reference app manifest contract tests for FinOps, Weather, and Agentic SDLC in `ui/src/__tests__/agentic-apps/reference-manifests.test.ts`
- [X] T077 [P] [US6] Add OSS cleanliness tests that fail on private app names or host imports from reference apps in `ui/src/__tests__/agentic-apps/oss-cleanliness.test.ts`
- [X] T078 [P] [US6] Add Agentic SDLC external runtime smoke tests in `ui/src/__tests__/agentic-apps/agentic-sdlc-reference.test.ts`

### Implementation for User Story 6

- [X] T079 [US6] Move FinOps manifest data into reference app-owned manifest module in `ui/apps/agentic-apps/finops/manifest.mjs`
- [X] T080 [US6] Move Weather manifest data into reference app-owned manifest module in `ui/apps/agentic-apps/weather/manifest.mjs`
- [X] T081 [US6] Create Agentic SDLC external reference runtime server in `ui/apps/agentic-sdlc/server.mjs`
- [X] T082 [US6] Create Agentic SDLC public manifest module in `ui/apps/agentic-sdlc/manifest.mjs`
- [X] T083 [US6] Replace host built-in app manifest imports with generic package seeding from reference manifests in `ui/src/lib/agentic-apps/builtin-packages.ts`
- [X] T084 [US6] Update app registry to avoid hardcoded private/internal app branches in `ui/src/lib/agentic-apps/registry.ts`
- [X] T085 [US6] Update package scripts for Agentic SDLC reference runtime in `ui/package.json`
- [X] T086 [US6] Document run/install/remove flow for each reference app in `docs/docs/specs/2026-05-09-external-agentic-apps/quickstart.md`
- [X] T087 [US6] Add migration redirect or compatibility handling for old Agentic SDLC bookmarks in `ui/src/app/(app)/apps/agentic-sdlc/[owner]/[repo]/page.tsx`

**Checkpoint**: User Story 6 can be validated by installing and removing reference apps through the generic platform flow.

---

## Phase 9: User Story 7 - Operate and Audit the App Platform Safely (Priority: P3)

**Goal**: Operators can trace install, launch, PDP, token, webhook, assistant-context, and health outcomes by app ID and correlation ID.

**Independent Test**: Generate success and failure events for import, install, launch, PDP denial, token issue, webhook forward, and health check, then confirm an operator can trace the reason and impacted app from CAIPE audit surfaces.

### Tests for User Story 7

- [X] T088 [P] [US7] Add audit event query tests for app id, decision id, correlation id, reason code, and redaction in `ui/src/__tests__/agentic-apps/audit-query.test.ts`
- [X] T089 [P] [US7] Add health snapshot tests for healthy, degraded, unreachable, and user-safe blocked reason states in `ui/src/__tests__/agentic-apps/health.test.ts`
- [X] T090 [P] [US7] Add admin audit API tests for filtering app platform events in `ui/src/app/api/admin/agentic-apps/audit/__tests__/route.test.ts`

### Implementation for User Story 7

- [X] T091 [US7] Implement app health checker and health snapshot persistence in `ui/src/lib/agentic-apps/health.ts`
- [X] T092 [US7] Add admin audit query helpers for app platform events in `ui/src/lib/agentic-apps/audit.ts`
- [X] T093 [US7] Implement admin app audit API route in `ui/src/app/api/admin/agentic-apps/audit/route.ts`
- [X] T094 [US7] Add health and blocked reason fields to user launch surfaces in `ui/src/components/agentic-apps/AgenticAppsHub.tsx`
- [X] T095 [US7] Add admin audit section for app events in `ui/src/components/admin/AgenticAppsSection.tsx`
- [X] T096 [US7] Emit health check and degraded/unavailable audit events in `ui/src/lib/agentic-apps/health.ts`
- [X] T097 [US7] Update Mongo migration notes with final indexes and retention decisions in `docs/docs/specs/2026-05-09-external-agentic-apps/mongodb-migration.md`

**Checkpoint**: User Story 7 can be validated through admin audit queries and safe user-facing blocked states.

---

## Final Phase: Polish & Cross-Cutting Concerns

**Purpose**: Validate the complete platform, update docs, and harden security and compatibility before merge.

- [X] T098 [P] Update user-facing external app platform docs in `docs/docs/agentic-apps.md`
- [X] T099 [P] Add operator environment variable documentation for app origins, token issuer, keys, webhook limits, and health policy in `ui/env.example`
- [X] T100 [P] Add release note draft for external agentic apps in `docs/docs/specs/2026-05-09-external-agentic-apps/release-notes.md`
- [X] T101 Run source scan for forbidden private app names and host-only imports in `ui/src/`, `ui/apps/`, and `docs/docs/specs/2026-05-09-external-agentic-apps/`
- [X] T102 Run targeted UI tests with `cd ui && npm test -- agentic-apps`
- [X] T103 Run full UI gate with `make caipe-ui-tests`
- [X] T104 Run quickstart validation from `docs/docs/specs/2026-05-09-external-agentic-apps/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on setup and blocks every user story.
- **US1, US2, US3 (P1)**: Depend on foundation. US1 is the MVP and should be completed first; US2 and US3 can start after foundation if capacity allows, but both integrate with US1 launch/install data.
- **US4, US5, US6 (P2)**: Depend on foundation. US4 depends on embedded launch behavior from US1. US5 can proceed after foundation and integrates with US4. US6 depends on US1 and benefits from US2/US3/US5.
- **US7 (P3)**: Depends on audit and event emission from prior stories.
- **Polish**: Depends on desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: First MVP slice; no dependency on other stories after foundation.
- **US2 (P1)**: Depends on foundation; integrates with US1 proxy route and access data.
- **US3 (P1)**: Depends on foundation and PDP/token helpers from US2 for final forwarding, but can build route/validation tests in parallel.
- **US4 (P2)**: Depends on US1 embedded launch path.
- **US5 (P2)**: Depends on foundation; SDK assistant helpers align with US4.
- **US6 (P2)**: Depends on US1 generic install/launch; reference app token/webhook usage depends on US2 and US3.
- **US7 (P3)**: Depends on audit event producers from US1 through US6.

### Within Each User Story

- Tests are written first and should fail before implementation.
- Types and validation precede persistence changes.
- Services/helpers precede API routes.
- API routes precede UI integration.
- Story checkpoint must pass before moving to the next priority slice.

### Parallel Opportunities

- Setup directory tasks T002-T005 can run in parallel after T001.
- Foundational tests T007-T009 can run in parallel.
- User story tests marked [P] can run in parallel within each story.
- US2 PDP/token helper work can run in parallel with US3 webhook route scaffolding after foundation.
- US5 SDK and UI kit test/implementation files can be split between two developers.
- Polish documentation tasks T098-T100 can run in parallel after implementation stabilizes.

---

## Parallel Example: User Story 1

```bash
Task: "T018 [US1] Add contract tests for admin package import validation in ui/src/app/api/admin/agentic-apps/packages/__tests__/route.test.ts"
Task: "T019 [US1] Add contract tests for admin installation, route conflict, enable, disable, and uninstall behavior in ui/src/app/api/admin/agentic-apps/installations/__tests__/route.test.ts"
Task: "T020 [US1] Add user app discovery and app detail API tests for allowed and blocked users in ui/src/app/api/agentic-apps/__tests__/route.test.ts"
Task: "T021 [US1] Add Apps Hub rendering tests for installed, disabled, unhealthy, unsupported, and unauthorized apps in ui/src/__tests__/agentic-apps/apps-hub.test.tsx"
```

## Parallel Example: User Story 2

```bash
Task: "T033 [US2] Add PDP adapter tests for allow, deny, fail-closed, scoped decisions, and safe metadata in ui/src/__tests__/agentic-apps/pdp.test.ts"
Task: "T034 [US2] Add app-scoped token mint/verify/reject tests for audience, app id, scopes, expiry, and token hash storage in ui/src/__tests__/agentic-apps/tokens.test.ts"
Task: "T036 [US2] Add app-owned authorization endpoint tests in ui/src/app/api/agentic-apps/[appId]/authorize/__tests__/route.test.ts"
```

## Parallel Example: User Story 5

```bash
Task: "T066 [US5] Add SDK tests for bridge messages, assistant controls, claim parsing, and authorization requests in ui/src/packages/agentic-app-sdk/__tests__/index.test.ts"
Task: "T067 [US5] Add React UI kit component tests for buttons, badges, page header, metric card, empty state, tabs, toolbar, and assistant trigger in ui/src/packages/agentic-app-ui/__tests__/components.test.tsx"
Task: "T068 [US5] Add forbidden import boundary tests for SDK/UI kit and reference apps in ui/src/__tests__/agentic-apps/package-boundary.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup.
2. Complete Phase 2 foundation.
3. Complete Phase 3 User Story 1.
4. Validate by importing, installing, discovering, launching, disabling, and blocking a neutral external app.
5. Stop and demo before adding PDP token hardening and webhooks.

### Incremental Delivery

1. US1: generic package/install/discovery/launch MVP.
2. US2: PDP and app-scoped token enforcement.
3. US3: generic webhook gateway.
4. US4: contextual assistant bridge.
5. US5: app-facing SDK and UI kit.
6. US6: reference app externalization.
7. US7: operator audit and health surfaces.

### Validation Commands

```bash
cd ui && npm test -- agentic-apps
make caipe-ui-tests
```

### Notes

- Keep app manifests public and secret-free.
- Do not add private/internal app names to OSS source, tests, or docs examples.
- Treat assistant context and webhook payloads as untrusted data.
- Use Conventional Commits with DCO for implementation commits.
