# Tasks: Admin UI User Detail View + Slack Identity Linking

**Input**: Design documents from `/specs/098-enterprise-rbac-slack-ui/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US6, US5)
- Include exact file paths in descriptions

---

## Phase 1: Keycloak Admin Client Extensions (Foundational)

**Purpose**: Add all missing Keycloak Admin API wrapper functions required by both FR-033 (user detail view) and FR-025 (Slack identity linking). These are blocking prerequisites for all downstream API routes and UI components.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T001 [P] Add `searchRealmUsers(params)` function with text search, enabled filter, and server-side pagination (`first`/`max`) in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T002 [P] Add `countRealmUsers(params)` function returning total user count for pagination controls in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T003 [P] Add `getUserSessions(userId)` function returning active sessions (for last login timestamp) in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T004 [P] Add `getUserFederatedIdentities(userId)` function returning IdP source array in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T005 [P] Add `assignRealmRolesToUser(userId, roles)` function (POST role-mappings/realm) in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T006 [P] Add `removeRealmRolesFromUser(userId, roles)` function (DELETE role-mappings/realm) in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T007 [P] Add `updateUser(userId, data)` function for enable/disable toggle (PUT user with partial body) in `ui/src/lib/rbac/keycloak-admin.ts`
- [x] T008 [P] Add `listUsersWithRole(roleName, first?, max?)` function for role-based filtering in `ui/src/lib/rbac/keycloak-admin.ts`

**Checkpoint**: All Keycloak Admin Client functions are available. API route and UI work can begin.

---

## Phase 2: User Story 6 — BFF API Routes for User Management (FR-033) (Priority: P2)

**Goal**: Build server-side API routes that provide paginated, filterable user data from Keycloak and CRUD for roles/teams.

**Independent Test**: Call `GET /api/admin/users?search=test&page=1` and verify paginated Keycloak user data is returned with total count. Call `POST /api/admin/users/[id]/roles` and verify role assignment via Keycloak Admin API.

- [x] T009 [US6] Rewrite `GET /api/admin/users` to use `searchRealmUsers` for Keycloak server-side pagination with 6 filters (search, role, team, IdP, Slack status, enabled) in `ui/src/app/api/admin/users/route.ts`
- [x] T010 [P] [US6] Create `GET /api/admin/users/[id]` returning full user profile (Keycloak user + roles + sessions + federated identities + Slack link status + teams from MongoDB) in `ui/src/app/api/admin/users/[id]/route.ts`
- [x] T011 [P] [US6] Create `PUT /api/admin/users/[id]` for enable/disable user via `updateUser` in `ui/src/app/api/admin/users/[id]/route.ts`
- [x] T012 [P] [US6] Create `POST /api/admin/users/[id]/roles` for assigning realm roles via `assignRealmRolesToUser` in `ui/src/app/api/admin/users/[id]/roles/route.ts`
- [x] T013 [P] [US6] Create `DELETE /api/admin/users/[id]/roles` for removing realm roles via `removeRealmRolesFromUser` in `ui/src/app/api/admin/users/[id]/roles/route.ts`
- [x] T014 [P] [US6] Create `POST /api/admin/users/[id]/teams` for adding user to CAIPE team (MongoDB `team_kb_ownership` update) in `ui/src/app/api/admin/users/[id]/teams/route.ts`
- [x] T015 [P] [US6] Create `DELETE /api/admin/users/[id]/teams` for removing user from CAIPE team in `ui/src/app/api/admin/users/[id]/teams/route.ts`

**Checkpoint**: All user management API routes functional. UI component work can begin.

---

## Phase 3: User Story 6 — UserManagementTab Component (FR-033) (Priority: P2)

**Goal**: Build the paginated user table with filter bar that replaces the inline user grid.

**Independent Test**: Load the Admin UI Users tab. Verify server-side paginated table renders with all 6 filters operational, pagination controls work, and total count displays.

- [x] T016 [US6] Create `UserManagementTab` component with paginated table structure (Name, Email, Roles badges, Teams, IdP, Slack status, Enabled) in `ui/src/components/admin/UserManagementTab.tsx`
- [x] T017 [US6] Add filter bar to `UserManagementTab`: text search, role multi-select, team multi-select, IdP dropdown, Slack status dropdown, enabled toggle in `ui/src/components/admin/UserManagementTab.tsx`
- [x] T018 [US6] Add pagination controls to `UserManagementTab`: page number, total count, prev/next buttons, 20 per page default in `ui/src/components/admin/UserManagementTab.tsx`

**Checkpoint**: User table with filters and pagination renders correctly.

---

## Phase 4: User Story 6 — UserDetailModal Component (FR-033) (Priority: P2)

**Goal**: Build the modal dialog showing full user profile with inline editing for roles and teams.

**Independent Test**: Click a user row in the table. Verify modal opens with all 8 sections populated. Assign a role and verify it appears in the user's profile. Add the user to a team and verify it persists.

- [x] T019 [US6] Create `UserDetailModal` base with shadcn/ui Dialog, header section (name, email, avatar placeholder, account status toggle), and close action in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T020 [US6] Add Realm Roles section to `UserDetailModal` with list display, add role dropdown, remove button per role, save via `POST/DELETE /api/admin/users/[id]/roles` in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T021 [US6] Add Teams section to `UserDetailModal` with list display, add team dropdown, remove button per team, save via `POST/DELETE /api/admin/users/[id]/teams` in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T022 [US6] Add Per-KB Roles section (read-only) to `UserDetailModal` parsing `kb_reader:<id>`, `kb_ingestor:<id>`, `kb_admin:<id>` from realm roles in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T023 [US6] Add Per-Agent Roles section (read-only) to `UserDetailModal` parsing `agent_user:<id>`, `agent_admin:<id>` from realm roles in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T024 [US6] Add Identity & Account section to `UserDetailModal` showing IdP source, Slack link status, last login timestamp, account created date in `ui/src/components/admin/UserDetailModal.tsx`

**Checkpoint**: Modal shows full user profile with inline editing for roles and teams.

---

## Phase 5: User Story 6 — Admin Page Integration (FR-033) (Priority: P2)

**Goal**: Wire UserManagementTab and UserDetailModal into the Admin page, replacing the inline user grid.

**Independent Test**: Navigate to Admin → Users tab. Table shows Keycloak users with filters. Click row → modal opens. Edit a role → save → table reflects change.

- [x] T025 [US6] Replace inline user grid in `ui/src/app/(app)/admin/page.tsx` with `UserManagementTab` component import and rendering
- [x] T026 [US6] Wire `UserDetailModal` to `UserManagementTab` row clicks — pass selected user ID, open modal, refresh table on save in `ui/src/app/(app)/admin/page.tsx`

**Checkpoint**: FR-033 fully integrated. Admin UI User Management is server-side paginated with full profile modal.

---

## Phase 6: User Story 5 — Slack Identity Linking Enhancements (FR-025) (Priority: P1)

**Goal**: Enhance the existing Slack identity linking flow with consumed nonce flag, Slack DM confirmation via Slack Web API, and proper HTML success page per the latest clarifications.

**Independent Test**: Generate a linking URL from the bot. Click it → authenticate via Keycloak → verify: (a) Keycloak user attribute `slack_user_id` is set, (b) nonce marked consumed in MongoDB, (c) browser shows HTML success page, (d) Slack DM arrives confirming link.

- [x] T027 [US5] Update `NonceDoc` type to include `consumed` boolean field and update nonce validation to check `consumed === false` in `ui/src/app/api/auth/slack-link/route.ts`
- [x] T028 [US5] Add `slack_user_id` query parameter handling — extract from URL, use to resolve Keycloak user for attribute storage in `ui/src/app/api/auth/slack-link/route.ts`
- [x] T029 [US5] Add Slack Web API DM confirmation after successful linking — use `SLACK_BOT_TOKEN` env var to call `chat.postMessage` with success message in `ui/src/app/api/auth/slack-link/route.ts`
- [x] T030 [US5] Replace plain-text success response with HTML success page ("Your Slack account is linked!") in `ui/src/app/api/auth/slack-link/route.ts`
- [x] T031 [US5] Update `identity_linker.py` to store nonces in MongoDB instead of in-memory dict — use motor/pymongo async client with TTL index on `created_at` in `ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py`
- [x] T032 [US5] Add MongoDB TTL index creation for `slack_link_nonces` collection (unique on `nonce`, TTL 600s on `created_at`) in `ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py`

**Checkpoint**: FR-025 identity linking flow is production-ready with MongoDB nonces, consumed flag, Slack DM, and HTML success page.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Loading/error states, accessibility, environment variable documentation, cleanup.

- [x] T033 [P] Add loading skeleton and error boundary to `UserManagementTab` — show skeleton rows during fetch, error banner on API failure in `ui/src/components/admin/UserManagementTab.tsx`
- [x] T034 [P] Add loading spinner and error states to `UserDetailModal` — show spinner during profile fetch, toast on save error in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T035 [P] Add ARIA labels, keyboard navigation (Escape to close modal, Tab through controls), and focus management to `UserDetailModal` in `ui/src/components/admin/UserDetailModal.tsx`
- [x] T036 [P] Document new environment variables (`SLACK_BOT_TOKEN` for BFF, `SLACK_LINK_BASE_URL` for bot) in `deploy/rbac/.env.rbac.example`
- [x] T037 Remove deprecated inline user grid code from `ui/src/app/(app)/admin/page.tsx` and clean up unused imports

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Keycloak Admin Client)**: No dependencies — can start immediately. **BLOCKS all subsequent phases.**
- **Phase 2 (BFF API Routes)**: Depends on Phase 1 completion.
- **Phase 3 (UserManagementTab)**: Depends on Phase 2 (needs API routes to fetch data).
- **Phase 4 (UserDetailModal)**: Depends on Phase 2 (needs API routes for CRUD operations).
- **Phase 5 (Admin Page Integration)**: Depends on Phases 3 + 4 (needs both components).
- **Phase 6 (Slack Linking)**: Depends on Phase 1 only (uses `mergeUserAttributes` which already exists). **Can run in parallel with Phases 2-5.**
- **Phase 7 (Polish)**: Depends on Phases 5 + 6 completion.

### User Story Dependencies

- **US6 (FR-033)**: Phases 1 → 2 → 3+4 (parallel) → 5
- **US5 (FR-025)**: Phases 1 → 6 (independent of US6 after Phase 1)

### Parallel Opportunities

- **Phase 1**: All 8 tasks (T001-T008) can run in parallel (different functions in same file).
- **Phase 2**: T010-T015 can run in parallel (different route files). T009 is independent.
- **Phase 3+4**: Can run in parallel with each other (different component files).
- **Phase 6**: Can run in parallel with Phases 2-5 entirely (different files, different user story).
- **Phase 7**: All tasks marked [P] can run in parallel.

---

## Parallel Example: Phase 1

```bash
# Launch all Keycloak Admin Client extensions together:
Task: "T001 Add searchRealmUsers in keycloak-admin.ts"
Task: "T002 Add countRealmUsers in keycloak-admin.ts"
Task: "T003 Add getUserSessions in keycloak-admin.ts"
Task: "T004 Add getUserFederatedIdentities in keycloak-admin.ts"
Task: "T005 Add assignRealmRolesToUser in keycloak-admin.ts"
Task: "T006 Add removeRealmRolesFromUser in keycloak-admin.ts"
Task: "T007 Add updateUser in keycloak-admin.ts"
Task: "T008 Add listUsersWithRole in keycloak-admin.ts"
```

## Parallel Example: Phase 6 alongside Phase 2

```bash
# US5 (Slack linking) runs independently from US6 (User Management):
Task: "T027-T032 Slack identity linking enhancements" # Phase 6
Task: "T009-T015 BFF API routes for user management"  # Phase 2
```

---

## Implementation Strategy

### MVP First (Phase 1 + Phase 2 + Phase 3)

1. Complete Phase 1: Keycloak Admin Client extensions
2. Complete Phase 2: BFF API routes
3. Complete Phase 3: UserManagementTab (paginated table + filters)
4. **STOP and VALIDATE**: Users tab shows paginated Keycloak users with filtering
5. Deploy/demo if ready (table works without modal)

### Incremental Delivery

1. Phase 1 → Foundation ready
2. Phase 2 → API routes functional → Testable via curl/Postman
3. Phase 3 → User table renders → Visual demo
4. Phase 4 → Modal with editing → Full FR-033
5. Phase 5 → Integrated → Ship FR-033
6. Phase 6 → Slack linking enhanced → Ship FR-025 updates
7. Phase 7 → Polish → Production-ready

---

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 37 |
| Phase 1 (Foundational) | 8 tasks |
| Phase 2 (US6 API Routes) | 7 tasks |
| Phase 3 (US6 UserManagementTab) | 3 tasks |
| Phase 4 (US6 UserDetailModal) | 6 tasks |
| Phase 5 (US6 Integration) | 2 tasks |
| Phase 6 (US5 Slack Linking) | 6 tasks |
| Phase 7 (Polish) | 5 tasks |
| US6 tasks (FR-033) | 26 |
| US5 tasks (FR-025) | 6 |
| Parallelizable tasks | 24 (marked [P]) |
| MVP scope | Phase 1 + 2 + 3 (18 tasks) |

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Existing functions (`listRealmUsersPage`, `listRealmRoleMappingsForUser`, `getRealmUserById`, `mergeUserAttributes`) are already in `keycloak-admin.ts` and are NOT re-created
- Existing `slack-link/route.ts` has basic nonce validation; Phase 6 enhances it with consumed flag, Slack DM, and HTML success page
- Existing `identity_linker.py` uses in-memory nonce store; Phase 6 migrates to MongoDB for persistence
