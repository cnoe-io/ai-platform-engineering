# Agent Context HMAC

When an agent makes an MCP tool call, CAIPE uses a short-lived HMAC-signed
context header to bind the call to a specific agent identity. The
OpenFGA Authz Bridge uses this to enforce per-agent tool policy on top of the
base user authorization check.

## How it works

```mermaid
sequenceDiagram
    participant U as End User
    participant UI as CAIPE UI<br/>(browser)
    participant BFF as UI Backend<br/>(Next.js BFF)
    participant DA as Dynamic Agent<br/>(mcp_client.py)
    participant AGW as AgentGateway<br/>(Envoy proxy)
    participant Bridge as OpenFGA Authz Bridge<br/>(ext_authz gRPC)
    participant FGA as OpenFGA
    participant MCP as MCP Server

    U->>UI: Send message (session cookie)
    UI->>BFF: POST /api/chat (session cookie → JWT)
    Note over BFF: Validates NextAuth session<br/>extracts user JWT (Keycloak access token)

    BFF->>DA: Start/resume agent stream<br/>Authorization: Bearer <user-JWT>

    Note over DA: Per MCP call:<br/>build_agent_context_headers(agent_id)<br/>payload = {agent_id, iat, exp: iat+300}<br/>encoded = base64url(payload)<br/>sig = HMAC-SHA256(secret, encoded)

    DA->>AGW: MCP tool call<br/>Authorization: Bearer <user-JWT>  ← human identity<br/>X-CAIPE-Agent-Context: encoded  ← agent identity<br/>X-CAIPE-Agent-Context-Signature: hex(sig)

    AGW->>Bridge: ext_authz CheckRequest (gRPC)<br/>all headers forwarded

    Note over Bridge: Extracts human identity from<br/>caipe.auth gRPC metadata (decoded JWT sub)
    Bridge->>FGA: ① Check(user:sub, can_call, mcp:server)

    alt base user check fails
        FGA-->>Bridge: denied
        Bridge-->>AGW: PERMISSION_DENIED
        AGW--xMCP: request blocked
    else base check passes + HMAC secret configured
        FGA-->>Bridge: allowed
        Note over Bridge: Verifies agent identity:<br/>1. recompute HMAC — compare_digest (timing-safe)<br/>2. check exp not expired<br/>3. extract agent_id
        alt missing, forged, or expired HMAC
            Bridge-->>AGW: DENY_NO_AGENT_CONTEXT
            AGW--xMCP: request blocked
        else valid agent context
            Bridge->>FGA: ② Check(user:sub, can_use, agent:agent_id)
            Bridge->>FGA: ③ Check(agent:agent_id, can_call, tool:server/name)<br/>fallback: tool:server/*
            FGA-->>Bridge: allow / deny per-agent tool policy
            alt agent not authorized for tool
                Bridge-->>AGW: DENY_AGENT_TOOL_POLICY
                AGW--xMCP: request blocked
            else agent authorized
                Bridge-->>AGW: OK
                AGW->>MCP: forward MCP tool call
                MCP-->>AGW: tool response
                AGW-->>DA: tool response
                DA-->>BFF: stream token(s)
                BFF-->>UI: SSE stream
                UI-->>U: render answer
            end
        end
    end
```

## Key points

| Property | Detail |
|---|---|
| Header | `X-CAIPE-Agent-Context` (base64url payload) + `X-CAIPE-Agent-Context-Signature` (hex HMAC-SHA256) |
| TTL | 5 minutes (`exp = iat + 300`) — prevents replay; created fresh per MCP call |
| Comparison | `hmac.compare_digest` — timing-safe |
| Secret | `CAIPE_AGENT_CONTEXT_HMAC_SECRET` shared between Dynamic Agents and the Authz Bridge |
| Fallback | Secret not set → headers omitted → bridge skips per-agent check (coarse user-level authz only) |

## OpenFGA checks

The bridge runs three checks in sequence:

1. **User → MCP server** — `user:sub can_call mcp:server`
2. **User → Agent** — `user:sub can_use agent:agent_id`
3. **Agent → Tool** — `agent:agent_id can_call tool:server/name` (falls back to `tool:server/*` wildcard)

All three must pass for the request to reach the MCP server.

## Configuration

```yaml
# Dynamic Agents
CAIPE_AGENT_CONTEXT_HMAC_SECRET: <random-256-bit-hex>

# OpenFGA Authz Bridge (same value)
AGENT_CONTEXT_HMAC_SECRET: <same-value>
```

Generate a secret with:

```bash
openssl rand -hex 32
```
