# Implementation Plan: External Agentic Apps Platform

**Branch**: `2026-05-09-external-agentic-apps` | **Date**: 2026-05-09 | **Spec**: `docs/docs/specs/2026-05-09-external-agentic-apps/spec.md`
**Input**: Feature specification from `docs/docs/specs/2026-05-09-external-agentic-apps/spec.md`

## Summary

Extend the existing `agentic-apps` foundation into a generic external app platform. The implementation should build on the current manifest validation, Apps Hub, Mongo-backed package/install state, and `/apps/[appId]/[[...path]]` proxy route, then add the missing generic contracts: PDP-backed authorization, app-scoped tokens, webhook gateway, assistant context bridge, SDK/UI kit, and external reference apps.

The first implementation slice should keep CAIPE as the host security boundary and avoid importing private app code into the host. External apps remain independently deployed runtimes installed through trusted manifests; CAIPE owns install state, launch policy, request enforcement, token issuance, audit, and the assistant overlay.

## Technical Context

**Language/Version**: TypeScript 6.0.2 with Next.js 16.2.3 and React 19.2.4 for the UI host and SDK/UI kit; Node 20+ runtime for local reference app servers; Python 3.11+ remains available for existing CAIPE agent/backend services but is not required for the first host-platform slice.  
**Primary Dependencies**: Next.js App Router route handlers, NextAuth, MongoDB Node driver 7.1.1, `jose` 6.2.2 for app-scoped JWTs, existing `@/lib/api-middleware`, existing `@/lib/agentic-apps/*`, existing `@octokit/webhooks` patterns for provider webhook tests, Jest and Testing Library.  
**Storage**: MongoDB via `ui/src/lib/mongodb.ts`. Existing collections `agentic_app_packages`, `agentic_app_installations`, and `agentic_app_events` are extended; new collections are introduced for PDP decision audit, app token records or revocation metadata, webhook deliveries, assistant context snapshots, and optional health snapshots.  
**Testing**: `cd ui && npm test` for UI/unit/API tests; targeted Jest tests under `ui/src/__tests__/agentic-apps/`, `ui/src/app/api/**/__tests__/`, and `ui/src/lib/**/__tests__/`; root `make caipe-ui-tests` for CI parity.  
**Target Platform**: CAIPE Next.js web host, server-side API routes, browser-based embedded/full-page external apps, local Node reference app runtimes, and Kubernetes/Helm deployments that inject trusted app manifests and runtime origins.  
**Project Type**: Web application platform with internal API routes, persisted installation state, shared TypeScript packages, and separately runnable reference apps.  
**Performance Goals**: Manifest/package list reads should remain a single indexed Mongo query per collection; app launch/proxy authorization should add no more than one PDP decision and one token mint per request; webhook gateway must enforce body-size limits before buffering large payloads; assistant context messages must be bounded by schema and byte-size validation.  
**Constraints**: Deny by default; fail closed when PDP is unavailable; strip browser cookies and client-supplied identity headers before forwarding; preserve raw webhook bytes when app-owned verification is declared; no secrets in manifest/package data; no private app names, manifests, imports, or route branches in OSS host code.  
**Scale/Scope**: MVP targets tens of installed apps and hundreds of app routes/webhook channels per CAIPE deployment. Reference apps for FinOps, Weather, and Agentic SDLC must exercise the same generic contracts as neutral third-party apps.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Worse is Better / YAGNI**: PASS. The plan extends existing `ui/src/lib/agentic-apps` and Next.js API routes instead of creating a new marketplace service, plugin runtime, or bundle upload system.
- **Rule of Three**: PASS. FinOps, Weather, and Agentic SDLC remain reference apps, but shared behavior moves into generic contracts only where all external apps need it.
- **Composition over Inheritance**: PASS. PDP, token, webhook, and assistant bridges are composed as host services and SDK helpers instead of subclassing app runtimes.
- **Specs as Source of Truth**: PASS. This plan, research, data model, contracts, quickstart, and Mongo migration notes live under `docs/docs/specs/2026-05-09-external-agentic-apps/`.
- **CI Gates Are Non-Negotiable**: PASS. The test plan uses existing Jest and Make targets; later implementation tasks must add targeted tests before code changes.
- **Security by Default**: PASS. Manifest validation rejects secret-like fields; request proxy strips client credentials; webhook routing enforces install/policy/body/rate checks; tokens are short-lived and app-scoped.

**Post-Design Recheck**: PASS. Phase 1 artifacts keep private app material out of source, use Mongo indexes for persisted lookup paths, document fail-closed PDP behavior, and avoid untrusted executable bundle upload.

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-05-09-external-agentic-apps/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── mongodb-migration.md
├── contracts/
│   ├── assistant-context-bridge.md
│   ├── manifest.schema.json
│   ├── pdp-and-token.md
│   ├── rest-api.md
│   ├── sdk-ui-kit.md
│   └── webhook-gateway.md
└── tasks.md
```

### Source Code (repository root)

```text
ui/
├── src/
│   ├── app/
│   │   ├── (app)/apps/
│   │   │   ├── page.tsx
│   │   │   ├── embed/[appId]/page.tsx
│   │   │   └── [appId]/[[...path]]/route.ts
│   │   └── api/
│   │       ├── agentic-apps/
│   │       │   ├── route.ts
│   │       │   ├── [appId]/route.ts
│   │       │   ├── [appId]/authorize/route.ts
│   │       │   ├── packages/route.ts
│   │       │   └── webhooks/[appId]/[provider]/[channel]/route.ts
│   │       └── admin/agentic-apps/
│   │           ├── packages/route.ts
│   │           └── installations/route.ts
│   ├── components/
│   │   ├── agentic-apps/
│   │   └── layout/AppHeader.tsx
│   ├── lib/
│   │   ├── agentic-apps/
│   │   │   ├── access.ts
│   │   │   ├── assistant-context.ts
│   │   │   ├── audit.ts
│   │   │   ├── execution-gateway.ts
│   │   │   ├── manifest-validation.ts
│   │   │   ├── pdp.ts
│   │   │   ├── registry.ts
│   │   │   ├── store.ts
│   │   │   ├── tokens.ts
│   │   │   └── webhook-gateway.ts
│   │   └── mongodb.ts
│   ├── packages/
│   │   ├── agentic-app-sdk/
│   │   └── agentic-app-ui/
│   ├── types/
│   │   └── agentic-app.ts
│   └── __tests__/agentic-apps/
└── apps/
    ├── _lib/
    ├── agentic-sdlc/
    └── agentic-apps/
        ├── finops/
        └── weather/
```

**Structure Decision**: Use the existing Next.js UI as the host platform boundary. Keep host logic in `ui/src/lib/agentic-apps`, user/admin APIs under `ui/src/app/api/agentic-apps` and `ui/src/app/api/admin/agentic-apps`, route execution under `ui/src/app/(app)/apps`, shared app-facing packages under `ui/src/packages`, and reference runtimes under `ui/apps`. Do not add a separate backend service until the current UI-hosted enforcement path proves insufficient.

## Database Migrations

**Deliverable**: `mongodb-migration.md` in this feature spec directory.

MongoDB changes are required because the feature persists install state, package metadata, policy decisions, webhook delivery outcomes, assistant context snapshots, token/revocation metadata, and audit events. The implementation should be idempotent: create missing indexes at startup or through a repeatable script, do not rename existing collections, and keep existing documents compatible where fields are extended.

Required collection work:

- Extend `agentic_app_packages` with manifest fields for assistant, webhook, PDP, provenance, compatibility, and catalog metadata.
- Extend `agentic_app_installations` with install policy, runtime overrides, access overrides, health policy, route ownership, and audit metadata.
- Extend or normalize `agentic_app_events` as the safe audit stream for app lifecycle, launch, PDP, token, webhook, health, and assistant-context events.
- Add `agentic_app_pdp_decisions`, `agentic_app_webhook_deliveries`, `agentic_app_assistant_contexts`, `agentic_app_health_snapshots`, and `agentic_app_token_grants` if implementation tasks decide these need queryable retention separate from the audit event stream.

Rollback is additive: disable the feature flag `AGENTIC_APPS_INSTALL_ENABLED`, stop writing the new collections, and drop new indexes/collections only after exporting audit data required by retention policy.

## Phase Outputs

- **Phase 0**: `research.md` resolves platform placement, manifest shape, authorization/PDP boundary, token strategy, webhook routing, assistant bridge, SDK/UI kit packaging, and reference app isolation.
- **Phase 1**: `data-model.md`, `contracts/*`, `quickstart.md`, and `mongodb-migration.md` define the design surface for `/speckit.tasks`.
- **Phase 2**: Deferred to `/speckit.tasks`; no implementation tasks are created by this command.

## Complexity Tracking

No constitution violations require exception tracking. The unavoidable breadth is managed as separate host services and reference apps behind the existing Spec Kit workflow rather than a single monolithic implementation.
