# A2A Authentication

The A2A protocol supports two authentication methods for securing agent-to-agent communication:

> **Tip:** When testing OAuth2 authentication, use version `0.2.7` or greater of the [agent-chat-cli](https://github.com/cnoe-io/agent-chat-cli) to ensure the `Authorization: Bearer <token>` header is sent correctly.
>
> **Usage:**
> ```
> docker run -it --network=host ghcr.io/cnoe-io/agent-chat-cli:0.2.7
> ```

## Public Endpoints

All authentication methods allow public access to the following endpoints without authentication:
- `<A2A_HOST>/.well-known/agent.json`
- `<A2A_HOST>/.well-known/agent-card.json`

These endpoints provide agent discovery and metadata information.

## Shared Key Authentication

Shared key authentication provides a simple authentication mechanism using a pre-shared secret. This method is suitable for development and testing environments.

**Configuration:**
- Set `USE_SHARED_KEY=true` in your environment
- Configure the following required environment variable:
  - `SHARED_KEY`: The shared secret key for authentication

**Usage:**
- Send the shared key as `Authorization: Bearer <shared_key>` header
- The key must match exactly with the configured `SHARED_KEY` value

### OAuth2 Authentication

OAuth2 authentication provides enterprise-grade security using JWT tokens with JWKS validation. This method is recommended for production environments.

**Configuration:**
- Set `USE_OAUTH2=true` in your environment
- Configure the following required environment variables:
  - `JWKS_URI`: The JWKS endpoint URL for token validation
  - `AUDIENCE`: Expected audience claim in the JWT token
  - `ISSUER`: Expected issuer claim in the JWT token
  - `OAUTH2_CLIENT_ID`: Client ID for audience validation

**Token Requirements:**
- Must be a valid JWT token with RS256 or EC256 signature
- Must include `iss`, `aud`, `exp`, and `nbf` claims
- Optional `cid` claim for additional client validation
- Must be sent as `Authorization: Bearer <token>` header

**Getting OAuth2 Tokens:**

You can use the provided utility script to obtain OAuth2 JWT tokens:

```bash
python ai_platform_engineering/utils/oauth/get_oauth_jwt_token.py
```

This script requires the following environment variables:
- `OAUTH2_CLIENT_ID`: Your OAuth2 client ID
- `OAUTH2_CLIENT_SECRET`: Your OAuth2 client secret
- `TOKEN_ENDPOINT`: The OAuth2 token endpoint URL

The script will:
- Validate your environment configuration
- Obtain a JWT access token using client credentials flow
- Display token contents and expiration status
- Check if the token is expired or about to expire

**Local Development with Keycloak:**

For local development and testing, you can use the provided Keycloak setup:

```bash
# Start local Keycloak OAuth server
cd deploy/keycloak
docker compose up
```

**Keycloak Configuration:**
1. Access admin console at http://localhost:7080
2. Login with `admin/admin`
3. Switch to the `caipe` realm
4. Create a client called `caipe-cli`
5. Copy the client secret

**Environment Variables for Local Keycloak:**
```bash
USE_OAUTH2=true
JWKS_URI=http://localhost:7080/realms/caipe/protocol/openid-connect/certs
AUDIENCE=caipe
ISSUER=http://localhost:7080/realms/caipe
OAUTH2_CLIENT_ID=caipe-cli
OAUTH2_CLIENT_SECRET=your-client-secret-from-keycloak
TOKEN_ENDPOINT=http://localhost:7080/realms/caipe/protocol/openid-connect/token
```

**Generate JWT Token with Keycloak:**
```bash
export OAUTH2_CLIENT_ID=caipe-cli
export OAUTH2_CLIENT_SECRET=<YOUR CLIENT SECRET>  # randomly generated from Keycloak
export TOKEN_ENDPOINT=http://localhost:7080/realms/caipe/protocol/openid-connect/token

python ai_platform_engineering/utils/oauth/get_oauth_jwt_token.py
```

## Keycloak OAuth Server Setup

This section provides comprehensive instructions for setting up and configuring Keycloak as an OAuth2 server for CAIPE A2A authentication.

### Quick Start

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

### Client Configuration

#### Create OAuth2 Client

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

#### Client Scopes

The following scopes are available in the `caipe` realm:
- `profile` - User profile information
- `email` - User email address
- `caipe` - CAIPE-specific audience claim

### Token Validation

The A2A middleware validates JWT tokens using:
- **Signature verification** via JWKS endpoint
- **Audience validation** (must match `caipe`)
- **Issuer validation** (must match Keycloak realm)
- **Expiration validation** (exp and nbf claims)
- **Client ID validation** (optional cid claim)

### Realm Configuration

The `caipe-realm.json` file includes:
- Pre-configured realm with `caipe` as the realm name
- Default user `caipe` with password `caipe`
- Client scopes for profile, email, and CAIPE audience
- Security policies and authentication flows

### Production Considerations

For production deployments:
1. Change default passwords
2. Use HTTPS endpoints
3. Configure proper CORS settings
4. Set up proper SSL certificates
5. Configure database persistence
6. Set up proper logging and monitoring

### Troubleshooting

#### Common Issues

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

#### Debug Mode

Enable debug logging to troubleshoot issues:

```bash
export DEBUG_UNMASK_AUTH_HEADER=true
```

This will show unmasked authorization headers in the logs (use only for debugging).
