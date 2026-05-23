# Keycloak OAuth Server Setup

This guide explains how to set up and configure Keycloak as an OAuth2 server for CAIPE A2A authentication.

> **Note on init scripts:** `init-idp.sh` and `init-token-exchange.sh` in this directory
> are **symlinks** into the canonical location `charts/ai-platform-engineering/charts/keycloak/scripts/`.
> The Helm chart consumes them via `.Files.Get` (which is sandboxed to the chart dir),
> and `docker-compose.dev.yaml` bind-mounts them via `./deploy/keycloak/init-*.sh`
> (Docker resolves the host symlink before mounting). **Edit only the canonical files
> in `charts/.../keycloak/scripts/`** — never replace the symlinks with a copy.
> Both scripts must remain busybox-`sh`/`sed` portable since they run inside
> `alpine/curl` containers in both Docker Compose and Kubernetes.
>
> **Note on realm import:** Docker Compose mounts the canonical chart realm
> export from `charts/ai-platform-engineering/charts/keycloak/realm-config.json`.
> Do not create `deploy/keycloak/realm-config.json`; if that missing bind-mount
> path is allowed to become a directory, Keycloak starts with only the `master`
> realm and `caipe-ui` login fails with `Realm does not exist`.

## Quick Start

1. **Start Keycloak Server**
   ```bash
   cd deploy/keycloak
   docker compose up
   ```

2. **Access Admin Console**
   - URL: http://localhost:7080
   - Username: `admin`
   - Password: `admin`

3. **Configure Realm**
   - The `caipe` realm is automatically imported from
     `../../charts/ai-platform-engineering/charts/keycloak/realm-config.json`
   - Switch to the `caipe` realm in the admin console

## Client Configuration

### Create OAuth2 Client

1. In the Keycloak admin console, navigate to the `caipe` realm
2. Go to **Clients** → **Create**
3. Configure the client:
   - **Client ID**: `caipe-cli`
   - **Client Protocol**: `openid-connect`
   - **Access Type**: `confidential`
   - **Standard Flow Enabled**: `ON`
   - **Direct Access Grants Enabled**: `ON`
   - **Service Accounts Enabled**: `ON`

4. Save the client and go to the **Credentials** tab
5. Copy the **Secret** value for use in your environment

### Client Scopes

The following scopes are available in the `caipe` realm:
- `profile` - User profile information
- `email` - User email address
- `caipe` - CAIPE-specific audience claim

## Environment Configuration

Configure your application with these environment variables:

```bash
# Enable OAuth2 authentication
A2A_AUTH_OAUTH2=true

# Keycloak OAuth2 endpoints
JWKS_URI=http://localhost:7080/realms/caipe/protocol/openid-connect/certs
AUDIENCE=caipe
ISSUER=http://localhost:7080/realms/caipe
OAUTH2_CLIENT_ID=caipe-cli
OAUTH2_CLIENT_SECRET=<YOUR_CLIENT_SECRET>

# Token generation
TOKEN_ENDPOINT=http://localhost:7080/realms/caipe/protocol/openid-connect/token
```

## Generate JWT Tokens

Use the provided utility to generate JWT tokens:

```bash
export OAUTH2_CLIENT_ID=caipe-cli
export OAUTH2_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
export TOKEN_ENDPOINT=http://localhost:7080/realms/caipe/protocol/openid-connect/token

python ai_platform_engineering/utils/oauth/get_oauth_jwt_token.py
```

## Token Validation

The A2A middleware validates JWT tokens using:
- **Signature verification** via JWKS endpoint
- **Audience validation** (must match `caipe`)
- **Issuer validation** (must match Keycloak realm)
- **Expiration validation** (exp and nbf claims)
- **Client ID validation** (optional cid claim)

## Realm Configuration

The canonical chart `realm-config.json` file includes:
- Pre-configured realm with `caipe` as the realm name
- Client scopes for profile, email, roles, and CAIPE audiences
- Security policies and authentication flows

## Production Considerations

For production deployments:
1. Change default passwords
2. Use HTTPS endpoints
3. Configure proper CORS settings
4. Set up proper SSL certificates
5. Configure database persistence
6. Set up proper logging and monitoring

## Troubleshooting

### Common Issues

1. **Token validation fails**
   - Check JWKS_URI is accessible
   - Verify AUDIENCE matches realm configuration
   - Ensure ISSUER matches Keycloak realm URL

2. **Client authentication fails**
   - Verify OAUTH2_CLIENT_ID exists in Keycloak
   - Check OAUTH2_CLIENT_SECRET is correct
   - Ensure client has proper permissions

3. **Token generation fails**
   - Verify TOKEN_ENDPOINT is correct
   - Check client credentials are valid
   - Ensure client has service account enabled

4. **Realm does not exist / Keycloak never becomes healthy**
   - Verify the mounted import path is a file, not a directory:
     `charts/ai-platform-engineering/charts/keycloak/realm-config.json`
   - Check `http://localhost:7080/realms/caipe/protocol/openid-connect/certs`
     returns `200`
   - If a stale empty `deploy/keycloak/realm-config.json/` directory exists,
     remove it before recreating the Keycloak container

### Debug Mode

Enable debug logging to troubleshoot issues:

```bash
export DEBUG_UNMASK_AUTH_HEADER=true
```

This will show unmasked authorization headers in the logs (use only for debugging).
