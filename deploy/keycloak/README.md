# Keycloak OAuth Server Setup

This guide explains how to set up and configure Keycloak as an OAuth2 server for CAIPE A2A authentication.

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
   - The `caipe` realm is automatically imported from `caipe-realm.json`
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
USE_OAUTH2=true

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

The `caipe-realm.json` file includes:
- Pre-configured realm with `caipe` as the realm name
- Default user `caipe` with password `caipe`
- Client scopes for profile, email, and CAIPE audience
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

### Debug Mode

Enable debug logging to troubleshoot issues:

```bash
export DEBUG_UNMASK_AUTH_HEADER=true
```

This will show unmasked authorization headers in the logs (use only for debugging).
