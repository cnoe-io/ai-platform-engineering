# Auto Context Management for LangGraph Agents

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

## The Solution

The `BaseLangGraphAgent` now includes automatic message trimming that:

1. **Counts tokens** before each request using the tiktoken library
2. **Detects overflow** when tokens exceed the configured threshold
3. **Trims old messages** while preserving:
   - System messages (always kept)
   - Recent N messages (configurable)
4. **Updates checkpointer** to remove trimmed messages

This happens **transparently** - no code changes required in agent implementations!

## Configuration

### Provider-Specific Defaults

The system automatically sets appropriate context limits based on your LLM provider:

| Provider | Context Window | Default Limit | Safety Margin |
|----------|----------------|---------------|---------------|
| `azure-openai` | 128K | 100K | 28K (22%) for tools + response |
| `openai` | 128K-200K | 100K | 28K+ (22%+) for tools + response |
| `aws-bedrock` (Claude) | 200K | 150K | 50K (25%) for tools + response |
| `anthropic-claude` | 200K | 150K | 50K (25%) for tools + response |
| `google-gemini` | 1M-2M | 800K | 200K+ (20%+) for tools + response |
| `gcp-vertexai` | Varies | 150K | Conservative default |

**How it works:** The agent detects your `LLM_PROVIDER` environment variable and automatically sets an appropriate `MAX_CONTEXT_TOKENS` limit with safety margin for tools and response generation.

### Environment Variables

Control the behavior via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `azure-openai` | LLM provider (determines default context limit) |
| `ENABLE_AUTO_COMPRESSION` | `true` | Enable/disable auto-trimming |
| `MAX_CONTEXT_TOKENS` | *provider-specific* | Maximum tokens before trimming (auto-set per provider) |
| `MIN_MESSAGES_TO_KEEP` | `10` | Minimum recent messages to always keep |

### Example Configurations

#### Default (Auto-Detected from Provider)

```yaml
# docker-compose.yml
services:
  agent-github-p2p:
    environment:
      - LLM_PROVIDER=azure-openai  # Automatically uses 100K token limit
      - ENABLE_AUTO_COMPRESSION=true
      # MAX_CONTEXT_TOKENS not set - uses provider default (100K)
```

#### Using AWS Bedrock (Claude)

```yaml
services:
  agent-github-p2p:
    environment:
      - LLM_PROVIDER=aws-bedrock  # Automatically uses 150K token limit
      - ENABLE_AUTO_COMPRESSION=true
      # MAX_CONTEXT_TOKENS not set - uses provider default (150K)
```

#### Using Google Gemini (Large Context)

```yaml
services:
  agent-github-p2p:
    environment:
      - LLM_PROVIDER=google-gemini  # Automatically uses 800K token limit
      - ENABLE_AUTO_COMPRESSION=true
      # MAX_CONTEXT_TOKENS not set - uses provider default (800K)
```

#### Custom Override (Any Provider)

```yaml
services:
  agent-github-p2p:
    environment:
      - LLM_PROVIDER=azure-openai
      - ENABLE_AUTO_COMPRESSION=true
      - MAX_CONTEXT_TOKENS=80000  # Override default: more aggressive trimming
      - MIN_MESSAGES_TO_KEEP=5    # Keep fewer messages

## How It Works

### 1. Token Counting

The system uses the `tiktoken` library to accurately count tokens:

```python
def _count_message_tokens(self, message: Any) -> int:
    """Count tokens in a message including content and tool calls."""
    content = str(message.content)
    
    # Add tokens for tool calls
    if hasattr(message, "tool_calls"):
        for tool_call in message.tool_calls:
            content += str(tool_call)
    
    return len(self.tokenizer.encode(content))
```

### 2. Message Trimming

When tokens exceed `MAX_CONTEXT_TOKENS`:

```python
async def _trim_messages_if_needed(self, config: RunnableConfig) -> None:
    """Trim old messages from checkpointer if context too large."""
    
    # Get current state
    state = await self.graph.aget_state(config)
    messages = state.values["messages"]
    
    # Count tokens
    total_tokens = self._count_total_tokens(messages)
    
    if total_tokens > self.max_context_tokens:
        # Separate system messages (keep) from conversation (trim)
        system_messages = [m for m in messages if isinstance(m, SystemMessage)]
        conversation_messages = [m for m in messages if not isinstance(m, SystemMessage)]
        
        # Keep recent N messages
        messages_to_keep = conversation_messages[-self.min_messages_to_keep:]
        messages_to_remove = conversation_messages[:-self.min_messages_to_keep]
        
        # Remove old messages from checkpointer
        remove_commands = [RemoveMessage(id=msg.id) for msg in messages_to_remove]
        await self.graph.aupdate_state(config, {"messages": remove_commands})
```

### 3. Integration

Trimming happens automatically in the `stream()` method:

```python
async def stream(self, query: str, sessionId: str, trace_id: str = None):
    config = self.tracing.create_config(sessionId)
    
    # Ensure graph is initialized
    await self._ensure_graph_initialized(config)
    
    # Auto-trim old messages to prevent context overflow
    await self._trim_messages_if_needed(config)  # ← Automatic!
    
    # Continue streaming...
    async for state in self.graph.astream(inputs, config):
        yield state
```

## Logging

### Initialization

At agent startup, you'll see provider-specific configuration:

```
INFO: Context management initialized for provider=azure-openai: max_tokens=100000, min_messages=10, auto_compression=true
INFO: Context management initialized for provider=aws-bedrock: max_tokens=150000, min_messages=15, auto_compression=true
INFO: Context management initialized for provider=google-gemini: max_tokens=800000, min_messages=20, auto_compression=true
```

### Trimming Activity

When trimming occurs:

```
WARNING: github: Context too large (186014 tokens > 100000). Trimming old messages...
INFO: github: ✂️ Trimmed 150 messages (86014 tokens). Kept 10 messages (100000 tokens)
```

### Normal Operation

Debug logging shows checks even when no trimming is needed:

```
DEBUG: github: Context size OK (45230 tokens)
```

## Disabling Auto-Compression

If you need to disable auto-compression (e.g., for testing):

```bash
export ENABLE_AUTO_COMPRESSION=false
```

Or in Docker Compose:

```yaml
environment:
  - ENABLE_AUTO_COMPRESSION=false
```

**Warning:** Disabling compression may cause context overflow errors on long conversations!

## Architecture

### Component Flow

```
User Query
    ↓
BaseLangGraphAgent.stream()
    ↓
1. _ensure_graph_initialized() ← Setup MCP + graph
    ↓
2. _trim_messages_if_needed() ← Auto-compression ✂️
    ├─ aget_state() ← Load current messages
    ├─ _count_total_tokens() ← Check size
    ├─ RemoveMessage() ← Delete old messages
    └─ aupdate_state() ← Update checkpointer
    ↓
3. graph.astream() ← Stream with trimmed context
    ↓
Response Stream
```

### What Gets Trimmed

**ALWAYS KEPT:**
- System messages (agent instructions)
- Recent N messages (MIN_MESSAGES_TO_KEEP)

**TRIMMED:**
- Old user queries
- Old agent responses
- Old tool calls/results
- Messages beyond the recent window

### Trimming Strategy

The algorithm works as follows:

1. **Check threshold:** Count all tokens in checkpointer
2. **If over limit:** Separate system messages from conversation
3. **Keep recent N:** Preserve the last MIN_MESSAGES_TO_KEEP messages
4. **Remove old:** Delete everything else
5. **Aggressive trimming:** If still over limit, trim more (keeping at least 2 messages)

## Recommendations

### Azure OpenAI (GPT-4o)

**Development:**
```bash
export LLM_PROVIDER=azure-openai
export MAX_CONTEXT_TOKENS=80000   # More aggressive for testing
export MIN_MESSAGES_TO_KEEP=5
```

**Production:**
```bash
export LLM_PROVIDER=azure-openai
# Use default (100K) - no MAX_CONTEXT_TOKENS override needed
export MIN_MESSAGES_TO_KEEP=10
```

### AWS Bedrock / Anthropic Claude

**Production (Recommended):**
```bash
export LLM_PROVIDER=aws-bedrock
# Use default (150K) - leverages Claude's larger context
export MIN_MESSAGES_TO_KEEP=15  # Keep more history with larger window
```

**High-Traffic:**
```bash
export LLM_PROVIDER=aws-bedrock
export MAX_CONTEXT_TOKENS=120000  # More aggressive to save costs
export MIN_MESSAGES_TO_KEEP=10
```

### Google Gemini

**Production (Leverage Large Context):**
```bash
export LLM_PROVIDER=google-gemini
# Use default (800K) - Gemini excels with large context
export MIN_MESSAGES_TO_KEEP=20  # Keep extensive history
```

**Cost-Optimized:**
```bash
export LLM_PROVIDER=google-gemini
export MAX_CONTEXT_TOKENS=400000  # Still 2x larger than GPT-4
export MIN_MESSAGES_TO_KEEP=15
```

### General Guidelines

| Use Case | MAX_CONTEXT_TOKENS | MIN_MESSAGES_TO_KEEP | Notes |
|----------|-------------------|---------------------|-------|
| **Development/Testing** | 50-60% of provider limit | 5-8 | Aggressive trimming for faster iteration |
| **Production** | 70-80% of provider limit | 10-15 | Balanced approach |
| **Long Conversations** | 80-90% of provider limit | 15-20 | Preserve more context |
| **Cost-Sensitive** | 60-70% of provider limit | 8-10 | More frequent trimming to reduce tokens |

## Troubleshooting

### Issue: Context still overflowing

**Cause:** Tool definitions consuming too many tokens

**Solution:** 
1. Reduce MAX_CONTEXT_TOKENS to trigger earlier trimming
2. Reduce MIN_MESSAGES_TO_KEEP to trim more aggressively
3. Review tool schemas - simplify descriptions/parameters

### Issue: Agent "forgetting" context

**Cause:** MIN_MESSAGES_TO_KEEP too low

**Solution:** Increase MIN_MESSAGES_TO_KEEP to preserve more history

### Issue: Frequent trimming

**Cause:** MAX_CONTEXT_TOKENS set too low

**Solution:** Increase MAX_CONTEXT_TOKENS (but stay below model limit)

## Future Enhancements

Potential improvements:

1. **Smart summarization:** Instead of deleting old messages, summarize them
2. **Message importance:** Keep important messages (e.g., containing decisions)
3. **Tool result compression:** Compress large tool outputs
4. **Per-agent tuning:** Different limits for different agent types
5. **Metrics:** Track trimming frequency and token usage

## Example: Before/After

### Before (Context Overflow)

```
Messages: 200
Total tokens: 186,014
Status: ❌ Error - context_length_exceeded
```

### After (Auto-Compression)

```
Messages: 10 (kept) + 190 (trimmed)
Total tokens: 98,450
Status: ✅ Success - auto-compressed
Trimmed: 87,564 tokens
```

## Migration

No migration needed! All agents using `BaseLangGraphAgent` automatically get this feature.

Agents already deployed will start auto-compressing on their next request.

