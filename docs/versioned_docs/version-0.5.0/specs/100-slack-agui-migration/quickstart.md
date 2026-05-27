# Quickstart: Slack Bot AG-UI Migration

**Date**: 2026-04-14
**Spec**: [spec.md](./spec.md)
**Plan**: [plan.md](./plan.md)

## Prerequisites

- Dynamic agents backend running at `http://dynamic-agents:8100` (or `localhost:8100` for local dev)
- MongoDB running (for LangGraph checkpointer)
- Slack bot tokens configured (`SLACK_INTEGRATION_BOT_TOKEN`, `SLACK_INTEGRATION_APP_TOKEN`)
- At least one dynamic agent configured in MongoDB (e.g., `platform-engineer`)

## Key Validation Scenarios

### Scenario 1: Streaming Response (P1 — Real User)

**Setup**:
1. Start dynamic agents: `docker compose -f docker-compose.dev.yaml --profile dynamic-agents up -d`
2. Start Slack bot: `docker compose -f docker-compose.dev.yaml --profile slack-bot up -d`
3. Ensure `SLACK_INTEGRATION_BOT_CONFIG` YAML has `agent_id` set for the test channel

**Test**:
1. In a configured Slack channel, send `@CAIPE what ArgoCD apps are deployed?`
2. Verify: bot shows typing indicator, then streams text progressively
3. Verify: tool usage indicators appear if the agent calls tools
4. Verify: response ends with feedback buttons (thumbs up/down)
5. Verify: footer shows attribution text

**Pass criteria**: Text appears progressively (not all at once), response completes successfully.

### Scenario 2: Invoke Response (P1 — Bot User)

**Setup**: Same as Scenario 1, plus an alerting bot configured to trigger CAIPE.

**Test**:
1. Have a bot user send a message that triggers CAIPE (e.g., via AI alerts config)
2. Verify: bot posts a single complete message (not streamed)
3. Verify: response includes feedback buttons

**Pass criteria**: Response appears as a single message, not streamed progressively.

### Scenario 3: Conversation Continuity

**Test**:
1. Send a message to CAIPE in a thread: `@CAIPE list my ArgoCD apps`
2. Wait for response
3. In the same thread, send: `@CAIPE what about the ones in namespace production?`
4. Verify: second response references the first (context is preserved)
5. Verify: both messages use the same conversation ID (check logs for UUID)

**Pass criteria**: Follow-up response demonstrates awareness of prior context.

### Scenario 4: HITL Form (P2)

**Setup**: Agent must have a workflow that triggers `request_user_input` (e.g., Jira ticket creation with approval).

**Test**:
1. Ask CAIPE to perform an action requiring approval: `@CAIPE create a Jira ticket for the OOM issue`
2. Verify: agent streams initial response explaining what it will do
3. Verify: interactive form appears in thread with fields and Approve/Reject buttons
4. Click Approve (fill in any required fields)
5. Verify: agent resumes and completes the action
6. Verify: confirmation message appears in thread

**Pass criteria**: Form renders correctly, submission resumes the agent, final response completes.

### Scenario 5: Channel-Agent Routing (P2)

**Setup**: Configure two channels with different `agent_id` values in `SLACK_INTEGRATION_BOT_CONFIG`.

**Test**:
1. Send a message in channel A: `@CAIPE who are you?`
2. Send a message in channel B: `@CAIPE who are you?`
3. Verify: responses differ based on the configured agent's system prompt

**Pass criteria**: Each channel routes to its configured agent.

### Scenario 6: Deterministic Conversation ID

**Test** (unit test level):
```python
from utils.session_manager import thread_ts_to_conversation_id

ts = "1713100000.000100"
id1 = thread_ts_to_conversation_id(ts)
id2 = thread_ts_to_conversation_id(ts)
assert id1 == id2  # Same input → same output
assert id1 != thread_ts_to_conversation_id("1713100000.000200")  # Different input → different output
```

**Pass criteria**: Function is deterministic and produces valid UUIDs.

### Scenario 7: Error Handling

**Test**:
1. Stop the dynamic agents backend
2. Send a message to CAIPE: `@CAIPE hello`
3. Verify: error message appears in thread (not a crash)
4. Verify: retry button is shown
5. Restart dynamic agents
6. Click retry
7. Verify: response completes successfully

**Pass criteria**: Graceful error message, retry works after backend recovery.

### Scenario 8: A2A Code Removal

**Test** (post-migration verification):
```bash
# No A2A imports in Slack bot code
rg "a2a_client" ai_platform_engineering/integrations/slack_bot/ --type py
rg "A2AClient" ai_platform_engineering/integrations/slack_bot/ --type py
rg "send_message_stream" ai_platform_engineering/integrations/slack_bot/ --type py
rg "event_parser" ai_platform_engineering/integrations/slack_bot/ --type py

# Files deleted
test ! -f ai_platform_engineering/integrations/slack_bot/a2a_client.py
test ! -f ai_platform_engineering/integrations/slack_bot/utils/event_parser.py
```

**Pass criteria**: Zero matches for A2A references, files confirmed deleted.

## Running Tests

```bash
# From repo root
cd ai_platform_engineering/integrations/slack_bot
uv run pytest tests/ -v
```

All tests must pass after each phase commit.
