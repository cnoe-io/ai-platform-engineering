# Research: MCP Server Authentication + Caller-Provided Backend Keys

## FastMCP Middleware Injection

**Decision**: Use Starlette ASGI middleware (`starlette.middleware.Middleware`) passed to `mcp.run()`.

**Rationale**: FastMCP 3.2.3 exposes two middleware systems:
1. `fastmcp.server.middleware.Middleware` — MCP-protocol-level (tool/resource hooks); does NOT intercept HTTP auth headers
2. `starlette.middleware.Middleware` aliased as `ASGIMiddleware` in `fastmcp/server/mixins/transport.py` — HTTP transport level; correct for auth

`mcp.run(transport=..., host=..., port=..., middleware=[Middleware(MCPAuthMiddleware)])` works because `run()` → `run_async()` → `run_http_async(middleware=...)` (confirmed via source inspection). This means we can add middleware to the existing `mcp.run()` call without switching to `run_http_async()`.

**Alternative considered**: Per-server inline `run_http_async()` — rejected for being more verbose with no benefit; `run()` kwargs passthrough is confirmed.

---

## JWT Validation (OAuth2 Mode)

**Decision**: Copy `verify_token()` logic and `JwksCache` class from `ai_platform_engineering/utils/auth/` into the new `mcp_agent_auth` package.

**Rationale**: `oauth2_middleware.py` imports `from a2a.types import AgentCard` (line 7), making it impossible to import from MCP servers that don't carry `a2a-sdk`. However, `verify_token()` itself has zero dependency on `AgentCard` — it only uses `jwt`, `JwksCache`, and module-level config globals. `JwksCache` only requires `requests` (already available in all server envs). Copying these two artifacts (~80 lines total) avoids adding `a2a-sdk` as a dep.

**Alternative considered**: Import `verify_token` directly from utils — rejected because `a2a.types` import at module level poisons the import even if the class is not instantiated.

---

## Per-Request Token Access

**Decision**: Use `fastmcp.server.dependencies.get_http_request()` inside tool functions.

**Rationale**: FastMCP stores the current Starlette `Request` in a `ContextVar` per async task. `get_http_request()` (at line 444 of `fastmcp/server/dependencies.py`) retrieves it. Raises `LookupError` or `RuntimeError` when called outside an HTTP request context (STDIO mode), making it safe to catch and fall back to env var.

---

## Server Inventory

| Server | Entry point | Token env var(s) | Auth header type | client.py raises ValueError? | Notes |
|--------|-------------|------------------|-----------------|------------------------------|-------|
| argocd | server.py | `ARGOCD_API_TOKEN` / `ARGOCD_TOKEN` | Bearer | Yes | Standard pattern |
| backstage | server.py | `BACKSTAGE_TOKEN` / `BACKSTAGE_API_TOKEN` | Bearer | Yes | Standard pattern |
| confluence | server.py | `ATLASSIAN_TOKEN` (+ `ATLASSIAN_EMAIL`) | Basic (email:token) | No (warns) | Email stays in env; token replaces password |
| jira | server.py | `ATLASSIAN_TOKEN` (+ `ATLASSIAN_EMAIL`) | Basic (email:token) | No (warns) | Email stays in env; token replaces password |
| komodor | server.py | `KOMODOR_TOKEN` | `X-API-KEY` header | Yes | Not Bearer; caller token maps to X-API-KEY |
| netutils | server.py | None | N/A | N/A | No client.py; only server.py needs middleware |
| pagerduty | server.py | `PAGERDUTY_API_KEY` | Bearer | No | No startup raise; `DEFAULT_API_KEY` may be None |
| splunk | server.py | `SPLUNK_TOKEN` | Bearer | Yes | Standard pattern |
| victorops | server.py | `X_VO_API_KEY` + `X_VO_API_ID` | Custom headers | Yes | Multi-org via `VICTOROPS_ORGS`; only single-org updated |
| webex | `__init__.py` | `WEBEX_TOKEN` (click `required=True`) | Bearer | click raises | `auth_token` closure in all 8+ tools; must switch to per-request |

---

## Module-Level ValueError Problem

**Decision**: In HTTP/shared_key mode, backend tokens are expected from the caller — not the environment. Remove `raise ValueError` for token-only env vars; keep raises for URL env vars (which are always required).

**Rationale**: Servers currently fail at import time if their backend token env var is absent (e.g., `ARGOCD_API_TOKEN`). In HTTP mode with caller-provided tokens, the env var is intentionally absent. The module-level raise prevents the server from starting. URL env vars (`ARGOCD_API_URL`, `KOMODOR_API_URL`, etc.) remain required since they can't come from the caller.

**Pattern**: Change `raise ValueError("...token...")` to `logger.warning("...token...")`. The token check already happens in `make_api_request()` where it returns an error dict if no token is available.

---

## Webex Special Case

**Decision**: Make `--auth-token` click option `required=False` (default `None`). Change each tool function in `mcp_server.py` to call `get_request_token("WEBEX_TOKEN") or auth_token_default` at invocation time.

**Rationale**: Webex currently captures `auth_token` in a closure at tool registration time (`register_tools(server, auth_token=auth_token)`). The same token is used by all 8+ tool functions. In HTTP mode, the per-request token must be read at call time, not at registration time. The fallback to `auth_token_default` (the registered startup token) preserves backward compatibility for STDIO mode.

---

## VictorOps Special Case

**Decision**: Update only the single-org path (`X_VO_API_KEY`). Multi-org path (`VICTOROPS_ORGS`) unchanged.

**Rationale**: Multi-org config embeds per-org `api_key` values directly in the JSON env var. Replacing these with a single caller-provided bearer token would break the multi-org routing logic. YAGNI — only update what the spec requires.

---

## New Package Location

**Decision**: `ai_platform_engineering/agents/common/mcp-auth/` with Python package name `mcp_agent_auth`.

**Rationale**: Consistent with other `common/` utilities in the agents directory. All 10 MCP servers add it as a local path dependency in their `pyproject.toml` via `[tool.uv.sources]`.

---

## Env Vars

| Var | Mode | Required when | Default |
|-----|------|---------------|---------|
| `MCP_AUTH_MODE` | All | Never (has default) | `none` |
| `MCP_SHARED_KEY` | shared_key | `MCP_AUTH_MODE=shared_key` | — |
| `JWKS_URI` | oauth2 | `MCP_AUTH_MODE=oauth2` | — |
| `AUDIENCE` | oauth2 | `MCP_AUTH_MODE=oauth2` | — |
| `ISSUER` | oauth2 | `MCP_AUTH_MODE=oauth2` | — |
| `OAUTH2_CLIENT_ID` | oauth2 | `MCP_AUTH_MODE=oauth2` | — |
| `ALLOWED_ALGORITHMS` | oauth2 | Never (has default) | `RS256,ES256` |
