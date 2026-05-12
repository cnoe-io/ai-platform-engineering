# Contract: RBAC Authorization Check v1

Internal authorization contract for the 098 Enterprise RBAC feature. All CAIPE enforcement points use one of two PDPs — both enforce the **same 098 permission matrix**.

## Contract overview

| Property | Value |
|----------|-------|
| **Version** | 1 |
| **Status** | Draft |
| **FR coverage** | FR-001, FR-002, FR-008, FR-013, FR-014, FR-022 |
| **Enforcement points** | BFF (Next.js API routes), Slack bot middleware, Agent Gateway |

## Dual-PDP model

```text
                   ┌─────────────────────┐
 UI / Slack path   │  Keycloak AuthZ     │  PDP-1: resources, scopes, role-based policies
                   │  (Authorization     │  Protocol: Keycloak token endpoint or UMA
                   │   Services)         │  Latency target: < 5 ms (in-process RPT cache)
                   └─────────────────────┘
                   ┌─────────────────────┐
 MCP / A2A path    │  Agent Gateway      │  PDP-2: JWT validation + CEL policy
                   │  (Data-plane)       │  Protocol: HTTP(S) proxy
                   │                     │  Fail-closed if AG unreachable
                   └─────────────────────┘
```

Both PDPs enforce the 098 permission matrix. Matrix rows are defined per component and capability; columns are roles.

## PDP-1: Keycloak Authorization Services (UI / Slack)

### Request format (Keycloak token endpoint — permission evaluation)

```http
POST /realms/{realm}/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:uma-ticket
&audience={resource-server-client-id}
&permission={resource}#{scope}
&subject_token={access_token}
```

### Alternative: direct evaluation (RPT introspection)

```http
POST /realms/{realm}/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:uma-ticket
&audience={resource-server-client-id}
&permission={resource}#{scope}
&response_mode=decision
```

### Response

```json
{
  "result": true
}
```

Or `403` with:
```json
{
  "error": "access_denied",
  "error_description": "not_authorized"
}
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `resource` | string | yes | Component from permission matrix: `admin_ui`, `slack`, `supervisor`, `rag`, `tool`, `mcp`, `a2a`, `sub_agent`, `skill` |
| `scope` | string | yes | Capability from matrix: `view`, `create`, `delete`, `invoke`, `admin`, `configure`, etc. |
| `access_token` | string | yes | Keycloak JWT (user session or OBO token) |

### BFF integration (TypeScript)

```typescript
interface RbacCheckRequest {
  resource: string;
  scope: string;
  accessToken: string;
}

interface RbacCheckResult {
  allowed: boolean;
  reason?: string;
}

async function checkPermission(req: RbacCheckRequest): Promise<RbacCheckResult>;
```

### Slack bot integration (Python)

```python
class RbacCheckRequest:
    resource: str
    scope: str
    access_token: str

class RbacCheckResult:
    allowed: bool
    reason: str | None

async def check_permission(request: RbacCheckRequest) -> RbacCheckResult: ...
```

## PDP-2: Agent Gateway (MCP / A2A / Agent)

### How it works

AG acts as a reverse proxy. When a request arrives:

1. AG extracts the `Authorization: Bearer <JWT>` header.
2. AG validates the JWT against Keycloak's JWKS endpoint.
3. AG evaluates CEL authorization rules using JWT claims (`sub`, `realm_access.roles`, `scope`, `org`).
4. **Allow**: request is proxied to the backend MCP/A2A/agent server.
5. **Deny**: AG returns `403 Forbidden`.

### CEL policy rule format

AG uses [CEL (Common Expression Language)](https://agentgateway.dev/docs/reference/cel/) for all authorization decisions. Rules are embedded inline in the AG `config.yaml` under `mcpAuthorization.rules` (for MCP traffic) and `authorization.rules` (for HTTP traffic).

```yaml
# MCP-level authorization (attached to backend)
mcpAuthorization:
  rules:
  # chat_user can invoke any MCP tool
  - '"chat_user" in jwt.realm_access.roles && has(mcp.tool)'
  # kb_admin can invoke RAG ingest tools
  - '"kb_admin" in jwt.realm_access.roles && mcp.tool.name.startsWith("rag_ingest")'
  # admin can invoke admin tools
  - '"admin" in jwt.realm_access.roles && mcp.tool.name.startsWith("admin_")'
```

```yaml
# HTTP-level authorization (attached to route)
authorization:
  rules:
  - deny: '!has(jwt.sub)'
  - allow: 'has(jwt.sub)'
```

### AG configuration reference

```yaml
# yaml-language-server: $schema=https://agentgateway.dev/schema/config
binds:
- port: 4000
  listeners:
  - policies:
      jwtAuth:
        mode: strict
        issuer: https://keycloak.example.com/realms/caipe
        audiences: [caipe-platform]
        jwks:
          file: /etc/agentgateway/jwks.json
    routes:
    - backends:
      - policies:
          mcpAuthorization:
            rules:
            - '"chat_user" in jwt.realm_access.roles && has(mcp.tool)'
```

## Default deny (FR-002)

Both PDPs enforce default deny:

- **Keycloak AuthZ**: decision strategy `UNANIMOUS` at resource server level; no matching permission → deny.
- **Agent Gateway**: if no `mcpAuthorization` rule matches, the request is denied; unreachable AG → deny (fail-closed).

## Audit integration (FR-005)

Every authorization decision (allow or deny) is logged as a structured event:

```json
{
  "ts": "2026-04-03T12:34:56Z",
  "tenant_id": "acme",
  "subject_hash": "sha256:abc...",
  "capability": "rag#invoke",
  "component": "mcp",
  "outcome": "deny",
  "reason_code": "DENY_NO_CAPABILITY",
  "pdp": "agent_gateway",
  "correlation_id": "req-12345"
}
```

Logged by the enforcement point (BFF middleware, Slack bot middleware, or AG sidecar) after PDP evaluation.

## Error responses (FR-006)

Enforcement points return a structured, actionable denial message to the user:

| Channel | Denied feedback |
|---------|----------------|
| Admin UI | Toast/banner: "You do not have permission to {action}. Contact your admin." Denied controls hidden/disabled. |
| Slack | Ephemeral message: "Sorry, you don't have permission to {action}. Ask your workspace admin for access." |
| Agent / MCP | `403` JSON body: `{"error": "access_denied", "capability": "{resource}#{scope}"}` |

## OBO token exchange (FR-018)

For Slack/Webex bot delegation, the bot performs OBO token exchange before calling Keycloak AuthZ or forwarding to AG:

```http
POST /realms/{realm}/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token={user_access_token}
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&requested_token_type=urn:ietf:params:oauth:token-type:access_token
&client_id={bot_client_id}
&client_secret={bot_client_secret}
```

The resulting OBO JWT contains `sub` (user) + `act.sub` (bot). Scope is the intersection of user entitlements and bot scope ceiling. This OBO JWT is forwarded to AG and downstream agents.
