# Implementation Plan: OpenFGA Relationship Backfill

**Branch**: `release/0.5.1` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `docs/docs/specs/2026-05-16-openfga-relationship-backfill/spec.md`

## Summary

Upgrade the existing universal ReBAC backfill into a production-safe OpenFGA relationship migration. The migration will read MongoDB team/resource/default-agent state, derive idempotent OpenFGA tuples and Mongo provenance records, support dry-run and forced reconciliation modes, record first-run migration status, and grant all authenticated users access to the configured default dynamic agent via a typed wildcard relationship supported by the authorization model.

## Technical Context

**Language/Version**: TypeScript 5.x / Node 20+ for the migration script; OpenFGA model DSL schema 1.1  
**Primary Dependencies**: MongoDB Node driver, existing OpenFGA HTTP API conventions, existing CAIPE RBAC Mongo schemas  
**Storage**: MongoDB (`teams`, `team_membership_sources`, `rebac_relationships`, `platform_config`, new migration-status collection) and OpenFGA tuple store  
**Testing**: Node test runner with `ts-node/register` for deterministic derivation/unit tests; dry-run CLI execution for operator verification  
**Target Platform**: Operator-run repository script in local, staging, and production environments  
**Project Type**: CLI migration/backfill script plus authorization model update and documentation  
**Performance Goals**: Process existing team/resource assignments without loading unrelated collections; report counts for every relationship category  
**Constraints**: Fail closed on missing OpenFGA model support, missing Mongo config, OpenFGA unavailability during apply, or invalid default-agent target  
**Scale/Scope**: Current installation team/resource graph; script should remain safe for hundreds of teams and thousands of generated tuples

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Worse is Better / YAGNI**: Pass. Extend the existing backfill path instead of introducing a new migration framework.
- **Rule of Three**: Pass. Keep tuple derivation explicit by resource type; only abstract repeated tuple construction helpers.
- **Composition over Inheritance**: Pass. Prefer pure derivation functions and small writer adapters over class hierarchies.
- **Specs as Source of Truth**: Pass. This plan follows the new spec and keeps tasks grounded in acceptance scenarios.
- **CI Gates Are Non-Negotiable**: Pass. Add focused unit tests for derivation and migration control flow.
- **Security by Default**: Pass. Validate identifiers, avoid secrets in source, fail closed on authorization-store errors, and do not weaken existing relationships.

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-05-16-openfga-relationship-backfill/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── mongodb-migration.md
├── contracts/
│   └── openfga-relationship-backfill.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
deploy/openfga/
└── model.fga

scripts/
├── backfill-universal-rebac.ts
└── __tests__/
    └── backfill-universal-rebac.test.ts

docs/docs/security/rbac/
├── architecture.md
├── file-map.md
└── usage.md
```

**Structure Decision**: Keep the migration in the existing `scripts/backfill-universal-rebac.ts` entry point to preserve operator familiarity, but refactor it into testable derivation and writer helpers within the same script unless task execution reveals a clearer local pattern for script modules.

## Database Migrations

**Deliverable**: [mongodb-migration.md](./mongodb-migration.md)

This feature includes a data migration/backfill rather than a schema-only change. It will upsert Mongo provenance records, write a durable migration-status document, and write idempotent OpenFGA tuples. It does not require destructive collection changes.

## Phase 0: Research Summary

See [research.md](./research.md).

Key decisions:

- Use the existing default-agent precedence from the platform-config feature: persisted `platform_config.default_agent_id`, then `DEFAULT_AGENT_ID`, then supervisor fallback.
- Represent "every user can use the default agent" with an OpenFGA typed wildcard tuple, requiring the `agent.can_use` relation to accept `user:*`.
- Keep the migration idempotent through deterministic tuple keys, Mongo upserts, OpenFGA duplicate-tolerant writes, and a completed migration record.

## Phase 1: Design Summary

See [data-model.md](./data-model.md), [mongodb-migration.md](./mongodb-migration.md), [quickstart.md](./quickstart.md), and [contracts/openfga-relationship-backfill.md](./contracts/openfga-relationship-backfill.md).

The design separates relationship derivation from writes:

1. Load source data and migration status.
2. Resolve default dynamic agent.
3. Derive team/resource tuples, provenance records, and optional typed wildcard default-agent tuple.
4. In dry-run mode, print a deterministic summary and exit without writes.
5. In apply mode, validate authorization model support, write OpenFGA tuples and Mongo provenance, then record completion.

## Post-Design Constitution Check

- **Simplicity**: Pass. No new framework, queue, or long-running service.
- **Security**: Pass. Apply mode fails closed before completion status is written when model support or OpenFGA writes fail.
- **Testing**: Pass. Pure derivation functions make the risky logic unit-testable without live MongoDB or OpenFGA.
- **Documentation**: Pass. RBAC docs and quickstart will explain operator verification and rollback.

## Complexity Tracking

No constitution violations requiring complexity exceptions.
