# Implementation Plan: Service Accounts

**Branch**: `2026-06-05-service-accounts` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-06-05-service-accounts/spec.md`

## Summary

Self-service, team-owned **service accounts**: named bot identities with their own Keycloak
credential and their own OpenFGA-scoped access to agents and tools, bounded at creation by the
creating user's own permissions. Managed from a new **Admin → Settings → Service Accounts** tab.

Technical approach (all verified against current code — see [research.md](./research.md)):

- **Identity** = a dynamically-created Keycloak confidential client (`serviceAccountsEnabled`), one
  per service account. The client's service-account-user `sub` (UUID) is the OpenFGA subject id.
- **Authorization** = OpenFGA tuples on the existing `service_account` type (extended with an
  `owner_team` ownership relation). Grants mirror existing patterns: `service_account:<sub> can_use
  agent:<id>` and `service_account:<sub> can_call tool:<server>/<tool>`.
- **Management state** = a new Mongo `service_accounts` collection (display/metadata only; OpenFGA
  is the source of truth for access; Keycloak owns the credential).
- **Auth at call time** = the SA presents a Keycloak client-credentials JWT; the existing BFF JWKS
  path already resolves it to `service_account:<sub>`. Two server-side fixes are required for the
  identity to be honored end-to-end (DA backend + AgentGateway bridge — see below).
- **In-scope platform fix (FR-012a/b)** = add a **caller-keyed** tool-authorization check to the
  AgentGateway ext_authz bridge, ANDed with the existing agent-keyed check, for both `user` and
  `service_account` subjects. Closes a pre-existing confused-deputy gap affecting human users too.

## Technical Context

**Language/Version**: TypeScript (Next.js 14 App Router, React) for BFF + UI; Python 3.11 for the
DA backend and the OpenFGA ext_authz bridge.
**Primary Dependencies**: Next.js, MongoDB Node driver, Keycloak Admin REST API, OpenFGA HTTP API,
`jose` (JWT), Radix UI + Tailwind; Python `httpx`, `pyjwt`, FastAPI/Starlette.
**Storage**: MongoDB — new `service_accounts` collection. OpenFGA store holds authorization tuples.
Keycloak holds the client credential. (See [mongodb-migration.md](./mongodb-migration.md).)
**Testing**: Jest (TS — BFF lib + routes + components), pytest (Python — bridge + DA authz).
**Target Platform**: Kubernetes (Helm) and docker-compose; all external traffic flows through the
Next.js BFF (the DA backend is ClusterIP-only — verified).
**Project Type**: Web application (Next.js BFF/UI + Python services).
**Performance Goals**: No new latency budget beyond existing auth checks. Create/rotate/revoke are
interactive admin actions (sub-second to a few seconds incl. Keycloak round-trips). The new
caller-keyed tool check adds one OpenFGA `check` (+ one wildcard fallback) per tool call, parallel
in cost to the existing agent-keyed check.
**Constraints**: No secrets in source (Keycloak owns the credential; we never persist it). All
scope writes guarded by an OpenFGA `check` regardless of UI. Defense in depth (UI list-objects +
write-time check + runtime enforcement).
**Scale/Scope**: Tens to low-hundreds of service accounts per deployment; not a hot path.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Worse is Better / II. YAGNI** — ✅ One credential per SA (no multi-token), no expiry in v1,
  Mongo metadata only (no inline scope copies as truth). We reuse `service_account`, existing
  Keycloak admin patterns, existing JWKS validation, and the existing bridge structure rather than
  building new abstractions.
- **III. Rule of Three** — ✅ `createServiceAccountClient`/`regenerate`/`delete` are net-new but
  each is a single concrete need; we mirror existing `keycloak-admin.ts` helpers, not a framework.
- **IV. Composition over Inheritance** — ✅ Plain functions + a lib wrapper (`service-accounts.ts`)
  mirroring `catalog-api-keys.ts`. No class hierarchy.
- **V. Specs as Source of Truth** — ✅ This plan derives from the approved spec; FR references
  throughout.
- **VI. CI Gates** — ✅ New TS code covered by Jest; bridge + DA changes covered by pytest. Lint
  (ruff/eslint) applies.
- **VII. Security by Default** — ✅ Credential never stored; write-time OpenFGA `check` on every
  grant; the in-scope bridge fix *removes* a privilege-escalation surface. The SA subject is honored
  at every enforcement layer (BFF, DA, gateway).

**No violations.** Complexity Tracking table omitted.

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-06-05-service-accounts/
├── spec.md              # Approved feature spec
├── plan.md              # This file
├── research.md          # Phase 0 — verified findings + decisions
├── data-model.md        # Phase 1 — Mongo doc + OpenFGA tuples + entities
├── mongodb-migration.md # Phase 1 — collection + indexes (storage involved)
├── quickstart.md        # Phase 1 — end-to-end validation scenarios
├── contracts/
│   └── service-accounts-api.md   # BFF REST contracts
└── checklists/
    └── requirements.md  # spec quality checklist (already present)
```

### Source Code (repository root)

```text
ui/                                         # Next.js BFF + UI
├── src/lib/
│   ├── service-accounts.ts                 # NEW — Mongo lib wrapper (mirrors catalog-api-keys.ts)
│   ├── rbac/
│   │   ├── keycloak-admin.ts               # EDIT — add createServiceAccountClient/regenerate/delete/get-sa-user
│   │   └── openfga.ts                       # REUSE — checkOpenFgaTuple / listOpenFgaObjects / writeOpenFgaTuples
│   ├── mongodb.ts                           # EDIT — register service_accounts indexes
│   └── types/mongodb.ts                     # EDIT — ServiceAccount document interface
├── src/app/api/admin/service-accounts/      # NEW — BFF routes (see contracts/)
│   ├── route.ts                             #   GET (list), POST (create)
│   └── [id]/
│       ├── route.ts                         #   GET (detail), DELETE (revoke)
│       ├── rotate/route.ts                  #   POST (rotate credential)
│       └── scopes/route.ts                  #   POST (add scope), DELETE (remove scope)
├── src/app/api/admin/service-accounts/grantable/route.ts  # NEW — list user-grantable agents/tools
└── src/components/admin/
    └── ServiceAccountsTab.tsx               # NEW — tab UI (+ create dialog, see-once reveal, manage)

ui/src/app/(app)/admin/page.tsx              # EDIT — register the Service Accounts tab in CATEGORIES

ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/openfga_authz.py
                                             # EDIT — namespace subject service_account: vs user: (BUG FIX)

deploy/openfga/
├── model.fga                                # EDIT — add owner_team + can_manage to service_account
└── bridge/main.py                           # EDIT — caller-keyed tool check + subject namespacing
deploy/openfga/bridge/tests/test_grpc_bridge.py   # EDIT — new caller-keyed test cases
charts/ai-platform-engineering/charts/openfga/authorization-model.json
                                             # EDIT — recompiled model JSON (mirror model.fga)

docs/docs/security/rbac/                      # EDIT — architecture + workflows (SA identity layer)
```

**Structure Decision**: Web-application layout. The feature is BFF/UI-centric (TypeScript), with two
targeted Python edits at the enforcement layers (DA backend agent-use check; gateway bridge tool
check) and a model change. No new services.

## Workstreams & Sequencing

Ordered so each is independently testable (maps to spec user stories). **WS-A and WS-F are the two
server-side enablers**; the UI/BFF stack (WS-B…E) can be built in parallel against them.

### WS-A — OpenFGA model: ownership relation *(enables US1, US5)*
Promote `service_account` from subject-only to:
```
type service_account
  relations
    define owner_team: [team#member]
    define can_manage: owner_team
```
Recompile `model.fga` → `charts/.../authorization-model.json`; confirm `deploy/openfga/init/seed.py`
applies it. Purely additive — `service_account` as a *subject* elsewhere is unchanged.
**Verified**: `tool#caller` already permits `user` + `service_account`, so the caller-keyed fix
(WS-F) needs **no** model change beyond this ownership relation.

### WS-B — Keycloak dynamic client provisioning *(enables US1, US4)*
Add to `ui/src/lib/rbac/keycloak-admin.ts`, mirroring existing `adminFetch`/`assertOk` patterns:
- `createServiceAccountClient(name)` → `POST /clients` (confidential, `serviceAccountsEnabled: true`,
  `standardFlowEnabled: false`, `directAccessGrantsEnabled: false`), then read back the client UUID,
  its generated secret, and its `service-account-user` `sub`.
- `regenerateClientSecret(clientUuid)` → `POST /clients/{id}/client-secret` (rotation).
- `deleteServiceAccountClient(clientUuid)` → `DELETE /clients/{id}` (revoke).
**Verified**: admin client `caipe-platform` already holds `manage-clients`. Client shape mirrors
`caipe-slack-bot`. Naming: `caipe-sa-<slug>-<short-rand>`.

### WS-C — Mongo collection + lib wrapper *(enables US1, US5)*
`ServiceAccount` interface in `types/mongodb.ts`; indexes in `mongodb.ts`; `service-accounts.ts`
wrapper (create/list-by-teams/get/update-status) mirroring `catalog-api-keys.ts`. No secret/hash
stored. See [data-model.md](./data-model.md) + [mongodb-migration.md](./mongodb-migration.md).

### WS-D — BFF API routes *(enables US1–US5)*
Create/list/detail/rotate/revoke + scope add/remove + grantable-resources. Each route: authorize
caller (team membership / `service_account#can_manage`), then orchestrate Keycloak + OpenFGA + Mongo.
Every scope add re-checks `check(user:<editor>, <rel>, <obj>)` (FR-008/FR-015); removes are
unconditional for owning-team members (FR-016). See [contracts/](./contracts/service-accounts-api.md).

### WS-E — UI tab *(enables US1, US3, US4, US5)*
`ServiceAccountsTab.tsx` registered in `admin/page.tsx` CATEGORIES (settings group). Create dialog
(name, description, owning-team picker, grantable scope picker), one-time credential reveal
(`CopyButton` + see-once dialog), list, and manage view (scopes add/remove, rotate, revoke with
confirm). **Open item**: admin page is gated by `canViewAdmin`/`isAdmin` today, but the spec wants
self-service for any team member — resolved in research.md (R-7); the tab is gated on team
membership, not admin role.

### WS-F — Caller-keyed tool authorization (in-scope platform fix) *(enables US2 / FR-012)*
In `deploy/openfga/bridge/main.py`:
- Decode `client_id` from the validated JWT to namespace the subject as `service_account:<sub>` vs
  `user:<sub>`.
- After the existing `agent:<id> can_call tool:...` check, ADD a caller-keyed check
  `<subject> can_call tool:<server>/<tool>` (with `tool:<server>/*` wildcard fallback). A tool call
  is allowed only if **both** pass. New deny reason `DENY_CALLER_TOOL`.
- Mirror existing tests in `test_grpc_bridge.py` for user-missing-tool, SA-success, SA-missing-tool.
**Verified**: model already allows both subjects on `tool#caller`; no model change here.

### WS-G — DA backend subject namespacing (bug fix) *(enables US2 / FR-011)*
`ai_platform_engineering/dynamic_agents/.../auth/openfga_authz.py` `_check_agent_use` currently
hardcodes `user:{subject}`. Detect service-account tokens (via `preferred_username` starting
`service-account-` or the `client_id` claim) and check `service_account:<sub> can_use agent:<id>`
for them. Without this, agent invocation by an SA is wrongly denied. Add pytest coverage.

### WS-H — Docs
`docs/docs/security/rbac/architecture.md` (SA identity layer) + `workflows.md` (create + external
call sequence diagrams, and the new dual agent+caller tool check).

## Database migrations

See [mongodb-migration.md](./mongodb-migration.md). Summary: additive — one new collection
(`service_accounts`) with indexes created on first connect via the existing `createIndexes()` path
in `ui/src/lib/mongodb.ts`. No backfill, no data movement. Rollback = drop the collection; OpenFGA
tuples and Keycloak clients are cleaned up by revoke flows (or manually) and are independent of the
Mongo collection.

## Complexity Tracking

No constitution violations — table omitted.

## Open items carried to /speckit.tasks

- **R-7 (UI gating)**: confirm the Service Accounts tab is shown on team membership, not `isAdmin`
  — may need a small gate addition (`canViewAdmin` currently fronts the admin page). See research.md.
- **Subject-detection consistency**: BFF uses `preferred_username` (`service-account-`); the bridge
  will use `client_id`. Ensure DA backend (WS-G) and bridge (WS-F) agree on the rule so the same
  token always namespaces identically across layers. Tracked in research.md R-2/R-3.
- **Team-deletion guard (FR-025)**: where to enforce — locate the team-delete path and add the
  "owns service accounts?" check. Not yet code-located; flagged for tasks.
