# CAIPE RBAC + Dynamic Agents: Demo Architecture

## Use Case 1: Slack Channel → Custom Agent Mapping

**Scenario:** Slack channel `#platform-incidents` auto-routes to a PagerDuty-enabled agent that only team members can access.

```
Slack User → Slack Bot → Channel→Agent Mapper → RBAC Check → Agent Response
                              ↓
                        1. Look up agent_id for channel
                        2. Check user's roles
                        3. Allow/deny based on agent visibility
```

### Key Flow:
1. **Channel Mapping** (MongoDB): `#platform-incidents` → `agent:incident-handler`
2. **RBAC Check** (Keycloak):
   - Global agent: ✅ all users
   - Team agent: ✅ if user has `team_member:sre` role
   - Private agent: ❌ deny (owner only)
3. **Auto-Bootstrap** (first message):
   - Silent: Match Slack email to Keycloak user
   - Fallback: User clicks HMAC link or set `SLACK_FORCE_LINK=true`

---

## Use Case 2: User → Multiple Agents + MCP Tool RBAC

**Scenario:** User creates a custom agent that uses GitHub + Jira tools. Only users with `engineer` role can invoke it.

```
User → Agent Editor → Save Agent Config → Dynamic Agents Service
                            ↓
                      Keycloak AuthZ Check:
                      ├─ Can user create agents? (admin role)
                      └─ Which tools can agent access?
                          ├─ GitHub (requires gh:read permission)
                          └─ Jira (requires jira:admin permission)

User runs agent → Gateway checks user roles → Routes to DA → MCP invocations
```

### Key Points:
- **Tool RBAC**: Each MCP server configured with allowed tools per agent
- **User Roles**: Gateway checks user's Keycloak roles before allowing tool access
- **Example**:
  ```yaml
  agent:
    id: "github-issue-finder"
    allowed_tools:
      github: ["list_issues", "get_issue"]  # subset of tools
      jira: []  # no jira access
  ```

---

## Use Case 3: User Impersonation + Token Cache in Keycloak

**Scenario:** Agent needs to call GitHub API *as the logged-in user* (not as bot).

```
User logs in → Keycloak issues access token + refresh token
                        ↓
User invokes agent → Gateway has user's token
                        ↓
Agent calls GitHub API with user's credentials (OBO)
                        ↓
GitHub sees: "API call from [user]'s token" ✓ audit trail

Token expires → Keycloak refresh (cached in Keycloak attributes)
                        ↓
Agent continues on behalf of user
```

### Key Flow:
1. **Pre-Auth** (Keycloak Admin API):
   - Store external tokens as user attributes
   - Example: `github_token`, `jira_token` attributes
   - Set refresh logic: auto-refresh before expiry

2. **Token Caching**:
   - Gateway caches valid tokens in memory (TTL: 5 min)
   - Before API call: Check cache → use if fresh
   - Cache miss: Fetch from Keycloak, update cache

3. **Example OBO Call**:
   ```
   POST /agent/chat
   Headers: Authorization: Bearer [user-token]
   Body: agent_id=github-pr-reviewer, message="review my PRs"
   
   Agent runtime:
   1. Get user context from token
   2. Look up user's github_token from Keycloak
   3. Call GitHub API with that token
   4. All actions logged as user (not bot)
   ```

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│ Slack Bot / Web UI                                       │
│ ├─ Channel ID / User                                    │
│ └─ Message                                              │
└────────────────┬──────────────────────────────────────┘
                 │
        ┌────────▼────────┐
        │ Keycloak OIDC   │
        │ • Auth          │
        │ • Roles/Groups  │
        │ • Token Storage │
        └────────┬────────┘
                 │
        ┌────────▼──────────────────┐
        │ Next.js Gateway           │
        │ ├─ Channel→Agent Mapper   │
        │ ├─ RBAC Enforcer          │
        │ ├─ Token Cache (5min TTL) │
        │ └─ OBO Token Exchange     │
        └────────┬──────────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌───▼──┐   ┌────▼─────┐   ┌──▼────┐
│ DA   │   │ MongoDB  │   │ MCP   │
│Svc   │   │ (Config) │   │Tools  │
└──────┘   └──────────┘   └───────┘
```

---

## Quick Demo Script

```bash
# 1. Create agent with GitHub + Jira tools
POST /api/dynamic-agents
{
  "name": "DevOps Helper",
  "system_prompt": "Help with deployments",
  "allowed_tools": {
    "github": ["list_repos", "get_pr"],
    "jira": ["list_issues"]
  },
  "visibility": "team",  # Only team_member:platform role
  "shared_with_teams": ["platform"]
}

# 2. Map Slack channel to agent
POST /api/admin/slack/channel-mappings
{
  "slack_channel_id": "C123456",
  "agent_id": "devops-helper"
}

# 3. Slack user sends message → auto-routed to agent
# Keycloak checks: Does user have team_member:platform role?
#   ✓ Yes → Invoke agent with MCP tools
#   ✗ No  → Show "Access denied"

# 4. Agent calls GitHub on behalf of user
# Gateway exchanges user's token (OBO) for GitHub API call
# Audit trail: GitHub logs show user's identity
```

---

## Key Takeaways

| Component | Role |
|-----------|------|
| **Keycloak** | Identity, roles, token storage |
| **Channel Mapper** | Slack channel → agent routing |
| **RBAC Enforcer** | Visibility checks (global/team/private) |
| **Token Cache** | OBO pre-auth + refresh |
| **Dynamic Agents** | LangGraph execution + MCP orchestration |

