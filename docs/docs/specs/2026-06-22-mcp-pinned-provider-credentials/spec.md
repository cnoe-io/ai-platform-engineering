# MCP pinned provider credentials (custom servers)

## Overview

Custom MCP servers created in the UI can pin a **specific** provider connection (OAuth)
so every authorized caller uses that connection's token — not their own connected app.

Built-in MCP servers (`github`, `jira`, `gitlab`, etc. from `config.yaml`) keep the
existing **per-caller** `provider` resolution with optional `fallback_env`.

## Motivation

Operators configure an MCP server with a service-user's Atlassian/GitHub connection
and expect all chat users to act through that identity. Today `provider` on the
credential source overrides `provider_connection_id` at runtime, so the invoking
user's OAuth wins instead.

## Design

### Schema: `connection_scope` on `MCPCredentialSource`

| Value | Meaning |
|-------|---------|
| `caller` (default) | Resolve `provider` for JWT `sub`; optional `fallback_env` |
| `pinned` | Always `provider_connection_id`; fail if missing/invalid |

**Pinned** sources store `provider_connection_id` + `connection_scope: "pinned"`.
Do **not** persist `provider` for resolution (built-ins keep `provider` only).

### Resolution (BFF + Dynamic Agents — identical order)

1. `connection_scope === "pinned"` → exchange `provider_connection_id`; **no** `fallback_env`
2. Else if `provider` → per-caller exchange by provider key
3. Else if `provider_connection_id` → legacy ID exchange
4. Else caller path fallbacks (`fallback_env`, `fallback_client_credentials`)

Pinned failure → `MCP_CREDENTIAL_UNAVAILABLE` (HTTP 401 on test/probe paths).

### Authorization for pinned exchange

Non-owners may refresh a pinned connection when:

- `mcp_server:<id>#can_use` **and** the server's `credential_sources` pins that
  `provider_connection_id` (`POST /api/credentials/exchange` accepts optional
  `mcp_server_id` for this path), **or**
- `secret_ref:provider_connection:<id>#can_use` (existing share model)

### UI (custom servers only)

MCP Server Editor shows **Connection scope** when kind = Connected app and the
server is not config-driven:

- **Use this connection for all callers** (`pinned`) — default for new credentials
- **Use each caller's connection** (`caller`)

### Out of scope

- Built-in / config-driven MCP servers (`config.yaml`)
- Changing GitHub/GitLab hybrid PAT fallback behavior

## Acceptance criteria

- [x] Custom server with `connection_scope: pinned` persists without `provider`
- [x] Test modal and Dynamic Agents use pinned connection ID for any authorized caller
- [x] Missing/disconnected pinned connection returns 401 (no silent skip, no PAT fallback)
- [x] `connection_scope: caller` + `provider` unchanged for per-user OAuth
- [x] Built-in `github`/`jira` seeds unchanged
- [x] E2E: create pinned server, second user test uses pinned ID; invalid pinned → error
