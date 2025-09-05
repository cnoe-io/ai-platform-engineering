# Security


The CAIPE (Community AI Platform Engineering) Multi-agent Systems provide robust user interfaces that facilitate seamless interaction between agents using the Agent-to-Agent (A2A) protocol. These interfaces are designed to support secure communication and collaboration among agents, leveraging OAuth for authentication to ensure data integrity and privacy.

These interfaces empower users to build and manage sophisticated multi-agent systems with ease and security.

> **Note:** Authorization and scope validation are currently handled by MCP servers. Additional details regarding this process will be provided in future updates.

Refer to [User Interfaces](../getting-started/user-interfaces.md) for additional details on client authentication.


## Login Flow

```mermaid
sequenceDiagram
    autonumber
    %% ===========================================================
    %% CAIPE / Jarvis Authentication & Authorization Flow
    %% Backstage UI Plugin uses Access Token and A2A
    %% ===========================================================

    participant U as User
    participant B as Browser (Backstage UI)
    participant IDP as Keycloak Identity Provider (federated with Company SSO)
    participant SUP as CAIPE Supervisor Agent
    participant A2A as A2A Protocol
    participant SUB as Sub-Agent
    participant MCP as MCP Tool Server
    participant POL as Policy Engine

    %% ------------------------ Step 0 Federation Setup ------------------------
    Note over IDP: Step 0 Setup - Keycloak federated with Company SSO for enterprise login and MFA

    %% ------------------------ Step 1 Onboarding ------------------------
    Note over IDP: Step 1 Onboarding - Admin defines custom entitlements and scopes such as github.read, github.write, argocd.read, argocd.app.create, caipe.use, agent.invoke, mcp.tools.kb.query

    %% -------------------- Step 2 User Session in Backstage -------------
    Note over B: Step 2 User Login - User signs into Backstage UI with Company SSO. UI plugin gets an access token
    U->>B: Open Backstage
    B->>IDP: Request access token (client credentials or OIDC)
    IDP-->>B: Access token returned

    %% ---------- Step 3 UI Plugin calls CAIPE Supervisor via A2A --------
    Note over B: Step 3 Call Supervisor - Backstage UI plugin calls CAIPE Supervisor using the access token via A2A
    B->>SUP: Call Supervisor with access token (A2A)
    SUP->>IDP: Get Public JWKS keys
    IDP-->>SUP: Keys returned
    SUP->>SUP: Validate token and check basic rights

    %% ---------- Step 4 Supervisor Reason + Act -------------------------
    Note over SUP: Step 4 ReAct - Supervisor plans which sub-agent or tool should handle the request
    SUP->>SUP: Reason and Act planning

    %% ---------- Step 5 Get a smaller, safer token for Sub-Agent --------
    Note over IDP: Step 5 Downscoping - Supervisor requests a limited token for just the sub-agent task
    SUP->>IDP: Request down-scoped token
    IDP-->>SUP: Down-scoped token returned

    %% ---------- Step 6 Supervisor to Sub-Agent via A2A -----------------
    Note over A2A: Step 6 Multi-Agent - Messages between Supervisor and Sub-Agent flow through A2A
    SUP->>A2A: Send task with down-scoped token
    A2A->>SUB: Deliver task with down-scoped token
    SUB->>IDP: Get Public JWKS keys
    IDP-->>SUB: Keys returned
    SUB->>SUB: Confirm token and check rights

    %% ---------- Step 7 Sub-Agent calls MCP Tool with policy check ------
    Note over MCP: Step 7 Tool Access - Sub-Agent calls a tool on MCP. Policy Engine ensures the request is allowed
    SUB->>MCP: Call tool with token
    MCP->>IDP: Get Public JWKS keys
    IDP-->>MCP: Keys returned
    MCP->>POL: Check policy using claims, scopes, resource rules
    POL-->>MCP: Allow or deny
    MCP-->>SUB: Tool result returned

    %% ---------- Step 8 Return results via A2A --------------------------
    Note over A2A: Step 8 Results - Supervisor returns the response back to the user. Response may be 200 OK (success) or 403 Forbidden (denied)
    SUB-->>A2A: Send result or denial
    A2A-->>SUP: Deliver result
    SUP-->>B: Return 200 OK or 403 Forbidden
    B-->>U: Show result to user
```
