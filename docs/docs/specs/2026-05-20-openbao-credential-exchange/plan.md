# Implementation Plan: MongoDB Envelope Credentials and Credential Exchange

**Branch**: `prebuild/fix-helm-image-channel` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-05-20-openbao-credential-exchange/spec.md`

## Summary

Build a feature-toggled **Connections & Secrets** capability that stores user, team, connector, and provider credential material through MongoDB envelope encryption with production key wrapping by KMS/CMK. CAIPE will expose server-side UI/BFF APIs for secrets management, OAuth connector administration, provider connection lifecycle, migration preview, and Dynamic Agent MCP impersonation-token use, plus a standard service-to-service credential API for approved internal services to retrieve or exchange credential material by reference. Keycloak remains the identity anchor, OpenFGA remains the authorization source of truth, and the credential-store interface keeps MongoDB as the initial backend while preserving a future OpenBao backend option.

The implementation should selectively port compatible foundations from PR #1282, preserving author credit at commit time, but must gate all user-visible and runtime behavior behind a disabled-by-default credential feature toggle.

## Technical Context

**Language/Version**: TypeScript 5.x / Node 20+ for Next.js 16 + React 19 UI/BFF; Python 3.11+ for Dynamic Agents and MCP auth paths; Go for the GitHub MCP server
**Primary Dependencies**: Next.js App Router, NextAuth/OIDC session and JWT validation, MongoDB driver, OpenFGA HTTP API, Keycloak OIDC/Admin APIs, Dynamic Agents FastAPI services, existing MCP auth middleware, AWS KMS or equivalent KMS for production key wrapping
**Storage**: MongoDB credential metadata and encrypted payload collections; OpenFGA tuples for `secret_ref` and connector/provider use; KMS/CMK for wrapping per-credential data keys; no OpenBao datastore in the first release
**Testing**: Jest/TS route and component tests, pytest for Python Dynamic Agents and MCP auth, Go tests for GitHub MCP bearer handling, RBAC matrix tests, Helm/unit rendering tests, targeted migration-preview tests
**Target Platform**: Local Docker Compose, Kubernetes/Helm deployments, GitOps overlays for CAIPE environments
**Project Type**: Full-stack web application plus backend/runtime integration across UI BFF, Dynamic Agents, MCP servers, and Helm deployment
**Performance Goals**: Authorized credential retrieval should complete within normal BFF/runtime request budgets; decrypt and refresh operations must happen only after authn/authz succeeds; repeated provider refresh for the same connection should avoid duplicate concurrent refresh writes
**Constraints**: Feature toggle disabled by default; no raw credential material in logs, traces, browser responses after create/rotate request ingestion, Helm values, or source-controlled files; browser clients may create or rotate secrets but must never retrieve credential material; deny before decrypt; custom connector SSRF protections; fail closed on KMS, policy, provider, or credential-store outages
**Scale/Scope**: Initial provider support for GitHub, Atlassian/Jira/Confluence, Webex, and PagerDuty; custom connector support limited to standards-compliant authorization-code OAuth/OIDC; migration preview targets MCP inline `env`, skill-hub `credentials_ref`, and catalog API key paths

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Worse is Better**: PASS. The plan avoids adding OpenBao in the first release and uses MongoDB plus KMS around existing CAIPE deployment patterns.
- **II. YAGNI**: PASS. Built-in providers plus bounded custom OAuth are included; non-standard provider adapters, generic public secrets APIs, and full OpenBao operations are out of scope.
- **III. Rule of Three**: PASS. A credential-store interface is justified now because secrets, OAuth connector client secrets, provider token sets, and future OpenBao all share the same storage boundary.
- **IV. Composition over Inheritance**: PASS. Storage, key wrapping, provider connectors, policy checks, and MCP injection are separate components wired through explicit interfaces.
- **V. Specs as Source of Truth**: PASS. This plan and the Phase 0/1 artifacts live with the feature spec under `docs/docs/specs/2026-05-20-openbao-credential-exchange/`.
- **VI. CI Gates Are Non-Negotiable**: PASS. The plan includes UI, Python, Go, Helm, migration, and RBAC matrix tests before implementation can be considered complete.
- **VII. Security by Default**: PASS. The design denies by default, validates JWT audience and OpenFGA policy before decrypt, masks all secrets, rejects unsafe connector URLs, blocks browser-side retrieval/exchange of raw credential material, and keeps KMS/CMK as the production root-key boundary.

**Post-Design Recheck**: PASS. `research.md`, `data-model.md`, `contracts/credential-api.yaml`, `quickstart.md`, and `mongodb-migration.md` preserve the same boundaries and contain no unresolved clarification markers.

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-05-20-openbao-credential-exchange/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── mongodb-migration.md
├── contracts/
│   └── credential-api.yaml
├── checklists/
│   └── requirements.md
└── tasks.md              # Phase 2 output from /speckit.tasks, not created by this plan
```

### Source Code (repository root)

```text
ui/src/lib/
├── credentials/          # credential-store interface, envelope encryption, masking, KMS adapter
├── oauth-connectors/     # connector validation, built-in provider descriptors, OAuth helpers
├── rbac/                 # secret_ref and connector policy helper extensions
└── feature-flags/        # server-side credential feature toggle helpers

ui/src/app/api/
├── credentials/secrets/                  # secrets manager metadata and lifecycle APIs
├── credentials/retrieve/                 # standard internal service credential retrieval API
├── credentials/exchange/                 # standard internal provider credential exchange API
├── credentials/inject/[provider]/        # future AgentGateway credential-injector API returning provider-token headers
├── credentials/oauth-connectors/         # admin connector configuration APIs
├── credentials/oauth/[provider]/         # connect and callback routes
└── credentials/migrations/preview/       # non-destructive migration preview APIs

ui/src/components/
├── credentials/          # Connections & Secrets UI
├── admin/                # OAuth connector, drift, and audit admin panels
└── dynamic-agents/       # MCP credential source selector and impersonation mode UI

ai_platform_engineering/dynamic_agents/src/dynamic_agents/
├── services/credential_exchange.py       # runtime credential exchange client
├── services/mcp_client.py                # inject per-user provider credentials where enabled
└── models.py                             # MCP credential source and impersonation config fields

ai_platform_engineering/agents/
├── common/mcp-auth/                      # bearer token resolution tests and docs updates
├── jira/mcp/mcp_jira/                    # OAuth bearer mode for impersonation
└── confluence/mcp/mcp_confluence/        # OAuth bearer mode for impersonation

ai_platform_engineering/mcp/mcp_github/   # per-request bearer token path verification

charts/ai-platform-engineering/
├── charts/caipe-ui/
├── charts/dynamic-agents/
└── values*.yaml                          # feature toggle, KMS, and credential-store values

deploy/openfga/
├── model.fga
└── init/authorization-model.json         # only if secret_ref relationships need expansion

docs/docs/security/rbac/                  # canonical RBAC reference updates required by FR-048
tests/rbac/                               # matrix additions for credential resources and APIs
```

**Structure Decision**: Implement the feature across existing CAIPE ownership boundaries instead of creating a new standalone service in the first release. The Next.js BFF remains the control-plane API for UI, internal credential retrieval, and a future AgentGateway credential-injection contract; Dynamic Agents consume a narrow credential exchange client for the active Jira path because the deployed AgentGateway version does not support backend response-header injection. MCP servers only receive already-authorized per-invocation material. This keeps OpenBao optional later by swapping the `CredentialStore` backend rather than changing consumers.

## Database Migrations

**Deliverable**: [mongodb-migration.md](./mongodb-migration.md)

MongoDB changes are required but can be introduced as additive collections and indexes. No destructive migration or collection rename is planned for the first release. Existing MCP server inline `env`, skill hub `credentials_ref`, and catalog API key records remain compatible while migration preview identifies credential-shaped values and records operator-approved migration candidates.

## Phase 0 Research

**Output**: [research.md](./research.md)

Research resolved the main design choices: MongoDB envelope encryption as the initial backend, KMS/CMK wrapping for production, Keycloak broker token storage as non-default, OpenBao as a future backend, bounded custom OAuth connector support, and feature-toggle isolation for PR #1282 integration.

## Phase 1 Design and Contracts

**Outputs**:

- [data-model.md](./data-model.md)
- [contracts/credential-api.yaml](./contracts/credential-api.yaml)
- [quickstart.md](./quickstart.md)
- [mongodb-migration.md](./mongodb-migration.md)

The contracts define server-side credential lifecycle, retrieval, provider exchange, OAuth connector, callback, health, and migration-preview APIs. Retrieval and exchange are standard service-to-service APIs for approved internal callers only. Browser clients can submit raw credential values only during create, rotate, or OAuth callback flows; all other browser-facing routes return metadata, masked values, statuses, and reason codes, never credential material.

## Complexity Tracking

No constitution violations require exception tracking. The credential-store abstraction is necessary because multiple first-release consumers need the same security boundary: BYO secrets, OAuth connector client secrets, provider token sets, MCP impersonation, migration tooling, and future OpenBao storage.
