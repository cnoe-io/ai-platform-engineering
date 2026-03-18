---
sidebar_position: 2
sidebar_label: Specification
title: "2025-10-27: A2A Event Flow Architecture - Complete Analysis"
---

# A2A Event Flow Architecture - Complete Analysis

**Status**: 🟢 In-use
**Category**: Architecture & Core Design
**Date**: October 27, 2025

## Overview

This document provides a thorough analysis of the Agent-to-Agent (A2A) protocol event flow in the CAIPE platform, from end client through supervisor to sub-agents, documenting actual event types, streaming behavior, and data flow patterns.


## Testing Commands

### Test Supervisor
```bash
curl -X POST http://10.99.255.178:8000 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"id":"test-1","method":"message/stream","params":{"message":{"role":"user","parts":[{"kind":"text","text":"show argocd version"}],"messageId":"msg-1"}}}'
```

### Test Sub-Agent Direct
```bash
curl -X POST http://localhost:8001 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"id":"test-2","method":"message/stream","params":{"message":{"role":"user","parts":[{"kind":"text","text":"show argocd version"}],"messageId":"msg-2"}}}'
```


## Related

### External References
- [A2A Protocol Specification](https://github.com/google/A2A) - Official Google A2A protocol spec
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) - MCP official documentation
- [LangGraph Event Streaming](https://python.langchain.com/docs/langgraph/) - LangGraph streaming guide

### Internal Documentation
- [Sub-Agent Tool Message Streaming (Oct 25, 2024)](../sub-agent-tool-message-streaming/spec) - Historical debugging investigation
  - Documents LangGraph streaming limitations
  - Investigation of sub-agent tool message visibility
  - Architectural discoveries and attempted solutions
- [Session Context (Oct 25, 2024)](../session-context/spec) - Earlier investigation session



- Architecture: [architecture.md](./architecture.md)
