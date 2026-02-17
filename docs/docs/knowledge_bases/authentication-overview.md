# Authentication Overview

This page provides a conceptual overview of authentication and authorization in CAIPE RAG. For configuration details and environment variables, see the [Server README](https://github.com/cnoe-io/ai-platform-engineering/tree/main/ai_platform_engineering/knowledge_bases/rag/server/README.md).

## Authentication Methods

CAIPE RAG supports multiple authentication methods to accommodate different deployment scenarios:

| Method | Use Case | How It Works |
|--------|----------|--------------|
| **JWT Bearer Token** | Production | Validates tokens against OIDC provider |
| **OAuth2 Client Credentials** | Ingestors | Machine-to-machine authentication |
| **Trusted Network** | Development | IP-based trust for localhost/internal networks |

### JWT Bearer Token (Production)

The recommended authentication method for production deployments. Users authenticate through your OIDC provider (Keycloak, Okta, Azure AD, AWS Cognito, etc.) and the RAG server validates their JWT tokens.

**Flow:**
1. User authenticates with OIDC provider via UI
2. UI receives JWT access token
3. UI includes token in `Authorization: Bearer <token>` header
4. RAG server validates token:
   - Signature verification against OIDC provider's JWKS
   - Expiry (`exp`), not-before (`nbf`), issued-at (`iat`) claims
   - Audience (`aud`) matches configured `OIDC_AUDIENCE`
   - Issuer (`iss`) matches configured `OIDC_ISSUER`
5. Server resolves user groups (see [Groups Resolution Flow](#groups-resolution-flow))
6. Server assigns role based on group membership

### OAuth2 Client Credentials (Ingestors)

Ingestors use OAuth2 client credentials flow for machine-to-machine authentication. This doesn't involve a user - the ingestor authenticates as a service account.

**Flow:**
1. Ingestor requests token from OIDC provider using client ID/secret
2. Ingestor includes token in API requests
3. RAG server validates token against ingestor OIDC configuration
4. Server assigns configured role (default: `ingestonly`)

### Trusted Network (Development)

For local development and testing, trusted network access allows connections from configured IP ranges without authentication.

**Important:** Never enable trusted network in production. It grants the configured role (default: `admin`) to all requests from trusted IPs.

## Token Type Detection Flow

After validating the JWT token, the server determines whether it's a **user token** (SSO) or **client credentials token** (machine-to-machine):

```
┌─────────────────────────────────────────────────────────────────────┐
│                    VALIDATE ACCESS TOKEN                             │
│  ✓ Signature (JWKS)  ✓ exp  ✓ nbf  ✓ iat  ✓ aud  ✓ iss             │
└─────────────────────────────┬───────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Check: grant_type == "client_credentials"?                          │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │ YES                     │ NO
          ▼                         ▼
┌─────────────────┐    ┌──────────────────────────────────────────────┐
│ CLIENT CREDS    │    │  Check: has client_id/azp but NO user claims? │
│ (skip to role)  │    │  (email, preferred_username, upn, name)       │
└─────────────────┘    └──────────────────────┬───────────────────────┘
                                              │
                              ┌───────────────┴───────────────┐
                              │ YES                           │ NO
                              ▼                               ▼
               ┌─────────────────┐           ┌────────────────────────┐
               │ CLIENT CREDS    │           │  Check: token_use ==   │
               │ (skip to role)  │           │  "client_credentials"? │
               └─────────────────┘           └───────────┬────────────┘
                                                         │
                                         ┌───────────────┴───────────┐
                                         │ YES                       │ NO
                                         ▼                           ▼
                          ┌─────────────────┐       ┌─────────────────────┐
                          │ CLIENT CREDS    │       │  Check: sub is UUID │
                          │ (skip to role)  │       │  AND no user claims?│
                          └─────────────────┘       └──────────┬──────────┘
                                                               │
                                               ┌───────────────┴───────────┐
                                               │ YES                       │ NO
                                               ▼                           ▼
                                ┌─────────────────┐         ┌──────────────────┐
                                │ CLIENT CREDS    │         │ USER TOKEN (SSO) │
                                │ (skip to role)  │         │ → Groups Flow    │
                                └─────────────────┘         └──────────────────┘
```

### Client Credentials Path

When detected as client credentials:
- **Role**: Assigned `RBAC_CLIENT_CREDENTIALS_ROLE` (default: `ingestonly`)
- **Groups**: Empty (not applicable for machine tokens)
- **Email**: Set to `client:{client_id}` or `client:{ingestor_type}:{ingestor_name}`

### User Token (SSO) Path

When detected as a user token:
- Proceeds to [Groups Resolution Flow](#groups-resolution-flow)
- Role determined from group membership

### Detection Criteria Summary

| Check | Claim | Indicates Client Credentials |
|-------|-------|------------------------------|
| 1 | `grant_type == "client_credentials"` | Yes |
| 2 | Has `client_id`/`azp` but no `email`/`preferred_username`/`upn`/`name` | Yes |
| 3 | `token_use == "client_credentials"` | Yes |
| 4 | `sub` is UUID format AND no user claims | Yes |
| 5 | None of the above | No → User token |

## Role-Based Access Control (RBAC)

CAIPE RAG uses three roles with hierarchical permissions:

| Role | Capabilities |
|------|--------------|
| **readonly** | View and query data |
| **ingestonly** | readonly + ingest data and manage jobs |
| **admin** | ingestonly + delete resources and bulk operations |

### Role Assignment Priority

When determining a user's role, the server checks in order:

1. **Admin groups** - If user's groups match any configured `RBAC_ADMIN_GROUPS`
2. **Ingestonly groups** - If user's groups match any configured `RBAC_INGESTONLY_GROUPS`
3. **Readonly groups** - If user's groups match any configured `RBAC_READONLY_GROUPS`
4. **Default role** - Falls back to `RBAC_DEFAULT_AUTHENTICATED_ROLE`

The first match wins (most permissive role). For unauthenticated requests from trusted networks, `TRUSTED_NETWORK_DEFAULT_ROLE` is used instead.

### Actor Types

| Actor | Authentication | Default Role | Role Source |
|-------|---------------|--------------|-------------|
| **User** | JWT Bearer | Based on groups | `RBAC_*_GROUPS` config |
| **Ingestor** | Client Credentials | `ingestonly` | `RBAC_CLIENT_CREDENTIALS_ROLE` |
| **Trusted** | IP-based | `admin` | `TRUSTED_NETWORK_DEFAULT_ROLE` |
| **Anonymous** | None | `anonymous` | Fixed |

## Supported OIDC Providers

CAIPE RAG works with any OIDC-compliant provider:

- Keycloak
- Okta
- Azure AD (Entra ID)
- AWS Cognito
- Auth0
- Google Workspace

The server automatically discovers OIDC endpoints from the issuer URL and validates tokens using the provider's public keys.

## Group Claims

For group-based role assignment, the RAG server fetches user information (email and groups) from the OIDC provider's `/userinfo` endpoint. This ensures the server always has authoritative user data regardless of what claims are included in the access token.

### User Info Resolution Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    VALIDATE ACCESS TOKEN                             │
│  ✓ Signature (JWKS)  ✓ exp  ✓ nbf  ✓ iat  ✓ aud  ✓ iss             │
└─────────────────────────────┬───────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Extract 'sub' (subject identifier) from access token               │
│  Used as cache key for userinfo lookup                              │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 1: Check REDIS CACHE for userinfo                             │
│  Key: rag/rbac/userinfo_cache:{sub}                                 │
│  Contains: { email, groups }                                        │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
      CACHE HIT                 CACHE MISS
     (use cached                    │
      email+groups)                 ▼
          │         ┌─────────────────────────────────────────────────┐
          │         │  Step 2: Fetch from OIDC /userinfo endpoint     │
          │         │  GET {issuer}/userinfo                          │
          │         │  Authorization: Bearer {access_token}           │
          │         └──────────────────────┬──────────────────────────┘
          │                                │
          │                   ┌────────────┴────────────┐
          │                   │                         │
          │               SUCCESS                    FAILED
          │                   │                         │
          │                   ▼                         ▼
          │    ┌──────────────────────────┐  ┌─────────────────────────┐
          │    │  Extract email & groups  │  │  FALLBACK: Extract from │
          │    │  from userinfo response  │  │  access_token claims    │
          │    │  → Cache in Redis (TTL)  │  │  (graceful degradation) │
          │    └──────────────────────────┘  └─────────────────────────┘
          │                   │                         │
          └───────────────────┴─────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  DETERMINE ROLE FROM GROUPS                                          │
│  Priority: admin_groups → ingestonly_groups → readonly_groups        │
│           → default_authenticated_role                               │
└─────────────────────────────────────────────────────────────────────┘
```

### Why Userinfo?

The `/userinfo` endpoint is the **authoritative source** for user claims - it works regardless of what your OIDC provider includes in access tokens. Results are cached in Redis (30min TTL) for performance. If userinfo fails, the server falls back to access_token claims.

### Supported Group Claim Names

The server auto-detects common group claim names from both access tokens and userinfo responses:

- `members`
- `memberOf`
- `groups`
- `group`
- `roles`
- `cognito:groups`

If your provider uses a different claim name, configure `OIDC_GROUP_CLAIM`. This supports comma-separated values to check multiple claims:

```bash
# Check a single custom claim
OIDC_GROUP_CLAIM=myGroups

# Check multiple claims (all are checked, groups are combined and deduplicated)
OIDC_GROUP_CLAIM=groups,members,roles
```

When not set, all default claims are checked and combined automatically.

### Email Extraction Priority

When extracting the user's email from userinfo or token claims, the server checks these claims in order:

| Priority | Claim | Description |
|----------|-------|-------------|
| 1 | `email` | Standard OIDC claim |
| 2 | `preferred_username` | Common in Keycloak, Azure AD |
| 3 | `upn` | User Principal Name (Microsoft) |
| 4 | `sub` | Subject identifier (last resort, usually opaque) |

The first non-empty value is used. If all are empty, defaults to `"unknown"`.

> **Note:** When `sub` is used as a fallback, the email may appear as an opaque hash. This is logged as a warning but doesn't affect authentication - the userinfo endpoint typically provides the real email.

### Caching Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `USERINFO_CACHE_TTL_SECONDS` | `1800` (30 min) | How long to cache userinfo (email + groups) in Redis |

The cache key format is `rag/rbac/userinfo_cache:{sub}` where `sub` is the user's subject identifier from the access token.

## Security Best Practices

### Production Deployments

- Use JWT Bearer authentication with your OIDC provider
- Set `RBAC_DEFAULT_AUTHENTICATED_ROLE=readonly` (least privilege)
- Disable trusted network (`ALLOW_TRUSTED_NETWORK=false`)
- Use group-based RBAC for maintainability
- Rotate OIDC client secrets regularly
- Monitor authentication failures in logs

### Development Deployments

- Trusted network is acceptable for local development only
- Use `RBAC_DEFAULT_AUTHENTICATED_ROLE=admin` only in isolated environments
- Test with production-like OIDC configuration before deploying

### What to Avoid

- Never enable trusted network in production
- Never set default role to `admin` in production
- Never commit OIDC secrets to version control
- Never use anonymous access in production

## Further Reading

- [Server README](https://github.com/cnoe-io/ai-platform-engineering/tree/main/ai_platform_engineering/knowledge_bases/rag/server/README.md) - Configuration reference with all environment variables
- [Ingestors](ingestors.md) - Ingestor authentication setup
- [Architecture](architecture.md) - System architecture overview
