# Data Model: MongoDB Envelope Credentials and Credential Exchange

## Collections

### `credential_secret_refs`

Non-secret metadata for user, team, connector, and provider credential references.

**Fields**:

- `_id`: MongoDB object id.
- `secret_id`: Stable CAIPE identifier, preferably UUID or prefixed ULID.
- `display_name`: User-visible name.
- `description`: Optional non-secret description.
- `kind`: `byo_secret`, `connector_client_secret`, `provider_token_set`, `migration_candidate`.
- `owner_type`: `user`, `team`, `service`, or `system`.
- `owner_id`: CAIPE user, team, service, or system identifier.
- `visibility`: `personal`, `team`, `team_shared`, `system`.
- `status`: `active`, `rotating`, `revoked`, `deleted`, `drift_detected`.
- `current_version`: Active secret version number.
- `payload_id`: Reference to `credential_encrypted_payloads`.
- `provider`: Optional provider key for provider credentials.
- `connector_id`: Optional OAuth connector reference.
- `tags`: Non-secret labels.
- `created_by`, `created_at`, `updated_by`, `updated_at`, `deleted_at`: Audit metadata.

**Validation rules**:

- `owner_type` and `owner_id` are required.
- `payload_id` is required when `status` is `active` or `rotating`.
- Raw secret values, tokens, refresh tokens, private keys, and client secrets are never stored in this collection.
- Browser list/detail responses must mask all credential material and expose only metadata allowed by policy.

**Indexes**:

- Unique `secret_id`.
- Compound `owner_type`, `owner_id`, `kind`, `status`.
- Compound `provider`, `connector_id`, `status` for provider connection lookup.
- Text or normalized-name index only on non-secret `display_name` and tags if search is implemented.

### `credential_encrypted_payloads`

Encrypted credential material plus metadata needed for envelope decryption.

**Fields**:

- `_id`: MongoDB object id.
- `payload_id`: Stable payload identifier.
- `secret_id`: Owning secret reference.
- `version`: Integer version.
- `ciphertext`: Encrypted credential material.
- `encrypted_data_key`: Data encryption key wrapped by KMS/CMK or local development wrapper.
- `key_provider`: `aws_kms`, `external_kms`, or `dev_local`.
- `key_id`: KMS key identifier or development key label.
- `algorithm`: Authenticated encryption algorithm, initially `AES-256-GCM`.
- `nonce`: Per-encryption nonce or IV.
- `auth_tag`: Authentication tag when stored separately from ciphertext.
- `aad_hash`: Hash of additional authenticated data inputs, such as `secret_id`, `version`, and `owner`.
- `content_type`: `opaque`, `oauth_token_set`, `client_secret`, `api_key`, or `bearer_token`.
- `created_at`, `created_by`, `rotated_from_payload_id`: Lifecycle metadata.

**Validation rules**:

- `version` must be monotonically increasing per `secret_id`.
- `algorithm`, `key_provider`, `key_id`, `encrypted_data_key`, `nonce`, and `ciphertext` are required.
- `dev_local` is rejected when deployment mode is production.
- Payload records are not returned to browser clients.

**Indexes**:

- Unique `payload_id`.
- Compound `secret_id`, `version`.
- Compound `secret_id`, `created_at` for rotation history.

### `oauth_connectors`

Admin-configured OAuth/OIDC connector metadata.

**Fields**:

- `connector_id`: Stable provider connector identifier.
- `provider_key`: Provider key, such as `github`, `atlassian`, `webex`, or custom slug.
- `display_name`, `description`, `logo_url`: Non-secret display metadata.
- `type`: `built_in` or `custom_oauth`.
- `status`: `draft`, `enabled`, `disabled`, `validation_failed`, `deleted`.
- `authorization_url`: HTTPS authorization endpoint.
- `token_url`: HTTPS token endpoint.
- `userinfo_url`: Optional HTTPS profile endpoint.
- `accessible_resources_url`: Optional HTTPS resource discovery endpoint.
- `redirect_uri`: CAIPE callback URI registered with the provider.
- `client_id`: Public OAuth client id.
- `client_secret_ref`: `credential_secret_refs.secret_id` for encrypted client secret.
- `requested_scopes`: Bounded list of scopes.
- `refresh_policy`: `rotate_refresh_token`, `reuse_refresh_token`, `no_refresh`, or `provider_default`.
- `identity_mapping`: Claim or response mapping for provider account identity.
- `token_mapping`: Token response mapping when provider fields are non-standard but still declarative.
- `hostname_policy`: Approved hostnames or suffixes for connector URLs.
- `enabled_for`: Optional team, role, or policy scope.
- `created_by`, `created_at`, `updated_by`, `updated_at`, `disabled_at`: Lifecycle metadata.

**Validation rules**:

- URL fields must use HTTPS and must not contain embedded credentials.
- URL host resolution must reject localhost, private IP, link-local, unsupported protocols, and unapproved hosts.
- Custom connectors require state support and PKCE where applicable.
- Client secret material is stored only through `client_secret_ref`.
- Scope changes mark affected provider connections as `reconsent_required` unless their grant already covers the new required scopes.

**Indexes**:

- Unique `connector_id`.
- Unique `provider_key` for built-in connectors.
- Compound `status`, `enabled_for`.

### `provider_connections`

User or allowed-team delegated OAuth provider relationships.

**Fields**:

- `connection_id`: Stable connection identifier.
- `connector_id`: OAuth connector used for consent and refresh.
- `provider_key`: Provider key.
- `subject_user_id`: CAIPE user identity anchor.
- `share_scope`: `personal` or `team_shared`.
- `shared_team_id`: Optional team if provider and CAIPE policy allow sharing.
- `provider_account_id`: Non-secret provider identity.
- `provider_account_name`: Optional non-secret display name.
- `provider_resource_id`: Optional organization, installation, workspace, tenant, or Atlassian `cloudid`.
- `granted_scopes`: Scopes granted by provider.
- `required_scopes_version`: Connector scope version used at consent time.
- `token_secret_ref`: Secret reference for encrypted token set.
- `state`: `not_connected`, `pending_consent`, `active`, `refresh_required`, `reconsent_required`, `reconnect_required`, `revoked`, `failed`.
- `expires_at`: Access-token expiry when known.
- `last_refresh_at`, `last_refresh_status`, `last_error_code`: Non-secret refresh metadata.
- `created_at`, `updated_at`, `revoked_at`: Lifecycle metadata.

**Validation rules**:

- `subject_user_id`, `connector_id`, and `provider_key` are required.
- `token_secret_ref` is required only after successful callback.
- Token material is never stored directly in this collection.
- Team sharing is allowed only when provider policy and ReBAC policy both permit it.

**Indexes**:

- Unique `connection_id`.
- Compound `subject_user_id`, `provider_key`, `state`.
- Compound `connector_id`, `state`.
- Compound `provider_key`, `provider_resource_id`, `state`.

### `credential_audit_events`

Non-secret credential lifecycle, use, denial, drift, migration, and refresh audit records.

**Fields**:

- `event_id`: Stable event identifier.
- `event_type`: `create`, `metadata_read`, `use`, `rotate`, `share`, `revoke`, `delete`, `deny`, `refresh`, `disconnect`, `drift_detected`, `migration_preview`, `migration_apply`, `feature_toggle`.
- `outcome`: `allowed`, `denied`, `failed`, `unavailable`, `masked`, `reconnect_required`, `scope_required`.
- `subject_user_id`: Acting user if present.
- `service_id`: Calling service if present.
- `resource_type`: `secret_ref`, `provider_connection`, `oauth_connector`, `mcp_server`, or `dynamic_agent`.
- `resource_id`: Non-secret resource identifier.
- `reason_code`: Stable non-secret reason.
- `correlation_id`: Request or trace correlation id.
- `metadata`: Non-secret structured context, excluding tokens and raw secrets.
- `created_at`: Event timestamp.

**Validation rules**:

- Raw secrets, tokens, authorization headers, refresh tokens, client secrets, private keys, and encrypted payload bytes are forbidden.
- Denials and unavailable outcomes must include a reason code.

**Indexes**:

- Compound `created_at`, `event_type`.
- Compound `resource_type`, `resource_id`, `created_at`.
- Compound `subject_user_id`, `created_at`.
- Compound `correlation_id`.

### `credential_migration_previews`

Records non-destructive migration scan results and approved migration batches.

**Fields**:

- `preview_id`: Stable preview id.
- `source_type`: `mcp_server_env`, `skill_hub_credentials_ref`, `catalog_api_key`, or `helm_static_secret`.
- `source_id`: Non-secret source identifier.
- `candidate_field`: Field or path flagged as credential-shaped.
- `risk`: `low`, `medium`, `high`.
- `recommendation`: `leave_static`, `migrate_to_secret_ref`, `manual_review`, `unsupported`.
- `target_secret_id`: Optional target after approved migration.
- `status`: `previewed`, `approved`, `applied`, `skipped`, `failed`.
- `created_by`, `created_at`, `updated_at`: Lifecycle metadata.

**Validation rules**:

- Preview records must not store the candidate raw value.
- Apply operations are idempotent and must remove or mask plaintext only after encrypted storage succeeds.

## Service API Request Models

### Credential Retrieval Request

Standard service-to-service request for resolving a `secret_ref` into credential material.

**Fields**:

- `secret_id`: Credential reference to resolve.
- `caller_type`: `dynamic_agent`, `mcp_runtime`, `internal_service`, or `credential_exchange`.
- `service_id`: Calling service identity when present.
- `acting_user_id`: User identity for user-scoped or delegated use.
- `resource_context`: Dynamic Agent, MCP server, tool, connector, or internal app context.
- `intended_use`: `mcp_env`, `authorization_header`, `api_key`, `oauth_bearer`, or `connector_refresh`.
- `audience`: Expected JWT audience for the credential service.
- `correlation_id`: Non-secret request correlation id.

**Validation rules**:

- Browser clients are not valid callers for retrieval requests.
- Session-only requests, browser-origin requests, CSRF-shaped requests, and browser-accessible tokens must be denied before decrypt.
- `caller_type`, `resource_context`, and `intended_use` are required for every retrieval.
- Authorization is evaluated before decrypt and before returning material.

### Provider Credential Exchange Request

Standard service-to-service request for resolving a user's provider connection into a provider credential for an approved runtime use.

**Fields**:

- `provider_key`: Provider such as `github`, `atlassian`, or `webex`.
- `caller_type`: `dynamic_agent`, `mcp_runtime`, or `internal_service`.
- `acting_user_id`: CAIPE user identity anchor.
- `provider_resource_id`: Optional organization, workspace, installation, tenant, or Atlassian `cloudid`.
- `required_scopes`: Provider scopes needed by the caller.
- `intended_use`: `github_mcp`, `jira_mcp`, `confluence_mcp`, or `internal_service`.
- `resource_context`: Dynamic Agent, MCP server, tool, or internal app context.
- `correlation_id`: Non-secret request correlation id.

**Validation rules**:

- Browser clients are not valid callers for exchange requests.
- Provider token refresh and token issuance are denied for browser-origin or session-only requests.
- Missing connection, disabled connector, missing scope, wrong provider resource, or denied policy fails before token issuance.

## State Transitions

### Secret Reference

```text
active -> rotating -> active
active -> revoked
active -> deleted
active -> drift_detected
drift_detected -> active
revoked -> deleted
```

### Provider Connection

```text
not_connected -> pending_consent -> active
active -> refresh_required -> active
active -> reconsent_required -> pending_consent
active -> reconnect_required -> pending_consent
active -> revoked
pending_consent -> failed
refresh_required -> reconnect_required
```

### OAuth Connector

```text
draft -> enabled
draft -> validation_failed
enabled -> disabled
enabled -> validation_failed
disabled -> enabled
disabled -> deleted
```

## Relationships

- `credential_secret_refs.payload_id` points to the active `credential_encrypted_payloads.payload_id`.
- `oauth_connectors.client_secret_ref` points to a secret reference of kind `connector_client_secret`.
- `provider_connections.token_secret_ref` points to a secret reference of kind `provider_token_set`.
- OpenFGA tuples attach users, teams, services, Dynamic Agents, MCP servers, and tools to `secret_ref` resources for discover, metadata-read, use, manage, share, and audit decisions.
- Dynamic Agent MCP server config stores credential source metadata and `secret_ref` ids, not raw credential values.

## Query Patterns

- List secrets visible to a user or team after OpenFGA discover/metadata filtering.
- Retrieve one secret for server-side use by `secret_id` only after JWT and OpenFGA authorization.
- Find active provider connection for `(subject_user_id, provider_key, provider_resource_id)` during credential exchange.
- Find enabled connector by `connector_id` or `provider_key` for connect, callback, refresh, and admin views.
- List audit events by resource, actor, time range, and outcome without secret values.
- Preview migration candidates by source type and status.
