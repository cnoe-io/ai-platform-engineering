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

## Role-Based Access Control (RBAC)

CAIPE RAG uses three roles with hierarchical permissions:

| Role | Capabilities |
|------|--------------|
| **readonly** | View and query data |
| **ingestonly** | readonly + ingest data and manage jobs |
| **admin** | ingestonly + delete resources and bulk operations |

### Role Assignment Priority

When determining a user's role, the server checks in order:

1. **Group membership** - If user's groups (from JWT) match configured admin/ingestonly/readonly groups
2. **Email match** - If user's email matches configured admin/ingestonly/readonly emails
3. **Default role** - Falls back to configured default for authenticated users
4. **Trusted network** - If enabled and request is from trusted IP

The first match wins. This allows fine-grained control with group-based assignment as the primary mechanism.

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

For group-based role assignment, the RAG server uses a tiered approach to resolve user groups efficiently:

### Groups Resolution Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    VALIDATE ACCESS TOKEN                             │
│  ✓ Signature (JWKS)  ✓ exp  ✓ nbf  ✓ iat  ✓ aud  ✓ iss             │
└─────────────────────────────┬───────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 1: Check ACCESS TOKEN for groups                              │
│  (Providers like Keycloak include groups in access_token)           │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
       FOUND                    NOT FOUND
    (use these)                     │
          │                         ▼
          │         ┌─────────────────────────────────────────────────┐
          │         │  Step 2: Check REDIS CACHE                      │
          │         │  Key: rag/groups_cache:{sub}                    │
          │         │  TTL: 30 minutes (configurable)                 │
          │         └──────────────────────┬──────────────────────────┘
          │                                │
          │                   ┌────────────┴────────────┐
          │                   │                         │
          │               CACHE HIT                 CACHE MISS
          │              (use these)                    │
          │                   │                         ▼
          │                   │         ┌─────────────────────────────┐
          │                   │         │  Step 3: Fetch from         │
          │                   │         │  OIDC /userinfo endpoint    │
          │                   │         │  → Cache result in Redis    │
          │                   │         └─────────────────────────────┘
          │                   │                         │
          └───────────────────┴─────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  DETERMINE ROLE FROM GROUPS                                          │
│  Priority: admin_groups → ingestonly_groups → readonly_groups        │
│           → admin_emails → ingestonly_emails → readonly_emails       │
│           → default_authenticated_role                               │
└─────────────────────────────────────────────────────────────────────┘
```

### How It Works

| Scenario | What Happens | Performance |
|----------|--------------|-------------|
| **Groups in access_token** (Keycloak, Okta) | Uses groups directly from token | Fastest - no external calls |
| **Groups only in userinfo** (Duo SSO) | First request fetches from userinfo, caches result | Slower first request, fast subsequent |
| **Repeat requests** (within TTL) | Cache hit - uses cached groups | Fast - no external calls |
| **Redis unavailable** | Falls back to userinfo every request | Slower but functional |
| **Userinfo fails** | Empty groups - user gets default role | Graceful degradation |

### Supported Group Claim Names

The server auto-detects common group claim names from both access tokens and userinfo responses:

- `groups`
- `members`
- `memberOf`
- `roles`
- `cognito:groups`

If your provider uses a different claim name, configure `OIDC_GROUP_CLAIM`.

### Caching Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GROUPS_CACHE_TTL_SECONDS` | `1800` (30 min) | How long to cache groups in Redis |

The cache key format is `rag/groups_cache:{sub}` where `sub` is the user's subject identifier from the access token.

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
