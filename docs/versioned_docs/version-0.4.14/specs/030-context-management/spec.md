---
sidebar_position: 2
sidebar_label: Specification
title: "2025-11-05: Auto Context Management for LangGraph Agents"
---

# Auto Context Management for LangGraph Agents

**Status**: 🟢 In-use
**Category**: Configuration & Prompts
**Date**: November 5, 2025

## Overview

All LangGraph agents now have **automatic message compression** to prevent context length exceeded errors. This system automatically trims old messages when the conversation history grows too large, ensuring agents can run indefinitely without hitting token limits.


## The Problem

LangGraph agents use a `MemorySaver` checkpointer to maintain conversation history across requests. Over time, this history accumulates:
- User messages
- Agent responses
- Tool calls and results
- System messages

Eventually, the total tokens exceed the model's context window (e.g., 128K tokens for GPT-4), causing errors:
```
openai.BadRequestError: Error code: 400 - This model's maximum context length is 128000 tokens.
However, your messages resulted in 186014 tokens...
```


## Related

- Architecture: [architecture.md](./architecture.md)
