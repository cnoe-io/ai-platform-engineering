# Implementation Plan: Enterprise Identity Group Sync and Universal ReBAC

**Branch**: `2026-05-11-identity-group-rebac` | **Date**: 2026-05-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-05-11-identity-group-rebac/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Expand CAIPE authorization from mixed Keycloak/CEL/resource-role checks into a ReBAC-first model where every protected resource is represented as an authorization object, every action is checked through relationships, Slack channels can access many agents/tools/knowledge bases, and Okta/AD/OIDC groups can create and maintain CAIPE team membership through reviewed regex mapping clusters. The implementation will introduce an Identity Group Sync domain, extend OpenFGA modeling and tuple authoring, add scoped admin surfaces and policy explanation, and migrate runtime policy enforcement incrementally while keeping Keycloak as identity and bootstrap-role infrastructure.

## Technical Context

**Language/Version**: TypeScript / Next.js 16 + React 19 for CAIPE Admin UI and BFF APIs; Python 3.11+ for Slack bot and AgentGateway OpenFGA bridge.  
**Primary Dependencies**: NextAuth.js, MongoDB driver, Keycloak Admin REST, OpenFGA HTTP API, AgentGateway ext_authz, Slack Web API/Bolt, React Flow for graph visualization.  
**Storage**: MongoDB for sync rules, sync runs, external group links, membership sources, team/channel/resource intent, audit metadata, and policy ownership metadata; OpenFGA for authorization tuples; Keycloak for identity, token issuance, limited realm roles, users, and upstream attributes.  
**Testing**: Jest for UI/BFF unit and contract tests, Playwright for RBAC/admin E2E, pytest for Python Slack bot and bridge tests, existing RBAC matrix tests for authorization outcomes.  
**Target Platform**: Docker Compose development stack and Kubernetes/Helm deployment path for CAIPE services.  
**Project Type**: Web application with BFF APIs, Python integration services, identity provider integration, policy enforcement integrations, and documentation artifacts.  
**Performance Goals**: Dry-run preview for 500 groups in under 5 minutes; filtered graph views under 5 seconds for typical admin datasets; authorization checks fast enough for Slack/AgentGateway interactive use without perceptible user delay.  
**Constraints**: Deny by default; no secrets in source; dry-run before enabling new group mapping clusters; manual memberships preserved unless explicitly removed; immutable upstream group IDs preferred; no application-resource grants from group existence alone.  
**Scale/Scope**: Enterprise group sync for hundreds of groups and thousands of users; universal ReBAC coverage for teams, users, groups, Slack channels, agents, tools, knowledge bases, skills, tasks, conversations, admin surfaces, policies, audit views, and system configuration scopes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Worse is Better / YAGNI**: PASS. Plan favors staged delivery: first sync metadata and dry-run, then tuple materialization, then runtime enforcement migration. Avoids a one-shot rewrite of all authorization paths.
- **Rule of Three / Composition**: PASS. New sync, policy authoring, graph, and enforcement responsibilities remain separate domains with explicit contracts; common relationship validation should be shared only after patterns repeat.
- **Specs as Source of Truth**: PASS. This feature is driven from `spec.md` and generates plan, research, data model, contracts, quickstart, and migration notes before tasks.
- **CI Gates Are Non-Negotiable**: PASS. Plan includes Jest, Playwright, pytest, and RBAC matrix coverage.
- **Security by Default**: PASS. Deny-by-default ReBAC, dry-run review, scoped admin, audit records, immutable group IDs, no implicit anonymous access, no secrets in source.
- **Documentation**: PASS. RBAC reference docs, API/config docs, and migration guidance must be updated during implementation.

**Post-Design Re-Check**: PASS. `research.md`, `data-model.md`, contracts, quickstart, and `mongodb-migration.md` preserve the same gates. The design adds necessary storage and API surfaces for the requested enterprise sync and universal ReBAC scope without introducing unmanaged secrets, implicit grants, or unreviewed destructive sync behavior.

## Project Structure

### Documentation (this feature)

```text
specs/<YYYY-MM-DD-feature>/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
├── db-migration.md      # Phase 1 when storage is involved (see Database migrations below); optional name: mongodb-migration.md, sql-migrations.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
ui/
├── src/app/api/admin/identity-group-sync/    # Sync rules, dry-run, apply, runs, links, remediation
├── src/app/api/admin/openfga/                # Tuple, graph, relationship, check APIs expanded for universal resources
├── src/app/api/admin/teams/                  # Team and manual membership management
├── src/app/api/admin/slack/                  # Slack channel multi-resource grants
├── src/app/api/rbac/                         # Access checker and enforcement status APIs
├── src/components/admin/                     # Identity Group Sync, ReBAC graph, policy builder, scoped admin UI
├── src/lib/rbac/                             # ReBAC model helpers, tuple builders, policy validation, Keycloak transition helpers
└── src/types/                                # Shared UI/BFF types for sync, resources, policies, graph

ai_platform_engineering/
└── integrations/slack_bot/                   # Slack channel/team/resource enforcement and OBO context updates

deploy/
├── agentgateway/                             # PEP config templates and policy bridge metadata
└── openfga-experiment/                       # OpenFGA model, seed, bridge behavior during migration

tests/
├── rbac/                                     # RBAC matrix, fixtures, and cross-surface authorization checks
└── integration/                              # Service-level integration tests where applicable

docs/docs/security/rbac/                     # Canonical RBAC architecture, workflows, usage, file map
docs/docs/specs/2026-05-11-identity-group-rebac/
```

**Structure Decision**: Use the existing CAIPE web application and integration-service layout. Keep identity sync and policy authoring in the Next.js BFF/Admin UI boundary, keep Slack runtime enforcement in the Slack bot integration, keep AgentGateway/OpenFGA bridge changes under deploy assets, and keep matrix/E2E tests in existing RBAC test locations.

## Database migrations

*Include this section when **Technical Context → Storage** is not N/A (MongoDB, PostgreSQL, Redis persistence, etc.). Omit entirely for UI-only or stateless features.*

**Deliverable**: `mongodb-migration.md` in this feature spec directory.

MongoDB changes are required for sync rules, sync runs, external group links, membership source tracking, Slack channel multi-resource grants, relationship ownership metadata, and drift findings. OpenFGA model migration and Keycloak role transition are covered as operational migration steps linked from the MongoDB migration notes.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
