# MongoDB Migration: External Agentic Apps Platform

## Summary

This feature requires additive MongoDB changes. Existing collections are extended and several queryable audit/support collections may be added. No collection rename, destructive backfill, or blocking data migration is required for the MVP.

## Existing Collections To Extend

### `agentic_app_packages`

Add optional manifest/package fields:

- `manifest.assistant`
- `manifest.webhooks`
- `manifest.access.policyActions`
- `manifest.catalog`
- `validationStatus`
- `validationMessages`
- `provenance`

Indexes:

- Unique `packageId`.
- Unique `manifest.id`.
- Non-unique `catalog.categories`, `catalog.capabilities`, and `source` for admin filtering.

### `agentic_app_installations`

Add optional installation fields:

- `visible`
- `accessOverrides`
- `healthPolicy`
- `runtimeOriginOverride`
- `runtimeMountPath`
- `routeOwnership`
- `createdAt`, `createdBy`, `updatedAt`, `updatedBy`

Indexes:

- Unique `appId`.
- Unique `routeOwnership.normalizedMountPath` for installed apps.
- Non-unique `packageId`.
- Non-unique `{ installed: 1, enabled: 1, visible: 1 }` for Apps Hub reads.

### `agentic_app_events`

Normalize audit events around common fields:

- `eventId`
- `type`
- `appId`
- `packageId`
- `decisionId`
- `correlationId`
- `actorEmail` or `actorSubjectHash`
- `outcome`
- `reasonCode`
- `payload`
- `createdAt`

Indexes:

- `{ appId: 1, createdAt: -1 }`.
- `{ correlationId: 1 }`.
- `{ decisionId: 1 }`.
- `{ reasonCode: 1, createdAt: -1 }` for support filtering.
- `{ type: 1, createdAt: -1 }`.

## New Collections

### `agentic_app_pdp_decisions`

Stores policy decisions when operators need queryable authorization history.

Indexes:

- Unique `decisionId`.
- `{ appId: 1, issuedAt: -1 }`.
- `{ subject.hash: 1, issuedAt: -1 }`.
- `{ correlationId: 1 }`.
- TTL on `expiresAt` if retention policy permits short-lived technical records. Audit-grade denials should also be copied to `agentic_app_events`.

### `agentic_app_token_grants`

Stores token grant metadata for revocation or support lookups. Raw tokens are never stored.

Indexes:

- Unique `jti`.
- `{ appId: 1, subject.hash: 1, issuedAt: -1 }`.
- `{ decisionId: 1 }`.
- TTL on `expiresAt` after retention requirements are met.

### `agentic_app_webhook_deliveries`

Stores generic webhook delivery outcomes without raw provider payloads.

Indexes:

- Unique `deliveryId`.
- `{ appId: 1, provider: 1, channel: 1, receivedAt: -1 }`.
- `{ providerDeliveryId: 1, provider: 1 }` sparse index for idempotency/retry tracing.
- `{ correlationId: 1 }`.

### `agentic_app_assistant_contexts`

Stores active or recent assistant context snapshots for embedded apps.

Indexes:

- `{ appId: 1, sessionId: 1, createdAt: -1 }`.
- `{ userSubjectHash: 1, createdAt: -1 }`.
- TTL on `expiresAt`.

### `agentic_app_health_snapshots`

Stores periodic or on-demand health outcomes for app launch surfaces.

Indexes:

- `{ appId: 1, checkedAt: -1 }`.
- TTL on `expiresAt` or retention-specific timestamp.

Retention decision: keep audit events in `agentic_app_events` according to the
deployment's operator audit retention policy. Keep technical PDP, token,
assistant-context, webhook-delivery, and health-snapshot records short-lived
unless copied into `agentic_app_events` for audit-grade retention.

## Backfill

Backfill should be idempotent and optional:

1. For existing `agentic_app_packages`, populate `validationStatus: "valid"` only after the current manifest validator accepts the stored manifest.
2. For existing `agentic_app_installations`, derive `routeOwnership.normalizedMountPath` from `runtimeMountPath` or package `manifest.runtime.mountPath`.
3. For existing events, leave historical payloads unchanged unless a later task needs normalized views for admin UI.

Backfill batch size should be small enough for local development and production parity, for example 100 documents per batch, with resumable progress based on `_id`.

## Rollback

Rollback is feature-flag-first:

1. Set `AGENTIC_APPS_INSTALL_ENABLED=false`.
2. Stop webhook gateway and proxy writes.
3. Keep audit collections until retention obligations are satisfied.
4. Drop new TTL/indexes only if they cause operational issues.
5. Drop new collections only after exporting required audit data.

Existing `agentic_app_packages`, `agentic_app_installations`, and `agentic_app_events` should not be dropped because earlier app-hub functionality already depends on them.

## Environment Notes

- Development can create indexes at app startup through `ui/src/lib/mongodb.ts` or a repeatable script.
- Staging should run the same index creation before enabling reference app installations.
- Production should create unique route/app indexes before operators import private app manifests so route conflicts fail deterministically.
