---
description: "Task list for Service Accounts feature implementation"
---

# Tasks: Service Accounts

**Input**: Design documents from `docs/docs/specs/2026-06-05-service-accounts/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md, mongodb-migration.md

**Tests**: INCLUDED — the spec defines acceptance scenarios + quickstart test mapping, and the
constitution mandates CI gates (Jest for TS, pytest for Python).

**Organization**: Grouped by user story (US1–US5 from spec.md) so each is independently testable.
Two server-side enablers (caller-keyed bridge fix, DA subject fix) live in US2 since they gate
end-to-end service-account usage.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5; Setup/Foundational/Polish have no story label
- File paths are exact.

## Path Conventions
Web app: BFF/UI in `ui/`, Python services in `ai_platform_engineering/` and `deploy/openfga/`.

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Resolve open item R-7 (UI gating): inspect `ui/src/app/(app)/admin/page.tsx` and `ui/src/hooks/use-admin-role.ts` to confirm whether non-admin team members can reach the admin page; decide the Service Accounts tab gate (team-membership, not `isAdmin`). Record the decision in `research.md` R-7. Blocks UI work (US1/US5).
- [ ] T002 Finalize the service-account detection rule (consistency across layers): confirm whether to key on `client_id` claim vs `preferred_username` (`service-account-`) for namespacing `service_account:<sub>`. Document the single canonical rule in `research.md` R-2/R-3; WS-F (bridge) and WS-G (DA) MUST both use it. Blocks T030, T034.

---

## Phase 2: Foundational (blocking prerequisites for all stories)

**⚠️ MUST complete before user-story phases.**

- [ ] T003 Add the ownership relation to the OpenFGA model in `deploy/openfga/model.fga`: extend `type service_account` with `define owner_team: [team#member]` and `define can_manage: owner_team`. (Additive; `tool#caller` already permits `user`+`service_account` — do NOT change it.)
- [ ] T004 Recompile the model into `charts/ai-platform-engineering/charts/openfga/authorization-model.json` so it mirrors `model.fga` exactly; verify `deploy/openfga/init/seed.py` applies the new relation on seed.
- [ ] T005 [P] Add the `ServiceAccount` + `ServiceAccountScope` TypeScript interfaces to `ui/src/types/mongodb.ts` per data-model.md (no secret/hash fields).
- [ ] T006 [P] Register `service_accounts` indexes in `ui/src/lib/mongodb.ts` `createIndexes()` (the 5 indexes in mongodb-migration.md).
- [ ] T007 Create the Mongo lib wrapper `ui/src/lib/service-accounts.ts` mirroring `ui/src/lib/catalog-api-keys.ts`: `createServiceAccountDoc`, `listByOwningTeams`, `getBySub`, `updateStatus`, `updateScopesSnapshot`, app-layer name-uniqueness check among active SAs in a team — **case-insensitive** (lowercase the name for the comparison; store original case for display) (FR-002a). Depends on T005, T006.
- [ ] T008 [P] Add Keycloak admin helpers to `ui/src/lib/rbac/keycloak-admin.ts` mirroring existing `adminFetch`/`assertOk`: `createServiceAccountClient(name)` (POST /clients confidential+serviceAccountsEnabled, read back client UUID + secret + service-account-user `sub`), `regenerateClientSecret(clientUuid)` (POST /clients/:id/client-secret), `deleteServiceAccountClient(clientUuid)` (DELETE /clients/:id). Naming `caipe-sa-<slug>-<short-rand>`.
- [ ] T009 [P] Unit-test the Keycloak helpers in `ui/src/lib/rbac/__tests__/keycloak-admin.service-accounts.test.ts` (mock `adminFetch`): create returns id+secret+sub, regenerate, delete, error propagation via `assertOk`.

---

## Phase 3: User Story 1 — Create a scoped service account (P1) 🎯 MVP

**Goal**: A team member creates an SA owned by their team, scoped only to what they hold, and sees
the credential once. **Independent test**: quickstart S1–S3.

- [ ] T010 [US1] Create `GET /api/admin/service-accounts/grantable` route in `ui/src/app/api/admin/service-accounts/grantable/route.ts` — return agents+tools the caller holds via `listOpenFgaObjects(user:<caller>, can_use, agent)` and the tool equivalent (FR-009). Uses `ui/src/lib/rbac/openfga.ts`.
- [ ] T011 [US1] Create `POST /api/admin/service-accounts` in `ui/src/app/api/admin/service-accounts/route.ts` implementing the 7-step create flow (contracts §POST): validate request body at the boundary (name length/charset, `owning_team_id` format, each scope `ref` shape — `agent` id or `server/tool`|`server/*`; reject malformed with 400) (constitution VII), team-membership check (FR-002), name-unique case-insensitive (FR-002a→409), per-scope `checkOpenFgaTuple(user:<caller>,…)` reject-if-unheld (FR-006/008), Keycloak client create (T008), OpenFGA tuple writes (owner_team + scopes), Mongo insert (T007), return credential ONCE (FR-005). Depends on T007, T008.
- [ ] T012 [US1] Wire create-time audit events in the POST route: `service_account.create` with actor+target+scopes (FR-026), reusing the repo's audit-events mechanism. Depends on T011.
- [ ] T013 [P] [US1] Jest test `ui/src/app/api/admin/service-accounts/__tests__/create.test.ts`: happy path (201 + secret once), name conflict incl. case-insensitive collision (409, FR-002a), unauthorized scope rejected (S3/FR-008), non-member team (403), default-deny empty scopes (S2/FR-004), malformed body rejected (400, constitution VII).
- [ ] T014 [US1] Create `ServiceAccountsTab.tsx` in `ui/src/components/admin/` and register it in `ui/src/app/(app)/admin/page.tsx` CATEGORIES (settings group), gated per T001. Reuse `Tabs`. Depends on T001.
- [ ] T015 [US1] Build the create dialog in `ServiceAccountsTab.tsx`: name + description inputs, owning-team picker (`TeamPicker`, teams the user belongs to), grantable scope picker (fetch T010), submit to T011. Depends on T010, T014.
- [ ] T016 [US1] Build the one-time credential reveal (client_id + client_secret + token URL) using `CopyButton` + the see-once dialog pattern (`SecretValueDialog`); never refetchable (FR-005). Depends on T015.
- [ ] T017 [P] [US1] List view in `ServiceAccountsTab.tsx`: fetch `GET /api/admin/service-accounts` (see T024), render name/team/created-by/status/scope-counts. Depends on T014.

**Checkpoint**: A user can create a scoped SA and copy its credential once. MVP demonstrable.

---

## Phase 4: User Story 2 — Use a service account end-to-end (P1) 🎯 MVP

**Goal**: External caller authenticates as the SA; agent-use authorized against the SA; tool calls
authorized against the SA (not just the agent). **Independent test**: quickstart S4, S5, S5b.
Includes the two server-side enablers.

- [ ] T018 [US2] Fix DA backend subject namespacing in `ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/openfga_authz.py`: in `_check_agent_use` / `require_agent_use_permission`, detect service-account tokens (rule from T002) and build `service_account:<sub>` instead of hardcoded `user:<sub>`; keep `user:<sub>` for interactive users (R-5/WS-G).
- [ ] T019 [P] [US2] pytest in `ai_platform_engineering/dynamic_agents/.../tests/` covering: SA token → `service_account:<sub> can_use agent:<id>` allowed; user token still `user:<sub>`; SA denied when no grant. Depends on T018.
- [ ] T020 [US2] Add caller-keyed tool check in `deploy/openfga/bridge/main.py`: decode `client_id` to namespace subject (rule from T002); after the existing `agent:<id> can_call tool:...` check, AND a `<subject> can_call tool:<server>/<tool>` check (+ `tool:<server>/*` wildcard fallback); allow only if both pass (FR-012/012a/012b). Depends on T002.
- [ ] T021 [US2] Add deny reason `DENY_CALLER_TOOL` audit path in `deploy/openfga/bridge/main.py` following the existing `_audit_decision` pattern (FR-027). Depends on T020.
- [ ] T022 [P] [US2] Extend `deploy/openfga/bridge/tests/test_grpc_bridge.py` mirroring existing tool-grant tests: (a) user has agent+agent-has-tool but user lacks tool → deny (S5b); (b) service_account caller with both grants → allow (S5); (c) service_account lacks tool → deny. Depends on T020.
- [ ] T021a [US2] Ensure call-time authorization decisions under a service-account credential are audited for BOTH allow and deny outcomes (FR-027/SC-009): the DA agent-use check (T018) emits an audit event, and the bridge emits allow events (not only `DENY_CALLER_TOOL`). Verify in the bridge `_audit_decision` and DA audit paths; add assertions to T019/T022. Depends on T018, T021.
- [ ] T022a [US2] **Rollout safety** for the caller-keyed check (FR-012c/SC-011): inventory current effective tool reach (which `user:`/`service_account:` subjects can reach which `tool:<server>/<tool>` via `agent can_call`), and EITHER (a) backfill direct `<subject> can_call tool:...` grants via a one-off OpenFGA write script, OR (b) gate the new check behind a config flag in `deploy/openfga/bridge/main.py` (default-off) with documented enable steps. Document the chosen approach in `docs/docs/security/rbac/workflows.md`. Coordinate with platform owner (Sri). **Gates turning the check on in any shared environment.** Depends on T020.
- [ ] T023 [P] [US2] Integration check: verify the BFF forwards the SA's original JWT to DA (`ui/src/lib/da-proxy.ts` already does — add/confirm a test that `Authorization: Bearer <sa-jwt>` is forwarded; no code change expected per R-4).

**Checkpoint**: An SA can authenticate, invoke a granted agent, and is correctly denied ungranted
tools — and the same enforcement now protects human users (S5b). **The caller-keyed check is only
enabled in a shared environment after T022a (rollout safety) is complete.**

---

## Phase 5: User Story 3 — Manage scopes after creation (P2)

**Goal**: Owning-team member adds (bounded) / removes (unconditional) scopes. **Test**: S6.

- [ ] T024 [US3] Create `GET /api/admin/service-accounts` (list, owning-team filtered, FR-014/021) and `GET /api/admin/service-accounts/[id]` (detail + current scopes read from OpenFGA) in `ui/src/app/api/admin/service-accounts/route.ts` and `.../[id]/route.ts`. Gate via `check(user:<caller>, can_manage, service_account:<id>)`.
- [ ] T025 [US3] Create `POST /api/admin/service-accounts/[id]/scopes` in `.../[id]/scopes/route.ts`: validate scope `ref` shape at the boundary (reject malformed with 400, constitution VII), `can_manage` check, then `checkOpenFgaTuple(user:<editor>, <rel>, <object>)` (FR-015→403 if unheld), write tuple, update snapshot, audit `service_account.scope_add`. Depends on T024.
- [ ] T026 [US3] Add `DELETE` to `.../[id]/scopes/route.ts`: `can_manage` check ONLY (no scope-holding requirement, FR-016), delete tuple, update snapshot, audit `service_account.scope_remove`. Depends on T024.
- [ ] T027 [P] [US3] Jest test `.../__tests__/scopes.test.ts`: add held scope (ok), add unheld scope (403), remove any scope incl. one the editor can't grant (ok), credential unchanged (FR-019).
- [ ] T024a [P] [US3] Jest test asserting GET list (T024) and GET detail responses contain NO credential/secret field (FR-005) — the secret appears ONLY in the 201-create (T011) and rotate (T029) responses. Depends on T024.
- [ ] T028 [US3] Manage view in `ServiceAccountsTab.tsx`: show current scopes, add-scope (picker bounded by editor via T010), remove-scope (delete-confirm pattern). Depends on T017, T025, T026.

**Checkpoint**: Scopes editable post-create with the asymmetric add/remove rule.

---

## Phase 6: User Story 4 — Rotate and revoke (P2)

**Goal**: Rotate credential (shown once); revoke terminal. **Test**: S7, S8.

- [ ] T029 [US4] Create `POST /api/admin/service-accounts/[id]/rotate` in `.../[id]/rotate/route.ts`: `can_manage` check, `regenerateClientSecret` (T008), return new secret ONCE, scopes unchanged (FR-017/019), audit `service_account.rotate`. Depends on T008, T024.
- [ ] T030 [US4] Create `DELETE /api/admin/service-accounts/[id]` in `.../[id]/route.ts`: `can_manage` check, delete Keycloak client (T008), delete ALL OpenFGA tuples for `service_account:<id>` (ownership + scopes), mark Mongo `status:revoked`+`revoked_at` (retain doc), free name for reuse (FR-018/018a), audit `service_account.revoke`. Depends on T008, T024.
- [ ] T031 [P] [US4] Jest test `.../__tests__/rotate-revoke.test.ts`: rotate returns new secret once + old invalidated (mock Keycloak); revoke deletes client+tuples, marks revoked, name reusable (S8).
- [ ] T032 [US4] Add rotate + revoke actions (with confirm) to the manage view in `ServiceAccountsTab.tsx`; reveal rotated secret via the see-once dialog. Depends on T016, T028, T029, T030.

**Checkpoint**: Credential hygiene + terminal revoke work end-to-end.

---

## Phase 7: User Story 5 — Ownership & visibility boundaries (P2)

**Goal**: Only owning-team members see/manage an SA; one team; no sharing. **Test**: S9.

- [ ] T033 [US5] Enforce ownership filtering in `GET /api/admin/service-accounts` (only SAs in teams the caller belongs to) and `can_manage` gating on every `[id]` route; verify non-members get 403/404 (FR-021/022). Hardening pass over T024/T025/T026/T029/T030.
- [ ] T034 [P] [US5] Jest test `.../__tests__/ownership.test.ts`: member sees+manages; non-member (different team) cannot see or mutate (S9); confirm no route accepts more than one owning team / no share path (FR-022).
- [ ] T034a [P] [US5] Test static access (FR-020, quickstart S10): after removing the creator's own grant for a scope, assert the SA's `service_account:<sub>` tuple is unchanged and the SA still authorizes. No code — regression guard.

**Checkpoint**: Cross-team isolation verified.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T035 Implement the team-deletion guard (FR-025): locate the team-delete path (BFF/admin teams API), block deletion while any `service_account:<sub> owner_team team:<id>` tuple exists, with a clear error (S11). Add a test.
- [ ] T036 [P] Update `docs/docs/security/rbac/architecture.md` — add the service-account identity layer (Keycloak client → `service_account:<sub>` → tuples).
- [ ] T037 [P] Update `docs/docs/security/rbac/workflows.md` — sequence diagrams for create + external-call flow, incl. the new dual agent+caller tool check.
- [ ] T038 [P] Add a component README / section documenting the `service_accounts` collection, env requirements (`KEYCLOAK_ADMIN_CLIENT_ID/SECRET`), and the `caipe-sa-` client naming convention.
- [ ] T039 Run quickstart.md S1–S12 end-to-end on a dev stack (bridge enabled + HMAC secret set); fix gaps. Confirm SC-001..SC-010.
- [ ] T040 [P] Lint + gate pass: `cd ui && npm run lint && npm run build`; `uv run ruff check` + `uv run pytest` for bridge + DA changes.

---

## Dependencies & Execution Order

**Phase gates**: Setup (T001–T002) → Foundational (T003–T009) → US1 (T010–T017) → US2 (T018–T023) →
US3/US4/US5 (largely parallel) → Polish.

**Critical path for MVP (US1+US2)**:
`T003/T004 (model)` + `T005→T006→T007 (Mongo)` + `T008 (Keycloak)` → `T011 (create)` → demo create;
then `T018 (DA fix)` + `T020 (bridge fix)` → demo end-to-end use.

**Story independence**:
- US1 needs Foundational. US2's enablers (T018, T020) are independent of US1's UI and can be built in
  parallel with US1.
- US3, US4, US5 all build on US1's routes/UI but are independent of each other (different routes/tests).

**Cross-layer consistency**: T002 (SA-detection rule) blocks T018 and T020 — do it first so DA and
bridge namespace identically.

**Rollout gate**: T022a (rollout safety, FR-012c) MUST complete before the caller-keyed check (T020)
is enabled in any shared environment — turning it on without the backfill/flag would break existing
human users who rely on transitive tool access. T020 can be written/tested (T022) before T022a; only
*enablement* is gated.

## Parallel Execution Examples

- **Foundational**: T005, T006, T008, T009 in parallel (distinct files); T007 after T005+T006.
- **US1**: T013 (test) ∥ T017 (list UI) while T011/T015/T016 proceed on the create path.
- **US2**: T019 ∥ T022 ∥ T023 (tests in different files) once T018/T020 land.
- **Polish**: T036, T037, T038, T040 all parallel.

## Implementation Strategy

**MVP = US1 + US2** (both P1). US1 alone is demonstrable (create + see-once credential) but the
feature only delivers value once US2's enablers (DA subject fix + caller-keyed bridge check) let the
SA actually call CAIPE with correct authorization. Ship US1+US2 first, then layer US3/US4/US5 and
polish. The caller-keyed bridge fix (T020/T022) is independently valuable — it closes the human-user
escalation gap (S5b) regardless of the rest of the feature.
