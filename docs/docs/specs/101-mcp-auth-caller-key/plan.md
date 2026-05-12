# Implementation Plan: MCP Server Authentication + Caller-Provided Backend Keys

**Branch**: `101-mcp-auth-caller-key` | **Date**: 2026-04-17 | **Spec**: [spec.md](./spec.md)

## Summary

All 10 first-party MCP servers have zero HTTP-level authentication. This plan adds a shared auth package (`mcp_agent_auth`) implementing three modes — `none` (default, backward compat), `shared_key`, `oauth2` — and modifies each MCP server to inject the middleware and resolve backend tokens per-request rather than at startup.

## Technical Context

**Language/Version**: Python 3.13  
**Primary Dependencies**: FastMCP 3.2.3, Starlette (transitive via FastMCP), PyJWT, requests  
**Storage**: N/A (middleware is stateless; JwksCache is in-process memory)  
**Testing**: pytest + starlette TestClient (same pattern as `tests/test_dual_auth_middleware.py`)  
**Target Platform**: Linux containers (Kubernetes), also macOS for dev  
**Project Type**: library (shared package) + modifications to 10 existing services  
**Performance Goals**: Auth check <5ms p99 (shared_key: constant-time string compare; oauth2: cached JWKS, PyJWT decode ~1ms)  
**Constraints**: Zero breaking changes to STDIO mode; no new required env vars for existing deployments  
**Scale/Scope**: 10 MCP servers; ~4 new files + ~21 modified files

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| Worse is Better | ✅ | Copying JwksCache (80 lines) instead of refactoring utils avoids coupling |
| YAGNI | ✅ | No RBAC, no token rotation, no audit log beyond existing logger |
| Rule of Three | ✅ | 10 identical server changes justify the shared package abstraction |
| Composition over Inheritance | ✅ | Middleware composed into FastMCP via `middleware=` kwarg; no subclassing |
| Specs as Source of Truth | ✅ | Spec exists at `docs/docs/specs/101-mcp-auth-caller-key/spec.md` |
| CI Gates | ✅ | Unit tests required; lint (Ruff) required |
| Security by Default | ✅ | Constant-time key compare; no token values in logs; defense-in-depth |
| Type hints | ✅ | Required on all public functions |
| No print() | ✅ | Use `logging`; remove existing `print()` calls in auth middleware |
| Docstrings on public functions | ✅ | Required on `MCPAuthMiddleware`, `get_request_token` |

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/101-mcp-auth-caller-key/
├── spec.md
├── plan.md              ← this file
├── research.md
├── data-model.md
├── contracts/
│   └── mcp_agent_auth.md
└── tasks.md             ← created by /speckit.tasks
```

### Source Code

```text
ai_platform_engineering/agents/common/mcp-auth/      ← NEW package
├── pyproject.toml
└── mcp_agent_auth/
    ├── __init__.py
    ├── middleware.py    ← MCPAuthMiddleware (Starlette BaseHTTPMiddleware)
    ├── token.py         ← get_request_token()
    └── jwks_cache.py    ← JwksCache (copied from utils/auth/jwks_cache.py)

ai_platform_engineering/agents/argocd/mcp/
├── pyproject.toml       ← add mcp-agent-auth dep + uv.sources
└── mcp_argocd/
    ├── server.py        ← inject MCPAuthMiddleware
    └── api/client.py    ← change ValueError→warning; use get_request_token

ai_platform_engineering/agents/backstage/mcp/
├── pyproject.toml
└── mcp_backstage/
    ├── server.py
    └── api/client.py

ai_platform_engineering/agents/confluence/mcp/
├── pyproject.toml
└── mcp_confluence/
    ├── server.py
    └── api/client.py    ← already warns; update get_token() to get_request_token

ai_platform_engineering/agents/jira/mcp/
├── pyproject.toml
└── mcp_jira/
    ├── server.py
    └── api/client.py    ← same as confluence

ai_platform_engineering/agents/komodor/mcp/
├── pyproject.toml
└── mcp_komodor/
    ├── server.py
    └── api/client.py    ← token maps to X-API-KEY; ValueError→warning

ai_platform_engineering/agents/netutils/mcp/
├── pyproject.toml
└── mcp_netutils/
    └── server.py        ← middleware only; no client.py

ai_platform_engineering/agents/pagerduty/mcp/
├── pyproject.toml
└── mcp_pagerduty/
    ├── server.py
    └── api/client.py    ← already no raise; use get_request_token

ai_platform_engineering/agents/splunk/mcp/
├── pyproject.toml
└── mcp_splunk/
    ├── server.py
    └── api/client.py    ← ValueError→warning; use get_request_token

ai_platform_engineering/agents/victorops/mcp/
├── pyproject.toml
└── mcp_victorops/
    ├── server.py
    └── api/client.py    ← single-org path uses get_request_token("X_VO_API_KEY")

ai_platform_engineering/agents/webex/mcp/
├── pyproject.toml
└── mcp_webex/
    ├── __init__.py      ← make --auth-token optional; inject middleware
    └── mcp_server.py    ← each tool calls get_request_token("WEBEX_TOKEN") or auth_token

tests/
└── test_mcp_auth_middleware.py   ← NEW unit tests
```

## Implementation Steps

### Step 1: Create `mcp_agent_auth` package (4 new files)

**File: `ai_platform_engineering/agents/common/mcp-auth/pyproject.toml`**
```toml
[project]
name = "mcp-agent-auth"
version = "0.1.0"
description = "Shared authentication middleware for MCP servers"
requires-python = ">=3.13"
dependencies = [
    "starlette>=0.27",
    "pyjwt[crypto]>=2.0",
    "requests>=2.28",
    "python-dotenv>=0.20",
]
```

**File: `mcp_agent_auth/__init__.py`** — empty (or re-exports)

**File: `mcp_agent_auth/jwks_cache.py`** — copy of `ai_platform_engineering/utils/auth/jwks_cache.py` verbatim (no changes needed)

**File: `mcp_agent_auth/middleware.py`** — `MCPAuthMiddleware`:
```python
import hmac, os, logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse

MCP_AUTH_MODE = os.getenv("MCP_AUTH_MODE", "none").lower()
MCP_SHARED_KEY = os.getenv("MCP_SHARED_KEY", "")
PUBLIC_PATHS = {"/healthz", "/health"}

# oauth2 mode: initialize at import time
if MCP_AUTH_MODE == "oauth2":
    import jwt
    from jwt import InvalidTokenError
    from .jwks_cache import JwksCache
    # ... init JWKS_URI, AUDIENCE, ISSUER, ALGORITHMS, OAUTH2_CLIENT_IDS, _jwks_cache
elif MCP_AUTH_MODE == "shared_key":
    if not MCP_SHARED_KEY:
        raise ValueError("MCP_SHARED_KEY must be set when MCP_AUTH_MODE=shared_key")
elif MCP_AUTH_MODE != "none":
    raise ValueError(f"Invalid MCP_AUTH_MODE: {MCP_AUTH_MODE!r}")

class MCPAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, public_paths=None):
        super().__init__(app)
        self.public_paths = PUBLIC_PATHS | set(public_paths or [])

    async def dispatch(self, request, call_next):
        if request.method == "OPTIONS" or request.url.path in self.public_paths:
            return await call_next(request)
        if MCP_AUTH_MODE == "none":
            return await call_next(request)
        auth = request.headers.get("Authorization", "")
        if not auth.lower().startswith("bearer "):
            return self._unauthorized("Missing or malformed Authorization header.", request)
        token = auth[7:]
        if MCP_AUTH_MODE == "shared_key":
            if not hmac.compare_digest(token, MCP_SHARED_KEY):
                return self._unauthorized("Invalid shared key.", request)
        elif MCP_AUTH_MODE == "oauth2":
            if not _verify_token(token):
                return self._unauthorized("Invalid or expired access token.", request)
        return await call_next(request)
    # ... _unauthorized(), _forbidden() helpers (same as existing A2A middlewares)
```

**File: `mcp_agent_auth/token.py`**:
```python
import os
from typing import Optional

def get_request_token(env_var_name: str) -> Optional[str]:
    """Return bearer token from current HTTP request, or fall back to env var."""
    try:
        from fastmcp.server.dependencies import get_http_request
        req = get_http_request()
        auth = req.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            return auth[7:]
    except Exception:
        pass
    return os.getenv(env_var_name)
```

---

### Step 2: Update each MCP server's `pyproject.toml` (10 files)

Add to each `[project].dependencies`:
```toml
"mcp-agent-auth",
```

Add `[tool.uv.sources]` section:
```toml
[tool.uv.sources]
mcp-agent-auth = { path = "../../common/mcp-auth", editable = true }
```

(For webex: `path = "../../common/mcp-auth"` — verify relative path from each server's directory)

Also add `pyjwt[crypto]` to each server's deps (needed at runtime in oauth2 mode even though it's a dep of mcp-agent-auth, uv needs it declared for container builds).

---

### Step 3: Update `server.py` for 9 standard servers (argocd, backstage, confluence, jira, komodor, netutils, pagerduty, splunk, victorops)

Add import at top:
```python
from starlette.middleware import Middleware
from mcp_agent_auth.middleware import MCPAuthMiddleware
```

Change the transport block from:
```python
if MCP_MODE.lower() in ["sse", "http"]:
    mcp.run(transport=MCP_MODE.lower(), host=MCP_HOST, port=MCP_PORT)
else:
    mcp.run(transport=MCP_MODE.lower())
```

To:
```python
_http_modes = {"sse", "http", "streamable-http", "streamable_http"}
if MCP_MODE.lower() in _http_modes:
    mcp.run(
        transport=MCP_MODE.lower(),
        host=MCP_HOST,
        port=MCP_PORT,
        middleware=[Middleware(MCPAuthMiddleware)],
    )
else:
    mcp.run(transport=MCP_MODE.lower())
```

---

### Step 4: Update `api/client.py` for 8 servers with client.py

**Standard pattern** (argocd, backstage, komodor, pagerduty, splunk):

1. Change module-level token `raise ValueError` → `logger.warning`
2. Replace `token = API_TOKEN` (module-level var) in `make_api_request` with `token = get_request_token("ARGOCD_API_TOKEN")` (use primary env var name)
3. Import: `from mcp_agent_auth.token import get_request_token`

**Komodor special**: token maps to `X-API-KEY` header, not `Authorization`. The `make_api_request` already uses `API_TOKEN` for the `X-API-KEY` header value — just replace with `get_request_token("KOMODOR_TOKEN")`.

**Confluence/Jira special** (Basic auth):
- No module-level raise to change (already just warns)
- Change `get_token()` helper: return `get_request_token("ATLASSIAN_TOKEN")` (falls back to env)
- The email/username MUST remain from env var — this is documented in spec assumptions

**VictorOps special**:
- Single-org path only: replace `api_key = os.getenv("X_VO_API_KEY")` with `api_key = get_request_token("X_VO_API_KEY")`; keep `raise ValueError` for URL and `X_VO_API_ID` (still required from env)
- Multi-org path (`VICTOROPS_ORGS`): unchanged

---

### Step 5: Update Webex `__init__.py` and `mcp_server.py`

**`__init__.py`**:
1. Add middleware import and injection to `server.run()`
2. Change `--auth-token` click option: `required=False, default=None`

**`mcp_server.py`**:
- Change `def register_tools(server, auth_token)` → `def register_tools(server, auth_token: str | None = None)`
- Inside each tool function, replace `auth_token` closure with:
  ```python
  from mcp_agent_auth.token import get_request_token
  token = get_request_token("WEBEX_TOKEN") or auth_token
  ```
  (8+ tool functions — all follow the same pattern)

---

### Step 6: Write unit tests

**File: `tests/test_mcp_auth_middleware.py`**

Test cases (following `tests/test_dual_auth_middleware.py` pattern):
- `none` mode: any request passes
- `shared_key` mode: correct token → 200; wrong token → 401; missing header → 401; OPTIONS → 200; `/healthz` → 200
- `oauth2` mode: valid JWT → 200; expired JWT → 401; wrong aud/iss → 401; no header → 401
- `get_request_token`: HTTP mode returns bearer; STDIO (no context) returns env var fallback; both absent returns None

Use `importlib.reload()` + `unittest.mock.patch.dict(os.environ, ...)` to test each mode (same pattern as existing test).

---

## Files to Create (4 new)

1. `ai_platform_engineering/agents/common/mcp-auth/pyproject.toml`
2. `ai_platform_engineering/agents/common/mcp-auth/mcp_agent_auth/__init__.py`
3. `ai_platform_engineering/agents/common/mcp-auth/mcp_agent_auth/middleware.py`
4. `ai_platform_engineering/agents/common/mcp-auth/mcp_agent_auth/token.py`
5. `ai_platform_engineering/agents/common/mcp-auth/mcp_agent_auth/jwks_cache.py` (copy)
6. `tests/test_mcp_auth_middleware.py`

## Files to Modify (21)

Per-server (×10): `pyproject.toml`, `server.py`  
Per-server with client.py (×8): `api/client.py` (argocd, backstage, confluence, jira, komodor, pagerduty, splunk, victorops)  
Webex special (×1): `mcp_webex/mcp_server.py`

## Verification

1. **Unit tests**: `make test-agents` — `test_mcp_auth_middleware.py` must pass all modes
2. **Lint**: `make lint` — no Ruff errors
3. **STDIO backward compat**: `MCP_AUTH_MODE` unset + tool invocation via stdio → uses env var token, works as before
4. **HTTP none mode**: `MCP_AUTH_MODE=none`, send HTTP request with no auth → tool executes using env var token
5. **HTTP shared_key mode**: `MCP_AUTH_MODE=shared_key MCP_SHARED_KEY=abc123`
   - Request with `Authorization: Bearer abc123` + no backend token env var → tool executes using `abc123` as backend credential
   - Request with `Authorization: Bearer wrongkey` → 401
6. **HTTP oauth2 mode**: configure JWKS, send valid JWT → tool executes; expired JWT → 401
7. **Webex startup**: `WEBEX_TOKEN` unset, `MCP_AUTH_MODE=shared_key` → server starts; tool invoked with bearer token → executes using that token

## Complexity Tracking

No constitution violations. The 10-server sweep is justified by the Rule of Three (10 identical changes). The shared package is the simplest approach that avoids duplication.
