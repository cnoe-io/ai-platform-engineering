# Security

CAIPE security is enforced across the UI/BFF, Dynamic Agents, MCP routing, and
supporting platform services.

## Request Flow

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant UI as CAIPE UI/BFF
    participant IDP as Keycloak / OIDC
    participant DA as Dynamic Agents
    participant AG as AgentGateway
    participant FGA as OpenFGA
    participant MCP as MCP Server

    U->>UI: Sign in and send message
    UI->>IDP: Validate session / obtain tokens
    UI->>DA: Start or resume chat stream
    DA->>AG: Call MCP tool
    AG->>FGA: Authorize caller and tool scope
    FGA-->>AG: Allow or deny
    AG->>MCP: Forward allowed tool call
    MCP-->>AG: Tool result
    AG-->>DA: Tool result
    DA-->>UI: Stream response
    UI-->>U: Render answer
```

## Main Controls

| Control | Purpose |
|---|---|
| NextAuth / OIDC | Browser session authentication |
| Keycloak | Identity provider, service accounts, token exchange |
| OpenFGA | Relationship and scope authorization |
| AgentGateway | MCP route enforcement and ext_authz integration |
| Audit service | Central audit log ingestion and querying |
| MongoDB | Persistent UI, agent, route, and checkpoint state |

See the RBAC section for policy model details and deployment guidance.
