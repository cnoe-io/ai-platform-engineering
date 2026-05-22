# Phase 0 Research: MongoDB Envelope Credentials and Credential Exchange

## Decision: Use MongoDB Envelope Encryption as the Initial Credential Store

**Rationale**: CAIPE already depends on MongoDB for Dynamic Agent, skill, RBAC, and UI metadata. Dedicated credential collections with application-level envelope encryption avoid introducing OpenBao operational burden in the first release while still removing plaintext credential material from MongoDB records, browser responses, Helm values, and source-controlled config.

**Alternatives considered**:

- **OpenBao now**: Better native secret-management semantics, but adds a datastore, bootstrap, seal/unseal, backup, HA, and operator burden before the product flow is proven.
- **Keycloak broker token storage**: Useful for selected IdP account-linking scenarios, but makes Keycloak and its database the provider-token vault and does not naturally model team sharing, policy explanations, or unified credential audit.
- **Plain MongoDB field storage**: Rejected because it does not satisfy the no-plaintext credential requirement.

## Decision: Use KMS/CMK Key Wrapping in Production

**Rationale**: MongoDB will hold ciphertext and encrypted data keys, but production root-key custody belongs in AWS KMS or an equivalent KMS. Per-credential data encryption keys limit blast radius and support future key rotation without exposing raw credential values.

**Alternatives considered**:

- **Database-stored master key**: Acceptable only for local development samples; rejected for production because application and database compromise would expose both ciphertext and wrapping key.
- **Single shared data key**: Simpler, but too broad for rotation and compromise isolation.
- **MongoDB Queryable Encryption**: Useful for encrypted queryable fields, but the feature does not require querying raw secret values; only metadata is queryable.

## Decision: Keep a Narrow Credential Store Interface

**Rationale**: The same storage boundary is needed for BYO secrets, OAuth connector client secrets, provider token sets, Dynamic Agent MCP runtime retrieval, and migration tooling. A narrow interface keeps encryption and future OpenBao backend details away from UI, BFF, Dynamic Agents, and MCP consumers.

**Alternatives considered**:

- **Inline encryption helpers at each call site**: Rejected because it spreads cryptographic policy, masking, audit, and failure behavior across unrelated modules.
- **Full secret-management service process now**: Deferred because the first release can stay inside the existing BFF/runtime deployment while preserving the backend interface.

## Decision: Enforce Authorization Before Decryption

**Rationale**: Credential retrieval must validate JWT authentication, service audience, caller classification, acting subject, resource context, intended use, and OpenFGA `secret_ref#use` or provider-connection policy before any decrypt operation returns material. Browser clients can submit raw values only during create, rotate, or OAuth callback flows; they are not valid callers for retrieval or exchange. This preserves deny-by-default semantics and prevents credential-store availability or BFF session access from becoming an authorization bypass.

**Alternatives considered**:

- **Decrypt then authorize**: Rejected because it increases blast radius and makes instrumentation/logging riskier.
- **Rely only on UI visibility**: Rejected because runtime, API, and microservice paths can bypass UI gates.
- **Allow browser retrieval for convenience**: Rejected because it would expose raw credentials to browser JavaScript and defeat the service-side credential boundary.

## Decision: Use `secret_ref` as the ReBAC Resource Boundary

**Rationale**: `secret_ref` already exists in the RBAC model and is the right resource to express discover, metadata-read, use, manage, share, and audit permissions. MongoDB stores metadata; OpenFGA decides relationships and use rights.

**Alternatives considered**:

- **Role-only access**: Rejected because team sharing and per-agent/tool use require resource relationships.
- **Provider-specific auth models**: Rejected for the first release because secrets, connector client secrets, and provider token sets need common audit and policy behavior.

## Decision: Implement Credential Exchange in CAIPE, Not Keycloak, by Default

**Rationale**: Keycloak remains the identity anchor for CAIPE users and service tokens. CAIPE owns provider connection lifecycle, refresh-token rotation, policy checks, audit, provider-specific metadata such as Atlassian `cloudid`, and server-side token injection. Keycloak broker storage may be evaluated per provider later, but it is not required for the initial architecture.

**Alternatives considered**:

- **Keycloak broker token storage for all providers**: Potentially reduces OAuth code for supported providers, but product-visible sharing, audit, reconnect, refresh failure, and provider-specific exchange semantics become harder.
- **UI-managed OAuth tokens**: Rejected because raw provider tokens must not be exposed to browsers after callback handling.

## Decision: Bound Dynamic OAuth Connector Support

**Rationale**: Admins can add custom connectors only when the provider uses standard authorization-code OAuth/OIDC semantics and passes URL, host, protocol, PKCE/state, scope, and mapping validation. This keeps dynamic connector setup useful without promising support for every non-standard OAuth variant.

**Alternatives considered**:

- **Only hard-coded connectors**: Safer and simpler, but would require code changes for every standards-compliant enterprise connector.
- **Arbitrary connector scripts or custom flows**: Rejected due to SSRF, credential exfiltration, and maintenance risk.

## Decision: Treat GitHub, Jira, and Confluence Impersonation Differently

**Rationale**: GitHub MCP already has HTTP bearer-token pathways that can accept per-request credentials. Jira and Confluence currently use API-token basic auth, so impersonation mode requires an Atlassian OAuth bearer path plus resource context such as `cloudid`.

**Alternatives considered**:

- **Use static deployment credentials for all MCP servers**: Preserved when `USE_IMPERSONATION_TOKENS` is disabled, but does not meet user impersonation requirements.
- **Inject user tokens through environment variables**: Rejected for HTTP/runtime paths because per-invocation credentials must not become persisted config or process-wide mutable state.

## Decision: Gate the Whole Feature Behind a Server-Side Feature Toggle

**Rationale**: The feature touches credential storage, UI navigation, BFF routes, Dynamic Agent runtime behavior, MCP auth, provider token refresh, migrations, and Helm configuration. A disabled-by-default server-side toggle allows selective PR #1282 integration and rollback without changing existing production behavior.

**Alternatives considered**:

- **Client-only feature flag**: Rejected because runtime and API routes must also be blocked.
- **Always-on migration**: Rejected because current deployments need compatibility with static credentials and env-var references.

## Decision: Integrate PR #1282 Selectively

**Rationale**: PR #1282 contains useful security UI, envelope encryption, MCP header, audit, rate-limit, and feature-flag ideas, but it also includes unrelated admin/auth/LLM/health changes from an older base. The plan is to cherry-pick or port only compatible pieces behind the credential feature toggle and preserve original author credit in git history where possible.

**Alternatives considered**:

- **Merge all of PR #1282**: Rejected due to broad blast radius and release-base drift.
- **Ignore PR #1282**: Rejected because it likely contains reusable foundations and attribution should be preserved for adopted work.

## Decision: Use Additive MongoDB Migrations

**Rationale**: New credential collections, indexes, and migration-preview records can be added without renaming or destructively changing existing collections. Existing MCP server `env`, skill hub `credentials_ref`, and catalog API key paths continue during compatibility.

**Alternatives considered**:

- **Immediate destructive migration**: Rejected because agents and deployments need staged rollout.
- **No migration tooling**: Rejected because existing credential-shaped values need discoverability and operator guidance.
