# Security Review Checklist: Enterprise RBAC (098)

**Purpose**: Repeatable verification of default-deny, fail-closed behavior, delegation boundaries, and bypass testing.  
**Evidence**: Code paths in `ui/src/lib/api-middleware.ts`, `ui/src/lib/rbac/keycloak-authz.ts`, `ui/src/lib/rbac/cel-evaluator.ts`, and related BFF routes.

## 1. Default deny (FR-002)

| # | Check | Expected | Evidence |
|---|--------|----------|----------|
| 1.1 | Call a BFF route protected by `requireRbacPermission` with **no** `accessToken` on session | **401** Authentication required; audit `DENY_NO_TOKEN` | `requireRbacPermission`: early deny when no token |
| 1.2 | Authenticated user lacks Keycloak permission **and** role fallback does not apply | **403** with denial payload; audit `DENY_NO_CAPABILITY` | `requireRbacPermission` after `checkPermission` |
| 1.3 | Empty / missing `CEL_RBAC_EXPRESSIONS` entry for a resource#scope | CEL layer **skipped** (only configured keys run) | `parseCelRbacExpressions()` + conditional `evalCel` |
| 1.4 | CEL expression configured but evaluation throws | **403** `Policy denied (CEL)`; evaluator returns false on error | `cel-evaluator.ts` catch → false; middleware `DENY_CEL` |

## 2. Fail-closed when Keycloak PDP is unavailable

| # | Check | Expected | Evidence |
|---|--------|----------|----------|
| 2.1 | Simulate Keycloak token endpoint unreachable (network drop) for UMA decision | `checkPermission` returns `DENY_PDP_UNAVAILABLE` | `keycloak-authz.ts` catch block |
| 2.2 | Same scenario inside `requireRbacPermission` | **503** "Authorization service unavailable — access denied (fail-closed)"; **no** role fallback for PDP unavailable | `api-middleware.ts`: branch on `result.reason === 'DENY_PDP_UNAVAILABLE'` |
| 2.3 | Keycloak returns HTTP **403** for permission | Treated as normal deny → **403** (or fallback if role matches), not 503 | `checkPermission` maps 403 to `DENY_NO_CAPABILITY` |

**Note**: Role **fallback** (realm role minimum for `admin_ui`, `supervisor`, `rag`) applies when PDP returns denial for other reasons—operators must not rely on fallback to compensate for a **down** PDP; the code explicitly fails closed for `DENY_PDP_UNAVAILABLE`.

## 3. Fail-closed when Agent Gateway is unavailable

| # | Check | Expected |
|---|--------|----------|
| 3.1 | MCP client cannot reach AG | Connection failure; no alternate unauthenticated path through AG |
| 3.2 | Invalid / wrong-audience JWT | AG `jwtAuth` strict mode rejects request |

(AG behavior is upstream; align monitoring with FR-013.)

## 4. No privilege escalation in OBO / delegation chain (FR-019)

| # | Check | Expected |
|---|--------|----------|
| 4.1 | Slack bot obtains OBO token for user A | Effective tool/MCP permissions must reflect **user A** entitlements, not bot service account breadth |
| 4.2 | Bearer JWT path in `getAuthFromBearerOrSession` | Comment in code: *"Bearer users get 'user' role by default; admin escalation is session-only"* — direct API Bearer calls do not gain UI bootstrap/Mongo admin by default |
| 4.3 | ASP + RBAC | If enterprise RBAC allows but ASP denies tool invocation → **deny** (deny-wins) |

**Code reference** (Bearer path):

```173:177:ui/src/lib/api-middleware.ts
    const identity = await validateBearerJWT(token);
    // Bearer users get 'user' role by default; admin escalation is session-only
    const user = { email: identity.email, name: identity.name, role: 'user' };
    return { user, session: { role: 'user' } };
```

## 5. RBAC bypass scenarios to test

| # | Scenario | Pass criteria |
|---|----------|----------------|
| 5.1 | Direct RAG server call **without** BFF | RAG must enforce JWT + per-KB / team rules (defense in depth per FR-026/FR-027) |
| 5.2 | MCP call **bypassing** Agent Gateway | Not supported in target architecture; verify nothing in prod routes MCP around AG |
| 5.3 | UI **Admin** routes without `requireRbacPermission` / admin checks | Code review: each admin route should use middleware or explicit check |
| 5.4 | `ALLOW_DEV_ADMIN_WHEN_SSO_DISABLED` in production | Must be **false** / unset in prod (`config.ts`) |
| 5.5 | Stale session after role revocation | User’s next permission check uses current token; cache TTL `RBAC_CACHE_TTL_SECONDS` (allows brief staleness—document for security reviews) |
| 5.6 | Cross-tenant header `x_tenant_id` vs `jwt.org` | AG CEL denies mismatch when both present (`config.yaml`) |

## 6. MongoDB and admin elevation

| # | Check | Expected |
|---|--------|----------|
| 6.1 | `users.metadata.role === 'admin'` | `getAuthenticatedUser` can promote to admin **after** OIDC session checks—ensure only trusted admins can write this field |
| 6.2 | MongoDB unreachable during admin check | Log warning; user may remain non-admin (does not grant access) |

## Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| Engineer | | | |
| Security | | | |
