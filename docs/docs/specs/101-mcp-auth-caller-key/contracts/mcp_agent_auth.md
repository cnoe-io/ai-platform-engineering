# Contract: mcp_agent_auth Package

## MCPAuthMiddleware

**Package**: `mcp_agent_auth.middleware`  
**Base class**: `starlette.middleware.base.BaseHTTPMiddleware`

### Constructor

```python
MCPAuthMiddleware(app, public_paths: list[str] | None = None)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `app` | ASGI app | required | Wrapped application |
| `public_paths` | `list[str] \| None` | `None` | Paths that bypass auth |

### Behavior by MCP_AUTH_MODE

| Mode | Auth check | On success | On failure |
|------|-----------|------------|------------|
| `none` | None | Pass through | N/A |
| `shared_key` | Constant-time compare `Bearer <token>` vs `MCP_SHARED_KEY` | Pass through | 401 JSON |
| `oauth2` | Verify JWT via JWKS (`iss`, `aud`, `exp`, `nbf`, optional `cid`) | Pass through | 401 JSON |

### Always bypass (all modes)

- `OPTIONS` requests (CORS preflight)
- Paths in `public_paths`

### Error responses

```json
// 401
{"error": "unauthorized", "reason": "<reason>"}

// For SSE clients (Accept: text/event-stream)
"error unauthorized: <reason>"  // text/event-stream, 401
```

---

## get_request_token

**Package**: `mcp_agent_auth.token`

```python
def get_request_token(env_var_name: str) -> str | None:
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `env_var_name` | `str` | Fallback env var name (e.g., `"ARGOCD_API_TOKEN"`) |

**Returns**: Bearer token from current HTTP request's `Authorization` header if available, else `os.getenv(env_var_name)`.

**Raises**: Nothing. Catches all exceptions from `get_http_request()` (STDIO mode, no context).

### Token resolution order

1. `Authorization: Bearer <token>` header of the current HTTP request
2. `os.getenv(env_var_name)`
3. `None`

---

## Environment Variables

| Variable | Required | Mode | Default | Description |
|----------|----------|------|---------|-------------|
| `MCP_AUTH_MODE` | No | All | `none` | Auth mode: `none`, `shared_key`, `oauth2` |
| `MCP_SHARED_KEY` | Yes (if shared_key) | shared_key | — | Secret for bearer token comparison |
| `JWKS_URI` | Yes (if oauth2) | oauth2 | — | JWKS endpoint URL |
| `AUDIENCE` | Yes (if oauth2) | oauth2 | — | Expected JWT `aud` claim |
| `ISSUER` | Yes (if oauth2) | oauth2 | — | Expected JWT `iss` claim |
| `OAUTH2_CLIENT_ID` | No | oauth2 | — | Comma-separated allowed `cid` values |
| `ALLOWED_ALGORITHMS` | No | oauth2 | `RS256,ES256` | Comma-separated JWT algorithms |
