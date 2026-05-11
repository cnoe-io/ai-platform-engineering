# Data Model: External Agentic Apps Platform

## Agentic App Manifest

Public declarative contract supplied by an app owner.

**Fields**:

- `id`: stable lowercase app ID, unique across installed packages.
- `apiVersion`: manifest schema version, initially `1.0`.
- `displayName`, `description`: user-facing catalog text.
- `runtime`: runtime kind, origin reference, mount path, chrome mode, path preservation, and optional asset prefix.
- `surfaces`: Apps Hub, top nav, home, embedded overlay, and ordering hints.
- `access`: required roles/groups, app-declared scopes, PDP action metadata, and optional custom-agent capability.
- `assistant`: enabled flag, schema versions, maximum context bytes, allowed context fields, and requested CAIPE assistant capability.
- `webhooks`: provider/channel declarations, allowed methods, upstream path, verification ownership, max body bytes, signature headers to preserve, and policy action.
- `health`: health endpoint, timeout, degraded/unavailable launch policy.
- `catalog`: categories, capabilities, icon metadata, support URL, compatibility range, and provenance.

**Validation rules**:

- IDs match the existing `AGENTIC_APP_ID_PATTERN`.
- Mount paths stay under `/apps/` and cannot collide with another installed app route.
- Origin values must be http(s), must not embed credentials, and should be operator-overridable.
- Secret-like field names are rejected in public package data.
- Webhook channels are unique within an app and provider.
- Assistant context configuration must set bounded payload sizes.

## App Package

Trusted package record containing a validated manifest and catalog/provenance metadata.

**Mongo collection**: `agentic_app_packages`

**Fields**:

- `packageId`: same value as manifest `id`.
- `source`: `builtin`, `admin-import`, `helm`, or `api`.
- `manifest`: validated `AgenticAppManifest`.
- `importedAt`, `importedBy`: audit metadata.
- `catalog`: indexed search/filter metadata.
- `validationStatus`: `valid`, `warning`, or `blocked`.
- `validationMessages`: safe validation warnings and errors.
- `provenance`: optional digest, version, publisher, and source URL metadata.

**Relationships**:

- One package can have at most one active installation per environment.
- Package deletion is blocked while installed unless the operator explicitly uninstalls first.

## App Installation

Environment-specific installation and launch policy.

**Mongo collection**: `agentic_app_installations`

**Fields**:

- `appId`: installed app ID.
- `packageId`: package selected for this installation.
- `installed`, `enabled`, `visible`: installation state.
- `runtimeOriginOverride`, `runtimeMountPath`: operator runtime overrides.
- `accessOverrides`: roles/groups/tenants or policy references that narrow manifest defaults.
- `healthPolicy`: whether `unknown`, `degraded`, or `unreachable` blocks launch.
- `runtimeHealth`: last effective health state.
- `routeOwnership`: claimed public mount path and normalized route key.
- `updatedAt`, `updatedBy`, `createdAt`, `createdBy`: audit metadata.

**State transitions**:

- `registered -> installed`: admin installs package and route conflicts are checked.
- `installed -> enabled`: launch surfaces may show if policy allows.
- `enabled -> disabled`: launch and webhook forwarding deny before contacting app runtime.
- `installed -> uninstalled`: app no longer appears in launch surfaces; audit retained.

## PDP Decision

Policy outcome for launch, proxy forwarding, webhook forwarding, or app-owned resource authorization.

**Mongo collection**: `agentic_app_pdp_decisions`

**Fields**:

- `decisionId`: generated unique decision ID.
- `correlationId`: request trace ID shared with app runtime when allowed.
- `appId`, `action`, `subject`, `tenant`, `resource`, `route`, `method`.
- `effect`: `allow` or `deny`.
- `reasonCode`: stable safe reason such as `unauthorized`, `disabled`, `pdp_unavailable`, or `route_conflict`.
- `policySource`: local adapter or external PDP identifier.
- `issuedAt`, `expiresAt`: decision validity window.
- `safeMetadata`: non-secret metadata for audit and debugging.

**Validation rules**:

- Default effect is deny.
- PDP unavailable resolves to deny unless a documented read-only fail-open policy exists.
- Decisions must not store browser cookies, provider tokens, raw app tokens, or private provider payloads.

## App-Scoped Token Grant

Short-lived CAIPE-issued identity and authorization context for one app and decision.

**Mongo collection**: `agentic_app_token_grants` when revocation/audit lookup is required; otherwise audit-only events may be sufficient.

**Fields**:

- `grantId`/`jti`: unique token ID.
- `decisionId`, `correlationId`, `appId`, `subject`.
- `audience`: target app audience.
- `scopes`: scopes allowed by the decision.
- `issuedAt`, `expiresAt`, `revokedAt`.
- `tokenHash`: optional hash for revocation lookup; raw token is never stored.

**Validation rules**:

- Tokens expire quickly.
- Tokens are audience-restricted to one app.
- Tokens include no browser cookies, provider secrets, or root provider credentials.

## Webhook Channel

Manifest-declared route for generic provider webhook delivery.

**Fields**:

- `provider`: provider identifier such as `github`, `slack`, `jira`, or `gitlab`.
- `channel`: app-owned channel identifier.
- `allowedMethods`: usually `POST`.
- `upstreamPath`: app runtime path that receives forwarded bytes.
- `verificationOwner`: `app` by default, optionally `caipe`.
- `preservedHeaders`: provider signature and delivery headers allowed to reach the app.
- `maxBodyBytes`, `rateLimit`, `policyAction`.

## Webhook Delivery

Auditable outcome of a provider delivery through the generic gateway.

**Mongo collection**: `agentic_app_webhook_deliveries`

**Fields**:

- `deliveryId`: CAIPE delivery ID.
- `providerDeliveryId`: provider retry/idempotency ID when present.
- `appId`, `provider`, `channel`.
- `decisionId`, `correlationId`.
- `status`: `accepted`, `denied`, `forwarded`, `failed`, `dropped`, or `rate_limited`.
- `httpStatus`: downstream or host response status.
- `bodySha256`: digest of raw body for support without storing payload.
- `receivedAt`, `completedAt`.
- `safeHeaders`: allowlisted non-secret request metadata.

## Assistant Context Message

Versioned payload from an embedded app to CAIPE-owned assistant overlay.

**Mongo collection**: `agentic_app_assistant_contexts` for active/recent context snapshots.

**Fields**:

- `contextId`: generated ID.
- `appId`, `sessionId`, `userSubjectHash`.
- `schemaVersion`: bridge version.
- `route`, `title`, `summary`, `selection`, `resourceRefs`, `suggestedPrompts`.
- `payloadSizeBytes`, `createdAt`, `expiresAt`.
- `validationStatus`: `accepted`, `ignored`, or `rejected`.
- `reasonCode`: safe rejection reason when applicable.

**Validation rules**:

- Source frame must match the active installed app and launch origin.
- Payload must match a versioned schema and max byte limit.
- Secret-like fields, cookies, tokens, and provider credentials are rejected.
- Context expires or is cleared when the user clears assistant context or leaves the app.

## Reference App

Separately runnable app used to demonstrate the platform contract.

**Fields**:

- `appId`: `finops`, `weather`, or `agentic-sdlc` reference ID.
- `runtime`: local development server command and production origin configuration.
- `manifest`: public manifest file used for installation.
- `domainStorage`: app-owned persistence outside CAIPE host platform collections.
- `webhookHandlers`: app-owned provider verification and domain processing.

## Audit Event

Safe append-only record for platform operations.

**Mongo collection**: `agentic_app_events`

**Fields**:

- `eventId`, `type`, `createdAt`, `actorEmail` or hashed subject.
- `appId`, `packageId`, `decisionId`, `correlationId`.
- `reasonCode`, `outcome`.
- `payload`: safe structured metadata; never raw tokens, cookies, secrets, or raw provider payloads.
