# Implementation Plan: Dynamic Agent PDP Gate

**Branch**: `release/0.5.1` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-05-16-dynamic-agent-pdp-gate/spec.md`

## Summary

Dynamic Agent start, invoke, and resume requests must be allowed only when the authenticated caller can use the selected agent. The implementation adds layered OpenFGA checks: the Next.js BFF checks `user:<sub> can_use agent:<agent_id>` before proxying execution requests, and the Dynamic Agents runtime repeats the same check before creating, invoking, or resuming runtime work. Cancellation remains authentication-only because it stops work rather than starting or continuing it.

## Technical Context

**Language/Version**: TypeScript 5.x / Node 20+ for the BFF; Python 3.11+ for Dynamic Agents  
**Primary Dependencies**: Next.js route handlers, existing BFF auth helpers, FastAPI, Starlette middleware, OpenFGA HTTP API, existing ReBAC tuple helpers  
**Storage**: Existing OpenFGA store and MongoDB-backed Dynamic Agent records; no schema migration required  
**Testing**: Jest for BFF route and helper tests; pytest for Dynamic Agents auth and route tests; existing RBAC/ReBAC validation scripts  
**Target Platform**: CAIPE web service stack running in Docker/Kubernetes environments  
**Project Type**: Web service with TypeScript BFF and Python backend runtime  
**Performance Goals**: Add one OpenFGA check per protected execution request at the boundary and one at runtime; denied requests must stop before runtime work  
**Constraints**: Fail closed on OpenFGA outage; do not log tokens or secrets; keep cancellation auth-only; preserve existing Dynamic Agent request/response behavior for authorized callers  
**Scale/Scope**: Protect three execution paths (`start`, `invoke`, `resume`) plus document and test the cancellation exception

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Worse is Better**: PASS. Reuses existing OpenFGA relationship semantics and local BFF/Dynamic Agents helpers instead of introducing a new policy system.
- **YAGNI**: PASS. Implements only `can_use` checks for start, invoke, and resume; leaves cancellation auth-only by explicit requirement.
- **Rule of Three**: PASS. The plan allows small shared helpers for repeated authorization checks across three routes.
- **Composition over Inheritance**: PASS. Adds composable helper functions/dependencies, not new class hierarchies.
- **Specs as Source of Truth**: PASS. This plan is generated from the feature spec in `docs/docs/specs/2026-05-16-dynamic-agent-pdp-gate/`.
- **CI Gates Are Non-Negotiable**: PASS. Focused Jest, pytest, RBAC/ReBAC validation, and documentation checks are required.
- **Security by Default**: PASS. Authorization fails closed, runtime does not trust the BFF as the only safeguard, and no secrets are added to source.

**Post-Design Recheck**: PASS. Phase 0 and Phase 1 artifacts keep the same scope and do not introduce unjustified complexity or unresolved clarifications.

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-05-16-dynamic-agent-pdp-gate/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── db-migration.md
├── checklists/
│   └── requirements.md
└── contracts/
    └── chat-execution-authz.md
```

### Source Code (repository root)

```text
ui/src/
├── app/api/v1/chat/
│   ├── invoke/route.ts
│   ├── stream/start/route.ts
│   ├── stream/resume/route.ts
│   ├── stream/cancel/route.ts
│   └── __tests__/routes.test.ts
└── lib/rbac/
    ├── openfga.ts
    └── openfga-agent-authz.ts

ai_platform_engineering/dynamic_agents/
├── src/dynamic_agents/
│   ├── auth/
│   │   ├── jwt_middleware.py
│   │   └── openfga_authz.py
│   └── routes/chat.py
└── tests/
    ├── test_chat_pdp_gate.py
    └── test_jwt_middleware.py

docs/docs/security/rbac/
├── architecture.md
├── workflows.md
├── file-map.md
└── usage.md

tests/rbac/
└── rbac-matrix.yaml

scripts/
└── validate-rbac-matrix.py
```

**Structure Decision**: Use the existing BFF route tree for boundary enforcement, a focused BFF OpenFGA authz helper for route reuse, a Dynamic Agents auth helper for runtime enforcement, and the existing canonical RBAC docs for operator-facing documentation.

## Database migrations

**Deliverable**: `db-migration.md` in the feature spec directory.

**Required or no-op**: No-op. This feature uses existing OpenFGA tuples and existing Dynamic Agent records. No schema, index, or data backfill is required.

**Details**: See [db-migration.md](./db-migration.md).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

## Phase 0: Research

**Output**: [research.md](./research.md)

Resolved decisions:

- Use OpenFGA `can_use` on `agent:<agent_id>` for execution authorization.
- Enforce at both the BFF boundary and Dynamic Agents runtime.
- Require validated bearer identity for runtime OpenFGA checks.
- Keep cancellation authentication-only.
- Fail closed on OpenFGA outages for start, invoke, and resume.
- Track OpenFGA route coverage without treating concrete agent resources as Keycloak realm resources.

## Phase 1: Design and Contracts

**Data model**: [data-model.md](./data-model.md)

**Contracts**:

- [contracts/chat-execution-authz.md](./contracts/chat-execution-authz.md)

**Quickstart**: [quickstart.md](./quickstart.md)

**Database migration notes**: [db-migration.md](./db-migration.md)

## Phase 2: Planning Scope for `/speckit.tasks`

The task breakdown should preserve test-first slices:

1. Add BFF OpenFGA helper tests and helper implementation.
2. Gate BFF start, invoke, and resume routes while leaving cancel auth-only.
3. Add Dynamic Agents OpenFGA runtime helper tests and implementation.
4. Gate Dynamic Agents start, invoke, and resume before runtime work.
5. Add or update ReBAC/RBAC drift validation for OpenFGA route coverage.
6. Update canonical RBAC documentation.
7. Run focused and broader verification commands from quickstart.
