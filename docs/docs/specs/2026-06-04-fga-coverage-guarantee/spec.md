# Spec: FGA Authorization Coverage Guarantee

- **Status**: In progress
- **Date**: 2026-06-04
- **Owner**: Platform Engineering / RBAC
- **Related**:
  - `docs/docs/specs/2026-06-03-unified-shareable-resource-rbac/`
  - `docs/docs/specs/2026-06-03-explicit-search-capability/`
  - `docs/docs/specs/102-comprehensive-rbac-tests-and-completion/`
  - `docs/docs/security/rbac/` (living reference)

## Overview

Make "**every current and new resource/entity type is gated by OpenFGA (FGA)**" a
**build-time invariant** rather than a code-review hope. Coverage is guaranteed by
two cooperating ideas:

1. A **single source of truth** for the set of resource types — the authored OpenFGA
   model (`deploy/openfga/model.fga`) — reconciled in CI against the deployed chart
   model, the TypeScript resource union, and the runtime resource registry.
2. **Default-deny everywhere**, verified by a coverage test so a type/route nobody
   wired up fails *closed* (HTTP 403) instead of leaking.

A new resource type therefore cannot be introduced silently: adding it to the model
forces it through registration, classification, an ownership-write path, and a
default-deny assertion, each enforced by an existing CI gate.

## Motivation

The repo already has strong **model-shape** guards (`shareable-type-drift.test.ts`,
the `rebac/*-contract.test.ts` suite, the single-model-artifact test) and **Keycloak
matrix** coverage (`scripts/validate-rbac-matrix.py`). But several gaps mean a new
type or create-path can land without FGA enforcement:

| # | Gap | Risk |
|---|-----|------|
| 1 | `data_source` / `mcp_tool` are in the TS union + model but **missing from `UNIVERSAL_REBAC_RESOURCE_TYPES`** (`resource-model.ts`) | No registry is authoritative → nothing to lint against |
| 2 | `anonymous` exists in the **deployed chart JSON but not in authored `model.fga`** | Authored vs deployed model drift |
| 3 | No **create-path linter** — a new POST handler can persist a resource and forget to write ownership tuples | Silent ungated resource |
| 4 | The `UniversalRebacResourceType` union is **not enumerable at runtime** | Parity guards can't compare against it |
| 5 | The matrix validator tracks **only** Keycloak `requireRbacPermission`, not FGA `requireResourcePermission` / Python `authorize_*` | FGA-gated routes have no coverage assertion |
| 6 | No **runtime default-deny** assertion parametrized over the type set | A new type with no enforcement could read-allow |

## Design — four layers

### Layer 1 — One registry, reconciled to the model (foundation)

- Promote the `UniversalRebacResourceType` union to derive from a runtime `const`
  array (`UNIVERSAL_REBAC_RESOURCE_TYPE_NAMES`), so it is enumerable in tests without
  changing the exported type name or any import.
- Add the missing actionable types (`data_source`, `mcp_tool`) to
  `UNIVERSAL_REBAC_RESOURCE_TYPES` (`resource-model.ts`) and the catalog defaults
  (`resource-catalog.ts`).
- Reconcile the `anonymous` drift by adding it (empty, subject-only) to `model.fga`.
- New guard `fga-type-coverage.test.ts` asserts, for the **object types**:
  - `model.fga` type set **==** chart-JSON type set (full parity, subjects included).
  - For every model type **not** in an explicit `SUBJECT_ONLY_TYPES` allowlist
    (`user`* handled as resource; `service_account`, `anonymous` allowlisted):
    the type appears in **both** `UNIVERSAL_REBAC_RESOURCE_TYPE_NAMES` (union) **and**
    `UNIVERSAL_REBAC_RESOURCE_TYPES` (registry).
  - The allowlist itself is a subset of the model types (no stale entries).

  *Effect:* a new `type foo` in `model.fga` fails CI until it is either registered
  (and thus classified + given actions) or explicitly allowlisted as subject-only
  with a documented reason.

### Layer 2 — Per-type enforcement manifest

- A static manifest classifies every registered resource type with an
  `enforcement_status` (`rebac_enforced` | `role_gated` | `rebac_shadowed` |
  `not_gated` | `deprecated`) and the authoritative enforcement call site(s).
- Guard `fga-enforcement-manifest.test.ts` asserts:
  - Every registry type has a manifest entry (no `unclassified`).
  - Every `rebac_enforced` entry names at least one real call site that exists in the
    codebase (file path resolves).
  - `not_gated` is only allowed for an explicit, documented allowlist.

  *Effect:* the manifest is the single artifact an auditor reads to answer
  "is type X gated, and where?", and it cannot rot silently.

### Layer 3 — Create-path ownership-tuple linter

- `scripts/validate-fga-create-paths.py` (sibling of `validate-rbac-matrix.py`) scans
  BFF `route.ts` POST/PUT handlers and Python create endpoints for registered
  resource types and asserts each create path calls a tuple-write
  (`writeOpenFgaTuples` / `reconcile*Relationships` / `handleShareableResourceWrite`
  / Python `write_*_ownership`), or is on a documented allowlist with rationale.

  *Effect:* catches "persisted a resource but forgot to write ownership" — the most
  common ungated-resource bug.

### Layer 4 — Runtime default-deny coverage

- Parametrized test over `UNIVERSAL_REBAC_RESOURCE_TYPES`: a freshly-authenticated
  subject with **no tuples** is denied `read`/`use`/`manage` on each type (via the
  real `requireResourcePermission` path against a mocked/empty OpenFGA), and bypass
  flags (`CAIPE_UNSAFE_RBAC_BYPASS`, org-admin bypass) are confirmed off by default.

  *Effect:* a newly-added type is auto-covered by the default-deny backstop and fails
  until enforcement exists.

## Functional requirements

- **FR-001** The authored model, deployed chart model, TS union, and runtime registry
  MUST agree on the resource-type set, modulo a documented subject-only allowlist.
- **FR-002** Adding a type to `model.fga` MUST fail CI until it is registered or
  allowlisted (Layer 1).
- **FR-003** Every registered resource type MUST carry an enforcement classification
  with a resolvable call site for `rebac_enforced` types (Layer 2).
- **FR-004** Every create path for a registered, ownable resource MUST write ownership
  tuples or be explicitly allowlisted (Layer 3).
- **FR-005** A subject with no grants MUST be denied read/use/manage on every
  registered type by default (Layer 4).
- **FR-006** All guards MUST run in CI via `make` targets and fail the build on drift.

## Success criteria

- **SC-001** `data_source` and `mcp_tool` appear in the registry; the four-source
  parity guard passes.
- **SC-002** The `anonymous` authored/deployed drift is resolved.
- **SC-003** All four guards are green and wired into `make test-rbac-lint` / Jest.
- **SC-004** Introducing a throwaway `type probe_resource` in `model.fga` makes at
  least the Layer-1 guard fail (manually verified, then reverted).

## Test plan

- Jest: `fga-type-coverage.test.ts`, `fga-enforcement-manifest.test.ts`,
  `default-deny-coverage.test.ts`.
- Python: `scripts/validate-fga-create-paths.py` with fixture-based unit coverage.
- Negative check: temporary `probe_resource` type proves the guard bites (SC-004).

## Out of scope

- Re-architecting enforcement (no new middleware in this spec; we add guards, then
  remediate gaps incrementally under follow-up tasks).
- Migrating Keycloak-only surfaces (skills/tasks/conversations/policies create paths)
  to FGA — these are recorded as `role_gated` in the manifest and tracked separately.
- AgentGateway policy changes.
