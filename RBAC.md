# CAIPE RBAC + Dynamic Agents: Architecture & Flows

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Slack User / Web UI                             │
│                      (Channel / User / Message)                         │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                ┌────────────▼─────────────┐
                │   Keycloak Identity      │
                │  • OIDC / Session Auth   │
                │  • User Roles & Groups   │
                │  • Token Storage         │
                └────────────┬─────────────┘
                             │
        ┌────────────────────▼──────────────────────┐
        │     Next.js Gateway (api-router)         │
        │  ├─ Channel→Agent Mapper                 │
        │  ├─ RBAC Enforcement                     │
        │  ├─ Token Cache (5min TTL)               │
        │  └─ OBO Token Exchange                   │
        └─┬──────────────────┬──────────────────┬──┘
          │                  │                  │
    ┌─────▼──┐        ┌──────▼─────┐    ┌──────▼──────┐
    │  MCP   │        │  MongoDB   │    │   Dynamic   │
    │ Tools  │        │ (Config)   │    │   Agents    │
    │• GitHub│        │• Mappings  │    │   (LangGraph)
    │• Jira  │        │• Agents    │    │  + Tool RPC │
    │• Other │        │• Roles     │    │             │
    └────────┘        └────────────┘    └─────────────┘
```

---

## Use Case 1: Slack Channel → Custom Agent Mapping

**Scenario:** Slack channel `#platform-incidents` routes to a PagerDuty agent. Only SRE team members access it.

### Sequence Diagram: Message from Slack

```
Slack User          Slack Bot           Next.js             Keycloak          MongoDB          Agent
   │                   │                 Gateway               │               │               │
   │─ @mention ───────▶│                   │                   │               │               │
   │  message          │                   │                   │               │               │
   │                   │─ Receive Event ──▶│                   │               │               │
   │                   │                   │                   │               │               │
   │                   │                   │─ Lookup Channel ─────────────────▶│               │
   │                   │                   │ #platform-incidents               │               │
   │                   │                   │◀─ Return agent_id ────────────────│               │
   │                   │                   │  (incident-handler)              │               │
   │                   │                   │                   │               │               │
   │                   │                   │─ Get User Roles ──▶│               │               │
   │                   │                   │ (from OIDC token)  │               │               │
   │                   │                   │◀─ Roles: [team_member:sre, admin] │               │
   │                   │                   │                   │               │               │
   │                   │                   │─ Check Agent Visibility ────────▶│               │
   │                   │                   │ (visibility=team, shared_teams=[sre]) │           │
   │                   │                   │◀─ RBAC: Allow (user has team role) │             │
   │                   │                   │                   │               │               │
   │                   │                   │─ Invoke Agent ────────────────────────────────▶│
   │                   │                   │ (user context + message)          │               │
   │                   │                   │                   │               │               │
   │                   │                   │◀─ Agent Response ──────────────────────────────│
   │                   │◀─ Return Response ─│                   │               │               │
   │                   │                   │                   │               │               │
   │◀─ Post to Slack ──│                   │                   │               │               │
```

### Authorization Decision Tree

```
Slack Message Arrives
    │
    ├─ Get user from OIDC session
    │
    ├─ Look up channel→agent mapping
    │  └─ Not found? Use default agent
    │
    ├─ Get agent config (visibility + shared_teams)
    │
    └─ RBAC Check:
       │
       ├─ visibility == "global"?
       │  └─ ✅ Allow any user
       │
       ├─ visibility == "team"?
       │  └─ Does user have team_member:{team} role?
       │     ├─ ✅ Yes → Allow
       │     └─ ❌ No → Deny
       │
       └─ visibility == "private"?
          └─ Is user == agent owner?
             ├─ ✅ Yes → Allow
             └─ ❌ No → Deny
```

### Auto-Bootstrap on First Message

```
User sends first message to Slack bot
    │
    ├─ Check: Is Slack identity linked to Keycloak account?
    │
    ├─ If SLACK_FORCE_LINK=true:
    │  └─ Send manual link button (HMAC-signed URL)
    │     └─ User clicks → UI links accounts
    │
    └─ If SLACK_FORCE_LINK=false (default):
       │
       ├─ Silent auto-bootstrap attempt:
       │  ├─ Fetch Slack user email (users.info API)
       │  ├─ Query Keycloak: Find user by exact email match
       │  └─ If found: Store slack_user_id in Keycloak user attributes
       │
       └─ If email not found in Keycloak:
          └─ Send manual link button as fallback
```

---

## Use Case 2: User → Multiple Custom Agents + MCP Tool RBAC

**Scenario:** User creates agent "DevOps Helper" with GitHub + Jira tools. Only "engineers" role can use it.

### End-to-End Flow

```
User visits Agent Editor
    │
    ├─ Fill in agent config:
    │  ├─ name, description, system_prompt
    │  ├─ visibility: "team"
    │  ├─ shared_with_teams: ["platform"]
    │  └─ allowed_tools: {github: [...], jira: [...]}
    │
    └─ Click "Create Agent"
       │
       ├─ Next.js Gateway receives POST
       │  └─ Check: Is user admin? (Keycloak roles)
       │     ├─ ✅ Yes → Proceed
       │     └─ ❌ No → Deny with "admin only"
       │
       ├─ Validate allowed_tools against MCP registry
       │  └─ Check: Each tool exists in configured MCP servers
       │     ├─ ✅ Yes → Proceed
       │     └─ ❌ No → Reject with "tool not found"
       │
       ├─ Store agent config in MongoDB
       │  ├─ visibility: "team"
       │  ├─ shared_with_teams: ["platform"]
       │  └─ created_by: user_id
       │
       └─ Notify user: Agent created ✅
```

### Runtime: User Invokes Agent

```
User submits message to agent
    │
    ├─ Next.js Gateway receives chat request
    │
    ├─ Validate user's token
    │  └─ Extract roles from Keycloak token
    │
    ├─ Fetch agent config from MongoDB
    │  ├─ Check visibility:
    │  │  ├─ team → Is user in shared_with_teams?
    │  │  └─ private → Is user == owner?
    │  └─ ✅ Access allowed
    │
    ├─ Extract allowed_tools for this agent
    │  │  [github: [list_issues, get_pr], jira: [list_issues]]
    │
    ├─ Call Dynamic Agents service
    │  ├─ Pass user context + message + tool restrictions
    │  ├─ Agent initializes with tool whitelist
    │  └─ Agent can ONLY call allowed tools
    │
    ├─ Agent runs LangGraph, calls MCP tools
    │  ├─ Tool call: github.list_issues() → ✅ Allowed
    │  ├─ Tool call: github.create_repo() → ❌ Denied (not in whitelist)
    │  └─ Tool call: jira.list_issues() → ✅ Allowed
    │
    └─ Return response to user
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

```
┌─────────────────────────────────────────────────────────────────┐
│ Login Phase                                                      │
└─────────────────────────────────────────────────────────────────┘

User authenticates → Keycloak OIDC → Issues access_token + refresh_token
                                              │
                                              ├─ access_token contains:
                                              │  ├─ sub: user_id
                                              │  ├─ roles: [admin, chat_user, team_member:sre]
                                              │  └─ scope: openid profile email
                                              │
                                              └─ Refresh token stored for later use

┌─────────────────────────────────────────────────────────────────┐
│ Pre-Authorization Phase (setup)                                 │
└─────────────────────────────────────────────────────────────────┘

Admin stores external credentials in Keycloak user attributes:
  user.attributes = {
    github_token: "ghp_xxxxx",
    jira_token: "JIRA_xxxxx",
    refresh_github_token: 3600  # seconds until refresh
  }

┌─────────────────────────────────────────────────────────────────┐
│ Runtime Phase: User invokes agent                               │
└─────────────────────────────────────────────────────────────────┘

1. User message arrives with their access_token (in Authorization header)
   │
2. Next.js Gateway validates token signature (Keycloak public key)
   │
3. Extract user_id from token
   │
4. Before calling agent:
   │  ├─ Check token cache: Is github_token in memory?
   │  │  ├─ ✅ Cache HIT (< 5min old) → Use cached token
   │  │  └─ ❌ Cache MISS
   │  │
   │  └─ Fetch from Keycloak Admin API:
   │     GET /admin/realms/caipe/users/{user_id}
   │     └─ Response contains: github_token, jira_token, ...
   │
5. Update memory cache with fresh token + TTL=5min
   │
6. Pass github_token to agent runtime
   │
7. Agent calls: POST https://api.github.com/user/repos
   │             Headers: Authorization: Bearer ghp_xxxxx
   │
8. GitHub API logs: Action performed by {user_email}, not by bot
   │
9. Audit trail shows user (not bot) made the change
```

### Token Refresh Logic

```
┌─ Token Cache Check ─┐
│                     │
│ Is token fresh?     │
│ (age < 5 min)       │
│                     │
│  YES ──────────────────────────────┐
│         Use cached token           │
│                                    │
│  NO                                │
│   │                                │
│   ├─ Fetch from Keycloak Admin API │
│   │  GET /admin/realms/caipe/users/{id}
│   │                                │
│   ├─ Check expiry:                 │
│   │  Is token expired?             │
│   │                                │
│   │  YES (expired):                │
│   │   └─ Call Keycloak token endpoint
│   │      POST /realms/caipe/protocol/openid-connect/token
│   │      body: {
│   │        grant_type: "refresh_token",
│   │        client_id: "caipe-platform",
│   │        refresh_token: "rt_xxxxx"
│   │      }
│   │      └─ Response: New access_token + refresh_token
│   │
│   │  NO (still valid):             │
│   │   └─ Use current token         │
│   │                                │
│   └─ Update cache (TTL = 5min)     │
│                                    │
└────────────────────────────────────┘
```

### API Call Flow with User Credentials

```
User's Request
    │
    ├─ POST /api/chat
    │  Headers: Authorization: Bearer {user's_access_token}
    │  Body: { agent_id: "github-pr-reviewer", message: "review my PRs" }
    │
    ├─ Next.js Gateway:
    │  ├─ Validate user's token signature
    │  ├─ Extract user_id from token claims
    │  └─ Look up user's github_token from Keycloak cache/API
    │
    ├─ Invoke Dynamic Agents:
    │  └─ Pass: (user_id, github_token, message)
    │
    ├─ Agent runs LangGraph:
    │  ├─ Tool: GitHub.list_pull_requests(repo, per_user=True)
    │  │  └─ Uses: Authorization: Bearer {github_token}
    │  │
    │  └─ Tool: GitHub.create_review(pr_id, body)
    │     └─ Uses: Authorization: Bearer {github_token}
    │
    ├─ GitHub API sees:
    │  └─ "API call from token belonging to {user_email}"
    │
    └─ Response includes:
       ├─ Pull requests reviewed
       └─ Audit log shows: user_email performed action at {timestamp}
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
