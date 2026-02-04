# RAG Server Authentication & RBAC Configuration

This guide covers how to configure authentication and role-based access control (RBAC) for the RAG (Retrieval-Augmented Generation) server.

## Overview

The RAG server supports multiple authentication methods:

1. **JWT Bearer Token Authentication** (Recommended for production)
2. **Trusted Network Access** (Development only)
3. **OAuth2 Proxy Headers** (Enterprise deployments - requires proxy setup)

## Architecture

```
UI/Client → NextAuth Session → JWT Token → RAG Server → OIDC Validation → Role Assignment
```

The RAG server validates JWT tokens against your OIDC provider (e.g., Okta) and assigns roles based on:
- Group membership in the JWT token
- Email address matching
- Default authenticated role (fallback)

## Configuration

### Environment Variables

The RAG server RBAC is configured via environment variables in `.env` or Helm chart values:

```bash
# ============================================
# RAG Server RBAC Configuration
# ============================================

# OIDC Provider Configuration
OIDC_ISSUER=https://your-sso-provider.com/oidc/YOUR_CLIENT_ID
OIDC_CLIENT_ID=YOUR_CLIENT_ID
# OIDC_CLIENT_SECRET is optional for token validation

# Group-Based Role Assignment
# Users in these groups get corresponding roles
RBAC_ADMIN_GROUPS=sre_admin,platform_admin
RBAC_INGESTONLY_GROUPS=rag-access,developers
RBAC_READONLY_GROUPS=rag-readonly,viewers

# Email-Based Role Assignment (fallback when groups not in token)
RBAC_ADMIN_EMAILS=admin@example.com,sre-lead@example.com
RBAC_INGESTONLY_EMAILS=dev1@example.com,dev2@example.com
RBAC_READONLY_EMAILS=viewer@example.com

# JWT Claim Mapping (adjust based on your OIDC provider)
OIDC_EMAIL_CLAIM=email          # Claim containing user email
OIDC_USERNAME_CLAIM=preferred_username  # Claim containing username
OIDC_GROUP_CLAIM=groups         # Claim containing user groups

# Default role for authenticated users who don't match any group/email
# Options: readonly, ingestonly, admin
RBAC_DEFAULT_AUTHENTICATED_ROLE=readonly

# Trusted Network Configuration (DEVELOPMENT ONLY)
ALLOW_TRUSTED_NETWORK=false     # Set to true only for local development
TRUSTED_NETWORK_CIDRS=127.0.0.0/8,172.16.0.0/12,10.0.0.0/8
TRUSTED_NETWORK_DEFAULT_ROLE=admin
```

### Role Permissions

Each role grants different permissions:

| Role | View & Query | Ingest Data | Delete Resources |
|------|--------------|-------------|------------------|
| **readonly** | ✅ | ❌ | ❌ |
| **ingestonly** | ✅ | ✅ | ❌ |
| **admin** | ✅ | ✅ | ✅ |

### Role Assignment Priority

The RAG server assigns roles in the following priority order:

1. **Group Match**: If user's groups (from JWT) match any `RBAC_*_GROUPS`
2. **Email Match**: If user's email matches any `RBAC_*_EMAILS`
3. **Default Role**: Use `RBAC_DEFAULT_AUTHENTICATED_ROLE`
4. **Trusted Network** (if enabled): Use `TRUSTED_NETWORK_DEFAULT_ROLE`

## Development Setup

### Quick Start (Local Development)

For local development, you can use trusted network access:

```bash
# .env for development
RBAC_DEFAULT_AUTHENTICATED_ROLE=admin  # All authenticated users get admin
ALLOW_TRUSTED_NETWORK=true
TRUSTED_NETWORK_DEFAULT_ROLE=admin
```

⚠️ **Warning**: This configuration grants admin access to all authenticated users. **DO NOT use in production!**

### Testing with Your SSO Provider

Example configuration for common SSO providers:

```bash
# SSO Provider Configuration
OIDC_ISSUER=https://your-sso-provider.com/oauth2/default
OIDC_CLIENT_ID=YOUR_CLIENT_ID
OIDC_CLIENT_SECRET=YOUR_CLIENT_SECRET

# Some providers use 'username' claim instead of 'email' in access tokens
# Adjust based on your provider's JWT structure
OIDC_EMAIL_CLAIM=email  # or 'username' if email not available
OIDC_USERNAME_CLAIM=preferred_username

# Configure your SSO groups
RBAC_ADMIN_GROUPS=sre_admin
RBAC_INGESTONLY_GROUPS=rag-access

# Fallback for development
RBAC_DEFAULT_AUTHENTICATED_ROLE=admin  # Change to 'readonly' for production!
```

### Docker Compose

Update `docker-compose.dev.yaml` or use environment variables:

```bash
# Start with specific configuration
IMAGE_TAG=0.2.14-rc.3 docker-compose -f docker-compose.dev.yaml --profile rag up -d rag_server
```

## Production Setup

### Option 1: Group-Based RBAC (Recommended)

**Prerequisites:**
- Your OIDC provider includes groups in the JWT **access token** (not just ID token)
- Groups are mapped correctly in the OIDC provider configuration

**Configuration:**

```bash
# Production RBAC - Strict group-based access
RBAC_ADMIN_GROUPS=sre_admin,platform_admin
RBAC_INGESTONLY_GROUPS=rag-access,platform_developers
RBAC_READONLY_GROUPS=platform_readonly

# Strict default for users without group matches
RBAC_DEFAULT_AUTHENTICATED_ROLE=readonly

# CRITICAL: Disable trusted network in production
ALLOW_TRUSTED_NETWORK=false
```

**Verify Token Contains Groups:**

Check the RAG server logs to see what claims are in your JWT:

```bash
docker logs rag_server | grep "Token claims keys:"
```

Expected output:
```
Token claims keys: ['username', 'email', 'groups', 'iss', 'sub', 'aud', 'exp', 'iat']
```

If `groups` is missing, see Option 2.

### Option 2: Email-Based RBAC (Fallback)

If your OIDC provider doesn't include groups in access tokens:

```bash
# Email-based RBAC for production
RBAC_ADMIN_EMAILS=admin@example.com,admin2@example.com
RBAC_INGESTONLY_EMAILS=dev1@example.com,dev2@example.com
RBAC_READONLY_EMAILS=viewer1@example.com

# Strict default
RBAC_DEFAULT_AUTHENTICATED_ROLE=readonly

# Disable trusted network
ALLOW_TRUSTED_NETWORK=false
```

### Option 3: ID Token with Refresh (Advanced)

If groups are only in the **ID token**, configure the UI to send ID tokens instead of access tokens:

**Update UI API proxy** (`ui/src/app/api/rag/[...path]/route.ts`):

```typescript
async function getRbacHeaders(): Promise<Record<string, string>> {
  const session = await getServerSession(authOptions);

  // Use ID token (contains groups) instead of access token
  if (session?.idToken) {
    headers['Authorization'] = `Bearer ${session.idToken}`;
  }

  return headers;
}
```

**Ensure ID token is refreshed** (`ui/src/lib/auth-config.ts`):

```typescript
return {
  ...token,
  accessToken: refreshedTokens.access_token,
  idToken: refreshedTokens.id_token,  // Must be included
  expiresAt: Math.floor(Date.now() / 1000) + refreshedTokens.expires_in,
};
```

## Helm Chart Configuration

### Using Built-in RBAC Values

The RAG server Helm chart exposes RBAC configuration in `values.yaml`:

```yaml
# charts/rag-stack/charts/rag-server/values.yaml
rbac:
  allowUnauthenticated: false       # Require authentication
  adminGroups: "admin"
  ingestonlyGroups: "rag-access"
  readonlyGroups: "rag-readonly"
  defaultRole: "readonly"
```

### Using Custom Environment Variables

For settings not yet in the Helm chart (like `RBAC_DEFAULT_AUTHENTICATED_ROLE`), use the `env` section:

```yaml
# values-production.yaml
rbac:
  allowUnauthenticated: false
  adminGroups: "sre_admin"
  ingestonlyGroups: "rag-access"
  defaultRole: "readonly"

# Add missing RBAC variables
env:
  RBAC_DEFAULT_AUTHENTICATED_ROLE: "readonly"
  RBAC_ADMIN_EMAILS: "admin@example.com"
  OIDC_EMAIL_CLAIM: "email"
  OIDC_GROUP_CLAIM: "groups"
  ALLOW_TRUSTED_NETWORK: "false"
```

### Deploy with Custom Values

```bash
helm upgrade rag-server charts/rag-stack/charts/rag-server \
  -f values-production.yaml \
  --set image.tag=0.2.14-rc.3
```

## Troubleshooting

### Issue: "Unauthenticated" despite valid JWT

**Symptom:** RAG server returns `is_authenticated: false` even with valid token

**Diagnosis:**

```bash
# Check if JWT is expired
docker logs rag_server | grep "Signature has expired"

# Check what's in the JWT token
docker logs rag_server | grep "Token claims keys:"
```

**Solution:**
- If "Signature has expired": ID token expired, use access token or implement refresh
- If missing claims: Configure correct claim mappings (`OIDC_EMAIL_CLAIM`, etc.)

### Issue: "readonly" role instead of "admin"

**Symptom:** User gets readonly role despite being in admin group

**Diagnosis:**

```bash
# Check if groups are in the token
docker logs rag_server | grep "No group claims found"

# Check RBAC configuration
docker logs rag_server | grep "RBAC Configuration:" -A 10
```

**Solution:**
- If "No group claims found": Groups not in access token, use Option 2 (email-based) or Option 3 (ID token)
- Verify `RBAC_ADMIN_GROUPS` matches your actual group names from your SSO provider (case-sensitive)

### Issue: "Invalid email format" warning

**Symptom:** Log shows `Invalid email format in token claims: c8d1d12e1d9d471e...`

**Diagnosis:** RAG server is reading the `sub` claim instead of `email`/`username`

**Solution:** Configure correct email claim mapping based on your SSO provider:

```bash
OIDC_EMAIL_CLAIM=email     # For standard OIDC providers
# or
OIDC_EMAIL_CLAIM=username  # If your provider uses username claim
```

### Issue: Permissions not updating in UI

**Symptom:** UI still shows old permissions after RAG server restart

**Solution:**
1. Hard refresh browser (Cmd/Ctrl + Shift + R)
2. Clear browser cache
3. Check browser console for `[getUserInfo]` logs

## Security Best Practices

### ✅ DO:
- Use JWT Bearer token authentication in production
- Set `RBAC_DEFAULT_AUTHENTICATED_ROLE=readonly` for production
- Disable trusted network (`ALLOW_TRUSTED_NETWORK=false`) in production
- Regularly rotate OIDC client secrets
- Use group-based RBAC when possible (more maintainable)
- Monitor RAG server logs for authentication failures

### ❌ DON'T:
- **Never** set `RBAC_DEFAULT_AUTHENTICATED_ROLE=admin` in production
- **Never** enable `ALLOW_TRUSTED_NETWORK=true` in production
- Don't commit OIDC secrets to Git (use secret management)
- Don't use anonymous access (`allowUnauthenticated: true`) in production

## References

- [RAG Server Source Code](../../../ai_platform_engineering/knowledge_bases/rag/)
- [UI Authentication Config](../../../ui/src/lib/auth-config.ts)
- [Helm Chart Values](../../../charts/rag-stack/charts/rag-server/values.yaml)
- [NextAuth Documentation](https://next-auth.js.org/)

## Version Compatibility

- **RAG Server**: v0.2.14-rc.3 or later (for full RBAC support)
- **UI**: Compatible with MongoDB chat history feature branch
- **OIDC Provider**: Any OIDC-compliant provider (Keycloak, Auth0, Okta, Azure AD, etc.)
