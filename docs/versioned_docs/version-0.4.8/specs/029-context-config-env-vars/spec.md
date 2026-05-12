---
sidebar_position: 2
sidebar_label: Specification
title: "2025-11-05: Context Management Environment Variables"
---

# Context Management Environment Variables

**Status**: 🟢 In-use
**Category**: Configuration & Prompts
**Date**: November 5, 2025

## Overview

Global context management configuration that supports **provider-specific overrides** via environment variables.


## Testing Strategy

Test configuration loading:

```bash
# Set provider-specific override
export LLM_PROVIDER=aws-bedrock
export AWS_BEDROCK_MAX_CONTEXT_TOKENS=180000

# Start agent and check logs
docker compose up agent-aws-p2p

# Expected log output:
# INFO: Using provider-specific context limit from AWS_BEDROCK_MAX_CONTEXT_TOKENS: 180,000 tokens
# INFO: Context management initialized for provider=aws-bedrock: max_tokens=180,000, ...
```


## Benefits

### 1. Centralized Configuration

One source of truth for context limits across all agents (LangGraph and Strands).

### 2. Flexible Overrides

- **Development:** Lower limits for faster testing
- **Production:** Provider-optimized defaults
- **Cost-sensitive:** Custom limits per environment

### 3. Multi-Provider Support

Different agents can use different providers with appropriate limits:
- Platform Engineer (Azure GPT-4o): 100K
- AWS Agent (Bedrock Claude): 150K
- GitHub Agent (Gemini): 800K

### 4. Easy Debugging

Clear logging shows which configuration is being used:
```
INFO: Using provider-specific context limit from AWS_BEDROCK_MAX_CONTEXT_TOKENS: 180,000 tokens
INFO: Context management initialized for provider=aws-bedrock: max_tokens=180,000, ...
```


## Related

- Architecture: [architecture.md](./architecture.md)
