---
sidebar_position: 2
sidebar_label: Specification
title: "2024-10-22: Enhanced Streaming Feature"
---

# Enhanced Streaming Feature

**Status**: 🟢 In-use
**Category**: Features & Enhancements
**Date**: October 22, 2024

## Overview

The Enhanced Streaming feature provides intelligent routing for agent queries with three execution modes:

1. **DIRECT** - Single sub-agent streaming (fastest, minimal latency)
2. **PARALLEL** - Multiple sub-agents streaming in parallel (efficient aggregation)
3. **COMPLEX** - Deep Agent orchestration (intelligent reasoning)


## Testing Strategy

### Test DIRECT Mode

```bash
curl -X POST http://localhost:8000 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":"test-direct",
    "method":"message/send",
    "params":{
      "message":{
        "role":"user",
        "kind":"message",
        "message_id":"msg-direct",
        "parts":[{"kind":"text","text":"show me komodor clusters"}]
      }
    }
  }'
```

Expected logs:
```
🎯 Routing decision: direct - Direct streaming from komodor
🚀 DIRECT MODE: Streaming from komodor at http://agent-komodor-p2p:8000
```

### Test PARALLEL Mode

```bash
curl -X POST http://localhost:8000 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":"test-parallel",
    "method":"message/send",
    "params":{
      "message":{
        "role":"user",
        "kind":"message",
        "message_id":"msg-parallel",
        "parts":[{"kind":"text","text":"list github repos and komodor clusters"}]
      }
    }
  }'
```

Expected logs:
```
🎯 Routing decision: parallel - Parallel streaming from github, komodor
🌊 PARALLEL MODE: Streaming from github, komodor
🌊🌊 Parallel streaming from 2 sub-agents
```

### Test COMPLEX Mode

```bash
curl -X POST http://localhost:8000 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":"test-complex",
    "method":"message/send",
    "params":{
      "message":{
        "role":"user",
        "kind":"message",
        "message_id":"msg-complex",
        "parts":[{"kind":"text","text":"analyze clusters and create tickets"}]
      }
    }
  }'
```

Expected logs:
```
🎯 Routing decision: complex - Query requires orchestration across 2 agents
```
(Falls through to Deep Agent, no DIRECT/PARALLEL logs)


## Related

- [Streaming Architecture](./2024-10-22-streaming-architecture.md) - Technical deep dive
- [A2A Intermediate States](./2024-10-22-a2a-intermediate-states.md) - Tool visibility implementation


- Architecture: [architecture.md](./architecture.md)
