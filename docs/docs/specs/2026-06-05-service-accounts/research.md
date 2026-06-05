# Phase 0 Research: Service Accounts

All items below were verified against the current codebase (not assumed). Each is a decision with
rationale and the evidence that grounds it.

## R-1 — OpenFGA identity & ownership model

**Decision**: Reuse the existing `service_account` OpenFGA type as the SA identity. Add an ownership
relation:
```
type service_account
  relations
    define owner_team: [team#member]
    define can_manage: owner_team
```
SA access grants reuse existing patterns: `service_account:<sub> can_use agent:<id>` and
`service_account:<sub> can_call tool:<server>/<tool>` (+ `tool:<server>/*` wildcard).

**Rationale**: Slack/Webex bots are already modeled as `service_account` subjects; these new
user-minted accounts are the same kind of identity with self-service management. `service_account`
is subject-only today, so adding relations is purely additive.

**Evidence**: `deploy/openfga/model.fga:29` (`type service_account`, no relations). `tool` type
(`model.fga:199-211`) — `caller` relation already lists **both** `user` and `service_account`, so
caller-keyed tool grants/checks need no model change. Subject convention confirmed in
`ui/src/lib/rbac/resource-authz.ts:147-155`.

**Alternatives rejected**: New `bot_account` type — more model churn and a second machine-identity
concept for no functional gain (Kevin/Erik decision).

## R-2 — Credential: dynamic Keycloak client per SA

**Decision**: Each SA is a dynamically-created Keycloak **confidential client** with
`serviceAccountsEnabled: true`. One client = one credential. The credential shown once = the Keycloak
`client_id` + `client_secret`. Rotation = regenerate the client secret. Revoke = delete the client.
No multi-token, no expiry in v1.

**Rationale**: "Work with Keycloak as it's meant to be." The SA is a first-class identity with its
own real JWT (client-credentials grant) — identical in kind to how Slack/Webex authenticate, just
created at runtime instead of statically in realm JSON.

**Evidence (capability verified)**:
- Admin client `caipe-platform` already holds `realm-management` role **`manage-clients`** —
  `charts/ai-platform-engineering/charts/keycloak/realm-config.json:719-735`. Sufficient to
  create/regenerate/delete clients.
- Existing admin plumbing to mirror: `ui/src/lib/rbac/keycloak-admin.ts` — `adminFetch` (l.215),
  `assertOk` (l.241), `getAdminToken` (l.192, client_credentials), `getClientByClientId` (l.845),
  and an existing `GET /clients/{id}/service-account-user` call (l.1324-1332).
- Client shape to mirror: `caipe-slack-bot` — `realm-config.json:164-187` (publicClient:false,
  serviceAccountsEnabled:true, standardFlowEnabled:false, directAccessGrantsEnabled:false).

**Net-new code (none exists today)**: `createServiceAccountClient`, `regenerateClientSecret`,
`deleteServiceAccountClient` in `keycloak-admin.ts`. Keycloak REST: `POST /clients`,
`POST /clients/{id}/client-secret`, `DELETE /clients/{id}`, `GET /clients/{id}/service-account-user`.

**Alternatives rejected**: opaque token + Mongo hash (catalog-api-keys style) → wouldn't give a real
SA JWT for downstream MCP checks. BFF-signed JWT → second issuer to trust. Token-as-Keycloak-secret
with N tokens → fights Keycloak's one-secret-per-client model and fragments identity.

## R-3 — Subject identity = JWT `sub` (no mapping table)

**Decision**: The OpenFGA subject id IS the Keycloak service-account-user `sub` (UUID). At create
time we read it back from `GET /clients/{id}/service-account-user` and write all tuples as
`service_account:<sub>`. Mongo stores the friendly name + client_id + sub for display.

**Rationale**: Zero translation layer; reuses the existing `service_account:${sub}` convention so the
same value works at every enforcement layer.

**Evidence**: BFF detection + namespacing already exists —
`ui/src/lib/jwt-validation.ts:243-249` sets `isServiceAccount` from
`preferred_username.startsWith('service-account-')`; `api-middleware.ts:476-493` propagates it into
the session; `resource-authz.ts:147-155` yields `service_account:${sub}`. So **BFF-layer authz
already works for SAs with no change.**

## R-4 — Call path: all traffic via BFF; SA JWT forwarded downstream

**Decision**: External callers present the SA's client-credentials JWT to the BFF `/api/v1/chat/*`
routes (same entry as browser + Slack/Webex). The BFF forwards the original JWT to the DA backend.

**Evidence**: `ui/src/lib/da-proxy.ts` — `authenticateRequest` reads `session.accessToken` (the
original bearer, l.106) and `buildBackendHeaders` forwards it as `Authorization: Bearer` (l.206-208).
DA backend is ClusterIP-only (verified earlier), so BFF is the only ingress. No opaque-token path
needed.

## R-5 — DA backend subject namespacing (BUG — must fix, WS-G)

**Decision**: Fix `_check_agent_use` to namespace SA subjects.

**Problem found**: `ai_platform_engineering/dynamic_agents/.../auth/openfga_authz.py:304-321`
hardcodes `"user": f"user:{subject}"`. An SA's forwarded JWT would be checked as
`user:<sub> can_use agent:<id>` and **denied**, because SA grants are `service_account:<sub> ...`.
The DA backend has **no** `isServiceAccount` detection today (the flag lives only in the BFF session
and never crosses to DA).

**Fix**: In the DA backend, detect service-account tokens from the validated JWT (via
`preferred_username` starting `service-account-`, or the `client_id` claim) and build
`service_account:<sub>` for those; keep `user:<sub>` for interactive users. Add pytest coverage.

## R-6 — Caller-keyed tool authorization (in-scope fix, WS-F)

**Decision**: Add a caller-keyed `<subject> can_call tool:<server>/<tool>` check to the bridge,
ANDed with the existing `agent:<id> can_call tool:...` check. Applies to both `user` and
`service_account` subjects (FR-012a/b).

**Evidence**: `deploy/openfga/bridge/main.py:595` builds `user = f"user:{sub}"` (hardcoded);
l.618-630 check `user→agent` then `agent→tool` — **no caller→tool check exists**. The bridge decodes
the JWT (`_decode_verified_bearer_subject`, l.321-345) but keeps only `sub`; it can additionally read
`client_id` to namespace the subject. Model already allows both subjects on `tool#caller` (R-1) — no
model change. Tests to mirror: `test_tools_call_requires_user_agent_and_agent_tool_grants` and
`test_tools_call_denies_when_agent_tool_grant_is_missing` (`test_grpc_bridge.py:247-321`). New deny
reason code `DENY_CALLER_TOOL` following the existing `_audit_decision` pattern.

**Consistency note**: BFF uses `preferred_username`, the bridge will use `client_id`. WS-F and WS-G
must apply the **same** service-account-detection rule so a given token namespaces identically at
every layer. Recommendation: prefer `client_id` presence as the canonical signal (present on all
client-credentials tokens), with `preferred_username` as corroboration; finalize in tasks.

## R-7 — UI placement & gating (OPEN — resolve in tasks)

**Finding**: The admin page (`ui/src/app/(app)/admin/page.tsx`) uses a two-level Radix tab system;
the "Settings" category is the right home for a "Service Accounts" sub-tab. Tabs are gated via
`tabGateValues` and the page is fronted by `useAdminRole()` (`canViewAdmin`/`isAdmin`).

**Tension**: Spec says self-service for **any team member** (not admin-only). So the tab's visibility
must key on "user belongs to ≥1 team," not `isAdmin`. 

**Decision (provisional)**: Mount under Settings, but gate the tab on team membership and rely on
per-action authorization (owning-team check on every BFF route) as the real control — consistent
with the spec's assumption that Admin→Settings is just *where* identity settings live. Confirm the
exact gate mechanism (and whether non-admins can currently reach `admin/page.tsx` at all) during
tasks; if the admin page itself is hard-gated to admins, the tab may need to live in a
non-admin-gated settings surface instead.

**Reusable components verified**: `Tabs`, `Dialog`, `CopyButton`, `TeamPicker`
(`ui/src/components/ui/team-picker.tsx`), `SecretValueDialog`
(`ui/src/components/credentials/`), and the fetch/`{success,data,error}` pattern
(`PlatformSettingsTab.tsx`). Grantable resources: `/api/dynamic-agents/available` (agents) and the
team-resources endpoint expose `available.tools`; the SA grantable list (WS-D) will use OpenFGA
`listOpenFgaObjects` for `user:<sub>` to be authoritative.

## R-8 — Grantable-set derivation (FR-006/007/009)

**Decision**: UI picker = `listOpenFgaObjects(user:<sub>, can_use, agent)` and the tool equivalent,
so only what the user holds is offered. Every write re-runs `checkOpenFgaTuple(user:<sub>, …)`
(FR-008). `ui/src/lib/rbac/openfga.ts` provides `listOpenFgaObjects`, `checkOpenFgaTuple`,
`writeOpenFgaTuples` — all reused, none net-new.

## Resolved risks summary

| Risk (from working notes) | Status |
|---|---|
| Keycloak admin can create clients? | ✅ Yes — `caipe-platform` has `manage-clients` |
| SA JWT validates + namespaces at BFF? | ✅ Yes — existing `isServiceAccount` path |
| DA agent-use check works for SA? | ❌ No — hardcoded `user:` → **WS-G fix required** |
| `.fga`→JSON model change for caller fix? | ✅ Not needed — `tool#caller` already allows both |
| Caller-keyed tool check exists? | ❌ No — **WS-F adds it** |
| UI self-service vs admin-gated? | ⚠️ Open — R-7, resolve in tasks |
