# PDP Coverage Audit — UI BFF `/api/*` Routes

**Status:** Living audit, last refreshed 2026-05-27. Re-run the grep snippets in the [How this audit was produced](#how-this-audit-was-produced) section whenever you change `ui/src/lib/api-middleware.ts::resolveLegacyWithAuthRbacPolicy` or add a new `/api/*` route.

**Audience:** Engineers reviewing whether a UI BFF endpoint is properly PDP-gated, and security architects checking that we never silently regressed to a Mongo-only "is admin?" decision.

**TL;DR**

1. Every production `/api/*` route in the UI BFF reaches a Policy Decision Point (PDP). There is no endpoint today that authorizes purely from MongoDB.
2. The PDP is **OpenFGA** for everything that goes through `requireRbacPermission()`, with a **Keycloak Authorization Services** fallback for routes whose target relation isn't yet modelled in OpenFGA. See [JWT and OpenFGA](./jwt-and-openfga.md) for the dual-PDP rationale.
3. Three patterns coexist today, in decreasing order of how cleanly they map to user intent:
   - **Resource-scoped PDP** (`requireResourcePermission(..., { type, id, action })`) — best.
   - **Capability-scoped PDP** (`requireRbacPermission(..., resource, scope)` or `requireAdminSurfaceManage`/etc.) — good.
   - **Catch-all `withAuth(...)`** that resolves to `supervisor#invoke` via `ui/src/lib/api-middleware.ts` — works (still PDP) but coarse. Tracked for cleanup by [`2026-05-27-fine-grained-rbac-for-withauth-routes`](../../specs/2026-05-27-fine-grained-rbac-for-withauth-routes/plan.md).
4. A handful of routes still have an `if (user.role === 'admin') { skip PDP }` short-circuit. These are **not** Mongo-based — `session.role === 'admin'` comes from the JWT (`BOOTSTRAP_ADMIN_EMAILS` or `OIDC_REQUIRED_ADMIN_GROUP`) — but they are a parallel decision path with no OpenFGA audit trail. Listed in [Category 1](#category-1--legacy-admin-bypass-no-pdp-on-the-bypass-branch).

If you are here because something denied unexpectedly, jump straight to [How to read an `audit_event_id` row](#how-to-read-an-audit_event_id-row).

---

## How the BFF gate works

Every UI API route ends up at one of three call sites, all defined in `ui/src/lib/api-middleware.ts`:

```ts
// Pattern 1 — resource-scoped (preferred)
const { session } = await getAuthFromBearerOrSession(request);
await requireResourcePermission(session, { type: "system_config", id: "platform_settings", action: "read" });

// Pattern 2 — capability-scoped
const { session } = await getAuthFromBearerOrSession(request);
await requireRbacPermission(session, "admin_ui", "admin");

// Pattern 3 — legacy umbrella (still PDP, but via a prefix-derived policy)
return withAuth(request, async (req, user, session) => { ... });
```

`withAuth` is **not** "is the user signed in?" — it resolves the URL to a `{ resource, scope }` pair and then runs the same `requireRbacPermission()` everyone else does. The mapping (post the 2026-05-27 `platform-config` carve-out) is:

| URL prefix                                            | PDP capability the BFF enforces |
|-------------------------------------------------------|--------------------------------|
| `/api/users/debug`                                    | `admin_ui#view`                |
| `/api/admin/platform-config` (`GET`, exception)       | `supervisor#invoke`            |
| `/api/admin/*` (other `GET`)                          | `admin_ui#view`                |
| `/api/admin/*` (non-`GET`)                            | `admin_ui#manage`              |
| `/api/users/me`, `/api/users/search`                  | `supervisor#invoke`            |
| `/api/settings`, `/api/nps`                           | `supervisor#invoke`            |
| `/api/chat`                                           | `supervisor#invoke`            |
| `/api/task-configs` (`GET` / non-`GET`)               | `dynamic_agent#view` / `manage` |
| `/api/workflow-runs` (`GET` / non-`GET`)              | `dynamic_agent#view` / `invoke` |
| `/api/catalog-api-keys`                               | `skill#configure`              |
| `/api/skills/seed`                                    | `admin_ui#admin`               |
| `/api/skills/token`                                   | `skill#invoke`                 |
| `/api/skills` / `/api/skill-templates` (everything else) | `skill#view` / `delete` / `configure` |
| **fallback**                                          | `supervisor#invoke`            |

The OpenFGA relation each pair maps to is computed by `organizationRelationFor()` in the same file:

| `resource` | `scope`                | OpenFGA relation on `organization:caipe` |
|------------|------------------------|-------------------------------------------|
| `admin_ui` | `view` / `audit.view`  | `can_audit`                               |
| `admin_ui` | any other              | `can_manage`                              |
| any        | `view` / `read` / `query` / `invoke` | `can_use`                       |
| any        | `audit.view`           | `can_audit`                               |
| any        | anything else          | `can_manage`                              |

So `withAuth` on `/api/users/me` becomes an OpenFGA `check` for `user:<sub> can_use organization:caipe`. That tuple is what every signed-in member has by default.

---

## Route-by-route audit

The audit reaches every `route.ts` under `ui/src/app/api/` (excluding `__tests__/`). Routes are grouped by *what gates them*, not by URL.

### Category 1 — Legacy admin bypass (no PDP on the bypass branch)

These routes contain a branch of the form `if (user.role === 'admin') { skip PDP } else { ... }`. `session.role === 'admin'` is set by the NextAuth JWT callback in `ui/src/lib/auth-config.ts` from one of:

- A match against `BOOTSTRAP_ADMIN_EMAILS`, or
- Membership in `OIDC_REQUIRED_ADMIN_GROUP` (default empty / unused).

The bypass is **not** Mongo-derived, but it is invisible to OpenFGA and produces no `audit_event_id` row. In the steady state we want every authorization decision to flow through PDP so the audit trail is complete.

| Route | File | Bypass site | Notes |
|---|---|---|---|
| `/api/workflow-configs` | `ui/src/app/api/workflow-configs/route.ts` | lines 117, 217, 265 | Skips `requireResourcePermission({ type: "task", … })` for admins on `GET`, `PUT`, `DELETE`. |
| `/api/skills/configs` | `ui/src/app/api/skills/configs/route.ts` | line 367 | Admin reads skip `requireResourcePermission({ type: "skill", id, action: "read" })`. Writes/deletes always PDP. |
| `/api/admin/teams/[id]/kb-assignments` (`GLOBAL_PSEUDO_TEAM` branch) | `ui/src/app/api/admin/teams/[id]/kb-assignments/route.ts` | lines 151, 204, 300 | The global pseudo-team branch only checks `user.role === 'admin'` — no PDP at all on that branch. |
| `/api/admin/openfga/baseline-profile` (`isAdminUser` helper) | `ui/src/app/api/admin/openfga/baseline-profile/route.ts` | line 167 | Reads `users.role === 'admin'` from MongoDB, but only as *input data* to bulk OpenFGA reconciliation. The route handler itself is gated by `withOpenFgaViewAuth` / `withOpenFgaAdminAuth`. Safe; included here for completeness. |

**Severity:** Medium. Bootstrap admins are already empowered through PDP anyway (they hold `organization:caipe#can_manage`), so the bypass doesn't actually grant additional access. The cost is the missing audit trail and a code path that future contributors might extend without realizing they're skipping the canonical PDP.

**Remediation:** Replace each bypass with a `requireResourcePermission(..., { ..., action: "admin" })` call against the resource the route mutates (or `requireRbacPermission(session, "admin_ui", "admin")` where no resource exists). The `GLOBAL_PSEUDO_TEAM` branch in `kb-assignments` should route through PDP unconditionally.

### Category 2 — `withAuth`-only routes (PDP via the legacy umbrella)

These routes look ungated at first glance — the only auth line in the file is `return withAuth(request, async (req, user, session) => { ... })` — but they ARE PDP-gated. `withAuth` runs the URL through `resolveLegacyWithAuthRbacPolicy()` and then calls `requireRbacPermission()`, which hits OpenFGA. The capability they end up enforcing is in the table at the top of this doc; almost all of them fall through to **`supervisor#invoke`** (i.e. `organization:caipe#can_use`).

| Route | File | Effective PDP capability |
|---|---|---|
| `/api/users/me` (GET / PATCH) | `ui/src/app/api/users/me/route.ts` | `supervisor#invoke` (self-scoped Mongo query is keyed on the caller's verified email — no IDOR surface) |
| `/api/users/me/insights`, `/api/users/me/favorites`, `/api/users/me/agent-*` | `ui/src/app/api/users/me/...` | `supervisor#invoke` (self-scoped) |
| `/api/users/search` | `ui/src/app/api/users/search/route.ts` | `supervisor#invoke` — returns public profile fields only (`email`, `name`, `avatar_url`); design intent is that any signed-in user can email-search the directory for sharing UIs |
| `/api/chat/conversations/[id]/messages` | `ui/src/app/api/chat/conversations/[id]/messages/route.ts` | `supervisor#invoke` at the BFF + an inline `requireRbacPermission(session, "supervisor", "invoke")` on `PATCH` |
| `/api/chat/conversations/[id]/share` | `ui/src/app/api/chat/conversations/[id]/share/route.ts` | `supervisor#invoke` at the BFF + `requireConversationResourcePermission(session, user.email, conversation, "share")` inline (real resource-scoped check) |
| `/api/settings/*`, `/api/nps/*` | `ui/src/app/api/{settings,nps}/...` | `supervisor#invoke` |
| `/api/feedback` | `ui/src/app/api/feedback/route.ts` | `supervisor#invoke` (writes the caller's own feedback row) |
| `/api/files/list`, `/api/files/content` | `ui/src/app/api/files/...` | `supervisor#invoke` (session-scoped upload tree) |
| `/api/ai/review`, `/api/ai/assist` | `ui/src/app/api/ai/...` | `supervisor#invoke` |
| `/api/credentials/{retrieve,audit,health}` | `ui/src/app/api/credentials/...` | `supervisor#invoke` at the BFF; per-credential `secret_ref#read/write` enforced inside the credential services in `ui/src/lib/credentials/` |
| `/api/credentials/connections/*`, `/api/credentials/oauth/*`, `/api/credentials/inject/*` | `ui/src/app/api/credentials/...` | Same pattern — coarse gate at BFF, resource-scoped check inside service |
| `/api/integrations/slack/.../access-check`, `/api/integrations/webex/.../access-check` | `ui/src/app/api/integrations/...` | `supervisor#invoke` — the route itself runs a delegated PDP check via `checkSlackChannelAccess` / equivalent |
| `/api/auth/role`, `/api/auth/my-roles`, `/api/auth/slack-link`, `/api/auth/webex-link` | `ui/src/app/api/auth/...` | `supervisor#invoke`; `/api/auth/role` also does an OpenFGA `checkOpenFgaTuple` on `organization:caipe#can_manage` to elevate to admin |
| `/api/dynamic-agents/models` | `ui/src/app/api/dynamic-agents/models/route.ts` | `supervisor#invoke` |
| `/api/dynamic-agents/available` | `ui/src/app/api/dynamic-agents/available/route.ts` | `supervisor#invoke` at the BFF + `filterResourcesByPermission(session, agents, { type: "agent", action: "use" })` inline |
| `/api/a2a/[[...path]]` | `ui/src/app/api/a2a/...` | `supervisor#invoke` at the BFF; A2A path runs its own JWKS validation downstream |
| `/api/version` | `ui/src/app/api/version/route.ts` | `supervisor#invoke` (read-only build metadata) |

**Severity:** Low for security, medium for hygiene. Every route IS PDP-gated; the issue is that the gate is semantically wrong for most of them. Revoking `organization:caipe#can_use` for a user disables their chat AND their ability to read their own profile, search the directory, and submit feedback — three things that have nothing to do with the supervisor.

**Remediation:** [`2026-05-27-fine-grained-rbac-for-withauth-routes`](../../specs/2026-05-27-fine-grained-rbac-for-withauth-routes/plan.md) tracks the migration to per-capability relations (`self_profile#read`, `chat_supervisor#invoke`, `user_directory#read`, `feedback#submit`, etc.). No route in this category needs an emergency fix.

### Category 3 — Properly resource-scoped PDP

These routes call a fine-grained `require*Permission` helper directly. The PDP decision matches user intent, the audit trail is precise, and revocation is granular.

| Route | File | PDP capability |
|---|---|---|
| `/api/admin/teams` | `ui/src/app/api/admin/teams/route.ts` | `requireAdminSurfaceManage(session, "teams")` |
| `/api/admin/teams/[id]` | `ui/src/app/api/admin/teams/[id]/route.ts` | `requireRbacPermission(session, "team", "view" | "manage")` |
| `/api/admin/teams/[id]/openfga/reconcile` | `ui/src/app/api/admin/teams/[id]/openfga/reconcile/route.ts` | `requireTeamMembershipManagementPermission(session, user.email, { slug })` |
| `/api/admin/users/[id]/role` | `ui/src/app/api/admin/users/[id]/role/route.ts` | `requireRbacPermission(session, "admin_ui", "admin")` |
| `/api/admin/stats` | `ui/src/app/api/admin/stats/route.ts` | `requireAdminSurfaceManage(session, "stats")` |
| `/api/admin/openfga/baseline-profile` | `ui/src/app/api/admin/openfga/baseline-profile/route.ts` | `withOpenFgaViewAuth` / `withOpenFgaAdminAuth` |
| `/api/admin/credentials/secrets/*`, `/api/admin/credentials/oauth-connectors/*` | `ui/src/app/api/admin/credentials/...` | Resource-scoped via the credential services |
| `/api/admin/platform-config` | `ui/src/app/api/admin/platform-config/route.ts` | `requireResourcePermission(session, { type: "system_config", id: "platform_settings", action: "read" })` on `GET`; `admin_ui#admin` + `system_config#admin` on `PATCH` |
| `/api/admin/teams/[id]/kb-assignments` (non-global branch) | `ui/src/app/api/admin/teams/[id]/kb-assignments/route.ts` | `requireRbacPermission(session, "admin_ui", "admin")` OR canonical team-admin via `findUserRoleInTeam` (per [`2026-05-26-canonical-team-membership`](../../specs/2026-05-26-canonical-team-membership/plan.md)) |
| `/api/rag/[...path]` | `ui/src/app/api/rag/[...path]/route.ts` | `requireRbacPermission` for the parent capability + `requireResourcePermission` per datasource |
| `/api/rag/tools` | `ui/src/app/api/rag/tools/route.ts` | `requireRbacPermission(session, "rag", "tool.*")` |
| `/api/skill-hubs/*`, `/api/skill-hubs/[id]/refresh` | `ui/src/app/api/skill-hubs/...` | `requireBaselineAdminSurfaceRead(session, "skills")` / `requireAdminSurfaceManage(session, "skills")` |
| `/api/dynamic-agents/teams` | `ui/src/app/api/dynamic-agents/teams/route.ts` | `requireResourcePermission(session, { type: "organization", id: caipeOrgKey(), action: "manage" })` |
| `/api/chat/conversations/[id]/share` (PATCH/DELETE) | `ui/src/app/api/chat/conversations/[id]/share/route.ts` | `requireConversationResourcePermission(session, user.email, conversation, "share" | "manage")` |

This is the shape every route should reach over time.

### Category 4 — Hybrid Mongo + PDP (intentional)

A few admin routes still consult the `teams` collection or canonical `team_membership_sources` reader inline. These are **not** legacy holdouts; they're intentional, scoped to team-membership questions that the [`2026-05-26-canonical-team-membership`](../../specs/2026-05-26-canonical-team-membership/plan.md) refactor moved to a canonical Mongo store. The reader is `findUserRoleInTeam` in `ui/src/lib/rbac/team-membership-store.ts`, and it's used alongside a fall-through to organization-level PDP:

```ts
const canAdmin = await requireRbacPermission(session, "admin_ui", "admin").then(() => true, () => false);
const role = await findUserRoleInTeam(team.slug, { user_email: normalizeEmail(email) });
if (!canAdmin && role !== "admin") {
  throw new ApiError("You do not have permission …", 403);
}
```

This is the supported pattern until team-membership tuples themselves live in OpenFGA. Don't refactor these without coordinating with the canonical-team-membership migration.

---

## How to read an `audit_event_id` row

Every `requireRbacPermission()` and `requireResourcePermission()` call writes an audit row via `logAuthzDecision()` in `ui/src/lib/rbac/audit.ts`. Rows live in MongoDB `rbac_audit_events` and the structured Next.js log.

A typical allow row looks like:

```json
{
  "subject_hash": "sha256:9accc8a00ffe…",
  "capability": "system_config:platform_settings#read",
  "outcome": "allow",
  "reason_code": "OK",
  "pdp": "openfga",
  "email": "viewer@example.com",
  "tenantId": "default",
  "audit_event_id": "ae_2026-05-27T06:26:14.082Z_…"
}
```

Useful filters when troubleshooting:

- **`capability: supervisor#invoke`** is noisy by design — it covers most Category 2 routes today. Once `2026-05-27-fine-grained-rbac-for-withauth-routes` lands, this string will fragment into `self_profile#read`, `chat_supervisor#invoke`, `feedback#submit`, etc., and the noise floor drops.
- **`pdp: openfga` vs `pdp: keycloak`** — `keycloak` only appears as a fallback when OpenFGA returned `DENY_NO_CAPABILITY` and the route still wants to consult Keycloak Authorization Services. If you see a route consistently using `keycloak`, its target relation is missing from the OpenFGA model.
- **`reason_code: DENY_PDP_UNAVAILABLE`** means OpenFGA returned an error. The user gets a 503, not a 403. Treat it like an SLO incident, not a policy bug.

---

## How this audit was produced

To re-run from a clean clone:

```bash
# 1. List every production route file that touches a role/admin pattern.
rg -l 'requireAdmin|isAdmin\(|userRole|getUserRole|session\.role\s*===\s*.admin|role:\s*.admin' \
   ui/src/app/api --type ts -g '!**/__tests__/**' -g '!**/*.test.ts'

# 2. List routes whose only auth line is withAuth (Category 2 candidates).
for f in $(rg -l '' ui/src/app/api --type ts -g 'route.ts' -g '!**/__tests__/**'); do
  if ! rg -q 'requireRbacPermission|requireResourcePermission|requireAdmin|withOpenFga|requireAdminSurface' "$f"; then
    echo "  $f"
  fi
done

# 3. For each candidate, confirm whether withAuth or getAuthFromBearerOrSession is present.
#    If neither, the route is genuinely ungated and that IS a bug.
```

When you add a new `/api/*` route:

1. Pick the smallest `require*Permission` helper that matches user intent. Resource-scoped is best.
2. If the route falls back to `withAuth`, add an explicit entry in `resolveLegacyWithAuthRbacPolicy` rather than relying on the `supervisor#invoke` catch-all.
3. Add a route test that mocks `checkOpenFgaTuple` and asserts the relation that was requested. The pattern is in `ui/src/lib/__tests__/api-middleware.test.ts` under `withAuth › legacy RBAC policy resolution`.
4. Append a row to the right table in this audit doc.

---

## Related

- [Architecture — UI section](./architecture.md) — bigger picture of the BFF tier and where this audit fits.
- [JWT and OpenFGA](./jwt-and-openfga.md) — how identity is carried from Keycloak through to the PDP.
- [OpenFGA Permission Evaluation](./openfga-permission-evaluation.md) — what actually happens inside an OpenFGA `check`.
- [Roles vs Scopes](./roles-scopes-comparison.md) — the model the resolver maps URLs into.
- [Feasibility — Remote PDP options](./feasibility-pdp-options.md) — why we picked OpenFGA for the data plane in the first place.
- [`2026-05-27-fine-grained-rbac-for-withauth-routes` plan](../../specs/2026-05-27-fine-grained-rbac-for-withauth-routes/plan.md) — migration path for Category 2.
- [`2026-05-26-canonical-team-membership` plan](../../specs/2026-05-26-canonical-team-membership/plan.md) — context for the Category 4 hybrid pattern.
