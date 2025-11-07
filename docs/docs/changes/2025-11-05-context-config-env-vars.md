# Context Management Environment Variables

**Status**: 🟢 In-use
**Category**: Configuration & Prompts
**Date**: November 5, 2025

## Overview

Global context management configuration that supports **provider-specific overrides** via environment variables.

## Environment Variables

### Provider Selection

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `azure-openai` | LLM provider (azure-openai, aws-bedrock, google-gemini, etc.) |

### Provider-Specific Context Limits

Override context limits for specific providers:

| Variable | Provider | Default | Description |
|----------|----------|---------|-------------|
| `AZURE_OPENAI_MAX_CONTEXT_TOKENS` | `azure-openai` | 100,000 | Azure OpenAI (GPT-4o) context limit |
| `OPENAI_MAX_CONTEXT_TOKENS` | `openai` | 100,000 | OpenAI context limit |
| `AWS_BEDROCK_MAX_CONTEXT_TOKENS` | `aws-bedrock` | 150,000 | AWS Bedrock (Claude) context limit |
| `ANTHROPIC_MAX_CONTEXT_TOKENS` | `anthropic-claude` | 150,000 | Anthropic Claude context limit |
| `GOOGLE_GEMINI_MAX_CONTEXT_TOKENS` | `google-gemini` | 800,000 | Google Gemini context limit |
| `GCP_VERTEXAI_MAX_CONTEXT_TOKENS` | `gcp-vertexai` | 150,000 | GCP Vertex AI context limit |

### Global Overrides

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CONTEXT_TOKENS` | *provider-specific* | Override for ALL providers |
| `MIN_MESSAGES_TO_KEEP` | `10` | Minimum recent messages to preserve |
| `ENABLE_AUTO_COMPRESSION` | `true` | Enable/disable auto-trimming (LangGraph only) |

## Priority Order

When determining context limits, the system uses this priority:

1. **Provider-specific ENV var** (e.g., `AWS_BEDROCK_MAX_CONTEXT_TOKENS`)
2. **Global override** (`MAX_CONTEXT_TOKENS`)
3. **Default for provider** (from `DEFAULT_PROVIDER_CONTEXT_LIMITS`)
4. **Fallback** (100,000)

## Examples

### Use Provider Defaults

```yaml
# docker-compose.yml
environment:
  - LLM_PROVIDER=aws-bedrock  # Uses 150K default
```

### Override Specific Provider

```yaml
environment:
  - LLM_PROVIDER=aws-bedrock
  - AWS_BEDROCK_MAX_CONTEXT_TOKENS=180000  # Increase Claude limit
```

### Override All Providers Globally

```yaml
environment:
  - MAX_CONTEXT_TOKENS=120000  # Applies to all providers
```

### Per-Provider Configuration (Multi-Provider Setup)

```yaml
# Platform Engineer (Azure OpenAI)
platform-engineer-p2p:
  environment:
    - LLM_PROVIDER=azure-openai
    - AZURE_OPENAI_MAX_CONTEXT_TOKENS=110000

# AWS Agent (Bedrock Claude)
agent-aws-p2p:
  environment:
    - LLM_PROVIDER=aws-bedrock
    - AWS_BEDROCK_MAX_CONTEXT_TOKENS=180000

# GitHub Agent (Google Gemini)
agent-github-p2p:
  environment:
    - LLM_PROVIDER=google-gemini
    - GOOGLE_GEMINI_MAX_CONTEXT_TOKENS=900000
```

## Testing

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

## Code Usage

### In Python Code

```python
from ai_platform_engineering.utils.a2a_common.context_config import (
    get_context_limit_for_provider,
    get_min_messages_to_keep,
    is_auto_compression_enabled,
    get_context_config,
)

# Get limit for specific provider
limit = get_context_limit_for_provider("aws-bedrock")
print(f"AWS Bedrock limit: {limit:,} tokens")

# Get limit for current provider (from LLM_PROVIDER env)
limit = get_context_limit_for_provider()
print(f"Current provider limit: {limit:,} tokens")

# Get complete config
config = get_context_config()
print(config)
# {
#   "provider": "aws-bedrock",
#   "max_context_tokens": 150000,
#   "min_messages_to_keep": 10,
#   "auto_compression_enabled": True
# }
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

## Migration

### From Hardcoded Values

**Before:**
```python
max_context_tokens = 100000  # Hardcoded
```

**After:**
```python
from .context_config import get_context_limit_for_provider
max_context_tokens = get_context_limit_for_provider()
```

### From ENV-Only Configuration

**Before:**
```python
max_context_tokens = int(os.getenv("MAX_CONTEXT_TOKENS", "100000"))
```

**After:**
```python
from .context_config import get_context_limit_for_provider
max_context_tokens = get_context_limit_for_provider()
# Now supports provider-specific overrides!
```

## Files Updated

- **`context_config.py`** (new): Global configuration module
- **`base_langgraph_agent.py`**: Uses `get_context_limit_for_provider()`
- **`base_strands_agent.py`**: Uses `get_context_limit_for_provider()`

## See Also

- [`CONTEXT_MANAGEMENT.md`](./CONTEXT_MANAGEMENT.md) - Full documentation
- [`CONTEXT_MANAGEMENT_SUMMARY.md`](./CONTEXT_MANAGEMENT_SUMMARY.md) - Quick reference




