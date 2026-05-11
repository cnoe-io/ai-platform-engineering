# Research: External Agentic Apps Platform

## Decision: Extend the existing UI-hosted `agentic-apps` platform

**Rationale**: The repository already has the core host surface: `ui/src/types/agentic-app.ts`, `ui/src/lib/agentic-apps/manifest-validation.ts`, Mongo-backed package/install storage in `ui/src/lib/agentic-apps/store.ts`, app access checks in `ui/src/lib/agentic-apps/access.ts`, Apps Hub rendering, admin APIs, and the `/apps/[appId]/[[...path]]` proxy route. Extending these paths gives the platform a working install/launch/proxy foundation without creating another host service.

**Alternatives considered**:

- New Python/FastAPI app platform service: rejected for the first slice because Next.js already owns session cookies, app routes, admin APIs, and Mongo helper patterns.
- Static config-only app list: rejected because requirements need install state, auditability, health, and operator changes without source edits.
- Uploading app bundles into CAIPE: rejected by spec scope and security constraints.

## Decision: Manifest contract remains public, declarative, and secret-free

**Rationale**: Existing validation already rejects secret-like field names and restricts app IDs and mount paths. The contract should grow to include route ownership, assistant capabilities, webhook channels, health policy, PDP actions, compatibility metadata, and provenance while keeping provider credentials and private runtime configuration outside package data.

**Alternatives considered**:

- Let manifests include provider secrets for convenience: rejected because public package data would become credential-bearing source.
- Store private app manifests in OSS for examples: rejected because the OSS host must remain generic and private names must not appear in code.

## Decision: PDP is an internal policy boundary with a local adapter first

**Rationale**: The requirement is a policy decision boundary, not a specific PDP engine. A small `ui/src/lib/agentic-apps/pdp.ts` interface can accept launch, proxy, webhook, and app-owned resource authorization inputs and initially adapt existing roles/groups/installation policy. The interface leaves room for OPA, Cedar, or a CAIPE policy service later without changing app-facing contracts.

**Alternatives considered**:

- Hardcode role checks only in the proxy route: rejected because webhooks and app-owned authorization need the same decision/audit shape.
- Require an external PDP before MVP: rejected because it would block validation of generic app flows and violate YAGNI.

## Decision: Forward app-scoped tokens, not browser cookies or root provider tokens

**Rationale**: The current proxy strips cookies and client-supplied identity headers but forwards a user OIDC ID token when available. The platform needs a stronger app-specific token minted by CAIPE with `aud`, `app_id`, `sub`, `scope`, `decision_id`, `correlation_id`, `exp`, and issuer claims. `jose` is already available in the UI project and fits short-lived JWT signing and verification docs.

**Alternatives considered**:

- Forward existing OIDC ID tokens only: rejected because audience and scopes are not app-specific.
- Store long-lived app API keys in Mongo: rejected because revocation, least privilege, and secret exposure risks are worse than short-lived minted tokens.

## Decision: Generic webhook gateway forwards raw bytes and provider headers

**Rationale**: The Agentic SDLC GitHub route already documents the need to read exact raw bytes for signature verification. The generic gateway should resolve `appId`, `provider`, and `channel`, enforce install/policy/body/rate/health checks, then forward bytes and selected provider signature headers without understanding provider payload semantics.

**Alternatives considered**:

- Verify every provider signature in CAIPE: rejected as the default because apps own provider secrets and semantics.
- Parse JSON before forwarding: rejected because signature verification and non-JSON providers require exact raw payload preservation.

## Decision: Assistant context uses a versioned postMessage bridge

**Rationale**: Embedded apps need to describe current page context without importing CAIPE chat stores or components. A small SDK helper can publish versioned messages from the frame; the CAIPE shell validates frame source, app ID, schema version, size, and secret-like content before storing active context for the CAIPE-owned assistant overlay.

**Alternatives considered**:

- Share CAIPE chat React components with apps: rejected because it couples external apps to private host internals.
- Let apps call the chat API directly with their context: rejected because CAIPE must own conversation state, model routing, audit, and safety controls.

## Decision: SDK and UI kit live as local publishable TypeScript packages first

**Rationale**: The root has no active npm workspace model, while the UI app owns TypeScript, React, and package scripts. Local packages under `ui/src/packages/agentic-app-sdk` and `ui/src/packages/agentic-app-ui` can be consumed by reference apps and documented as publishable artifacts without introducing registry automation in the MVP.

**Alternatives considered**:

- Add full npm workspace publishing immediately: rejected because packaging/release automation is not needed to prove the host contract.
- Keep SDK helpers in host-only `src/lib`: rejected because external apps must not import CAIPE host aliases or private modules.

## Decision: Reference apps stay under `ui/apps` and exercise the same contracts

**Rationale**: Existing FinOps and Weather servers already run from `ui/apps/*`. Agentic SDLC should move toward the same pattern so reference apps can be launched, proxied, authorized, and tested as external runtimes without host-specific route branches.

**Alternatives considered**:

- Keep Agentic SDLC as a built-in route permanently: rejected because it would keep product-specific logic in the host.
- Move reference apps to another repository before MVP: rejected because local examples are useful for contract tests and contributor onboarding.
