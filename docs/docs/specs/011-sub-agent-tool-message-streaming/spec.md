---
sidebar_position: 2
sidebar_label: Specification
title: "2024-10-25: Sub-Agent Tool Message Streaming Analysis"
---

# Sub-Agent Tool Message Streaming Analysis

**Status**: 🟢 In-use
**Category**: Architecture & Core Design
**Date**: October 25, 2024

> **Note**: This is a historical debugging/investigation document from October 2024. For comprehensive A2A protocol documentation with actual event data, see [A2A Event Flow Architecture](./2025-10-27-a2a-event-flow-architecture.md).

## Overview

This document tracks the investigation and implementation of enhanced transparency for sub-agent tool messages in the CAIPE streaming architecture conducted in October 2024. The goal was to make detailed sub-agent tool executions visible to end users for better debugging and transparency.

**Document Purpose**: Historical record of debugging process (October 2024), architectural limitations discovered, and implementation attempts.

**Date**: October 25, 2024


## Motivation

Users were only seeing high-level supervisor notifications like:
- `🔧 Calling argocd...`
- `✅ argocd completed`

But not the detailed sub-agent tool messages like:
- `🔧 Calling tool: **version_service__version**`
- `✅ Tool **version_service__version** completed`


## Current Status

### ✅ Successfully Implemented
1. **Transparent status-update processing** - All sub-agent messages are captured and processed
2. **Real-time streaming infrastructure** - Events are immediately passed to stream writer
3. **Robust error handling** - Client disconnections handled gracefully
4. **Enhanced logging** - Full visibility into event processing pipeline
5. **Comprehensive architecture mapping** - Complete understanding of event flow

### ❌ Architectural Limitation
- **Custom events not displayed:** Due to LangGraph's `astream_events` mode not processing custom events from `get_stream_writer()`
- **Sub-agent tool details not visible:** Users still don't see detailed tool execution steps

### 📊 Current User Experience

**What Users See:**
```
⟦🎯 Execution Plan: Retrieve ArgoCD Version Information⟧
🔧 Calling argocd...
✅ argocd completed
[Final response with version details]
```

**What Users Don't See (but is captured):**
```
🔧 Calling tool: **version_service__version**
✅ Tool **version_service__version** completed
```


## Testing Validation

### Test Command
```bash
curl -X POST http://10.99.255.178:8000 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"id":"test","method":"message/stream","params":{"message":{"role":"user","parts":[{"kind":"text","text":"show argocd version"}],"messageId":"msg-test"}}}'
```

### Log Validation
```bash
docker logs platform-engineer-p2p --since=2m | grep -E "(Streamed.*accumulated|Processing.*custom)"
```

**Expected Output:**
```
✅ Streamed + accumulated text from status-update: 45 chars
✅ Streamed + accumulated text from status-update: 46 chars
✅ Streamed + accumulated text from status-update: 400+ chars
```


## Current Status & Updated Documentation

> **⚠️ Historical Document**: This document captures the investigation as of October 25, 2024.

For the **current, comprehensive A2A protocol documentation** with actual event data, real-world examples, and complete event flow analysis, see:

### 📚 [A2A Event Flow Architecture (2025-10-27)](./2025-10-27-a2a-event-flow-architecture.md)

**What's included in the new documentation:**
- ✅ Complete architecture flowchart (Client → Supervisor → Sub-Agent → MCP → Tools)
- ✅ Detailed sequence diagram showing all 6 phases of execution
- ✅ Actual A2A event structures from real tests
- ✅ Token-by-token streaming analysis with append flags
- ✅ Comprehensive event type reference (task, artifact-update, status-update)
- ✅ Event count metrics (600+ events for simple query)
- ✅ Frontend integration examples
- ✅ Testing commands for both supervisor and sub-agents

**Use cases:**
- Understanding A2A protocol: → New doc
- Debugging streaming issues: → This doc (historical context)
- Implementing frontend clients: → New doc
- Understanding architectural limitations: → This doc

---

**Investigation Date:** October 25, 2024
**Document Status:** Historical - See [2025-10-27-a2a-event-flow-architecture.md](./2025-10-27-a2a-event-flow-architecture.md) for current documentation
**Findings:** Infrastructure Complete - Architecture Limitation Identified
**Outcome:** LangGraph streaming limitation documented; sub-agent tool details not visible to end users via `astream_events`


## Related

- Architecture: [architecture.md](./architecture.md)
