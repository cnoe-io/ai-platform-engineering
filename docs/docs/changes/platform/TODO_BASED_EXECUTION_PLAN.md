# TODO-Based Execution Plan Architecture

## Overview

The Platform Engineer now uses **TODO lists as execution plans** instead of text-based execution plans with `⟦...⟧` markers. This solves the "execution plan without tool calls" problem and provides better UX.

## How It Works

### 1. Prompt Changes (`prompt_config.deep_agent.yaml`)

**Old Workflow:**
```
1. Stream text-based execution plan with ⟦...⟧ markers
2. [Agent could complete here without calling tools! ❌]
3. Call agents/tools
4. Create TODOs
5. Update TODOs
```

**New Workflow:**
```
1. Call write_todos immediately (forces tool execution ✅)
2. Execute tasks
3. Update TODOs with merge=true
4. Synthesize results
```

### 2. Agent Binding Changes (`agent.py`)

When `write_todos` tool completes:

- **Initial plan** (merge=False, has pending/in_progress items)
  → Emitted as `execution_plan_update` artifact
  → Clients display in execution plan panel

- **TODO updates** (merge=true, status changes)
  → Emitted as `execution_plan_status_update` artifact
  → Clients update execution plan panel in-place (no new chat messages)

```python
# In agent.py ToolMessage handler
if tool_name == "write_todos":
    if is_initial_plan:
        yield {
            "artifact": {
                "name": "execution_plan_update",
                "description": "TODO-based execution plan",
                "text": tool_content
            }
        }
    else:
        # Status update - client updates execution plan in-place
        yield {
            "artifact": {
                "name": "execution_plan_status_update",
                "description": "TODO progress update",
                "text": tool_content
            }
        }
```

### 3. Client Compatibility

**agent-chat-cli:**
- Still looks for `execution_plan_update` artifact ✅
- Displays in cyan Panel with "🎯 Execution Plan" title ✅
- No changes needed

**agent-forge:**
- Still looks for `execution_plan_update` artifact ✅
- Displays in execution plan panel ✅
- No changes needed

## Example Flow

### User Query
```
"show PRs in cnoe-io/ai-platform-engineering and tabulate status"
```

### Agent Response

**Step 1: Immediate tool call (write_todos)**
```python
write_todos(
    merge=False,
    todos=[
        {"id": "1", "content": "Query GitHub for PR information", "status": "in_progress"},
        {"id": "2", "content": "Tabulate results", "status": "pending"},
        {"id": "3", "content": "Synthesize findings", "status": "pending"}
    ]
)
```

**Client displays (execution plan panel):**
```
📋 Execution Plan
- 🔄 Query GitHub for PR information
- ⏸️  Tabulate results
- ⏸️  Synthesize findings
```

**Step 2: Execute first task**
```python
github(query="list PRs in cnoe-io/ai-platform-engineering")
```

**Step 3: Update TODOs**
```python
write_todos(
    merge=True,
    todos=[
        {"id": "1", "content": "Query GitHub for PR information", "status": "completed"},
        {"id": "2", "content": "Tabulate results", "status": "in_progress"},
        {"id": "3", "content": "Synthesize findings", "status": "pending"}
    ]
)
```

**Client displays (execution plan panel updates in-place):**
```
🎯 Execution Plan
- ✅ Query GitHub for PR information
- 🔄 Tabulate results
- ⏸️  Synthesize findings
```

**Note**: The execution plan panel updates in-place using ANSI escape codes. No new messages appear in the main chat for status updates.

## Benefits

### 1. **Forces Tool Execution**
- Agent MUST call `write_todos` first
- Can't complete without calling tools
- Eliminates "execution plan → completion without tools" bug

### 2. **Single Source of Truth**
- TODO list IS the execution plan
- No redundant content
- Clear, structured workflow

### 3. **Better UX**
- Interactive checklist with live status updates
- Clear icons (🔄 in-progress, ⏸️ pending, ✅ completed)
- Real-time progress tracking
- **Execution plan stays in dedicated pane** (not cluttering chat)
- **Status updates in-place** (no duplicate messages)
- **Clean separation**: Plan in one pane, results in another

### 4. **Clean Content Separation**
- **Execution Plan Pane**: Shows TODO list, updates in-place
- **Main Response Pane**: Shows actual agent work and results
- **No confusion**: User sees plan progress AND actual content clearly

### 5. **Backward Compatible**
- Clients receive `execution_plan_update` artifact (same as before)
- New `execution_plan_status_update` artifact for in-place updates
- agent-chat-cli updated to handle both
- agent-forge will need similar update (trivial)

## Implementation Files

1. **Prompt**: `charts/ai-platform-engineering/data/prompt_config.deep_agent.yaml`
   - Enforces TODO-first workflow
   - Provides clear examples

2. **Deep Agent**: `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py`
   - Simplified architecture (no post_model_hook needed)
   - TODOs enforce tool execution naturally

3. **A2A Binding**: `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py`
   - Detects initial TODO creation vs status updates
   - Emits initial plan as `execution_plan_update` artifact
   - Emits status updates as `execution_plan_status_update` artifact

4. **agent-chat-cli**: `agent_chat_cli/a2a_client.py` ✅ UPDATED
   - Handles `execution_plan_update` (initial display)
   - Handles `execution_plan_status_update` (in-place updates with ANSI codes)
   - Clean separation of execution plan vs content

5. **agent-forge**: `workspaces/agent-forge/plugins/agent-forge/src/components/AgentForgePage.tsx` ⏳ NEEDS UPDATE
   - Already handles `execution_plan_update`
   - Needs to handle `execution_plan_status_update` to update execution plan buffer in-place
   - Similar approach: update state without adding new message

## Testing

Restart the platform engineer and test with:
```bash
docker compose -f docker-compose.dev.yaml --profile p2p-no-rag restart platform-engineer-p2p
```

Try queries like:
- "show PRs in cnoe-io/ai-platform-engineering"
- "check argocd version"
- "get recent alerts from komodor"

You should see:
1. TODO checklist appears immediately as execution plan
2. Agent executes tasks right away (no completion without tools)
3. TODO status updates as work progresses
4. Final synthesis with results

