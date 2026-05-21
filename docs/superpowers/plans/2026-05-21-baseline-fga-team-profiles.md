# Baseline FGA Team Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build global Org Member / Org Admin baseline profiles plus custom team-assigned profiles that override the global baseline for matching team users.

**Architecture:** Store profile definitions in MongoDB as a v2 bundle while preserving the existing `openfga_baseline_profiles` default document for compatibility. Login and admin reconciliation compute effective direct user tuples from the selected global profiles unless team profile overrides apply; when multiple teams apply overrides, their profile grants are unioned and replace the global grant set for that role. The Baseline FGA UI becomes a profile editor with available/current grant columns, drag/drop, and team assignment controls.

**Tech Stack:** Next.js route handlers, MongoDB, OpenFGA tuple writer, React 19, Jest/Testing Library.

---

### Task 1: Profile Data Model And Effective Grants

**Files:**
- Modify: `ui/src/lib/rbac/baseline-access.ts`
- Test: `ui/src/lib/rbac/__tests__/baseline-access.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving:
- v2 defaults expose `org-member` and `org-admin` profiles.
- a team member override replaces the global member profile.
- a team admin override replaces the global admin profile.
- multiple team overrides union with each other, not with the global profile.

- [ ] **Step 2: Implement data helpers**

Add `BaselineFgaProfileDefinition`, `BaselineFgaProfileBundle`, `defaultBaselineFgaProfileBundle`, `normalizeBaselineFgaProfileBundle`, and `effectiveBaselineBootstrapTuples`.

- [ ] **Step 3: Verify tests**

Run `npm test -- src/lib/rbac/__tests__/baseline-access.test.ts --runInBand`.

### Task 2: Baseline Profile API

**Files:**
- Modify: `ui/src/app/api/admin/openfga/baseline-profile/route.ts`
- Test: `ui/src/app/api/admin/openfga/__tests__/baseline-profile-route.test.ts`

- [ ] **Step 1: Write failing API tests**

Cover GET returning profile bundle and team assignments; PUT saving profiles, global profile IDs, team assignments, and reconciling known users with override semantics.

- [ ] **Step 2: Implement PUT compatibility**

Keep legacy `{member_grants, admin_grants}` PUT requests working by mapping them onto the built-in v2 profiles.

- [ ] **Step 3: Verify route tests**

Run `npm test -- src/app/api/admin/openfga/__tests__/baseline-profile-route.test.ts --runInBand`.

### Task 3: Login Reconciliation

**Files:**
- Modify: `ui/src/lib/rbac/login-openfga-bootstrap.ts`
- Test: `ui/src/lib/rbac/__tests__/login-openfga-bootstrap.test.ts`

- [ ] **Step 1: Write failing login test**

Mock a team override for `user@example.com` and assert login writes only the override member grant set, not the global member profile.

- [ ] **Step 2: Use effective tuple helper**

Replace direct `baselineMemberTuples` / `baselineAdminTuples` calls with `effectiveBaselineBootstrapTuples`.

- [ ] **Step 3: Verify login tests**

Run `npm test -- src/lib/rbac/__tests__/login-openfga-bootstrap.test.ts --runInBand`.

### Task 4: Baseline FGA UI

**Files:**
- Modify: `ui/src/components/admin/rebac/BaselineFgaProfilePanel.tsx`
- Test: `ui/src/components/admin/rebac/__tests__/BaselineFgaProfilePanel.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Assert admins can select a profile, move a grant from available to current, create a custom profile, assign member/admin profiles to a team, and save one bundle payload.

- [ ] **Step 2: Implement editor**

Render profile selector, available/current grant columns with drag/drop and click fallback, custom profile create/delete controls, and team assignment selects.

- [ ] **Step 3: Verify UI tests**

Run `npm test -- src/components/admin/rebac/__tests__/BaselineFgaProfilePanel.test.tsx --runInBand`.

### Task 5: RBAC Documentation

**Files:**
- Modify: `docs/docs/security/rbac/architecture.md`
- Modify: `docs/docs/security/rbac/workflows.md`
- Modify: `docs/docs/security/rbac/file-map.md`

- [ ] **Step 1: Document override semantics**

Explain that team-assigned custom profiles replace global profile grants for the affected role and are materialized as direct user tuples during login/reconciliation.

- [ ] **Step 2: Verify focused tests**

Run the three focused Jest commands from Tasks 1-4 plus `ReadLints` on edited files.
