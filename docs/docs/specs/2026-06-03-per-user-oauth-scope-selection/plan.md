# Implementation Plan: Per-User OAuth Scope Selection

**Branch**: `2026-06-03-per-user-oauth-scope-selection` (authored on `main`, no feature branch yet) | **Date**: 2026-06-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-06-03-per-user-oauth-scope-selection/spec.md`

## Summary

Let a user choose, **at connect time**, which scopes their OAuth connection requests — via an **"Advanced settings"** control in "My Connections" — bounded by the connector's existing `scopes` (narrow-only; default = full set). Persist the user's `requestedScopes` (and `grantedScopes` when returned) on the per-user `provider_connection` so the choice survives **relink** and is shown in the UI. The connector document is unchanged; its `scopes` array is the allowed upper bound. The access token works without the stored copy (the IdP encodes granted scopes in the token); persistence exists for relink fidelity, display, and auditing.

## Technical Context

**Language/Version**: TypeScript / Next.js 16 + React 19 (CAIPE UI + BFF route handlers); Node 20+.
**Primary Dependencies**: NextAuth session/JWT auth, MongoDB driver (`getCollection`), existing `OAuthConnectorService` / `ProviderConnectionService` in `ui/src/lib/credentials/oauth-service.ts`, OpenFGA baseline access for admin surfaces (not needed for the user path).
**Storage**: MongoDB `provider_connections` collection — **additive** fields `requestedScopes: string[]` and optional `grantedScopes: string[]`. `oauth_connectors` unchanged. No index change. Backward compatible (absent ⇒ connector default).
**Testing**: Jest + React Testing Library (`*.test.tsx`, route `*.test.ts`) under `ui/src/`; run via `make caipe-ui-tests` / `npm test`. `npm run lint`.
**Target Platform**: Next.js app (Docker + Helm), MongoDB-backed.
**Project Type**: Web (frontend + BFF in one Next.js app).
**Performance Goals**: No added latency on connect; one extra small field on a document already written at connect/callback time.
**Constraints**: Per-user selection MUST stay **bounded by `connector.scopes`** (no privilege escalation); empty selection rejected; GitHub `offline_access` authorization filter preserved; existing connections and the "didn't open advanced settings" path behave exactly as today.
**Scale/Scope**: Handful of providers; localized change to one service file, one connect route, one callback path, two UI components, plus tests + RBAC docs.

## Constitution Check

*GATE: Must pass before Phase 0. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Worse is Better | PASS — reuse `startConnection`/`completeConnection`; add an optional `scopes` arg + two persisted fields. No new abstraction. |
| II. YAGNI | PASS — narrow-only within `connector.scopes`; the richer scope *catalog* and admin-edit UI are explicitly deferred. |
| III. Rule of Three | PASS — scope validation/normalization centralized as one helper in `oauth-service.ts`, reused by start + persistence. |
| IV. Composition over Inheritance | PASS — pure helper for `boundScopes(connector, requested)`; no inheritance. |
| V. Specs as Source of Truth | PASS — spec/plan precede code. |
| VI. CI Gates | PASS (planned) — `npm run lint` + Jest (service, route, components) in verify. |
| VII. Security by Default | PASS — server-side bound to `connector.scopes` (FR-004), empty rejected, no privilege escalation; users can only **narrow**. Token handling unchanged; secrets untouched. Stored scopes are non-sensitive. |

Coding practices: explicit types on new service signatures, no `any`, named constant for default selection, no secret logging.

**Result: PASS — Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-06-03-per-user-oauth-scope-selection/
├── plan.md              # This file
├── spec.md              # Feature spec
├── data-model.md        # provider_connections additive fields + bounding rule
├── contracts/
│   └── api-contracts.md  # connect route query/contract + service signatures
└── tasks.md             # ordered, testable tasks
```

### Source Code (repository root) — concrete touch points

```text
# Data + service (the bounding rule + persistence live here)
ui/src/lib/credentials/oauth-service.ts
  - ProviderConnectionDocument: add requestedScopes?: string[]; grantedScopes?: string[]
  - boundScopes(connectorScopes, requested): subset-only, non-empty, dedup/trim   (NEW helper)
  - startConnection(input + optional scopes): bound → authorizationScopes() → URL  (EXTEND)
  - completeConnection(...): persist requestedScopes (+ grantedScopes from token response)  (EXTEND)
  - getConnectionsForOwner / metadata: surface requestedScopes for display          (EXTEND)

# BFF route (accept the user's selection at connect/relink time)
ui/src/app/api/credentials/oauth/[provider_key]/connect/route.ts
  - read optional ?scopes=a,b,c (or repeated ?scope=), pass to startConnection
ui/src/app/api/credentials/oauth/[provider_key]/callback/route.ts
  - thread granted scopes (if present in token response) into completeConnection
ui/src/app/api/credentials/connections/route.ts
  - include requestedScopes in the per-connection response (display + pre-fill)
ui/src/app/api/credentials/oauth-connectors/route.ts
  - include connector.scopes (allowed set) so the editor can render toggles   (was stripped)

# UI (the "Advanced settings" control)
ui/src/components/credentials/ProviderConnections.tsx
  - per-provider collapsible "Advanced settings": scope checkboxes (allowed = connector.scopes,
    pre-selected = stored requestedScopes ?? all); pass selection to connect popup;
    show "connected with: …" + "relink to apply" hint

# Tests
ui/src/lib/credentials/__tests__/oauth-service.test.ts          # boundScopes, startConnection w/ subset, persistence
ui/src/app/api/credentials/oauth/[provider_key]/connect/__tests__ # route passes & rejects scopes
ui/src/components/credentials/__tests__/ProviderConnections.test.tsx # advanced UI + relink pre-fill

# Docs (RBAC living-doc rule)
docs/docs/security/rbac/architecture.md   # Component for credentials: per-user scope selection + new fields
docs/docs/security/rbac/file-map.md       # note the connect route + ProviderConnections scope editor
```

**Structure Decision**: All changes are in the existing Next.js `ui/` app — the credentials service (`oauth-service.ts`), four BFF route handlers, two React components, tests, and RBAC docs. No new packages, no Python changes (MCPs consume the resulting token unchanged via `X-CAIPE-Provider-Token`).

## Database migrations

*No `db-migration.md` needed — additive, backward-compatible fields only.* `provider_connections` gains optional `requestedScopes` / `grantedScopes`; documents without them are read as "connector default." No backfill, no index change. `oauth_connectors` is untouched.

## Phase 0 — Research (decisions)

Resolved by the user's choices, no open `NEEDS CLARIFICATION`:
- **Model**: per-user, connect-time selection (option B).
- **Storage**: persist `requestedScopes` on `provider_connections` (token valid without it; storage for relink/display/audit).
- **Allowed set**: equals connector `scopes` for this iteration (narrow-only); richer catalog deferred.
- **Bounding**: server-side rejection of any scope ∉ `connector.scopes`, and of empty selection.
- **GitHub**: existing `authorizationScopes()` `offline_access` filter still applied on top of the user selection.

## Phase 1 — Design & Contracts

- **data-model.md** — `provider_connections` additive fields, the `boundScopes` rule, backward-compat read semantics.
- **contracts/api-contracts.md** — the connect route's optional `scopes` input + validation/error contract; extended `startConnection` / `completeConnection` / connections-list signatures; the connectors-list response now exposing `scopes` for the editor.
- **quickstart.md** *(optional)* — manual verify: connect with a subset, confirm authorization `scope` param, relink pre-fill, out-of-bounds rejection.

## Complexity Tracking

> No constitution violations — section intentionally empty.
