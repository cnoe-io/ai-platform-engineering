# Agentic Apps Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the trusted-admin Agentic Apps marketplace: persistent package registry, admin install state, Hub, Gallery, Discovery, landing, and execution enforcement.

**Architecture:** CAIPE stores trusted app packages and installation policy in MongoDB. The whole platform is gated by server-only `AGENTIC_APPS_INSTALL_ENABLED=true`; `NEXT_PUBLIC_` variants must not enable installation. When the gate is off, navigation, landing, user APIs, admin APIs, and execution return hidden/404 states. End-user routes read effective app policy for Hub/Gallery/Discovery/launch, while admin routes mutate packages/installations behind `requireAdmin`. App execution goes through the existing `/apps/:appId` proxy route, upgraded into a gateway that checks install gate, package, install, RBAC, route ownership, and health before forwarding.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MongoDB driver via existing `getCollection`, NextAuth session helpers via `api-middleware`, Jest + React Testing Library.

---

## File Structure

Create:

- `ui/src/lib/agentic-apps/manifest-validation.ts` — runtime validation for trusted admin-imported manifest JSON.
- `ui/src/lib/agentic-apps/guard.ts` — shared install-gate helper for route handlers and server components.
- `ui/src/lib/agentic-apps/builtin-packages.ts` — built-in Agentic SDLC, FinOps, and Weather Starter package metadata seeds.
- `ui/apps/weather-starter/server.mjs` — CopilotKit/AG-UI-first template app runtime.
- `ui/src/lib/agentic-apps/store.ts` — MongoDB repository helpers for packages, installations, events, and effective policy.
- `ui/src/lib/agentic-apps/access.ts` — user-specific launch eligibility and blocked reason evaluation.
- `ui/src/lib/agentic-apps/health.ts` — per-installation health check helpers.
- `ui/src/app/api/admin/agentic-apps/packages/route.ts` — admin package list/import endpoint.
- `ui/src/app/api/admin/agentic-apps/installations/route.ts` — admin installation list/create/update endpoint.
- `ui/src/app/api/admin/agentic-apps/health/route.ts` — admin health refresh endpoint.
- `ui/src/app/api/agentic-apps/packages/route.ts` — user-visible Gallery/Discovery package endpoint.
- `ui/src/app/api/agentic-apps/[appId]/route.ts` — user-visible app detail endpoint.
- `ui/src/components/agentic-apps/AgenticAppsExperience.tsx` — Hub/Gallery/Discovery shell.
- `ui/src/components/agentic-apps/AgenticAppCard.tsx` — reusable app card.
- `ui/src/components/agentic-apps/AgenticAppDetail.tsx` — app detail and launch eligibility.
- `ui/src/components/admin/AgenticAppsAdminTab.tsx` — admin management UI.
- Tests under `ui/src/__tests__/agentic-apps/`.

Modify:

- `ui/src/types/agentic-app.ts` — add package, installation, health, blocked reason, and API response types.
- `ui/src/lib/mongodb.ts` — add marketplace indexes.
- `ui/src/app/api/agentic-apps/route.ts` — return effective Hub data from MongoDB instead of env-only registry.
- `ui/src/app/(app)/apps/page.tsx` — render full Hub/Gallery/Discovery experience.
- `ui/src/app/(app)/apps/[appId]/[[...path]]/route.ts` — enforce execution gateway checks before proxying.
- `ui/src/app/(app)/page.tsx` — apply admin-selected default landing behavior.
- `ui/src/app/(app)/admin/page.tsx` — add Agentic Apps admin tab.
- `ui/env.example` — document Mongo-backed marketplace and optional built-in seed config.

---

## Task 1: Types And Manifest Validation

**Files:**
- Modify: `ui/src/types/agentic-app.ts`
- Create: `ui/src/lib/agentic-apps/manifest-validation.ts`
- Test: `ui/src/__tests__/agentic-apps/manifest-validation.test.ts`

- [ ] **Step 1: Write failing validation tests**

```ts
import { validateAgenticAppManifest } from "@/lib/agentic-apps/manifest-validation";

describe("validateAgenticAppManifest", () => {
  it("accepts a valid proxied app manifest", () => {
    const manifest = {
      id: "finops",
      displayName: "FinOps Dashboard",
      description: "Cloud cost app",
      apiVersion: "1.0",
      runtime: { kind: "proxied-next-zone", mountPath: "/apps/finops", origin: "http://localhost:3010" },
      surfaces: { showInHub: true, homeEligible: true },
      access: { tokenScopes: ["finops:read"] },
      health: { endpoint: "/healthz" },
    };

    expect(validateAgenticAppManifest(manifest)).toEqual({
      ok: true,
      manifest,
      warnings: [],
    });
  });

  it("blocks unsupported api versions and route ownership outside /apps", () => {
    const result = validateAgenticAppManifest({
      id: "bad",
      displayName: "Bad",
      description: "Bad app",
      apiVersion: "2.0",
      runtime: { kind: "proxied-next-zone", mountPath: "/admin/bad" },
      surfaces: { showInHub: true },
      access: { tokenScopes: [] },
      health: { endpoint: "/healthz" },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "apiVersion must be 1.0",
        "runtime.mountPath must start with /apps/",
      ]),
    );
  });
});
```

- [ ] **Step 2: Run the red test**

Run: `npm test -- src/__tests__/agentic-apps/manifest-validation.test.ts --runInBand`

Expected: FAIL because `manifest-validation.ts` does not exist.

- [ ] **Step 3: Implement types and validator**

Add exported types:

```ts
export type AgenticAppPackageSource = "builtin" | "admin-import" | "helm" | "api";
export type AgenticAppValidationStatus = "valid" | "warning" | "blocked";
export type AgenticAppHealthStatus = "unknown" | "healthy" | "degraded" | "unreachable";
export type AgenticAppBlockedReason =
  | "not_installed"
  | "disabled"
  | "unauthorized"
  | "unhealthy"
  | "route_conflict"
  | "unsupported_runtime";
```

Implement `validateAgenticAppManifest(input)` with strict allow-list checks:

- object shape and required string fields
- `apiVersion === "1.0"`
- `id` matches `/^[a-z0-9][a-z0-9-]{1,62}$/`
- `runtime.kind` is one of the supported runtime kinds
- `runtime.mountPath` starts with `/apps/`
- `access.tokenScopes` is an array of strings
- no secrets are accepted in manifest fields; credentials must be referenced later by policy, not embedded

- [ ] **Step 4: Verify green**

Run: `npm test -- src/__tests__/agentic-apps/manifest-validation.test.ts --runInBand`

Expected: PASS.

---

## Task 2: Mongo Store, Built-In Seeds, And Indexes

**Files:**
- Create: `ui/src/lib/agentic-apps/store.ts`
- Create: `ui/src/lib/agentic-apps/builtin-packages.ts`
- Modify: `ui/src/lib/mongodb.ts`
- Test: `ui/src/__tests__/agentic-apps/store.test.ts`

- [ ] **Step 1: Write failing store tests**

Test in-memory mocked collections for:

- `listAppPackages()`
- `upsertAppPackageFromManifest()`
- `installAppPackage()`
- `listEffectiveAppsForUser()`

Expected assertions:

```ts
expect(packages.updateOne).toHaveBeenCalledWith(
  { packageId: "finops" },
  expect.objectContaining({ $set: expect.objectContaining({ packageId: "finops" }) }),
  { upsert: true },
);

expect(installations.updateOne).toHaveBeenCalledWith(
  { appId: "finops" },
  expect.objectContaining({
    $set: expect.objectContaining({ installed: true, enabled: true }),
  }),
  { upsert: true },
);
```

- [ ] **Step 2: Run the red test**

Run: `npm test -- src/__tests__/agentic-apps/store.test.ts --runInBand`

Expected: FAIL because `store.ts` does not exist.

- [ ] **Step 3: Implement store helpers**

Use `getCollection` and these collection names:

```ts
export const AGENTIC_APP_PACKAGES_COLLECTION = "agentic_app_packages";
export const AGENTIC_APP_INSTALLATIONS_COLLECTION = "agentic_app_installations";
export const AGENTIC_APP_EVENTS_COLLECTION = "agentic_app_events";
```

Store helpers must not read secrets or accept executable code. Package import stores manifest JSON and metadata only.

- [ ] **Step 4: Add indexes**

Add to `createIndexes()` in `ui/src/lib/mongodb.ts`:

```ts
safeCreateIndex(db, "agentic_app_packages", { packageId: 1 }, { unique: true }),
safeCreateIndex(db, "agentic_app_packages", { "manifest.id": 1 }),
safeCreateIndex(db, "agentic_app_packages", { "catalog.categories": 1 }),
safeCreateIndex(db, "agentic_app_packages", { "catalog.capabilities": 1 }),
safeCreateIndex(db, "agentic_app_installations", { appId: 1 }, { unique: true }),
safeCreateIndex(db, "agentic_app_installations", { enabled: 1 }),
safeCreateIndex(db, "agentic_app_installations", { isDefaultLanding: 1 }),
safeCreateIndex(db, "agentic_app_events", { appId: 1, createdAt: -1 }),
safeCreateIndex(db, "agentic_app_events", { actorEmail: 1, createdAt: -1 }),
```

- [ ] **Step 5: Verify green**

Run: `npm test -- src/__tests__/agentic-apps/store.test.ts --runInBand`

Expected: PASS.

---

## Task 3: Admin Package And Installation APIs

**Files:**
- Create: `ui/src/lib/agentic-apps/guard.ts`
- Create: `ui/src/app/api/admin/agentic-apps/packages/route.ts`
- Create: `ui/src/app/api/admin/agentic-apps/installations/route.ts`
- Test: `ui/src/__tests__/agentic-apps/admin-api.test.ts`

- [ ] **Step 1: Write failing admin API tests**

Use the `admin-stats.test.ts` pattern: mock `getServerSession`, `isMongoDBConfigured`, and `getCollection`.

Cover:

- 401 when unauthenticated
- 403 when non-admin writes
- 503 when MongoDB is not configured
- 404 when server-only `AGENTIC_APPS_INSTALL_ENABLED` is unset/false, before admin mutations are allowed
- `GET /api/admin/agentic-apps/packages` allows `requireAdminView`
- `POST /api/admin/agentic-apps/packages` requires `requireAdmin`
- `POST /api/admin/agentic-apps/installations` requires `requireAdmin`

- [ ] **Step 2: Run red**

Run: `npm test -- src/__tests__/agentic-apps/admin-api.test.ts --runInBand`

Expected: FAIL because admin routes do not exist.

- [ ] **Step 3: Implement routes**

Route wrappers:

```ts
export const GET = withErrorHandler(async (request: NextRequest) => {
  requireAgenticAppsInstallEnabled();
  if (!isMongoDBConfigured) throw new ApiError("MongoDB is required for Agentic Apps", 503);
  return withAuth(request, async (_req, _user, session) => {
    requireAdminView(session);
    return NextResponse.json({ items: await listAppPackages() });
  });
});
```

Mutations must call `requireAdmin(session)` and append an `agentic_app_events` audit record.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/__tests__/agentic-apps/admin-api.test.ts --runInBand`

Expected: PASS.

---

## Task 4: User Gallery, Discovery, And Detail APIs

**Files:**
- Modify: `ui/src/app/api/agentic-apps/route.ts`
- Create: `ui/src/app/api/agentic-apps/packages/route.ts`
- Create: `ui/src/app/api/agentic-apps/[appId]/route.ts`
- Create: `ui/src/lib/agentic-apps/access.ts`
- Test: `ui/src/__tests__/agentic-apps/user-api.test.ts`

- [ ] **Step 1: Write failing user API tests**

Cover:

- `/api/agentic-apps` returns Hub-ready installed apps with `canLaunch`
- `/api/agentic-apps/packages` returns Gallery packages with install status
- `/api/agentic-apps/[appId]` returns detail and blocked reason when unauthorized
- user APIs return 404 when server-only `AGENTIC_APPS_INSTALL_ENABLED` is unset/false
- user/admin APIs do not honor `NEXT_PUBLIC_AGENTIC_APPS_INSTALL_ENABLED`

- [ ] **Step 2: Run red**

Run: `npm test -- src/__tests__/agentic-apps/user-api.test.ts --runInBand`

Expected: FAIL for missing routes/access resolver.

- [ ] **Step 3: Implement access resolver**

`evaluateAppAccess(user, session, package, installation)` returns:

```ts
{
  canLaunch: boolean;
  blockedReasons: AgenticAppBlockedReason[];
  href: string;
}
```

Deny by default when installation is missing, disabled, user role/group is not allowed, runtime kind is unsupported, or health policy blocks launch.

- [ ] **Step 4: Implement routes**

Use `getAuthFromBearerOrSession` or `getAuthenticatedUser` consistently with existing public authenticated APIs. Do not expose admin-only notes or raw health errors to end users.

- [ ] **Step 5: Verify green**

Run: `npm test -- src/__tests__/agentic-apps/user-api.test.ts --runInBand`

Expected: PASS.

---

## Task 5: Execution Gateway

**Files:**
- Modify: `ui/src/app/(app)/apps/[appId]/[[...path]]/route.ts`
- Test: `ui/src/__tests__/agentic-apps/proxy-route.test.ts`

- [ ] **Step 1: Extend failing proxy tests**

Add tests for:

- disabled app returns 403 with `{ error: "app_disabled" }`
- unauthorized app returns 403 with `{ error: "app_unauthorized" }`
- install gate disabled returns 404 and does not call upstream `fetch`
- unknown app returns 404
- healthy, authorized proxied app forwards to configured runtime origin
- upstream `set-cookie`, `x-frame-options`, and CSP headers are filtered

- [ ] **Step 2: Run red**

Run: `npm test -- src/__tests__/agentic-apps/proxy-route.test.ts --runInBand`

Expected: FAIL because current proxy only checks env registry.

- [ ] **Step 3: Implement gateway checks**

Check `AGENTIC_APPS_INSTALL_ENABLED` before resolving or proxying. Resolve from Mongo store. Keep the existing header filtering. Add host context headers only after authorization:

```ts
headers.set("x-caipe-app-id", appId);
headers.set("x-caipe-user-email", user.email);
headers.set("x-caipe-execution-mode", "proxy");
```

Do not forward browser cookies to app origins.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/__tests__/agentic-apps/proxy-route.test.ts --runInBand`

Expected: PASS.

---

## Task 6: Hub, Gallery, Discovery, And Detail UI

**Files:**
- Modify: `ui/src/components/agentic-apps/AgenticAppsHub.tsx`
- Create: `ui/src/components/agentic-apps/AgenticAppsExperience.tsx`
- Create: `ui/src/components/agentic-apps/AgenticAppCard.tsx`
- Create: `ui/src/components/agentic-apps/AgenticAppDetail.tsx`
- Modify: `ui/src/app/(app)/apps/page.tsx`
- Create: `ui/src/app/(app)/apps/gallery/page.tsx`
- Create: `ui/src/app/(app)/apps/[appId]/page.tsx`
- Test: `ui/src/__tests__/agentic-apps/apps-hub.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Cover:

- Hub renders Installed, Recommended, Recently launched, and Blocked sections
- Gallery supports search and category/status filter controls
- Detail page shows launch eligibility and blocked reasons
- Empty state explains admin import/register when no packages exist

- [ ] **Step 2: Run red**

Run: `npm test -- src/__tests__/agentic-apps/apps-hub.test.tsx --runInBand`

Expected: FAIL because the current Hub is a simple card grid.

- [ ] **Step 3: Implement UI**

Follow `SkillsGallery` for search/filter state and `RepoGrid` for loading/error/empty/grid states. Keep components pure and pass API response fixtures in tests.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/__tests__/agentic-apps/apps-hub.test.tsx --runInBand`

Expected: PASS.

---

## Task 7: Admin UI

**Files:**
- Create: `ui/src/components/admin/AgenticAppsAdminTab.tsx`
- Modify: `ui/src/app/(app)/admin/page.tsx`
- Test: `ui/src/__tests__/agentic-apps/admin-ui.test.tsx`

- [ ] **Step 1: Write failing admin UI tests**

Cover:

- read-only admin viewers can see packages/installations but cannot mutate
- full admins can import/register a manifest
- full admins can install, enable/disable, edit groups, and set default landing

- [ ] **Step 2: Run red**

Run: `npm test -- src/__tests__/agentic-apps/admin-ui.test.tsx --runInBand`

Expected: FAIL because `AgenticAppsAdminTab` does not exist.

- [ ] **Step 3: Implement admin tab**

Use existing admin page patterns:

- `AuthGuard`
- `useAdminRole`
- `requireAdmin` enforced server-side for mutations
- read-only state when `canViewAdmin && !isAdmin`

- [ ] **Step 4: Verify green**

Run: `npm test -- src/__tests__/agentic-apps/admin-ui.test.tsx --runInBand`

Expected: PASS.

---

## Task 8: Landing Selection

**Files:**
- Modify: `ui/src/app/(app)/page.tsx`
- Create: `ui/src/lib/agentic-apps/landing.ts`
- Test: `ui/src/__tests__/agentic-apps/landing.test.ts`

- [ ] **Step 1: Write failing landing tests**

Cover:

- no default landing returns CAIPE Home
- default landing `apps-hub` redirects/renders `/apps`
- default landing installed app redirects to `/apps/:appId`
- inaccessible default landing falls back to `/apps` with a reason
- install gate disabled leaves the normal CAIPE Home behavior unchanged

- [ ] **Step 2: Run red**

Run: `npm test -- src/__tests__/agentic-apps/landing.test.ts --runInBand`

Expected: FAIL because landing resolver does not exist.

- [ ] **Step 3: Implement landing resolver**

Keep route behavior server-side where possible. Do not redirect unauthenticated users outside existing auth flow.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/__tests__/agentic-apps/landing.test.ts --runInBand`

Expected: PASS.

---

## Task 9: Health Checks And Audit Events

**Files:**
- Create: `ui/src/lib/agentic-apps/health.ts`
- Modify: `ui/src/lib/agentic-apps/store.ts`
- Create: `ui/src/app/api/admin/agentic-apps/health/route.ts`
- Test: `ui/src/__tests__/agentic-apps/health-audit.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:

- healthy app writes `health.status = "healthy"`
- unreachable app writes `health.status = "unreachable"`
- import/install/disable/launch-denied events append to `agentic_app_events`

- [ ] **Step 2: Run red**

Run: `npm test -- src/__tests__/agentic-apps/health-audit.test.ts --runInBand`

Expected: FAIL for missing health helpers.

- [ ] **Step 3: Implement health and audit helpers**

Use bounded fetch timeout from manifest/installation health config. Log audit records with non-secret metadata only.

- [ ] **Step 4: Verify green**

Run: `npm test -- src/__tests__/agentic-apps/health-audit.test.ts --runInBand`

Expected: PASS.

---

## Task 10: Documentation, Env, And Verification

**Files:**
- Modify: `ui/env.example`
- Modify: `docs/docs/specs/2026-05-06-app-module-registry/spec.md`
- Test/verify: focused Jest suite, TypeScript, lint diagnostics

- [ ] **Step 1: Document env**

Add host config examples:

```bash
AGENTIC_APPS_INSTALL_ENABLED=true
AGENTIC_APPS_SEED_BUILTINS=agentic-sdlc,finops,weather
AGENTIC_APP_FINOPS_ORIGIN=http://localhost:3010
AGENTIC_APP_WEATHER_ORIGIN=http://localhost:3020
```

Do not document secrets or tokens as literal values.

- [ ] **Step 2: Run focused tests**

Run: `npm test -- src/__tests__/agentic-apps --runInBand`

Expected: PASS.

- [ ] **Step 3: Run TypeScript**

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 4: Read lints**

Use IDE diagnostics on edited files and fix introduced issues.

- [ ] **Step 5: Check for secrets in the new marketplace files**

Run a secret-pattern scan over:

- `ui/src/lib/agentic-apps`
- `ui/src/app/api/admin/agentic-apps`
- `ui/src/app/api/agentic-apps`
- `ui/src/components/agentic-apps`
- `ui/src/components/admin/AgenticAppsAdminTab.tsx`

Expected: no matches except intentional test fake tokens if any are split or clearly fake.

- [ ] **Step 6: Checkpoint**

Do not create a git commit unless the user explicitly asks. If a commit is requested, use a conventional commit with DCO sign-off.
