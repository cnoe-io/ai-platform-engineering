# Admin Effective Permissions Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only Admin "View as" simulator that evaluates actual user/team OpenFGA effective permissions and scopes existing Admin tabs accordingly.

**Architecture:** Keep the browser authenticated as the real admin. A new BFF simulator library validates simulation subjects, checks the real admin can simulate, and evaluates OpenFGA checks for the selected user or team userset. The existing admin tab gates endpoint accepts optional simulation query params and returns read-only simulation metadata; the Admin page surfaces a banner/control and appends query params to scoped tab-gate requests.

**Tech Stack:** Next.js App Router route handlers, React 19 client components, OpenFGA check API, Jest and React Testing Library.

---

### Task 1: Simulator Subject And Gate Endpoint

**Files:**
- Create: `ui/src/lib/rbac/admin-simulator.ts`
- Modify: `ui/src/app/api/rbac/admin-tab-gates/route.ts`
- Test: `ui/src/app/api/rbac/admin-tab-gates/__tests__/route.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that call `GET()` with `?simulate_type=team&simulate_id=platform&simulate_relation=admin` and assert Slack is visible when `team:platform#admin can_manage admin_surface:slack` is allowed, while platform-only tabs remain hidden when the simulated team lacks those relationships. Add a test rejecting simulation for a non-admin actor.

- [ ] **Step 2: Verify red**

Run: `npm test -- app/api/rbac/admin-tab-gates/__tests__/route.test.ts`

Expected: fail because the endpoint ignores simulation query params.

- [ ] **Step 3: Implement simulator helpers**

Create `parseSimulationRequest`, `simulationSubjectToOpenFgaUser`, and `assertCanSimulate` helpers. Allow simulation only for organization admins/bootstrap admins. Support `user`, `team#member`, and `team#admin`.

- [ ] **Step 4: Wire tab gates**

Change `GET` to accept `NextRequest`, derive the effective subject from the simulation params when present, check each protected tab against `admin_surface:<tab>` where available, and include `simulation: { active, subject, readonly: true }` in the response.

- [ ] **Step 5: Verify green**

Run: `npm test -- app/api/rbac/admin-tab-gates/__tests__/route.test.ts`

Expected: pass.

### Task 2: Admin Page Simulator Controls

**Files:**
- Modify: `ui/src/hooks/useAdminTabGates.ts`
- Modify: `ui/src/app/(app)/admin/page.tsx`
- Test: add focused React hook/page assertions if existing test seams allow it; otherwise keep endpoint coverage and lint.

- [ ] **Step 1: Write failing hook test**

Extend `useAdminTabGates` tests so `refresh` and initial fetch include simulation query params when a simulation target is supplied.

- [ ] **Step 2: Verify red**

Run: `npm test -- hooks/__tests__/useAdminTabGates.test.ts`

Expected: fail because the hook has no simulation input.

- [ ] **Step 3: Implement hook params**

Let `useAdminTabGates` accept optional simulation params and append them to `/api/rbac/admin-tab-gates`.

- [ ] **Step 4: Add UI controls**

Add a compact read-only "View as" banner above Admin categories with subject type, id, relation, and exit action driven by URL params. Keep mutations unchanged; this v1 only simulates visibility/editability.

- [ ] **Step 5: Verify green**

Run: `npm test -- hooks/__tests__/useAdminTabGates.test.ts`

Expected: pass.

### Task 3: Documentation

**Files:**
- Modify: `docs/docs/security/rbac/architecture.md`
- Modify: `docs/docs/security/rbac/usage.md`

- [ ] **Step 1: Document behavior**

Add a short section explaining that simulator mode evaluates real OpenFGA effective permissions for selected users/teams, is read-only, and does not use Keycloak impersonation.

- [ ] **Step 2: Verify docs are consistent**

Run targeted tests/lints already used above; no docs build required unless time allows.

### Self-Review

- Spec coverage: covers existing Admin tab path, real user/team effective permissions, read-only v1, and OpenFGA-only simulation.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: simulation subject uses `type`, `id`, and optional `relation`; OpenFGA user string uses existing `user:<sub>` and `team:<slug>#relation` conventions.
