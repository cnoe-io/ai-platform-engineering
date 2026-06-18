# MongoDB Migration Plan

## Migration Type

Additive MongoDB migration with no collection rename, destructive data movement, or required plaintext credential export in the first release.

The implementation adds new credential collections and indexes, then provides non-destructive migration preview for existing credential-shaped fields. Existing static credentials, MCP inline `env` records, skill hub `credentials_ref`, and catalog API key behavior remain compatible while the feature toggle is disabled.

## Required Collections

### `credential_secret_refs`

Stores non-secret metadata for secrets, connector client secrets, provider token sets, and migration candidates.

Required indexes:

```javascript
db.credential_secret_refs.createIndex({ secret_id: 1 }, { unique: true })
db.credential_secret_refs.createIndex({ owner_type: 1, owner_id: 1, kind: 1, status: 1 })
db.credential_secret_refs.createIndex({ provider: 1, connector_id: 1, status: 1 })
db.credential_secret_refs.createIndex({ updated_at: -1 })
```

### `credential_encrypted_payloads`

Stores ciphertext, encrypted data keys, key metadata, algorithm metadata, and version history.

Required indexes:

```javascript
db.credential_encrypted_payloads.createIndex({ payload_id: 1 }, { unique: true })
db.credential_encrypted_payloads.createIndex({ secret_id: 1, version: 1 }, { unique: true })
db.credential_encrypted_payloads.createIndex({ secret_id: 1, created_at: -1 })
```

### `oauth_connectors`

Stores non-secret OAuth connector configuration and encrypted client-secret references.

Required indexes:

```javascript
db.oauth_connectors.createIndex({ connector_id: 1 }, { unique: true })
db.oauth_connectors.createIndex({ provider_key: 1, type: 1 }, { unique: true, partialFilterExpression: { status: { $ne: "deleted" } } })
db.oauth_connectors.createIndex({ status: 1, enabled_for: 1 })
```

### `provider_connections`

Stores user/provider relationship metadata and encrypted token-set references.

Required indexes:

```javascript
db.provider_connections.createIndex({ connection_id: 1 }, { unique: true })
db.provider_connections.createIndex({ subject_user_id: 1, provider_key: 1, state: 1 })
db.provider_connections.createIndex({ connector_id: 1, state: 1 })
db.provider_connections.createIndex({ provider_key: 1, provider_resource_id: 1, state: 1 })
```

### `credential_audit_events`

Stores non-secret audit events for credential lifecycle, use, denial, refresh, drift, migration, and feature-toggle changes.

Required indexes:

```javascript
db.credential_audit_events.createIndex({ created_at: -1, event_type: 1 })
db.credential_audit_events.createIndex({ resource_type: 1, resource_id: 1, created_at: -1 })
db.credential_audit_events.createIndex({ subject_user_id: 1, created_at: -1 })
db.credential_audit_events.createIndex({ correlation_id: 1 })
```

### `credential_migration_previews`

Stores non-secret migration scan results and operator decisions.

Required indexes:

```javascript
db.credential_migration_previews.createIndex({ preview_id: 1 }, { unique: true })
db.credential_migration_previews.createIndex({ source_type: 1, source_id: 1, status: 1 })
db.credential_migration_previews.createIndex({ created_at: -1 })
```

## Schema and Data Movement

### First Release

- Create new collections and indexes.
- Add optional credential reference fields to MCP server configuration records only when users opt into the new model.
- Add optional connector/provider connection collections without modifying existing Keycloak broker config.
- Add migration preview that scans existing sources and stores only source ids, field names, risk classification, and recommendations.
- Do not automatically move existing inline credential values.

### Later Apply Migration

When a future task implements explicit migration apply:

1. Read the existing credential-shaped value in a server-side context.
2. Create a `credential_secret_refs` record.
3. Encrypt value into `credential_encrypted_payloads`.
4. Update the source record to reference `secret_id`.
5. Remove or mask the plaintext source value.
6. Record a `credential_audit_events` migration event.

The apply operation must be idempotent and must not remove plaintext until encrypted payload write and source-reference update both succeed.

## Rollback

### Toggle Rollback

Disable the credential feature toggle. Existing static credential behavior remains active. New credential metadata and encrypted payload collections are left in place but no new UI/API/runtime actions are exposed.

### Index Rollback

Indexes are additive and can remain safely. If removal is required, drop only the indexes created for this feature after verifying no enabled deployment depends on them.

### Data Rollback

For first-release preview-only migration, no source data is modified. Remove preview records if necessary.

For future apply migrations, rollback requires restoring the previous source value from a pre-migration backup or re-entering the credential through an approved create/rotate flow. Raw credential values must not be reconstructed from logs or audit events.

## Environment Differences

### Local Development

- `CREDENTIAL_KEY_PROVIDER=dev-local` may use a generated local key file.
- Development key files must be ignored by git and must not be reused for production data.
- Health checks must clearly identify development key mode.

### Staging and Production

- `CREDENTIAL_KEY_PROVIDER=aws-kms` or equivalent is required.
- KMS/CMK access must be scoped to the CAIPE runtime identities that need wrapping and unwrapping.
- `dev-local` must fail startup or health checks in production mode.
- Backup and restore procedures must include MongoDB credential collections and KMS key availability.

## Operational Validation

- Confirm index bootstrap is idempotent.
- Confirm health endpoint fails closed when MongoDB, KMS, or OpenFGA is unavailable.
- Confirm audit events contain reason codes and correlation ids but no raw credential material.
- Confirm browser API responses mask connector client secrets, provider tokens, and BYO secret values.
- Confirm Helm rendering includes toggle and KMS references but no hardcoded credentials.
