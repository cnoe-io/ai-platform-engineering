# Feature Specification: MCP Server Authentication with Caller-Provided Backend Keys

**Feature Branch**: `101-mcp-auth-caller-key`
**Created**: 2026-04-17
**Status**: Draft

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Secure HTTP MCP Access via Shared Key (Priority: P1)

A platform operator deploys an MCP server in HTTP/SSE mode and wants to restrict access so only authorized callers (e.g., an orchestration agent) can invoke MCP tools. The operator sets a shared secret in the MCP server's environment. Callers include this secret as a bearer token. Unauthorized callers are rejected without reaching any backend service.

**Why this priority**: This is the most common hardening requirement — HTTP-exposed MCP servers with no auth represent a critical security gap. Shared key is the simplest mode to deploy and verify.

**Independent Test**: Can be tested end-to-end by starting an MCP server with `MCP_AUTH_MODE=shared_key` and `MCP_SHARED_KEY=secret`, then sending requests with and without the correct bearer token.

**Acceptance Scenarios**:

1. **Given** an MCP server running in HTTP mode with `MCP_AUTH_MODE=shared_key` and `MCP_SHARED_KEY=my-secret`, **When** a caller sends `Authorization: Bearer my-secret`, **Then** the request is authenticated and the tool is executed
2. **Given** the same server, **When** a caller sends an incorrect or missing Authorization header, **Then** the server returns 401 Unauthorized without invoking any tool
3. **Given** the same server, **When** a caller sends a request to a public health-check path (e.g., `/healthz`), **Then** the request succeeds without requiring authentication

---

### User Story 2 - JWT/OAuth2-Based MCP Access (Priority: P2)

A platform operator uses an identity provider (e.g., Keycloak, Okta) for authentication. MCP servers should validate that callers hold a valid JWT issued by the configured identity provider, with the expected audience and issuer.

**Why this priority**: Organizations with existing OAuth2 infrastructure need to integrate MCP servers into their SSO/authorization model without introducing a separate secret management burden.

**Independent Test**: Can be tested by configuring `MCP_AUTH_MODE=oauth2`, `JWKS_URI`, `AUDIENCE`, and `ISSUER`, then sending requests with valid/expired/malformed JWTs.

**Acceptance Scenarios**:

1. **Given** an MCP server with `MCP_AUTH_MODE=oauth2` and valid JWKS/audience/issuer config, **When** a caller sends a valid JWT in `Authorization: Bearer <jwt>`, **Then** the request succeeds
2. **Given** the same server, **When** a caller sends an expired JWT, **Then** the server returns 401
3. **Given** the same server, **When** a caller sends a JWT with wrong audience or issuer, **Then** the server returns 401
4. **Given** the same server, **When** a caller sends no Authorization header, **Then** the server returns 401

---

### User Story 3 - No Auth Mode (Backward Compatibility) (Priority: P1)

Existing deployments running MCP servers in STDIO mode or in isolated/trusted environments should continue to work with zero configuration changes. The default auth mode must be `none`, preserving all existing behavior.

**Why this priority**: Breaking existing deployments would block adoption. Backward compatibility is required for safe rollout.

**Independent Test**: Can be tested by starting any MCP server with no `MCP_AUTH_MODE` env var set and confirming all tools work as before.

**Acceptance Scenarios**:

1. **Given** an MCP server with no `MCP_AUTH_MODE` set, **When** any request is received, **Then** it is processed without any authentication check
2. **Given** an MCP server in STDIO mode, **When** tools are invoked, **Then** backend tokens are read from environment variables as before

---

### User Story 4 - Caller Provides Backend API Key via Bearer Token (Priority: P2)

An orchestration agent calls an MCP server in shared_key mode. Rather than requiring each MCP server to have a per-service API key stored in its environment (e.g., `ARGOCD_API_TOKEN`), the caller passes its own API key as the bearer token. The MCP server uses that same token to call the backend service (ArgoCD, Jira, etc.). This allows different callers to use different backend accounts without any server-side configuration change.

**Why this priority**: Eliminates the need for platform operators to provision per-MCP-server backend credentials for every deployment environment, enabling dynamic multi-tenancy.

**Independent Test**: Can be tested by starting an MCP server in shared_key mode without any backend token env var, calling a tool with `Authorization: Bearer <actual-backend-token>`, and verifying the tool executes using that token.

**Acceptance Scenarios**:

1. **Given** an MCP server in shared_key mode with no backend token env var set, **When** a caller sends `Authorization: Bearer <argocd-token>`, **Then** the tool executes and makes backend calls using `<argocd-token>`
2. **Given** the same server with a backend token env var set, **When** no Authorization header is present (e.g., STDIO mode), **Then** the tool falls back to the env var token
3. **Given** the same server, **When** a caller provides a token that fails MCP authentication, **Then** the request is rejected with 401 and no backend call is made

---

### Edge Cases

- What happens when `MCP_AUTH_MODE` is set to an unrecognized value? The server should reject startup with a clear error message.
- What happens when `MCP_AUTH_MODE=shared_key` but `MCP_SHARED_KEY` is not set? The server should reject startup with a clear error message.
- What happens when `MCP_AUTH_MODE=oauth2` but `JWKS_URI` is unreachable at startup? The server should start but return 401 on all requests until JWKS is available.
- What happens when a JWT's signature is valid but the `cid` (client ID) is not in the allowed list? The request must be rejected with 401.
- What happens when both MCP auth token and backend token env var are available? The bearer token from the request takes precedence in shared_key mode.
- What happens in STDIO mode when no backend token env var is set? The tool should return a clear error message, not crash.
- What happens when Jira (which uses Basic auth with email+token) receives a caller-provided token? The caller-provided token replaces only the password portion; the email must remain in the env var.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: MCP servers MUST support three authentication modes for HTTP/SSE transport: `none`, `shared_key`, and `oauth2`, controlled by the `MCP_AUTH_MODE` environment variable
- **FR-002**: The default value of `MCP_AUTH_MODE` MUST be `none` to preserve backward compatibility for all existing deployments
- **FR-003**: In `shared_key` mode, the system MUST reject requests where the `Authorization: Bearer <token>` header does not match `MCP_SHARED_KEY` using constant-time comparison, returning HTTP 401
- **FR-004**: In `oauth2` mode, the system MUST validate the bearer JWT against the JWKS endpoint specified by `JWKS_URI`, checking `iss`, `aud`, `exp`, `nbf`, and optionally `cid` claims, returning HTTP 401 for invalid tokens
- **FR-005**: Authentication MUST be skipped for requests to designated public paths (e.g., `/healthz`) regardless of auth mode
- **FR-006**: Authentication MUST be skipped for STDIO transport regardless of `MCP_AUTH_MODE`
- **FR-007**: In `shared_key` mode, the bearer token used for MCP authentication MUST also be forwarded as the backend service API key when the tool makes calls to external services
- **FR-008**: Tools MUST fall back to reading the backend API token from the server's environment variables when no Authorization header is present (STDIO mode and `none` mode)
- **FR-009**: The authentication logic MUST be packaged as a shared common package that all MCP servers can depend on, avoiding code duplication
- **FR-010**: MCP servers MUST NOT raise startup errors when backend API key environment variables are absent in HTTP/shared_key mode (the key will be supplied per-request by callers)
- **FR-011**: The system MUST support OPTIONS requests (CORS preflight) without requiring authentication in all modes
- **FR-012**: All authentication failures MUST be logged at WARNING level with the reason, without exposing token values in logs
- **FR-013**: The shared auth package MUST have no dependency on `a2a-sdk` or `a2a.types`

### Key Entities

- **MCP Auth Mode**: The configured authentication strategy for an MCP server (`none`, `shared_key`, `oauth2`); set once at server startup via env var
- **Bearer Token**: The credential included by callers in `Authorization: Bearer <token>`; serves dual purpose in shared_key mode as both MCP auth credential and backend API key
- **Shared Key**: A symmetric secret (`MCP_SHARED_KEY`) that both the MCP server and authorized callers know; used in `shared_key` mode
- **JWKS Endpoint**: A URL (`JWKS_URI`) serving JSON Web Key Sets for JWT signature verification in `oauth2` mode
- **Backend API Token**: The credential used to authenticate calls from an MCP tool to its upstream service (ArgoCD, Jira, Confluence, etc.); sourced from bearer token in HTTP mode or env var in STDIO mode
- **Public Path**: A URL path that bypasses authentication (e.g., `/healthz`)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 10 first-party MCP servers running in HTTP mode with `MCP_AUTH_MODE=shared_key` reject unauthenticated requests with 401 — 100% coverage
- **SC-002**: All 10 first-party MCP servers continue to function identically in STDIO mode with no environment variable changes — zero regressions
- **SC-003**: A caller can authenticate to an MCP server and invoke a backend tool using a single bearer token, with no backend API key stored in the server environment — end-to-end in under 5 seconds
- **SC-004**: Operators can switch between `none`, `shared_key`, and `oauth2` modes via a single environment variable change without code modification
- **SC-005**: The shared auth package is the single source of auth logic — no per-server duplication; adding auth to a new MCP server requires only adding one dependency and one middleware line
- **SC-006**: Invalid, expired, or missing credentials are rejected within 50ms without invoking any tool or making any backend call
- **SC-007**: All three auth modes are covered by automated unit tests with positive and negative test cases

## Assumptions

- FastMCP's HTTP transport (`run_http_async`) accepts Starlette-compatible middleware, enabling standard `BaseHTTPMiddleware` injection
- `get_http_request()` from FastMCP's dependencies module is available within tool functions to access per-request headers
- PyJWT is available as a direct dependency (not a FastMCP transitive dep) for oauth2 JWT validation
- For Jira's Basic auth pattern, the caller-provided token replaces only the API token portion; the email/username remains a required server-side env var
- VictorOps multi-org mode (`VICTOROPS_ORGS` env var) is incompatible with caller-provided keys and retains existing env-var-only behavior
- STDIO transport is implicitly trusted (process boundary); no network-level auth is needed or possible

## Out of Scope

- Refresh token handling or token rotation for OAuth2 flows
- Role-based access control (RBAC) — all authenticated callers have equal access to all tools
- Audit logging beyond the existing application log
- Changes to A2A server authentication (separate system)
- MCP server authentication for non-first-party or third-party MCP servers
