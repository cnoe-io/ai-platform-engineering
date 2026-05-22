# Feature Specification: MongoDB Envelope Credentials and Credential Exchange

**Feature Branch**: `prebuild/fix-helm-image-channel`
**Created**: 2026-05-20
**Status**: Draft
**Input**: User description: "Add a new secrets manager component in UI that manages user BYO secrets used in Dynamic Agent MCP servers or wherever credentials are needed. It can expose an API interface to let other internal microservices or apps retrieve user credentials using JWT. MongoDB in-cluster envelope encryption is good enough for initial secure storage, using cleaner interfaces so OpenBao can be used later. Secrets are based on user boundary or team boundary and can be shared between teams. Also implement another credential_exchange component, potentially using Keycloak, for storing external 3-legged authorization for apps like GitHub, Atlassian, Webex. Store access or ID OAuth tokens in encrypted credential storage or Keycloak broker storage, use our JWT to exchange them as needed, and support refresh-token rotation on behalf of the user when the provider allows it. This acts as a credential cache for impersonation use cases. Merge relevant code from PR #1282 into the implementation and put this feature behind a feature toggle."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manage User and Team BYO Secrets (Priority: P1)

As a CAIPE user or team administrator, I need a secure secrets manager in the UI where I can add, update, share, and revoke credentials for Dynamic Agent MCP servers and other credential-consuming workflows, so secrets no longer need to be stored as plaintext in MongoDB, Helm values, or environment-variable indirection records.

**Why this priority**: Dynamic Agent MCP server configuration can currently carry credential-shaped values in persisted configuration. The first usable slice must give users and teams a safe credential home before downstream runtime integration expands.

**Independent Test**: Create a personal secret and a team-shared secret through the UI, verify only non-secret metadata is visible after save, grant a team access, revoke that access, and confirm unauthorized users cannot discover or use the secret.

**Acceptance Scenarios**:

1. **Given** an authenticated user opens the secrets manager, **When** they create a personal secret, **Then** the secret value is envelope-encrypted before persistence and only metadata, ownership, and policy references are visible in CAIPE.
2. **Given** a team administrator manages a team-owned secret, **When** they share the secret with another team for use, **Then** authorized members of the target team can use the secret without seeing the raw value.
3. **Given** a user lacks read or use permission for a secret, **When** they search, view, or attempt to use that secret, **Then** CAIPE denies the request without disclosing the secret value or unnecessary existence details.
4. **Given** a secret is rotated or revoked, **When** a downstream Dynamic Agent MCP server tries to use the old reference, **Then** execution fails closed or uses the new version according to the configured rotation state.

---

### User Story 2 - Use Secrets Through a Standard Service Credential API (Priority: P1)

As a Dynamic Agent author or internal service owner, I need a standard server-to-server credential API that resolves policy-controlled secret references only with a valid CAIPE JWT or approved service token, so runtime services can use credentials without embedding raw secrets in agent, MCP, app configuration, or browser code.

**Why this priority**: The secrets manager is only useful if the runtimes that need credentials can consume it safely with user and team boundaries.

**Independent Test**: Configure one Dynamic Agent MCP server to use a secret reference for an environment variable or authorization header. Invoke the agent as an allowed and denied user, and verify only the allowed run receives the credential at runtime.

**Acceptance Scenarios**:

1. **Given** an MCP server configuration references a secret, **When** an authorized user invokes a Dynamic Agent that needs that MCP server, **Then** the runtime can resolve the secret for that invocation without persisting the raw value in the MCP server record.
2. **Given** the same MCP server is invoked by a user without `secret_ref#use`, **When** the runtime requests the credential, **Then** the retrieval API denies the request and the agent run fails before the tool call uses the secret.
3. **Given** an internal microservice has a service JWT and acts for a user or team context, **When** it requests a permitted secret, **Then** the API returns the minimum credential material needed for the operation and emits an audit event.
4. **Given** an internal microservice sends an expired, wrong-audience, or missing JWT, **When** it requests a secret, **Then** the API returns an authentication failure and no decrypt operation occurs.
5. **Given** browser UI code attempts to call the credential retrieval or credential exchange API to obtain raw credential material, **When** the request reaches CAIPE, **Then** CAIPE rejects it even if the browser user is authenticated; browser paths may submit raw values only during create or explicit rotate flows.
6. **Given** `USE_IMPERSONATION_TOKENS` is enabled for a GitHub, Jira, or Confluence MCP server, **When** an authorized user invokes tools from that server, **Then** CAIPE uses the user's provider credential from credential exchange instead of the deployment-level static token.
7. **Given** `USE_IMPERSONATION_TOKENS` is disabled for a GitHub, Jira, or Confluence MCP server, **When** the server starts or handles a request, **Then** CAIPE preserves the existing static credential behavior for compatibility.
8. **Given** AgentGateway fronts a provider-backed MCP route such as Jira, **When** a request carries a valid Keycloak JWT for a user with a connected provider account, **Then** CAIPE can inject that user's provider token into the upstream MCP request through a non-browser internal route, without each MCP server calling credential exchange directly.

---

### User Story 3 - Connect External OAuth Providers for Impersonation (Priority: P1)

As a CAIPE user, I need to connect external providers such as GitHub, Atlassian, Webex, and PagerDuty using 3-legged OAuth, so agents can act on my behalf with provider-scoped credentials instead of shared service tokens.

**Why this priority**: User impersonation use cases require delegated provider credentials. Platform OBO JWTs prove the CAIPE user identity, but they do not currently provide provider-specific access tokens.

**Independent Test**: Connect one provider account through a consent flow, verify CAIPE records a connection without exposing raw tokens, and invoke an authorized agent path that exchanges the user's CAIPE JWT for a provider token.

**Acceptance Scenarios**:

1. **Given** a user starts a GitHub, Atlassian, Webex, or PagerDuty connection flow, **When** they complete provider consent, **Then** CAIPE records an active provider connection linked to their CAIPE identity.
2. **Given** a user has an active provider connection, **When** an authorized Dynamic Agent requires that provider, **Then** the credential exchange service can provide a valid provider credential for that user and provider.
3. **Given** a provider requires refresh-token rotation, **When** a token is near expiry, **Then** CAIPE refreshes the token, stores the rotated refresh token when returned, and never logs the old or new token.
4. **Given** a user disconnects a provider connection, **When** an agent later requests that provider credential, **Then** the exchange fails with a reconnect-required outcome.

---

### User Story 4 - Admin Configures OAuth Connectors (Priority: P1)

As a platform administrator, I need to configure built-in and custom OAuth connectors for providers such as GitHub, Atlassian, Webex, and standards-compliant OAuth/OIDC services, so users can connect provider accounts without CAIPE developers hard-coding every provider.

**Why this priority**: The credential exchange feature only scales if operators can add and manage provider connectors safely while CAIPE stores connector client secrets and user token sets through the same encrypted credential-store interface.

**Independent Test**: Add a custom OAuth connector with authorization URL, token URL, client ID, encrypted client secret, redirect URI, scopes, profile mapping, and refresh policy. Enable it for one team, connect a user account, and verify only authorized users and agents can use the resulting provider credential.

**Acceptance Scenarios**:

1. **Given** an admin opens the OAuth connector settings, **When** they configure a built-in connector such as GitHub or Atlassian, **Then** CAIPE shows provider-specific required fields, safe defaults, redirect URI, scopes, and validation status.
2. **Given** an admin creates a custom standard OAuth connector, **When** they provide authorization URL, token URL, client credentials, scopes, and identity mapping, **Then** CAIPE validates and stores the connector with its client secret envelope-encrypted.
3. **Given** a connector is disabled, **When** a user tries to create or use a connection for that provider, **Then** CAIPE blocks new consent flows and fails existing credential exchange requests with a provider-disabled outcome.
4. **Given** a connector's client secret is rotated, **When** users with existing provider connections refresh tokens, **Then** CAIPE uses the new connector secret and records non-secret audit metadata for the rotation.
5. **Given** a custom connector points to an unapproved host, non-HTTPS URL, localhost, link-local, private IP, or unsupported protocol, **When** the admin saves or tests it, **Then** CAIPE rejects the connector to prevent SSRF and credential exfiltration.

---

### User Story 5 - Govern Sharing, Audit, and Access Boundaries (Priority: P2)

As a platform administrator or security reviewer, I need user, team, and service access to secrets and provider credentials to follow the same ReBAC and audit model as the rest of CAIPE, so delegated credentials do not become a bypass around resource authorization.

**Why this priority**: Secrets are high-value resources. They need explicit ownership, sharing, auditability, and denial behavior before broad adoption.

**Independent Test**: Grant and revoke `secret_ref` relationships for users, teams, and services, then verify allow/deny outcomes, audit events, and policy explanations match the configured graph.

**Acceptance Scenarios**:

1. **Given** a secret is team-owned, **When** a team member has use permission but not manage permission, **Then** they can use the secret through approved runtime paths but cannot reveal, rotate, delete, or share it.
2. **Given** an administrator reviews credential activity, **When** they inspect audits, **Then** they can see who used which secret reference or provider connection, for what resource, and with what outcome without seeing raw secret values.
3. **Given** a policy change would grant a team use of a secret, **When** the change is previewed, **Then** CAIPE marks it as a sensitive credential-sharing change before applying it.

---

### User Story 6 - Operate Envelope Encryption and Credential Exchange in CAIPE Deployments (Priority: P2)

As a platform operator, I need MongoDB envelope encryption and credential exchange deployment paths that work locally and in Helm/GitOps installs, so the secure credential architecture can be tested, backed up, monitored, and recovered without introducing a new datastore in the first release.

**Why this priority**: Envelope encryption moves credential custody into the existing MongoDB-backed control plane, but it is not production-ready without KMS/CMK key wrapping, rotation, backup, health, and failure-mode guidance.

**Independent Test**: Enable the local development stack and Helm values for MongoDB envelope-encrypted credential storage, create a test secret, restart dependent services, and verify credential metadata and encrypted credential material remain consistent.

**Acceptance Scenarios**:

1. **Given** a developer enables the local credential profile, **When** the stack starts, **Then** envelope encryption is available for development use with documented bootstrap behavior and no production secrets in source.
2. **Given** an operator renders Helm values, **When** credential exchange is enabled, **Then** the manifests show explicit KMS/CMK or development-key references, health checks, storage settings, and no hardcoded credentials.
3. **Given** KMS/CMK or key-wrap dependencies are temporarily unavailable, **When** a runtime asks for a credential that requires decrypting or rotating material, **Then** CAIPE fails closed and returns a retryable credential-store-unavailable outcome.

---

### User Story 7 - Migrate Existing Credential References Safely (Priority: P3)

As a platform operator, I need a migration path from existing environment-variable references, MCP server inline environment values, and catalog API key storage, so current deployments can adopt envelope-encrypted credential references without breaking all existing agents at once.

**Why this priority**: Several existing paths use MongoDB metadata, environment variables, or Kubernetes Secrets. A staged migration avoids a disruptive cutover.

**Independent Test**: Run migration checks against sample MCP servers and skill hubs, preview which fields are credential-shaped, migrate selected values to envelope-encrypted secret references, and verify old plaintext values are removed or flagged.

**Acceptance Scenarios**:

1. **Given** an existing MCP server has credential-shaped environment values, **When** an operator previews migration, **Then** CAIPE identifies candidate fields without moving anything automatically.
2. **Given** an operator approves migration for a credential value, **When** migration completes, **Then** the raw value is stored as envelope-encrypted credential material, the MCP server record uses a secret reference, and the old plaintext value is no longer persisted in the record.
3. **Given** existing skill hub `credentials_ref` records remain env-var based, **When** the new secrets manager is enabled, **Then** CAIPE supports a documented compatibility period and shows which hubs still need migration.

---

### User Story 8 - Gate Security UI V2 Integration Behind a Feature Toggle (Priority: P3)

As a platform operator, I need the security UI and credential-management pieces imported from PR #1282 to be disabled by default until the envelope-encrypted credential architecture is ready, so broad admin UI, encryption, and credential-handling changes can be integrated without changing production behavior prematurely.

**Why this priority**: PR #1282 contains useful foundations but also a wide surface area. A feature toggle allows selective integration, safe testing, and rollback while preserving current release behavior.

**Independent Test**: Start CAIPE with the feature toggle disabled and verify legacy credential and admin UI behavior remains unchanged. Enable the toggle and verify the new secrets manager, credential exchange, and reused PR #1282 UI/foundation pieces become visible only to authorized users.

**Acceptance Scenarios**:

1. **Given** the credential feature toggle is disabled, **When** users open the UI or Dynamic Agents invoke existing MCP servers, **Then** existing static credential behavior remains unchanged and no new secrets-manager routes are exposed.
2. **Given** the feature toggle is enabled for an administrator, **When** the administrator opens the Security or credential-management UI, **Then** the envelope-encrypted secrets manager and credential exchange surfaces are visible according to RBAC policy.
3. **Given** code from PR #1282 overlaps with current branch behavior, **When** it is integrated, **Then** CAIPE keeps current RBAC, Keycloak, and Dynamic Agent behavior unless the new feature toggle is enabled.

### Edge Cases

- A user belongs to multiple teams that can use different versions of the same provider credential; CAIPE must choose based on the selected agent/resource context or reject ambiguous requests.
- A team-shared secret is deleted while an agent run is in progress; CAIPE must not reuse stale material beyond the current authorized operation.
- A secret's metadata exists in MongoDB but the encrypted payload, wrapped data key, key version, or encryption metadata is missing or invalid; CAIPE must report drift and fail closed for use.
- A future OpenBao backend contains a secret path with no CAIPE metadata owner; CAIPE must not surface or use it unless an administrator imports and binds it.
- A provider returns a rotated refresh token; CAIPE must atomically replace the stored refresh token from the caller's perspective.
- A provider revokes refresh access out of band; CAIPE must mark the connection reconnect-required rather than repeatedly attempting failed refreshes.
- A custom OAuth connector lacks a usable profile or userinfo endpoint; CAIPE must require an explicit identity claim mapping or block connector activation.
- A connector changes requested scopes after users have connected; CAIPE must mark affected connections as re-consent-required rather than silently using stale grants.
- A service JWT attempts to retrieve a credential for a different user without an approved delegation context; CAIPE must deny the request.
- A browser-origin session or browser-accessible token attempts to call the service credential retrieval or provider credential exchange API; CAIPE must deny the request and must not decrypt or return material.
- A raw secret, OAuth token, refresh token, or provider API key appears in logs, audit payloads, traces, browser responses, or error messages; this is a security failure.
- A user attempts to share a personal provider OAuth connection with a team; CAIPE must allow this only for providers and scopes explicitly classified as shareable.
- A provider supports only non-refreshing or long-lived tokens; CAIPE must track the limitation and require reconnect or re-consent on failure.
- PR #1282 contains MongoDB envelope-encryption logic for secret material; CAIPE must adapt this into a KMS/CMK-backed credential-store interface rather than directly coupling every caller to ad hoc encryption helpers.
- PR #1282 contains unrelated admin/auth/LLM/health changes; CAIPE must integrate only the pieces needed for this feature unless planning explicitly includes the broader surface.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: CAIPE MUST provide a secrets manager UI for creating, listing, updating, rotating, sharing, revoking, and deleting user-owned and team-owned credential references.
- **FR-002**: CAIPE MUST store raw secret values and OAuth credential material only as envelope-encrypted payloads in dedicated MongoDB credential collections or encrypted credential fields, not as plaintext in MongoDB, browser storage, logs, traces, Helm values, or source-controlled files.
- **FR-003**: CAIPE MUST use a credential-store interface that hides the storage backend from callers and supports MongoDB envelope encryption first, with a future OpenBao backend possible without changing consumer contracts.
- **FR-004**: CAIPE MUST model secrets as ReBAC `secret_ref` resources with distinct discover, metadata-read, use, manage, audit, and share behaviors.
- **FR-005**: CAIPE MUST support personal, team-owned, and team-shared secret boundaries; a secret MUST NOT be usable outside its owner or shared team relationships.
- **FR-006**: CAIPE MUST expose a standard service-to-service credential API for approved internal services, Dynamic Agents, and MCP runtimes to retrieve credential material by reference using JWT authentication, declared audience, acting subject, resource context, intended use, and `secret_ref#use` authorization before decrypting credential material.
- **FR-007**: CAIPE MUST return credential material only to approved server-side consumers and MUST NOT expose raw secret values to browsers after initial create or explicit rotate request ingestion.
- **FR-008**: Browser clients MUST NOT be allowed to call credential retrieval or provider credential exchange endpoints for raw credential material; those endpoints MUST reject browser-origin, session-only, CSRF-shaped, or otherwise browser-accessible requests before decrypting, refreshing, or returning credential material.
- **FR-009**: CAIPE MUST support Dynamic Agent MCP server configurations that reference secret IDs for environment variables, authorization headers, API keys, OAuth bearer tokens, and provider-specific credential fields.
- **FR-010**: CAIPE MUST preserve a compatibility path for existing env-var `credentials_ref` records while making envelope-encrypted secret references the target model.
- **FR-011**: CAIPE MUST provide drift detection for missing encrypted payloads, invalid encryption metadata, unsupported key versions, stale grants, orphan future-backend paths, missing secret metadata, and failed migrations.
- **FR-012**: CAIPE MUST audit create, read-metadata, use, rotate, share, revoke, delete, denied, and drift-detected outcomes for secrets and provider credentials without recording raw credential values.
- **FR-013**: CAIPE MUST provide a credential exchange component for provider-delegated credentials used by agents, MCP servers, and internal microservices.
- **FR-014**: Credential exchange MUST support 3-legged OAuth connection lifecycle states for GitHub, Atlassian, Webex, and PagerDuty: not connected, pending consent, active, refresh required, reconnect required, revoked, and failed.
- **FR-015**: Credential exchange MUST bind each provider connection to a CAIPE user identity and MAY bind provider credentials to a team only when provider policy and CAIPE policy allow team sharing.
- **FR-016**: Credential exchange MUST use the caller's CAIPE JWT or approved OBO token as the identity anchor for provider credential retrieval.
- **FR-017**: Credential exchange MUST enforce that a caller is authorized to use the selected provider credential for the selected agent, MCP server, tool, or internal app before issuing or injecting a provider token.
- **FR-018**: Credential exchange MUST refresh access tokens before expiry when a refresh token is present and MUST store rotated refresh tokens when the provider returns them.
- **FR-019**: Credential exchange MUST handle providers that do not issue refresh tokens by marking credentials as reconnect-required after provider rejection or expiry.
- **FR-020**: Credential exchange MUST support provider-specific account metadata such as organization, workspace, cloud site, installation, tenant, or account identifier without storing raw tokens in metadata.
- **FR-021**: Credential exchange MUST support disconnect and revoke flows that prevent future token issuance and remove or invalidate stored token material.
- **FR-022**: Credential exchange MUST fail closed for missing identity, missing provider connection, denied authorization, expired JWT, credential-store outage, key-wrap/decrypt failure, provider refresh failure, policy service outage, or browser-side retrieval attempts.
- **FR-023**: CAIPE MUST provide provider connection UI surfaces where users can connect, view status, refresh/reconnect, disconnect, and understand which agents or teams can use their provider credentials.
- **FR-024**: CAIPE MUST provide administrator and security-review surfaces for inventory, audit, policy explanation, drift, and sensitive sharing review across secret references and provider connections.
- **FR-025**: CAIPE MUST document and evaluate three credential-exchange storage options: MongoDB envelope-encrypted storage, Keycloak broker token storage, and future OpenBao-backed storage.
- **FR-026**: CAIPE MUST use MongoDB envelope-encrypted credential storage as the default initial architecture unless planning proves Keycloak broker storage is required for a provider-specific use case.
- **FR-027**: If Keycloak broker token storage is used for any provider, CAIPE MUST document provider support, token refresh behavior, revocation behavior, audit behavior, storage risk, and fallback behavior before enabling it.
- **FR-028**: CAIPE MUST include local development, Helm, and GitOps deployment paths for envelope encryption, credential exchange, and their required KMS/CMK or development-key bootstrap settings.
- **FR-029**: CAIPE MUST include backup, restore, key rotation, health-check, and operational runbook guidance for envelope-encrypted credentials.
- **FR-030**: CAIPE MUST provide migration tooling or guided migration checks for existing MCP server inline credentials, skill hub env-var references, and catalog API key credential storage.
- **FR-031**: CAIPE MUST support a `USE_IMPERSONATION_TOKENS` capability flag for GitHub, Jira, and Confluence MCP servers.
- **FR-032**: When `USE_IMPERSONATION_TOKENS` is enabled for GitHub MCP, CAIPE MUST use the authenticated user's GitHub OAuth credential from credential exchange as the GitHub bearer token for MCP requests instead of a deployment-level `GITHUB_PERSONAL_ACCESS_TOKEN`.
- **FR-033**: When `USE_IMPERSONATION_TOKENS` is enabled for Jira or Confluence MCP, CAIPE MUST use the authenticated user's Atlassian OAuth credential from credential exchange as a bearer token against Atlassian Cloud API endpoints instead of API-token basic authentication.
- **FR-034**: When `USE_IMPERSONATION_TOKENS` is disabled or unsupported for a server, CAIPE MUST preserve existing static credential behavior and clearly mark the run as static-credential mode in non-secret diagnostics.
- **FR-035**: When impersonation mode is enabled but the user lacks a connected provider credential, required provider scope, site/cloud access, or policy permission, CAIPE MUST fail closed with a reconnect-required, scope-required, site-not-authorized, or authorization-denied outcome before issuing the MCP tool call.
- **FR-035a**: CAIPE MUST expose an AgentGateway-compatible credential injector path that can resolve a user's provider connection from the Keycloak JWT subject and return provider-token headers for a future upstream MCP injection path; until the deployed AgentGateway supports backend response-header injection, the active Jira implementation MUST keep user-specific provider-token injection in the Dynamic Agents/Jira connector path.
- **FR-036**: CAIPE MUST provide an admin OAuth connector configuration UI for built-in connectors and custom standards-compliant OAuth/OIDC connectors.
- **FR-037**: OAuth connector configuration MUST support provider display metadata, authorization URL, token URL, optional userinfo/profile URL, optional accessible-resources URL, client ID, encrypted client secret, redirect URI, requested scopes, refresh policy, identity-claim mapping, token response mapping, and enablement state.
- **FR-038**: OAuth connector client secrets MUST be stored through the envelope-encrypted credential-store interface and MUST be masked in all read responses.
- **FR-039**: Custom OAuth connectors MUST be validated before activation, including HTTPS-only URLs, allowed hostnames, no embedded credentials, no localhost/private/link-local destinations, state/PKCE support where applicable, supported grant type, and bounded scopes.
- **FR-040**: Connector enablement MAY be scoped by team, provider, or admin policy so a provider can be available only to approved users or teams.
- **FR-041**: Connector scope changes MUST mark affected provider connections as re-consent-required unless the existing grant already satisfies the new required scopes.
- **FR-042**: CAIPE MUST place the envelope-encrypted secrets manager, credential exchange, OAuth connector configuration, and MCP impersonation-token behavior behind an explicit feature toggle that is disabled by default.
- **FR-043**: The feature toggle MUST gate UI navigation, UI routes, BFF/API routes, runtime credential retrieval, connector configuration, migration actions, and MCP impersonation-token behavior.
- **FR-044**: When the feature toggle is disabled, CAIPE MUST preserve existing behavior for MCP server credentials, skill hub credentials, catalog API keys, Dynamic Agent execution, and admin UI navigation.
- **FR-045**: CAIPE MUST evaluate PR #1282 as an implementation input and selectively merge reusable pieces relevant to this feature, including feature-flag infrastructure, audit/rate-limit helpers, MCP header handling, admin UI panels, and tests where compatible with the current branch.
- **FR-046**: CAIPE MUST adapt PR #1282's MongoDB envelope-encryption storage into the primary initial credential store, while replacing DB-stored master-key behavior with KMS/CMK-backed key wrapping for production deployments.
- **FR-047**: CAIPE MUST keep encryption/decryption behind narrow interfaces so a future OpenBao backend can replace MongoDB envelope storage without changing GitHub, Jira, Confluence, Dynamic Agent, OAuth connector, or BFF consumers.
- **FR-048**: Automated tests MUST cover allowed use, denied use, missing JWT, wrong audience, wrong user, wrong team, browser retrieval denied, browser exchange denied, credential-store unavailable, key decrypt/wrap failure, provider refresh success, provider refresh failure, revoked credential, connector validation, connector disabled, connector scope change, GitHub impersonation mode, Jira/Confluence impersonation mode, static fallback mode, feature-toggle disabled mode, feature-toggle enabled mode, and migration preview cases.
- **FR-049**: Canonical RBAC documentation under `docs/docs/security/rbac/` MUST be updated in the same implementation to cover envelope-encrypted credential storage, secrets manager, credential exchange, OAuth connector configuration, JWT retrieval flows, provider token flows, MCP impersonation-token mode, feature-toggle behavior, and auth-relevant file mappings.

### Key Entities *(include if feature involves data)*

- **Secret Reference**: A policy-controlled CAIPE resource representing a secret stored through the credential-store interface. It has an identifier, owner, visibility boundary, status, version metadata, and storage pointer.
- **Encrypted Credential Payload**: The ciphertext, wrapped data key, nonce/IV, authentication tag, algorithm, key version, and storage metadata needed to decrypt sensitive credential material through the credential-store interface.
- **Secret Value**: The sensitive credential material protected by envelope encryption, such as API keys, bearer tokens, client secrets, private credentials, or provider refresh tokens.
- **Secret Owner**: The user or team that controls management rights for a secret reference.
- **Secret Consumer**: A server-side component, Dynamic Agent runtime, MCP server launcher, or internal microservice that requests credential material for an authorized operation.
- **Credential Retrieval Request**: A JWT-authenticated request that asks for a credential by reference and includes the acting subject, resource context, and intended use.
- **Service Credential API**: The standard internal API contract used by approved server-side CAIPE services to retrieve or exchange credential material by reference; browser clients are outside this trust boundary.
- **Provider Connection**: A user's delegated OAuth relationship with an external provider such as GitHub, Atlassian, Webex, or PagerDuty.
- **OAuth Connector**: An admin-configured provider definition that describes how CAIPE starts consent, exchanges codes, refreshes tokens, maps provider identity, and stores connector client credentials.
- **Provider Token Set**: Access, ID, refresh, expiry, scope, and provider-account material associated with a provider connection and stored securely.
- **Credential Exchange Decision**: The allow, deny, refresh, reconnect-required, or unavailable result produced when a caller asks for a provider credential.
- **Credential Injector Request**: A non-browser AgentGateway authorization subrequest that carries the caller's Keycloak JWT and asks CAIPE to return provider-token headers for a specific upstream MCP route.
- **Credential Policy Binding**: The ReBAC relationship that allows a user, team, service, agent, tool, or MCP server to use a secret or provider connection.
- **Impersonation Token Mode**: A per-MCP-server capability mode enabled by `USE_IMPERSONATION_TOKENS` that replaces deployment-level static credentials with user-scoped provider credentials retrieved through credential exchange.
- **Credential Feature Toggle**: The deployment and runtime switch that enables or disables the envelope-encrypted secrets manager, credential exchange, migration actions, and MCP impersonation-token mode.
- **PR #1282 Security UI V2 Input**: Existing branch work that includes envelope encryption, feature flags, MCP header handling, audit/rate limiting, health surfaces, and admin UI components to evaluate and selectively reuse.
- **Key Wrapping Provider**: The root-key integration that wraps per-secret data encryption keys. Production target is AWS KMS/CMK or equivalent cloud KMS; local development may use a generated development key with clear warnings.
- **Credential Audit Event**: A non-secret record of credential lifecycle, use, denial, refresh, migration, and drift events.

### Assumptions

- MongoDB envelope encryption is acceptable as the initial secure datastore for user and team BYO credentials when production key wrapping uses AWS KMS/CMK or an equivalent KMS.
- MongoDB remains available for encrypted credential payloads, non-secret metadata, UI query patterns, migrations, audit summaries, and relationship provenance.
- OpenFGA/ReBAC remains the authorization source of truth for secret discovery, metadata reads, use, management, audit, and sharing.
- Keycloak remains the identity anchor for user JWTs, service tokens, OBO flows, and provider-connection ownership.
- Dynamic Agent MCP server configuration can be extended to reference secrets instead of carrying raw credential values.
- External provider support starts with GitHub, Atlassian, Webex, and PagerDuty, with provider-specific behavior captured as metadata and tests.
- GitHub MCP can consume user-scoped OAuth/PAT-style bearer credentials when supplied per request or per invocation, while Jira and Confluence MCP require an Atlassian OAuth bearer-token mode because their current static path uses API-token basic authentication.
- Webex platform identity linking and Webex API 3-legged OAuth may share provider branding but are separate credential concerns unless explicitly unified during planning.
- Existing environment-variable credential references and Kubernetes Secret/ExternalSecret patterns continue to work during a documented compatibility period.
- PR #1282 is a reference implementation input from an older `release/0.5.0` base and must be reconciled with current `release/0.5.1` RBAC, Keycloak, Dynamic Agents, and UI patterns before code is adopted.

### Out Of Scope

- Replacing Keycloak as CAIPE's identity provider.
- Replacing OpenFGA/ReBAC as the authorization decision source.
- Storing enterprise SSO upstream tokens for Okta, Entra, or Duo unless a later spec explicitly requires it.
- Exposing raw secret values to browser clients after create or rotate request submission, including via internal retrieval or exchange endpoints.
- Building a generic public secrets API for third-party clients outside CAIPE-controlled service boundaries.
- Migrating every existing deployment secret, such as `MONGODB_URI`, `NEXTAUTH_SECRET`, Keycloak admin secrets, Slack bot tokens, and Webex bot tokens, into the user-facing secrets manager in the initial slice.
- Supporting arbitrary OAuth providers before GitHub, Atlassian, Webex, and PagerDuty provider contracts are complete.

## Feasibility and Architecture Options

### Option A - MongoDB Envelope-Encrypted Credential Store (Recommended)

MongoDB stores dedicated encrypted credential payloads and non-secret metadata. Each credential value is encrypted with a per-secret data encryption key; the data encryption key is wrapped by AWS KMS/CMK or an equivalent KMS in production. Retrieval goes through a JWT-authenticated internal API that enforces ReBAC before decrypting.

**Pros**:

- Avoids introducing another datastore in the initial release.
- Fits existing MongoDB-backed CAIPE metadata and admin UI patterns.
- Lets CAIPE selectively reuse PR #1282 envelope-encryption, masking, key-rotation, and MCP-header foundations while preserving author credit.
- Keeps plaintext credentials out of MongoDB, logs, browser responses, Helm values, and source-controlled files.
- Supports a clean backend interface so OpenBao can replace the encrypted MongoDB backend later.

**Cons**:

- MongoDB still holds ciphertext, wrapped data keys, and credential metadata, so compromise analysis must include app runtime plus MongoDB plus KMS permissions.
- CAIPE owns encryption correctness, key rotation, decrypt authorization, and failure handling.
- It does not provide native OpenBao leasing, revocation trees, or secret-engine isolation.
- Requires strict KMS/CMK IAM boundaries so only authorized runtime services can unwrap data keys.

### Option B - Keycloak Broker Token Storage for External Provider Credentials

Keycloak brokers GitHub, Atlassian, and Webex OAuth connections, stores external tokens when configured to do so, and exchanges CAIPE JWTs for provider tokens through Keycloak token exchange or broker APIs.

**Pros**:

- Uses the existing identity provider and account-linking model.
- May reduce custom OAuth connection code for supported providers.
- Can pair provider connections directly with Keycloak user identities.
- May support refresh behavior for some providers through Keycloak broker capabilities.

**Cons**:

- Turns Keycloak and its database into a high-value third-party token store.
- Current realm configuration intentionally uses `storeToken: false` for enterprise IdPs and has no GitHub/Atlassian provider brokers wired for this use.
- Keycloak token-exchange behavior already has scope limitations in this codebase, so provider token exchange must be verified provider by provider.
- Sharing provider credentials across teams is not a natural Keycloak broker model.
- Audit, rotation, reconnect, and provider-specific failure handling may be harder to make product-visible.

### Option C - Hybrid Identity Anchor With Future OpenBao Token Vault

Keycloak continues to handle login, user identity, linking, service tokens, and platform OBO JWTs. The credential exchange component keeps the same storage interface but swaps the initial MongoDB envelope backend for OpenBao when the operational burden is justified. Provider credential retrieval still requires a valid CAIPE JWT and ReBAC allow decision.

**Pros**:

- Keeps Keycloak focused on identity and platform authorization.
- Keeps third-party tokens in a secret manager designed for credential storage once CAIPE is ready to operate it.
- Supports a future opt-in Keycloak broker path where a provider demonstrably works better there.
- Gives CAIPE consistent user/team sharing and audit semantics across static secrets and OAuth token sets.

**Cons**:

- Adds a new datastore and operational surface.
- Still requires CAIPE-owned OAuth callback, refresh, and provider-contract implementation unless Keycloak brokers a provider.
- Requires explicit boundaries between platform OBO tokens and external provider credentials.
- Needs additional testing to prevent confused-deputy flows between user JWTs, service JWTs, team sharing, and provider tokens.

## Proposed Design

### Architecture

Adopt Option A as the initial design. Add a CAIPE secrets manager that treats MongoDB envelope encryption as the initial credential-store backend and uses existing CAIPE metadata and ReBAC systems for ownership, discovery, sharing, and audit. Add a credential exchange component that stores external provider token sets through the credential-store interface and exposes a controlled internal exchange API for Dynamic Agents, MCP servers, and other internal apps.

Keycloak remains responsible for CAIPE user identity, service identity, OBO token minting, and JWT validation. OpenFGA remains responsible for whether a user, team, service, agent, or tool can discover, use, manage, share, or audit a secret reference or provider credential. MongoDB stores non-secret records, UI-friendly metadata, and encrypted credential payloads, but not plaintext credential material.

The implementation should selectively merge compatible PR #1282 foundations behind the new credential feature toggle. The feature-flag and admin UI patterns from PR #1282 are useful for safe rollout. The MCP header handling, envelope encryption, key-rotation, masking, and audit/rate-limit helpers are useful implementation inputs. The implementation must adapt those pieces into a narrow credential-store interface and use KMS/CMK-backed key wrapping for production rather than a DB-stored master key.

### User Experience

CAIPE presents the feature as **Connections & Secrets**, not as a raw encryption or vault UI. Users see **My Connections** for provider accounts they connected, **Team Connections** for credentials shared with teams, **Secrets** for BYO API keys and tokens, **Where Used** for agent/MCP/tool references, and **Audit** for non-secret use history.

For a normal user, a GitHub/Jira/Webex/PagerDuty-backed agent can prompt: "Connect GitHub to let this agent act as you." After consent, the user returns to CAIPE and sees connection status such as `Connected`, `Reconnect required`, `Missing scopes`, `Provider disabled`, or `Revoked`. Users can disconnect their own provider connection and see which agents or teams are allowed to use it, but they do not see raw access or refresh tokens.

For a Dynamic Agent or MCP author, the MCP server editor exposes a credential source selector: `Static deployment secret`, `User impersonation token`, `Team shared secret`, or `Personal secret`. When `User impersonation token` is selected, the editor requires provider, required scopes, and provider-specific context such as Atlassian `cloudid`; fallback behavior is fail-closed.

For admins, the Security and credential-management area exposes feature-toggle status, connector configuration, credential inventory, team sharing, migration warnings, drift diagnostics, and audit logs. Admin views mask all secrets and provider tokens.

### Admin OAuth Connector Configuration

Admins configure built-in and custom OAuth connectors from a controlled **OAuth Connectors** panel. Built-in connectors such as GitHub, Atlassian, Webex, and PagerDuty provide provider-specific defaults. Custom connectors are allowed when they use standard authorization-code OAuth/OIDC semantics and pass validation.

Each connector captures provider display metadata, authorization URL, token URL, optional userinfo/profile URL, optional accessible-resources URL, client ID, encrypted client secret, redirect URI, requested scopes, refresh policy, identity-claim mapping, token response mapping, and enablement state. Client secrets are stored through the envelope-encrypted credential-store interface. Connector metadata remains queryable for UI and audit.

CAIPE validates custom connectors before activation: URLs must be HTTPS, must not include embedded credentials, must not target localhost/private/link-local addresses, and must match an admin-approved hostname policy. CAIPE uses state and PKCE where applicable, stores provider token sets through credential storage, and marks connections as re-consent-required when connector scopes change.

The dynamic connector capability is intentionally bounded. It supports standard OAuth/OIDC providers with predictable authorization, token, refresh, and profile/identity mapping. Providers with non-standard flows, device-code-only flows, custom signing, unusual token formats, or provider-specific resource discovery require a built-in connector adapter before activation.

### Data Flow - Static Secret Use

1. A user or team administrator creates a secret in the CAIPE secrets manager.
2. CAIPE envelope-encrypts raw secret material, stores the encrypted payload in a dedicated credential collection or encrypted credential field, and stores non-secret metadata and policy bindings in CAIPE metadata.
3. The secret appears in the UI only to subjects with discover or metadata-read permission.
4. A Dynamic Agent MCP server or internal app stores a `secret_ref` instead of a raw credential value.
5. At runtime, the consumer sends a JWT-authenticated credential retrieval request with user, service, resource, and intended-use context.
6. CAIPE validates the JWT, checks `secret_ref#use`, decrypts the value only after authorization succeeds, and returns or injects the minimum credential material required.
7. CAIPE writes a non-secret audit event for allow, deny, unavailable, and drift outcomes.

### Data Flow - Service Credential API Browser Guardrail

1. A browser may send raw credential material only to create a new secret, rotate an existing secret, or complete an OAuth callback where CAIPE exchanges a provider authorization code server-side.
2. Browser-facing list, detail, connector, connection, audit, and migration-preview routes return only metadata, masked indicators, statuses, and reason codes.
3. Internal credential retrieval and provider credential exchange routes require server-side caller classification, expected JWT audience, service or OBO context, resource context, and intended use.
4. If a browser-origin request, session-only request, CSRF-shaped request, or browser-accessible token attempts to retrieve or exchange raw credential material, CAIPE rejects the request before decrypt, provider refresh, or token issuance.
5. Credential material returned by the service API is delivered only to approved server-side consumers or injected into runtime calls; it is never proxied back to browser JavaScript.

### Data Flow - MCP Impersonation Token Mode

1. An operator or Dynamic Agent author enables `USE_IMPERSONATION_TOKENS` for a GitHub, Jira, or Confluence MCP server.
2. A user invokes an agent path that needs that MCP server.
3. CAIPE validates the user's JWT, verifies the user and agent are allowed to use the MCP server and provider credential, and asks credential exchange for the user's provider token.
4. For GitHub, CAIPE supplies the user-scoped GitHub bearer token to the GitHub MCP path for the invocation.
5. For Jira and Confluence, CAIPE supplies the user-scoped Atlassian bearer token and the selected `cloudid`/resource context to Atlassian Cloud API requests.
6. If no user credential is available, the credential is revoked, required scopes are missing, or the selected Atlassian site is not authorized, CAIPE fails before the MCP tool call is issued.
7. When `USE_IMPERSONATION_TOKENS` is disabled, CAIPE uses the existing static token path and records static-credential mode in non-secret diagnostics.

### Data Flow - Feature Toggle

1. CAIPE starts with the credential feature toggle disabled unless explicitly enabled by deployment configuration or an authorized admin runtime setting.
2. When disabled, the UI hides secrets-manager and credential-exchange navigation, BFF routes reject credential-management actions, and MCP servers keep existing static credential behavior.
3. When enabled, CAIPE exposes the new UI and APIs only to authorized users and only after credential-store, key-wrap, and policy dependencies are healthy.
4. Operators can disable the toggle to stop new credential-management actions and MCP impersonation-token use without deleting stored metadata or encrypted credential payloads.
5. Audit events record enable, disable, and denied-due-to-disabled outcomes without logging secret values.

### Data Flow - Provider Credential Exchange

1. A user starts a provider connection flow from the CAIPE UI.
2. CAIPE sends the user through provider consent and binds the completed connection to the user's CAIPE identity.
3. CAIPE stores provider token material through the credential-store interface and provider metadata in CAIPE metadata.
4. A runtime that needs delegated provider access sends a JWT-authenticated exchange request for a specific provider, provider account, and intended resource.
5. CAIPE validates identity, policy, provider connection state, and token freshness.
6. If the access token is stale and a refresh token exists, CAIPE refreshes it and stores any rotated token material through the credential-store interface.
7. CAIPE returns or injects a valid provider credential only to an approved server-side consumer and audits the outcome.

### Error Handling

All credential paths deny by default. Missing JWT, wrong audience, denied policy, missing secret, credential-store outage, KMS/CMK unwrap failure, provider refresh failure, revoked connection, mismatched user, unsupported provider, and ambiguous team context produce structured error categories. User-facing messages avoid leaking policy internals or secret existence. Operator diagnostics include specific non-secret reason codes and correlation IDs.

### Testing

Testing must cover unit-level policy checks, API-level authentication and authorization, envelope encryption/decryption, KMS/CMK key wrapping, credential-store outage behavior, provider refresh behavior, migration previews, Dynamic Agent MCP integration, and RBAC matrix coverage for `secret_ref` use/manage/share/audit actions. Documentation validation must include the canonical RBAC file map because this feature adds auth-relevant services, routes, and runtime retrieval paths.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of newly created user/team BYO secret values are stored only as envelope-encrypted payloads and are absent as plaintext from MongoDB records, browser responses, logs, traces, and source-controlled files after the create/rotate request completes.
- **SC-002**: 100% of unauthorized secret retrieval attempts are denied before a decrypt operation returns credential material.
- **SC-003**: 100% of browser attempts to retrieve or exchange raw credential material through the BFF or service credential API are denied before decrypt, provider refresh, or token issuance.
- **SC-004**: Authorized Dynamic Agent MCP invocations can resolve configured secret references without storing raw credential values in MCP server records.
- **SC-005**: Users can connect, view status, disconnect, and reconnect GitHub, Atlassian, Webex, and PagerDuty provider connections through CAIPE UI.
- **SC-006**: Provider credentials with refresh tokens are refreshed before expiry, and rotated refresh tokens are persisted without exposing old or new token values.
- **SC-007**: Revoked or disconnected provider credentials are not returned or injected into any downstream agent, MCP server, or internal app.
- **SC-008**: Credential audit records cover create, use, deny, rotate, refresh, revoke, share, and drift outcomes with zero raw credential values.
- **SC-009**: Admins can create, test, enable, disable, rotate, and delete built-in or custom OAuth connectors without exposing connector client secrets in UI responses.
- **SC-010**: 100% of custom OAuth connectors with non-HTTPS, embedded-credential, localhost, private-IP, link-local, unsupported protocol, or unapproved-host URLs are rejected before activation.
- **SC-011**: With `USE_IMPERSONATION_TOKENS` enabled, GitHub MCP requests use the invoking user's GitHub credential and fail closed when the user has no connected or authorized GitHub credential.
- **SC-012**: With `USE_IMPERSONATION_TOKENS` enabled, Jira and Confluence MCP requests use the invoking user's Atlassian OAuth credential and fail closed when the user lacks the required `cloudid`, scopes, site grant, or policy permission.
- **SC-013**: With the credential feature toggle disabled, existing MCP static credential behavior and admin navigation remain unchanged.
- **SC-014**: With the credential feature toggle enabled, authorized users can access the new secrets manager, OAuth connector, and credential exchange surfaces, and unauthorized users are denied.
- **SC-015**: Local and Helm deployment paths can enable envelope-encrypted credential storage with documented KMS/CMK, development-key, health, backup, rotation, and failure behavior.
- **SC-016**: Automated tests cover allowed, denied, browser retrieval denied, browser exchange denied, outage, wrong-user, wrong-team, revoked, refresh-success, refresh-failure, connector create/test/disable/scope-change, GitHub impersonation, Jira/Confluence impersonation, static fallback, feature-toggle enabled, feature-toggle disabled, and migration-preview scenarios.
- **SC-017**: Canonical RBAC documentation identifies every new envelope-encrypted credential store, secrets manager, OAuth connector, credential exchange, retrieval API, MCP impersonation-token path, feature-toggle path, and Dynamic Agent/MCP auth-relevant file added by the implementation.
