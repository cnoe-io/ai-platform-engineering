---
sidebar_position: 2
sidebar_label: Specification
title: "2024-10-22: A2A Common: Intermediate States and Tool Visibility"
---

# A2A Common: Intermediate States and Tool Visibility

**Status**: 🟢 In-use
**Category**: Architecture & Core Design
**Date**: October 22, 2024

## Overview

Enhanced the `a2a_common` base classes to provide **detailed visibility** into agent execution, including:

1. **Tool Selection** - See which tools are being called and with what parameters
2. **Tool Execution Status** - Know when tools succeed or fail
3. **Intermediate Progress** - Get real-time updates as agents work


## What Changed

### Before

```
⏳ Agent is working...
⏳ Processing results...
✅ Task completed
```

**Problems**:
- No visibility into which tools are running
- Users don't know if the agent is stuck or making progress
- Debugging is difficult

### After

```
🔧 Calling tool: **list_clusters**
✅ Tool **list_clusters** completed
🔧 Calling tool: **get_cluster_details**
✅ Tool **get_cluster_details** completed
⏳ Processing results...
✅ Task completed
```

**Benefits**:
- ✅ See exactly which tools are being invoked
- ✅ Know when each tool succeeds or fails
- ✅ Better UX with real-time progress updates
- ✅ Easier debugging of agent behavior


## Benefits

### 1. Improved User Experience

- **Progress Visibility**: Users see what the agent is doing in real-time
- **Wait Time Justification**: Users understand why operations take time
- **Error Transparency**: Clear indication when specific tools fail

### 2. Better Debugging

- **Tool Call Logging**: All tool invocations are logged
- **Failure Point Identification**: Easy to see which tool failed
- **Argument Inspection**: Tool parameters are visible (truncated for safety)

### 3. Performance Monitoring

- **Tool Execution Tracking**: Monitor which tools are slow
- **Call Frequency**: Identify tools that are called multiple times
- **Failure Rates**: Track tool reliability

### 4. Agent Development

- **Behavior Verification**: Confirm agents are using correct tools
- **Flow Understanding**: See the sequence of tool calls
- **Prompt Tuning**: Identify when agents make wrong tool choices


## Testing Strategy

### Test Cases

#### 1. Test Tool Call Visibility

```bash
# Query an agent that uses multiple tools
curl -X POST http://localhost:8001 \
  -H "Content-Type: application/json" \
  -d '{"query": "list all clusters in production"}'
```

**Expected**:
- See "🔧 Calling tool: **list_clusters**"
- See "✅ Tool **list_clusters** completed"

#### 2. Test Tool Failure Handling

```bash
# Query that will fail (invalid app name)
curl -X POST http://localhost:8001 \
  -H "Content-Type: application/json" \
  -d '{"query": "show status of nonexistent-app"}'
```

**Expected**:
- See "🔧 Calling tool: **get_application**"
- See "❌ Tool **get_application** failed"

#### 3. Check Logs

```bash
docker logs agent-komodor-p2p 2>&1 | grep "Tool call detected"
```

**Expected**:
```
komodor: Tool call detected - list_clusters
komodor: Tool result received - list_clusters (success)
```


## Related

- [Enhanced Streaming Feature](../enhanced-streaming-feature/spec)
- [Streaming Architecture](../streaming-architecture/spec)


- Architecture: [architecture.md](./architecture.md)
