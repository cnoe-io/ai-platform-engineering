---
sidebar_position: 2
sidebar_label: Specification
title: "2024-10-25: Chat Session Context - Sub-Agent Tool Message Streaming Fix"
---

# Chat Session Context - Sub-Agent Tool Message Streaming Fix

**Status**: 🟢 In-use
**Category**: Session & Context
**Date**: October 25, 2024
**Session Goal**: Enable sub-agent tool messages to stream to end users for better transparency and debugging

---

## 🧪 Testing Results

### Test Command:
```bash
curl -X POST http://10.99.255.178:8000 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"id":"test-clean-output","method":"message/stream","params":{"message":{"role":"user","parts":[{"kind":"text","text":"show argocd version"}],"messageId":"msg-clean-test"}}}'
```

### Output - What Users Now See:
✅ **Sub-agent tool messages (NEW):**
- `"text":"🔧 Calling tool: **version_service__version**\n"`
- `"text":"✅ Tool **version_service__version** completed\n"`
- `"text":"The current version of ArgoCD is **v3.1.8+becb020**..."`

✅ **Token-level streaming (still working):**
- Individual tokens: `"###"`, `" Ar"`, `"go"`, `"CD"`, `" Version"`, etc.

✅ **Supervisor notifications (still working):**
- `🔧 Calling argocd...`
- `✅ argocd completed`

❌ **Raw JSON (REMOVED):**
- No more `{'id': '...', 'jsonrpc': '2.0', 'result': {...}}`

### Supervisor Logs Confirm Success:
```
2025-10-25 18:30:55 [root] [INFO] [stream:85] Processing custom a2a_event from sub-agent: 45 chars
2025-10-25 18:30:56 [root] [INFO] [stream:85] Processing custom a2a_event from sub-agent: 46 chars
2025-10-25 18:30:57 [root] [INFO] [stream:85] Processing custom a2a_event from sub-agent: 403 chars
```
- 45 chars = `🔧 Calling tool: **version_service__version**\n`
- 46 chars = `✅ Tool **version_service__version** completed\n`
- 403 chars = Full version response

---

## 📚 Related Documentation

### Files to Reference:
1. **Architecture Diagram:** [2024-10-25-sub-agent-tool-message-streaming](../011-sub-agent-tool-message-streaming/architecture.md)
   - Comprehensive Mermaid diagram showing event flow
   - A2A event type specifications
   - Protocol communication details

2. **Previous Work:** [2024-10-22-a2a-intermediate-states](../001-a2a-intermediate-states/architecture.md)
   - Background on A2A protocol

3. **Prompt Config:** `charts/ai-platform-engineering/data/prompt_config.deep_agent.yaml`
   - System prompt for Deep Agent (🔍 Querying instructions removed)

### Docker Configuration:
- **docker-compose.dev.yaml line 11:** Volume mount for prompt config
  ```yaml
  platform-engineer-p2p:
    volumes:
      - ./charts/ai-platform-engineering/data/prompt_config.deep_agent.yaml:/app/prompt_config.yaml
  ```

---

## ✅ TODO Status

**Completed:**
- [x] Switch supervisor from astream_events to astream with custom mode
- [x] Remove raw JSON streaming from a2a_remote_agent_connect.py
- [x] Update Mermaid diagram to show working flow
- [x] Test and verify sub-agent tool messages stream to users

**Pending:**
- [ ] Commit all changes
- [ ] Add on_tool_start logic to base_langgraph_agent.py for 🔍 Querying announcements

---

**End of Session Context**

## Related

- Architecture: [architecture.md](./architecture.md)
