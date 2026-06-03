---
description: "Task list for Per-User OAuth Scope Selection"
---

# Tasks: Per-User OAuth Scope Selection

**Input**: Design documents from `docs/docs/specs/2026-06-03-per-user-oauth-scope-selection/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/api-contracts.md

**Tests**: INCLUDED. Success criteria SC-001..SC-005 demand verifiable bounding, persistence, and relink behavior (TDD: write failing tests before impl where practical).

**Organization**: By user story (US1 connect-time choice, US2 persistence/relink, US3 bounding) so each is independently deliverable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1/US2/US3
- Exact file paths included.

## Path Conventions

- Service: `ui/src/lib/credentials/oauth-service.ts`
- Routes: `ui/src/app/api/credentials/…`
- UI: `ui/src/components/credentials/ProviderConnections.tsx`
- Tests: co-located `__tests__/` under each
- Docs: `docs/docs/security/rbac/`

---

## Phase 1: Setup

- [ ] T001 Confirm UI test/lint env works: `cd ui && npm ci` (if needed), `npm run lint`, `npm test -- --watchman=false oauth-service` baseline green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: The `boundScopes` helper + the additive document fields block every user story.

- [ ] T002 [Foundational] Add optional `requestedScopes?: string[]` and `grantedScopes?: string[]` to `ProviderConnectionDocument` (and its public metadata type) in `ui/src/lib/credentials/oauth-service.ts`. Backward compatible (absent ⇒ connector default).
- [ ] T003 [Foundational] Add pure `boundScopes(connectorScopes: string[], requested?: string[]): string[]` in `oauth-service.ts` per data-model.md: undefined ⇒ all; trim/dedup; reject out-of-bounds and empty with `ApiError(…, 400, "VALIDATION_ERROR")`; order follows `connectorScopes`.
- [ ] T004 [Foundational] Unit tests for `boundScopes` in `ui/src/lib/credentials/__tests__/oauth-service.test.ts` (subset ok, out-of-bounds rejected, empty rejected, undefined ⇒ all, dedup/trim).

**Checkpoint**: bounding + storage shape exist.

---

## Phase 3: User Story 1 — Choose scopes when connecting (P1) 🎯 MVP

**Goal**: A user picks a subset at connect time and the authorization request asks for exactly that set.

**Independent Test**: connector `scopes={A,B,C}`; `startConnection` with `{A,C}` ⇒ authorization URL `scope=A C` (GitHub `offline_access` filter still applies).

- [ ] T005 [US1] Extend `startConnection` to accept `requestedScopes?`, run `boundScopes`, build the URL `scope` from the bounded set (then `authorizationScopes()` GitHub filter), and return the bounded `requestedScopes`. (`oauth-service.ts`)
- [ ] T006 [US1] Tests: `startConnection` with subset sets `scope` param correctly and still strips GitHub `offline_access`. (`__tests__/oauth-service.test.ts`)
- [ ] T007 [US1] Connect route reads optional `?scopes=` and passes to `startConnection`; stash bounded set in the PKCE/state cookie. (`ui/src/app/api/credentials/oauth/[provider_key]/connect/route.ts`)
- [ ] T008 [US1] Expose connector `scopes` (allowed set) in `GET /api/credentials/oauth-connectors` response so the editor can render toggles. (`ui/src/app/api/credentials/oauth-connectors/route.ts`)
- [ ] T009 [US1] Route tests: connect passes scopes through; connectors-list includes `scopes`. (co-located `__tests__`)
- [ ] T010 [US1] UI: add collapsible **"Advanced settings"** with one checkbox per `connector.scopes` (default all checked); append `?scopes=` to the connect popup URL; disable Connect on empty. (`ProviderConnections.tsx`)
- [ ] T011 [US1] Component test: advanced panel renders toggles, connect URL carries selection, empty disables Connect. (`__tests__/ProviderConnections.test.tsx`)

**Checkpoint**: US1 independently demoable (connect with a chosen subset).

---

## Phase 4: User Story 2 — Choice survives relink and is visible (P2)

**Goal**: persist `requestedScopes`; pre-fill the editor and display it; relink defaults to the stored set.

**Independent Test**: connect `{A,C}` ⇒ reload ⇒ editor pre-checked `{A,C}` ⇒ relink requests `{A,C}`.

- [ ] T012 [US2] Persist `requestedScopes` (and `grantedScopes` from token response `scope` when present) in `completeConnection`; thread the stashed selection from callback. (`oauth-service.ts` + `…/callback/route.ts`)
- [ ] T013 [US2] Include `requestedScopes`/`grantedScopes` in `GET /api/credentials/connections` per-connection response. (`ui/src/app/api/credentials/connections/route.ts`)
- [ ] T014 [US2] UI: pre-select toggles from `connection.requestedScopes ?? connector.scopes`; show "connected with: …" and a "relink to apply scope changes" hint (FR-009). (`ProviderConnections.tsx`)
- [ ] T015 [US2] Tests: persistence on complete; connections route returns stored scopes; component pre-fills from stored value and relink carries it. (service + route + component `__tests__`)

**Checkpoint**: choice durable across relink/reload (the "do we need to store it" payoff).

---

## Phase 5: User Story 3 — Bounded & least-privilege (P3)

**Goal**: server rejects out-of-bounds/empty; editor only offers allowed set; stored scopes outside a shrunken connector set are dropped.

**Independent Test**: POST connect with a scope ∉ `connector.scopes` ⇒ `400`, no redirect.

- [ ] T016 [US3] Route test: connect with out-of-bounds scope ⇒ `400 VALIDATION_ERROR`, no authorization URL. (connect route `__tests__`)
- [ ] T017 [US3] Confirm/handle connector-shrink: `boundScopes` drops stored scopes no longer in `connector.scopes` on relink; add test. (`__tests__/oauth-service.test.ts`)
- [ ] T018 [US3] Backward-compat tests: pre-feature connection (no `requestedScopes`) and "no advanced settings" connect behave as before. (service + component)

**Checkpoint**: no privilege escalation; legacy behavior intact.

---

## Phase 6: Docs & Verify

- [ ] T019 [P] Update `docs/docs/security/rbac/architecture.md` (credentials component: per-user scope selection, allowed=connector.scopes, new persisted fields) and `docs/docs/security/rbac/file-map.md` (connect route + ProviderConnections scope editor) — RBAC living-doc rule.
- [ ] T020 Verify end-to-end: `cd ui && npm run lint && npm test` green; manual connect-with-subset + relink pre-fill against the running stack.
