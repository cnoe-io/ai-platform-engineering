# Data Model: MCP Server Authentication

## Entities

### MCPAuthConfig (runtime, per-process)

Loaded once at server startup from environment variables. Immutable after load.

| Field | Type | Source | Constraints |
|-------|------|--------|-------------|
| `mode` | `Literal["none", "shared_key", "oauth2"]` | `MCP_AUTH_MODE` env | Default `"none"` |
| `shared_key` | `str \| None` | `MCP_SHARED_KEY` env | Required when `mode="shared_key"` |
| `jwks_uri` | `str \| None` | `JWKS_URI` env | Required when `mode="oauth2"` |
| `audience` | `str \| None` | `AUDIENCE` env | Required when `mode="oauth2"` |
| `issuer` | `str \| None` | `ISSUER` env | Required when `mode="oauth2"` |
| `client_ids` | `set[str]` | `OAUTH2_CLIENT_ID` (comma-sep) | Optional; empty = skip cid check |
| `algorithms` | `list[str]` | `ALLOWED_ALGORITHMS` (comma-sep) | Default `["RS256", "ES256"]` |

**Validation rules**:
- If `mode="shared_key"` and `shared_key` is None/empty → raise `ValueError` at startup
- If `mode="oauth2"` and `jwks_uri` / `audience` / `issuer` is None → raise `ValueError` at startup
- If `mode` is unrecognized → raise `ValueError` at startup

---

### BearerToken (per-request)

The credential carried in `Authorization: Bearer <token>` on each HTTP request.

| Field | Type | Source |
|-------|------|--------|
| `raw` | `str` | HTTP header `Authorization` |

**Dual role** (in `shared_key` mode only):
- **MCP authentication**: compared against `MCP_SHARED_KEY` via constant-time comparison
- **Backend API key**: forwarded as the backend service credential (e.g., ArgoCD token, Webex token)

---

### JwksCache (runtime singleton, oauth2 mode only)

In-memory cache of JWKS public keys for JWT signature verification.

| Field | Type | Description |
|-------|------|-------------|
| `jwks_uri` | `str` | URL of the JWKS endpoint |
| `ttl_seconds` | `int` | Default TTL if no Cache-Control header (3600s) |
| `_keys_by_kid` | `dict[str, dict]` | Map of key ID → JWK dict |
| `_expires_at` | `float` | Unix timestamp when cache expires |

**State transitions**:
- Empty → Loaded (on first `get_jwk()` call)
- Loaded → Stale (when `now >= _expires_at`)
- Stale → Loaded (on next `get_jwk()` call triggers `refresh()`)
- Loaded → Loaded (force refresh on unknown `kid`, key rotation scenario)

---

### BackendTokenResolution (per-tool-invocation)

How a tool determines the token to use for a backend API call.

| Priority | Source | When available |
|----------|--------|----------------|
| 1 (highest) | `Authorization: Bearer <token>` from current HTTP request | HTTP transport only |
| 2 (fallback) | Environment variable (e.g., `ARGOCD_API_TOKEN`) | Any transport |
| 3 (error) | None available | Tool returns error response |

---

## Public Path List

Paths that bypass authentication regardless of `MCP_AUTH_MODE`:

| Path | Purpose |
|------|---------|
| `/healthz` | Health check (Kubernetes liveness/readiness probes) |
| `/health` | Alternative health check path |

Additional paths may be configured by passing `public_paths` to `MCPAuthMiddleware`.
