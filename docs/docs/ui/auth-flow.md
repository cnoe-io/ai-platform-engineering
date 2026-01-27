# Authentication Flow

This document describes the complete OIDC authentication flow in the CAIPE UI, including initial login, API calls, token refresh, and session management.

## Overview

The CAIPE UI implements a multi-layered authentication architecture using:
- **OIDC Provider** (SSO) - External identity provider (Okta, Duo, Keycloak, etc.)
- **Next.js SSR** - Server-side session management via NextAuth.js
- **React Client** - Browser-based UI with token-based API calls
- **CAIPE Backend** - Supervisor agent with Bearer token validation

## Initial Authentication Flow

```mermaid
sequenceDiagram
    actor User
    participant Browser as React Client<br/>(Browser)
    participant NextJS as Next.js SSR<br/>(NextAuth.js)
    participant OIDC as OIDC Provider<br/>(SSO)
    participant Backend as CAIPE Backend<br/>(Supervisor Agent)

    Note over User,Backend: User initiates login

    User->>Browser: Click "Sign in with SSO"
    Browser->>NextJS: POST /api/auth/signin
    NextJS->>OIDC: Redirect to /authorize<br/>scope: openid email profile groups offline_access<br/>response_type: code<br/>redirect_uri: /api/auth/callback

    Note over OIDC: User authenticates<br/>with SSO provider

    OIDC->>NextJS: Redirect with authorization code
    NextJS->>OIDC: POST /token<br/>grant_type: authorization_code<br/>code: [authorization_code]
    OIDC-->>NextJS: access_token, id_token, refresh_token<br/>expires_in: 3600 (1 hour)

    Note over NextJS: JWT callback:<br/>1. Store tokens in JWT<br/>2. Extract user profile<br/>3. Check group membership<br/>4. Set expiry timestamp

    NextJS->>NextJS: Create encrypted session cookie
    NextJS->>Browser: Set-Cookie: next-auth.session-token
    Browser->>Browser: Redirect to / (home page)

    Note over Browser: User is authenticated<br/>Session active
```

## API Call Flow with Bearer Token

```mermaid
sequenceDiagram
    actor User
    participant Browser as React Client<br/>(Browser)
    participant NextJS as Next.js SSR<br/>(Session)
    participant Backend as CAIPE Backend<br/>(Supervisor Agent)

    Note over User,Backend: User sends message to agent

    User->>Browser: Type message & send
    Browser->>Browser: useSession() hook<br/>Get access_token from session

    Browser->>NextJS: Request session data
    NextJS-->>Browser: { accessToken, user, expiresAt }

    Browser->>Backend: POST /message/stream<br/>Authorization: Bearer {access_token}<br/>Body: { message, contextId }

    Note over Backend: Validate Bearer token<br/>(JWT signature, expiry, claims)

    alt Token Valid
        Backend-->>Browser: 200 OK<br/>Content-Type: text/event-stream<br/>Stream A2A events (SSE)
        Note over Browser: Display agent response<br/>in real-time
    else Token Expired/Invalid
        Backend-->>Browser: 401 Unauthorized
        Browser->>Browser: Show "Session expired"<br/>Redirect to login
    end
```

## Token Refresh Flow (Seamless)

```mermaid
sequenceDiagram
    participant Timer as Next.js Request<br/>(Every API call)
    participant NextJS as Next.js SSR<br/>(JWT Callback)
    participant OIDC as OIDC Provider<br/>(Token Endpoint)
    participant Browser as React Client<br/>(Browser)

    Note over Timer,Browser: Automatic refresh<br/>5 minutes before expiry

    Timer->>NextJS: Session request<br/>(useSession or getServerSession)
    NextJS->>NextJS: JWT callback triggered<br/>Check: expiresAt - now < 5min?

    alt Token needs refresh
        NextJS->>OIDC: POST /token<br/>grant_type: refresh_token<br/>refresh_token: {refresh_token}<br/>client_id: {client_id}<br/>client_secret: {client_secret}

        alt Refresh Success
            OIDC-->>NextJS: New access_token, id_token<br/>New refresh_token (optional)<br/>New expires_in
            NextJS->>NextJS: Update JWT with new tokens<br/>Update expiresAt timestamp
            NextJS-->>Browser: Updated session<br/>{ accessToken: new_token, ... }

            Note over Browser: Seamless continuation<br/>User unaware of refresh
        else Refresh Failed
            OIDC-->>NextJS: 400 Bad Request<br/>error: invalid_grant
            NextJS->>NextJS: Set error: "RefreshTokenExpired"
            NextJS-->>Browser: Session with error flag
            Browser->>Browser: TokenExpiryGuard detects error<br/>Show expiry modal<br/>Redirect to login
        end
    else Token still valid
        NextJS-->>Browser: Current session unchanged
        Note over Browser: Continue normally
    end
```

## Token Expiry Warning Flow (Fallback)

```mermaid
sequenceDiagram
    participant Timer as TokenExpiryGuard<br/>(Check every 30s)
    participant Session as useSession()<br/>(Client State)
    participant Browser as React Client<br/>(UI)
    actor User

    Note over Timer,User: No refresh token available<br/>or refresh disabled

    loop Every 30 seconds
        Timer->>Session: Get current session
        Session-->>Timer: { expiresAt, accessToken }
        Timer->>Timer: Calculate time until expiry<br/>timeLeft = expiresAt - now

        alt 5 min warning (timeLeft < 300s)
            Timer->>Browser: Show warning toast<br/>"Session expiring in {time}"
            Browser-->>User: 🔔 Warning notification<br/>with "Re-login Now" button

            alt User clicks "Re-login Now"
                User->>Browser: Click button
                Browser->>Browser: Redirect to /login
            else User dismisses
                User->>Browser: Click "Dismiss"
                Browser->>Browser: Hide toast<br/>(will reappear on next check)
            end
        else Token expired (timeLeft <= 0)
            Timer->>Browser: Show critical modal<br/>"Session Expired"
            Browser-->>User: 🚫 Full-screen modal<br/>"Please log in again"
            Timer->>Timer: Wait 5 seconds
            Timer->>Browser: Auto-redirect to /login<br/>?session_expired=true
        else Token valid (timeLeft > 300s)
            Note over Timer: Continue monitoring<br/>No action needed
        end
    end
```

## Complete Authentication Architecture

```mermaid
graph TB
    subgraph "Browser (React Client)"
        A[User Interface]
        B[useSession Hook]
        C[TokenExpiryGuard]
        D[AuthGuard]
        E[A2A Client]
    end

    subgraph "Next.js SSR (NextAuth.js)"
        F["POST /api/auth/signin"]
        G["GET /api/auth/callback"]
        H[JWT Callback]
        I[Session Callback]
        J[Session Cookie]
    end

    subgraph "OIDC Provider"
        K["GET /authorize Endpoint"]
        L["POST /token Endpoint"]
    end

    subgraph "CAIPE Backend"
        M[Supervisor Agent]
        N[Bearer Token Validator]
    end

    %% Initial Auth Flow
    A -->|1. Click Login| F
    F -->|2. Redirect| K
    K -->|3. Auth Code| G
    G -->|4. Exchange Code| L
    L -->|5. Tokens| H
    H -->|6. Create Session| J
    J -->|7. Set Cookie| B

    %% Token Refresh Flow
    B -->|8. Check Expiry| H
    H -->|9. Refresh if needed| L
    L -->|10. New Tokens| I
    I -->|11. Update Session| B

    %% Monitoring Flow
    B -->|12. Provide Token| C
    C -->|13. Monitor Expiry| D
    D -->|14. Protect Routes| A

    %% API Call Flow
    A -->|15. Send Message| E
    B -->|16. Get Token| E
    E -->|17. Bearer Token| M
    M -->|18. Validate| N
    N -->|19. Stream Events| E
    E -->|20. Display| A

    style A fill:#e1f5ff
    style M fill:#fff4e1
    style K fill:#f0e1ff
    style L fill:#f0e1ff
```

## Key Components

### 1. NextAuth.js (Next.js SSR)
- **Location**: `ui/src/lib/auth-config.ts`, `ui/src/app/api/auth/[...nextauth]/route.ts`
- **Purpose**: Manages OIDC flow, token exchange, session creation
- **Features**:
  - JWT-based sessions (encrypted cookies)
  - Automatic token refresh (5 min before expiry)
  - Group-based authorization
  - Configurable refresh token support

### 2. AuthGuard Component
- **Location**: `ui/src/components/auth-guard.tsx`
- **Purpose**: Protects routes, validates session on mount
- **Features**:
  - Checks authentication status
  - Validates token expiry
  - Redirects to login if session invalid
  - Handles refresh token errors

### 3. TokenExpiryGuard Component
- **Location**: `ui/src/components/token-expiry-guard.tsx`
- **Purpose**: Real-time token monitoring and user warnings
- **Features**:
  - Checks token every 30 seconds
  - Shows warning toast at 5 min before expiry
  - Shows critical modal when expired
  - Auto-redirects to login after 5 seconds
  - Handles refresh token failures

### 4. A2A Client (Bearer Token Auth)
- **Location**: `ui/src/lib/a2a-sdk-client.ts`, `ui/src/lib/a2a-client.ts`
- **Purpose**: Makes authenticated API calls to CAIPE backend
- **Features**:
  - Adds Bearer token to Authorization header
  - Handles 401 errors gracefully
  - Shows user-friendly error messages
  - Suggests re-login on token expiry

## Configuration

### Environment Variables

```bash
# OIDC Provider Configuration
OIDC_ISSUER=https://your-oidc-provider.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret

# Enable/Disable Refresh Token Support
OIDC_ENABLE_REFRESH_TOKEN=true  # default

# Group-based Authorization (optional)
OIDC_REQUIRED_GROUP=backstage-access
OIDC_GROUP_CLAIM=groups  # auto-detect if not set

# NextAuth Session
NEXTAUTH_SECRET=your-secret-here
NEXTAUTH_URL=http://localhost:3000
```

### Token Refresh Modes

| Mode | Config | Behavior |
|------|--------|----------|
| **Auto-Refresh (Default)** | `OIDC_ENABLE_REFRESH_TOKEN=true` | Seamless token refresh 5 min before expiry |
| **Warning-Only** | `OIDC_ENABLE_REFRESH_TOKEN=false` | Show warnings, no auto-refresh |
| **Fallback** | Provider doesn't support `offline_access` | Gracefully falls back to warnings |

## Security Considerations

### Token Storage
- **Access Token**: Stored in encrypted JWT session cookie (HttpOnly, Secure)
- **Refresh Token**: Stored in encrypted JWT session cookie (server-side only)
- **ID Token**: Stored in encrypted JWT session cookie
- **Never exposed to browser localStorage or sessionStorage**

### Token Validation
- **Backend Validation**: CAIPE backend validates Bearer token signature and expiry
- **Client Validation**: AuthGuard checks session validity before rendering
- **Expiry Monitoring**: TokenExpiryGuard proactively monitors token expiry

### Token Refresh
- **Automatic**: Triggered 5 min before expiry (background, seamless)
- **Secure**: Uses refresh token grant type (OAuth 2.0 standard)
- **Error Handling**: Falls back to warning system if refresh fails

## Troubleshooting

### No Refresh Token Received
**Symptom**: Warning system active, but no auto-refresh
**Cause**: OIDC provider not issuing refresh token
**Solution**:
1. Check if provider supports `offline_access` scope
2. Verify client configuration allows refresh tokens
3. Check logs: `[Auth] ⚠️ Refresh token not provided by OIDC provider`

### Token Refresh Failing
**Symptom**: User logged out after token expiry despite refresh enabled
**Cause**: Refresh token expired or invalid
**Solution**:
1. Check refresh token expiry in OIDC provider settings
2. Verify client credentials are correct
3. Check logs: `[Auth] Token refresh failed`

### 401 Errors from Backend
**Symptom**: API calls fail with "Session expired" error
**Cause**: Access token expired, not refreshed in time
**Solution**:
1. Ensure `OIDC_ENABLE_REFRESH_TOKEN=true`
2. Check if refresh token is available in session
3. Verify backend is accepting Bearer tokens

## Related Documentation

- [OIDC Configuration](./configuration.md#oidc-sso-configuration)
- [Development Guide](./development.md)
- [API Reference](./api-reference.md)
- [Troubleshooting](./troubleshooting.md)

## Standards & References

- [OAuth 2.0 Authorization Framework (RFC 6749)](https://datatracker.ietf.org/doc/html/rfc6749)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [OAuth 2.0 Token Refresh (RFC 6749 Section 6)](https://datatracker.ietf.org/doc/html/rfc6749#section-6)
- [NextAuth.js Documentation](https://next-auth.js.org/)
