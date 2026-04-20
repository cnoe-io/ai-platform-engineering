# Next Steps: MCP Tools, Channel Mapping, & Slack-Bot Conversation

## Status
- **Branch:** feat/comprehensive-rbac (102 commits)
- **Services:** Supervisor running ✓, Dynamic Agents ✓, Keycloak ✓, MongoDB ✓
- **UI:** Next.js `npm run dev` ready (seed-config loading at startup)

---

## Issue 1: MCP Tools Not Selectable in Agent Editor

**Current State:**
- `AllowedToolsPicker.tsx` component exists (line 28 imported into DynamicAgentEditor)
- Component fetches MCP servers from `/api/mcp-servers?page_size=100`
- Component probes servers to discover available tools
- Config has 5 enabled MCP servers: GitHub, ArgoCD, Jira, PagerDuty, Knowledge Base

**Likely Causes:**
1. MCP servers not seeded into MongoDB llm_models collection yet
   - Need: Run `npm run dev` in `ui/` to trigger instrumentation.ts → applySeedConfig()
2. Endpoint requires auth token (returns 401 Unauthorized without it)
3. MCP servers failing health checks or probe failures

**Fix Steps:**
```bash
cd ui && npm run dev  # Starts Next.js, triggers seed-config loading
# Wait for logs: "[seed-config] Applied: X models, Y MCP servers, Z agents"
# Then check MongoDB:
docker exec caipe-mongodb-dev mongosh admin -u admin -p changeme caipe --eval "db.mcp_servers.find().count()"
```

---

## Issue 2: Channel→Agent Mapping UI

**Current State:**
- `SlackChannelMappingTab.tsx` component exists (admin panel, line 33 of admin/page.tsx)
- API endpoint exists: `/api/admin/slack/channel-mappings` (GET/POST/DELETE)
- Backend mapper exists: `channel_agent_mapper.py` with RBAC checks

**Likely Causes:**
1. UI not showing agents dropdown (Dynamic Agents endpoint returning empty?)
2. Admin user doesn't have permissions to see admin panel
3. Channel mappings created but not being used by slack-bot

**Verification Steps:**
```bash
# 1. Check if agents exist in MongoDB
docker exec caipe-mongodb-dev mongosh admin -u admin -p changeme caipe \
  --eval "db.dynamic_agents.find({}, {name: 1, visibility: 1}).toArray()"

# 2. Try creating a mapping via API
curl -X POST http://localhost:3000/api/admin/slack/channel-mappings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slack_channel_id": "C123456", "agent_id": "github-pr-reviewer"}'

# 3. Verify slack-bot uses mapping
docker compose -f docker-compose.dev.yaml logs caipe-supervisor 2>&1 | grep "channel_agent"
```

---

## Issue 3: Slack-Bot Conversation Flow via Next.js API

**Current State:**
- Slack-bot currently calls supervisor directly via SSEClient
- Next.js has `/api/v1/chat/stream/start` and `/api/dynamic-agents/conversations` endpoints
- User wants dedicated endpoints for slack-bot to call

**Missing Endpoints (to create):**
```
POST /api/slack/conversation          # Start or resume conversation
GET  /api/slack/conversation/:id      # Get conversation state
POST /api/slack/turns                 # Submit a turn/message
GET  /api/slack/start-stream          # SSE stream endpoint for message
POST /api/slack/resume-stream         # Resume streaming
```

**Implementation Plan:**

1. **Create `/api/slack/conversation` (POST)**
   - Request: `{ slack_user_id, slack_channel_id, agent_id?, message? }`
   - Response: `{ conversation_id, thread_ts, status }`
   - Resolves: user identity, channel→agent mapping, RBAC, OBO token
   - Returns: Keycloak user context + agent_id for slack-bot to use

2. **Create `/api/slack/start-stream` (GET)**
   - SSE endpoint for streaming agent responses
   - Query: `?conversation_id=X&turn_id=Y`
   - Streams: LangGraph events (content, tool_calls, etc.)

3. **Update slack-bot to call these endpoints**
   - Instead of: Direct supervisor calls
   - Now: Call Next.js gateway for RBAC/OBO context, then stream via SSE
   - Update: `app.py` handle_dm_message() and handle_qanda_message()

**Example Flow:**
```
Slack User → Bot receives @mention
    ↓
Bot calls: POST /api/slack/conversation
    ├─ Request: { slack_user_id, slack_channel_id, message }
    └─ Response: { conversation_id, keycloak_user_id, agent_id, obo_token }
    ↓
Bot calls: GET /api/slack/start-stream?conversation_id=...
    ├─ Establishes SSE connection
    ├─ Receives events: { type, data }
    └─ Posts to Slack as events arrive
    ↓
Bot calls: POST /api/slack/turns?conversation_id=...
    ├─ Request: { message, turn_id }
    └─ Response: ack
```

---

## Implementation Order

1. **Verify MCP seeding** (5 min)
   - Run `npm run dev`, check MongoDB for mcp_servers count
   - If 0, debug seed-config loading in instrumentation.ts logs

2. **Test channel→agent mapping** (15 min)
   - Create test agent via API
   - Create mapping to it
   - Verify slack-bot uses it

3. **Create slack-bot conversation endpoints** (60 min)
   - `/api/slack/conversation` for context resolution
   - `/api/slack/start-stream` for SSE streaming
   - Update slack-bot app.py to call these
   - Test end-to-end with Slack message

---

## Files to Check/Modify

| Task | Files |
|------|-------|
| MCP Tools | `ui/src/lib/seed-config.ts`, `/api/mcp-servers`, MCP endpoint |
| Channel Mapping | `ui/src/components/admin/SlackChannelMappingTab.tsx`, `/api/admin/slack/channel-mappings` |
| Slack API | Create new `/api/slack/*` routes, update `slack_bot/app.py` |

---

## Testing Checklist

- [ ] MCP servers seeded into MongoDB (count > 0)
- [ ] Agent editor shows "Select MCP Server" dropdown
- [ ] Can expand a server and see tools
- [ ] Can select tools for agent
- [ ] Admin panel shows "Channel Mapping" tab
- [ ] Can map #test-channel to an agent
- [ ] Slack-bot uses channel mapping when resolving agent
- [ ] Slack message triggers `/api/slack/conversation` call
- [ ] SSE stream works and posts to Slack
