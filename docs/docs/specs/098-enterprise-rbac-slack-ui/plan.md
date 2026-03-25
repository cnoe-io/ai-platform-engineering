# Implementation Plan: Enterprise RBAC for Slack and CAIPE UI

**Branch**: `098-enterprise-rbac-slack-ui` | **Date**: 2026-04-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/098-enterprise-rbac-slack-ui/spec.md`

## Summary

Deliver **enterprise RBAC** consistent across **Slack, CAIPE Admin UI, Supervisor, RAG, sub-agents, tools, skills, A2A, and MCP** (FR-008, FR-014), grounded in **IdP directory groups** (Okta, Entra ID) federated through **Keycloak** (required OIDC broker and PDP), with **OBO token exchange** for end-to-end user identity delegation (FR-018–FR-021, absorbed from 093), **Agent Gateway** as the required MCP/A2A/agent data-plane gateway, **RAG server Keycloak integration** with **per-KB access control** (FR-026, FR-027) providing defense-in-depth enforcement at the data layer, **dynamic agent RBAC** with three-layer Keycloak resource + per-agent roles + MongoDB visibility (FR-028), **CEL as the mandated policy engine** at all enforcement points (FR-029), and **deepagent MCP routing through Agent Gateway** (FR-030).

**Technical approach**: Dual-PDP architecture:
- **Keycloak Authorization Services** — PDP for UI/Slack paths (FR-022). The 098 permission matrix is modeled as Keycloak resources, scopes, and role-based policies. BFF and Slack bot call Keycloak AuthZ for every protected operation.
- **Agent Gateway** — PDP for MCP/A2A/agent paths (FR-013). AG validates JWTs issued by Keycloak and applies [CEL](https://agentgateway.dev/docs/reference/cel/) policy rules aligned with the 098 matrix.

**Identity flow**: Enterprise IdP (Okta/Entra) → Keycloak (federation + claim mappers: groups → roles at token issuance) → JWT (sub, act, groups, roles, scope, org) → consumed by all enforcement points. Slack identity linking stores `slack_user_id` as a Keycloak user attribute (no MongoDB dependency for the bot). OBO token exchange (RFC 8693) ensures downstream agents act as the user, not the bot.

**Architecture reference**: [architecture.md](./architecture.md)

## Technical Context

**Language/Version**: Python 3.11+ (supervisor, agents, slack-bot); TypeScript / Next.js 16 (CAIPE UI, BFF API routes)
**Primary Dependencies**:
- **Keycloak** (required) — OIDC broker, token issuance, Authorization Services (PDP), OBO token exchange, identity link storage (user attributes)
- **Agent Gateway** (required) — MCP/A2A/agent data-plane gateway, JWT validation, CEL policy
- **NextAuth.js** — OIDC integration with Keycloak for UI sessions
- **Slack Bolt** — Slack bot event handling
- **MongoDB** — team/KB ownership assignments, app metadata, ASP tool policies
**Storage**: Hybrid — **Keycloak** for authz policies (resources, scopes, permissions), realm roles, user attributes (slack_user_id); **MongoDB** for team/KB assignments, app metadata, operational state (FR-023)
**Testing**: `pytest` (Python), Jest/`npm test` (UI), integration via `make test` / `make caipe-ui-tests` per constitution
**Target Platform**: Linux containers (Kubernetes), browser clients
**Project Type**: Web application (UI + BFF) with Slack bot integration and Python backend services
**Performance Goals**: Keycloak AuthZ PDP decision p95 **< 5 ms** in-process (FR-022); permission propagation within **15 minutes** of IdP group change (SC-002)
**Constraints**: Default deny (FR-002); no secrets in repo; same canonical group claims across all paths (FR-012); OWASP-aligned UI; fail-closed when Keycloak or AG unavailable; Agent Gateway required for MCP/A2A/agent traffic (FR-013); permission matrix covers all FR-008/FR-014 components
**Scale/Scope**: Multi-tenant org model (FR-020); permission matrix for Slack, Admin UI, Supervisor, RAG, sub-agents, tools, skills, A2A, MCP; team-scoped RAG tool admin (FR-009); OBO delegation chains (FR-018–FR-019)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|--------|
| I. Specifications as source of truth | **Pass** | [spec.md](./spec.md) + this plan + [architecture.md](./architecture.md) drive implementation |
| II. Agent-first | **Pass** | RBAC gates **before** supervisor/sub-agent dispatch; does not redefine graph semantics |
| III. MCP security | **Pass** | MCP tool list/invoke gated by Agent Gateway; least-privilege tool exposure via 098 matrix |
| IV. LangGraph | **N/A** | No new graph requirement |
| V. A2A | **Pass** | A2A operations are matrix rows; protocol unchanged; OBO JWT forwarded through chain |
| VI. Skills | **Pass** | Skills in FR-014 scope where product exposes them |
| VII. Test-first | **Pass** | Matrix scenarios → automated tests before merge; acceptance criteria from spec drive test cases |
| VIII. Structured documentation | **Pass** | All artifacts under this feature directory |
| IX. Security by default | **Pass** | Deny by default, audit records, least privilege, no cross-team tool edits, HTTPS-only linking URLs |
| X. Simplicity | **Pass (with justification)** | Keycloak is a new required service but consolidates OIDC brokering, OBO, PDP, and identity link storage — avoiding a custom `caipe-authorization-server`. AG is required upstream infrastructure for MCP/A2A security. See Complexity Tracking below. |

**Post–Phase 1 re-check**: Design artifacts ([data-model.md](./data-model.md), [contracts/](./contracts/)) align with dual-PDP model. No unjustified new microservice beyond Keycloak (required broker) and AG (required gateway).

**Post–Phase 10 addition (Session 2026-03-24)**: RAG server Keycloak JWT integration (FR-026) and per-KB access control (FR-027) added as Phase 10 / User Story 7 (P1). Defense-in-depth: BFF coarse AuthZ + RAG server fine-grained per-KB enforcement + query-time filtering. See [architecture.md § Map RAG RBAC to Keycloak](./architecture.md#map-rag-rbac-to-keycloak--per-kb-access-control-architecture-overview).

**Post–Phase 11 addition (Session 2026-03-25)**: Dynamic agent RBAC (FR-028), CEL as mandated policy engine (FR-029), and deepagent MCP routing through AG (FR-030) added as Phase 11 / User Story 8 (P1). Three-layer Keycloak resource + per-agent roles + MongoDB visibility model. CEL evaluators embedded in all services (AG, RAG, dynamic agents, BFF). See [architecture.md § Dynamic Agent RBAC](./architecture.md#dynamic-agent-rbac-architecture-fr-028-fr-029-fr-030).

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/098-enterprise-rbac-slack-ui/
├── plan.md              # This file
├── spec.md              # Feature specification (25 FRs, 9 SCs, 5 user stories)
├── architecture.md      # Canonical architecture diagrams and flow tables
├── research.md          # Phase 0: decisions (PDP placement, IdP claims, AG mandate)
├── data-model.md        # Phase 1: entities (principals, roles, audit, Keycloak AuthZ model)
├── quickstart.md        # Phase 1: local verification of RBAC matrix
├── contracts/
│   └── rbac-authorization-v1.md  # Internal authorization check contract (dual-PDP)
├── checklists/
│   └── requirements.md  # Specification quality checklist
├── permission-matrix.md # 098 permission matrix (FR-008, FR-014) — generated during implementation
├── operator-guide.md    # FR-017 deployment documentation — generated during implementation
└── tasks.md             # Task list (/speckit.tasks output)
```

### Source Code (repository root)

```text
ui/
├── src/
│   ├── app/api/auth/[...nextauth]/route.ts   # NextAuth + Keycloak OIDC
│   ├── app/api/rbac/permissions/route.ts      # BFF: user capabilities endpoint
│   ├── app/api/admin/audit/route.ts           # Audit query/export API
│   ├── app/api/admin/roles/route.ts           # Role CRUD (FR-024)
│   ├── app/api/admin/roles/[name]/route.ts    # Role detail/delete
│   ├── app/api/admin/role-mappings/route.ts   # Group-to-role mapping CRUD (FR-024)
│   ├── app/api/admin/role-mappings/[id]/route.ts  # Mapping delete
│   ├── app/api/admin/teams/[id]/roles/route.ts    # Team role assignment
│   ├── app/api/rag/                           # RAG tool CRUD (team-scoped RBAC)
│   ├── app/(app)/admin/                       # Admin pages (RBAC-gated)
│   ├── app/(app)/knowledge-bases/             # KB management (team-scoped)
│   ├── lib/api-middleware.ts                  # BFF middleware (extend for Keycloak AuthZ)
│   ├── lib/auth-config.ts                     # NextAuth OIDC config (Keycloak provider)
│   ├── lib/rbac/
│   │   ├── keycloak-authz.ts                  # Keycloak Authorization Services client
│   │   ├── keycloak-admin.ts                  # Keycloak Admin REST API client (FR-024)
│   │   ├── types.ts                           # Permission matrix TypeScript types
│   │   ├── error-responses.ts                 # Denied-action feedback
│   │   └── audit.ts                           # Structured audit event logger
│   ├── hooks/useRbacPermissions.ts            # React hook for capability-based UI
│   ├── components/auth-guard.tsx              # Conditional rendering guard
│   └── components/admin/
│       ├── RolesAccessTab.tsx                 # Admin tab: roles, mappings, team assignments (FR-024)
│       ├── CreateRoleDialog.tsx               # New role dialog
│       └── GroupRoleMappingDialog.tsx         # New group-to-role mapping dialog
└── tests/

ai_platform_engineering/
├── knowledge_bases/rag/
│   ├── server/src/server/
│   │   ├── rbac.py                              # Extended: Keycloak role mapper, per-KB access, query filter (FR-026, FR-027)
│   │   └── restapi.py                           # Extended: per-KB access dependencies on KB endpoints
│   └── common/src/common/models/
│       └── rbac.py                              # Extended: KeycloakRole constants, KbPermission model, UserContext.kb_permissions
├── dynamic_agents/src/dynamic_agents/
│   ├── auth/
│   │   ├── access.py                              # Extended: CEL-based access evaluation replacing can_view_agent/can_use_agent (FR-028, FR-029)
│   │   └── auth.py                                # Extended: Keycloak role mapper, per-agent role extraction from JWT (FR-028)
│   ├── services/
│   │   └── agent_runtime.py                       # Extended: OBO JWT forwarding through LangGraph to MCP client (FR-030)
│   └── models.py                                  # Extended: Keycloak resource sync on agent create/delete (FR-028)
├── integrations/slack_bot/
│   ├── app.py                                 # Slack bot entry (identity linking callback, RBAC middleware)
│   └── utils/
│       ├── keycloak_admin.py                  # Keycloak Admin API client (user attribute ops)
│       ├── keycloak_authz.py                  # Keycloak AuthZ Services client (PDP)
│       ├── identity_linker.py                 # Slack identity linking (FR-025)
│       ├── obo_exchange.py                    # OBO token exchange (RFC 8693)
│       ├── rbac_middleware.py                 # RBAC enforcement middleware
│       └── audit.py                           # Structured audit event logger
├── multi_agents/platform_engineer/
│   └── protocol_bindings/a2a/agent_executor.py  # OBO JWT forwarding through delegation chain
├── knowledge_bases/rag/
│   ├── server/src/server/rbac.py              # RAG server RBAC (extend for team/KB scope)
│   └── common/src/common/models/rbac.py       # RBAC data models
└── utils/

deploy/
├── keycloak/
│   ├── docker-compose.yml                     # Keycloak dev instance
│   └── realm-config.json                      # Realm export: IdP brokers, mappers, roles, AuthZ
└── agentgateway/
    ├── docker-compose.yml                     # AG dev instance
    └── config.yaml                            # AG config with Keycloak OIDC + inline CEL rules (098 matrix)
```

**Structure decision**: Extend existing UI BFF (`ui/src/lib/`) and Slack bot (`ai_platform_engineering/integrations/slack_bot/`) with Keycloak AuthZ clients. New `ui/src/lib/rbac/` directory for authorization utilities. Agent Gateway and Keycloak configs under `deploy/`. No new microservices — Keycloak and AG are external required infrastructure.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Keycloak as required infrastructure (Principle X) | Consolidates OIDC brokering, OBO token exchange, groups→roles mapping, Authorization Services (PDP), and Slack identity link storage into one proven component | Custom `caipe-authorization-server` rejected — would duplicate Keycloak AuthZ functionality; direct Okta/Entra without broker rejected — no OBO, no unified PDP (Session 2026-04-03) |
| Agent Gateway as required infrastructure (Principle X) | Centralizes JWT validation + policy for all MCP/A2A/agent traffic; solves remote-MCP and auth-less-MCP gaps | No AG: leaves MCP/A2A without uniform auth gateway; per-agent JWT validation: inconsistent, harder to audit (Session 2026-04-01) |
| CEL as mandated policy engine (Principle X) | Provides consistent, configurable, sandboxed policy evaluation across all enforcement points (AG, RAG, dynamic agents, BFF) with a shared context schema | Code-based checks rejected — not configurable, not auditable, inconsistent across services; OPA/Rego rejected — heavier runtime, different from AG's built-in CEL (Session 2026-03-25) |

## Generated artifacts (Phases 0–1)

| Phase | Artifact | Purpose |
|-------|----------|---------|
| 0 | [research.md](./research.md) | Decisions: PDP placement (Keycloak AuthZ), IdP claims, Slack parity, OBO split, AG mandate, hybrid store |
| 1 | [data-model.md](./data-model.md) | Entities: principals, roles, audit records, Keycloak AuthZ model, OBO tokens, team/KB assignments |
| 1 | [contracts/rbac-authorization-v1.md](./contracts/rbac-authorization-v1.md) | Dual-PDP authorization check contract (Keycloak AuthZ for UI/Slack; AG for MCP/A2A) |
| 1 | [quickstart.md](./quickstart.md) | Local verification with Keycloak + AG dev environment |

## Next step

Run **`/speckit.tasks`** to produce `tasks.md` with ordered implementation items (already generated — 88 tasks across 11 phases).

**Paths (relative to repository root)**

- **FEATURE_SPEC**: `docs/docs/specs/098-enterprise-rbac-slack-ui/spec.md`
- **IMPL_PLAN**: `docs/docs/specs/098-enterprise-rbac-slack-ui/plan.md`
- **SPECS_DIR**: `docs/docs/specs/098-enterprise-rbac-slack-ui`
