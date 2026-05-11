# Contract: Host REST APIs

## User App Discovery

### `GET /api/agentic-apps`

Returns apps visible to the current authenticated user.

Response:

```json
{
  "apps": [
    {
      "appId": "weather",
      "displayName": "Weather",
      "description": "Reference weather app",
      "launchPath": "/apps/weather",
      "runtimeKind": "proxied-next-zone",
      "health": "healthy",
      "blockedReasons": []
    }
  ]
}
```

Rules:

- Requires user authentication.
- Filters by package, installation, health, manifest surfaces, and PDP/access policy.
- Does not expose private runtime origins or inaccessible resource names.

## User App Detail

### `GET /api/agentic-apps/{appId}`

Returns launch metadata and blocked reason for one app.

Response:

```json
{
  "appId": "weather",
  "canLaunch": true,
  "launchPath": "/apps/weather",
  "blockedReasons": [],
  "manifest": {
    "displayName": "Weather",
    "description": "Reference weather app"
  }
}
```

## App-Owned Authorization

### `POST /api/agentic-apps/{appId}/authorize`

External apps call this endpoint with an app-scoped token to ask CAIPE for additional app-owned resource authorization.

Request:

```json
{
  "action": "repo.epic.read",
  "resource": {
    "type": "epic",
    "id": "EPIC-123"
  },
  "tenant": "default"
}
```

Response:

```json
{
  "decisionId": "dec_01H...",
  "effect": "allow",
  "reasonCode": "allowed",
  "correlationId": "req_01H..."
}
```

Rules:

- Requires a valid app-scoped token for the same `appId`.
- Uses the same PDP decision contract as launch, proxy, and webhook checks.
- Does not accept browser cookies as app identity.

## Admin Package Import

### `POST /api/admin/agentic-apps/packages`

Imports or updates a trusted app package from a manifest.

Request:

```json
{
  "source": "admin-import",
  "manifest": {
    "id": "weather",
    "apiVersion": "1.0",
    "displayName": "Weather",
    "description": "Reference weather app",
    "runtime": {
      "kind": "proxied-next-zone",
      "mountPath": "/apps/weather"
    },
    "surfaces": {
      "showInHub": true
    },
    "access": {
      "tokenScopes": ["weather:read"]
    },
    "health": {
      "endpoint": "/health"
    }
  }
}
```

Response:

```json
{
  "packageId": "weather",
  "validationStatus": "valid"
}
```

Rules:

- Requires admin.
- Validates manifest schema and secret-like fields.
- Rejects package/app ID mismatch.
- Emits an audit event.

## Admin Installation

### `POST /api/admin/agentic-apps/installations`

Installs or updates environment-specific state for an app package.

Request:

```json
{
  "appId": "weather",
  "packageId": "weather",
  "installed": true,
  "enabled": true,
  "visible": true,
  "runtimeOriginOverride": "http://localhost:3102",
  "accessOverrides": {
    "requiredRoles": ["user"]
  }
}
```

Response:

```json
{
  "appId": "weather",
  "installed": true,
  "enabled": true
}
```

Rules:

- Requires admin.
- Rejects route conflicts and app ID conflicts.
- Does not persist provider secrets.
- Emits an audit event for every install, enable, disable, or uninstall.

## Generic Webhook Gateway

### `POST /api/agentic-apps/webhooks/{appId}/{provider}/{channel}`

Defined in `webhook-gateway.md`.

## Proxy Route

### `/apps/{appId}/{path...}`

The proxy route is not a public JSON API. It is the user-facing app execution gateway.

Rules:

- Requires a real user session.
- Denies before contacting the app when policy fails.
- Strips browser credentials and client-supplied identity headers.
- Forwards only an app-scoped token and safe correlation metadata.
