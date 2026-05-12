# CAIPE RBAC + Dynamic Agents: Architecture & Flows

## System Architecture

```mermaid
graph TB
    User["🧑 Slack User / Web UI<br/>(Channel / User / Message)"]
    Keycloak["🔐 Keycloak Identity<br/>• OIDC / Session Auth<br/>• User Roles & Groups<br/>• Token Storage"]
    Gateway["🚪 Next.js Gateway<br/>• Channel→Agent Mapper<br/>• RBAC Enforcement<br/>• Token Cache 5min TTL<br/>• OBO Token Exchange"]
    MCP["🔧 MCP Tools<br/>• GitHub<br/>• Jira<br/>• ArgoCD<br/>• PagerDuty"]
    MongoDB["📦 MongoDB<br/>• Mappings<br/>• Agents<br/>• Roles"]
    DA["🤖 Dynamic Agents<br/>• LangGraph<br/>• Tool RPC<br/>• LLM Execution"]
    
    User --> Keycloak
    Keycloak --> Gateway
    Gateway --> MCP
    Gateway --> MongoDB
    Gateway --> DA
    MCP -.-> DA
```

---

## Use Case 1: Slack Channel → Custom Agent Mapping + Pre-Auth

**Scenario:** Slack channel `#platform-incidents` routes to a PagerDuty agent. Only SRE team members access it.

**First Message Experience:** When a new user sends their first message to the bot, they receive a pre-auth prompt asking them to authenticate before their question is processed. This ensures they are linked to a Keycloak account and have proper RBAC permissions before accessing agents.

### Sequence Diagram: Message from Slack

```mermaid
sequenceDiagram
    participant User as Slack User
    participant Bot as Slack Bot
    participant Gateway as Next.js Gateway
    participant KC as Keycloak
    participant DB as MongoDB
    participant Agent as Dynamic Agent
    
    User->>Bot: @mention<br/>message
    Bot->>Gateway: Receive Event
    Gateway->>DB: Lookup Channel<br/>#platform-incidents
    DB-->>Gateway: agent_id:<br/>incident-handler
    Gateway->>KC: Get User Roles<br/>(from token)
    KC-->>Gateway: [team_member:sre,<br/>admin]
    Gateway->>DB: Check Agent Config<br/>(visibility + teams)
    DB-->>Gateway: RBAC: Allow<br/>(user has role)
    Gateway->>Agent: Invoke Agent<br/>(context + message)
    Agent-->>Gateway: Response
    Gateway->>Bot: Return Response
    Bot->>User: Post to Slack
```

### RBAC Authorization Decision Tree

```mermaid
flowchart TD
    A["Slack Message Arrives"] --> B["Get User from<br/>OIDC Session"]
    B --> C["Look up<br/>Channel→Agent Mapping"]
    C --> D{Found?}
    D -->|No| E["Use Default Agent"]
    D -->|Yes| F["Get Agent Config<br/>visibility + teams"]
    E --> F
    F --> G{Check Visibility}
    
    G -->|global| H["✅ Allow Any User"]
    G -->|team| I{User has<br/>team_member role?}
    G -->|private| J{User == Owner?}
    
    I -->|Yes| K["✅ Allow"]
    I -->|No| L["❌ Deny Access"]
    J -->|Yes| K
    J -->|No| L
    
    H --> M["Invoke Agent"]
    K --> M
    L --> N["Error: Access Denied"]
```

### Auto-Bootstrap & Pre-Auth Prompt on First Message

```mermaid
flowchart TD
    A["User Sends<br/>First Message"] --> B{Slack ↔ Keycloak<br/>Linked?}
    B -->|Yes| C["✅ Use Existing Link"]
    B -->|No| D{Recently<br/>Prompted?}
    
    D -->|Yes| E["Skip Prompt<br/>(Spam Prevention)"]
    D -->|No| F["Send Pre-Auth Prompt<br/>with Link Button"]
    F --> G["Mark User as<br/>Prompted 1hr TTL"]
    G --> H["Don't Process<br/>Question Yet"]
    
    E --> I["Check:<br/>SLACK_FORCE_LINK?"]
    I -->|true| J["Send Manual Link<br/>HMAC-signed URL"]
    I -->|false| K["Attempt Silent<br/>Auto-Bootstrap"]
    
    K --> L["Fetch Slack<br/>User Email"]
    L --> M["Query Keycloak<br/>by Email"]
    M --> N{Match Found?}
    N -->|Yes| O["Store slack_user_id<br/>in Keycloak attrs"]
    N -->|No| J
    
    J --> P["User Clicks Link<br/>in Prompt or Message"]
    O --> Q["✅ User Authenticated"]
    P --> Q
    C --> Q
    H --> R["User Clicks Link<br/>in Prompt Button"]
    R --> Q
```

**Pre-Auth Prompt Details:**
- Sent only when `RBAC_ENABLED=true` and user is unlinked
- Interactive Slack message with "Authenticate Now" button
- Button points to HMAC-signed linking URL (10min TTL)
- User marked as prompted (1hr TTL) to prevent spam
- Question processing deferred until user authenticates

---

## Use Case 2: User → Multiple Custom Agents + MCP Tool RBAC

**Scenario:** User creates agent "DevOps Helper" with GitHub + Jira tools. Only "engineers" role can use it.

### Agent Creation Flow

```mermaid
sequenceDiagram
    participant User as Web UI
    participant Gateway as Next.js Gateway
    participant KC as Keycloak
    participant MCP as MCP Registry
    participant DB as MongoDB
    
    User->>Gateway: POST /api/dynamic-agents<br/>{config}
    Gateway->>KC: Check: Is user admin?
    KC-->>Gateway: Roles: [admin, chat_user]
    Note over Gateway: ✅ User is admin
    Gateway->>MCP: Validate tools:<br/>github, jira
    MCP-->>Gateway: ✅ Tools exist
    Gateway->>DB: Store Agent Config<br/>visibility: team<br/>allowed_tools: {...}
    DB-->>Gateway: ✅ Created
    Gateway-->>User: Agent created
```

### Runtime: User Invokes Agent

```mermaid
flowchart TD
    A["User Submits<br/>Message to Agent"] --> B["Next.js Gateway<br/>receives chat request"]
    B --> C["Validate User Token<br/>(Keycloak)"]
    C --> D["Fetch Agent Config<br/>from MongoDB"]
    D --> E{Check Visibility}
    E -->|global| F["✅ Access Allowed"]
    E -->|team| G{User in<br/>teams?}
    E -->|private| H{User == Owner?}
    G -->|Yes| F
    G -->|No| I["❌ Deny"]
    H -->|Yes| F
    H -->|No| I
    F --> J["Extract allowed_tools<br/>for agent"]
    J --> K["Call Dynamic Agents<br/>with tool whitelist"]
    K --> L["Agent Runs LangGraph"]
    L --> M{Tool Call?}
    M -->|In Whitelist| N["✅ Execute"]
    M -->|Not in Whitelist| O["❌ Block"]
    N --> P["Return Response"]
    O --> P
```

### Tool RBAC Configuration

```yaml
# Allowed tools per agent (seed-config.yaml / MongoDB)
agents:
  - id: "devops-helper"
    name: "DevOps Helper"
    visibility: "team"
    shared_with_teams: ["platform"]
    allowed_tools:
      github:
        - "list_repos"        # Whitelist specific tools
        - "get_pr"
        - "list_issues"
      jira:
        - "list_issues"
        - "get_issue"
    # Tools NOT listed = denied at runtime
```

---

## Use Case 3: User Impersonation + Token Cache in Keycloak

**Scenario:** Agent calls GitHub API as the logged-in user (audit trail shows user, not bot).

### OBO (On-Behalf-Of) Token Exchange

```mermaid
sequenceDiagram
    participant User as User
    participant KC as Keycloak
    participant Cache as Token Cache
    participant Gateway as Next.js Gateway
    participant GitHub as GitHub API
    
    Note over User,KC: Login Phase
    User->>KC: Authenticate (OIDC)
    KC-->>User: access_token +<br/>refresh_token
    
    Note over KC,Cache: Pre-Auth Phase
    KC->>KC: Store credentials in<br/>user.attributes:<br/>github_token, jira_token
    
    Note over User,GitHub: Runtime Phase
    User->>Gateway: POST /api/chat<br/>Authorization: {token}
    Gateway->>Cache: Check: github_token<br/>in cache?
    alt Cache HIT
        Cache-->>Gateway: Fresh token (< 5min)
    else Cache MISS
        Gateway->>KC: Admin API: GET user<br/>fetch github_token
        KC-->>Gateway: github_token
        Gateway->>Cache: Update cache<br/>TTL = 5min
    end
    Gateway->>GitHub: POST /user/repos<br/>Auth: Bearer github_token
    GitHub-->>Gateway: 200 OK
    GitHub->>GitHub: Audit Log:<br/>Action by {user_email}
    Gateway-->>User: Response
```

### Token Refresh Logic

```mermaid
flowchart TD
    A["Before API Call"] --> B{Token in Cache?}
    B -->|Yes| C{Age < 5min?}
    C -->|Yes| D["✅ Use Cached Token"]
    C -->|No| E["Fetch from KC"]
    B -->|No| E
    
    E --> F["Check Expiry"]
    F --> G{Token Expired?}
    G -->|Yes| H["Refresh via<br/>Keycloak Token Endpoint"]
    G -->|No| I["✅ Use Current Token"]
    
    H --> J["POST /protocol/openid-connect/token<br/>grant_type: refresh_token"]
    J --> K["New access_token +<br/>refresh_token"]
    K --> L["Update Cache<br/>TTL = 5min"]
    L --> M["✅ Token Ready"]
    
    D --> M
    I --> M
    M --> N["Call GitHub API"]
```

### API Call Flow with User Credentials

```mermaid
sequenceDiagram
    participant User as User
    participant Gateway as Next.js Gateway
    participant KC as Keycloak (Admin)
    participant DA as Dynamic Agents
    participant GitHub as GitHub API
    
    User->>Gateway: POST /api/chat<br/>agent_id: github-pr-reviewer<br/>Auth: Bearer {user_token}
    
    Gateway->>Gateway: Validate token signature
    Gateway->>Gateway: Extract user_id from claims
    
    Gateway->>KC: Look up user attrs<br/>github_token
    KC-->>Gateway: github_token (from cache)
    
    Gateway->>DA: Invoke agent<br/>(user_id, github_token, message)
    
    DA->>DA: Initialize LangGraph
    DA->>DA: Load allowed_tools whitelist
    
    DA->>GitHub: github.list_pull_requests()<br/>Auth: Bearer {github_token}
    GitHub-->>DA: [PR list]
    GitHub->>GitHub: Audit: Action by {user_email}
    
    DA->>GitHub: github.create_review(pr_id)<br/>Auth: Bearer {github_token}
    GitHub-->>DA: Review created
    GitHub->>GitHub: Audit: Action by {user_email}
    
    DA-->>Gateway: Response with results
    Gateway-->>User: Show PRs + review status
```

---

## Quick Demo Script

### 1. Create Agent with Tools

```bash
curl -X POST http://localhost:3000/api/dynamic-agents \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "DevOps Helper",
    "system_prompt": "Help with deployments using GitHub and Jira",
    "allowed_tools": {
      "github": ["list_repos", "get_pr"],
      "jira": ["list_issues"]
    },
    "visibility": "team",
    "shared_with_teams": ["platform"]
  }'
```

### 2. Map Slack Channel to Agent

```bash
curl -X POST http://localhost:3000/api/admin/slack/channel-mappings \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slack_channel_id": "C123456",
    "agent_id": "devops-helper"
  }'
```

### 3. User Sends Message in Slack

```
User in #platform-incidents: @caipe-bot help me review recent PRs
   │
   └─ Slack Bot receives message
      ├─ User has team_member:platform role? ✅ YES
      ├─ Agent visibility is team? ✅ YES
      ├─ Invoke agent with GitHub + Jira tools
      └─ Response posted to Slack
```

### 4. Verify OBO in GitHub Audit Log

```bash
# GitHub API shows:
# "Action performed by {user_email} using token {last_4_digits}"
# NOT "Action performed by caipe-bot"
```

---

## Key Architecture Decisions

| Component | Role | Technology |
|-----------|------|-----------|
| **Keycloak** | Identity, roles, token storage | OIDC broker + Admin API |
| **Channel Mapper** | Slack channel → agent routing | MongoDB `channel_agent_mappings` |
| **RBAC Enforcer** | Visibility checks (global/team/private) | Next.js Gateway middleware |
| **Token Cache** | OBO pre-auth + memory caching | In-memory (5min TTL) |
| **Dynamic Agents** | LangGraph execution + MCP tool filtering | Python service + MongoDB config |

---

## Deployment Considerations

- **Multi-tenant**: Each team sees only agents shared with them
- **Audit trail**: All API calls logged with actual user identity (not bot)
- **Fallback**: If channel unmapped, use `defaults.default_agent_id`
- **Scalability**: Token cache TTL allows graceful cache misses
