# Plan: Streaming Tool Thoughts to UI

## Problem Statement

When an LLM calls tools, users only see the tool name and arguments in the UI. There's no visibility into **why** the agent is calling a tool or what it expects to achieve. This makes the agent's reasoning opaque and harder to understand/debug.

## Goal

Stream the LLM's reasoning/thinking for each tool call to the UI, so users can see:
- Why the agent decided to call this tool
- What information it expects to get
- How this fits into its overall plan

---

## Options Considered

### Option 1: Tool Wrapping with `thought` Parameter (Recommended)

**Approach**: Wrap each tool to add a `thought` parameter that the LLM must fill in before execution.

**How it works**:
1. At agent initialization, wrap MCP tools with an extended schema
2. Add `thought: str` as the first parameter with a descriptive prompt
3. Update tool descriptions to instruct LLM to explain reasoning
4. Extract `thought` from tool call args during streaming
5. Include `thought` in `tool_start` SSE event

**Pros**:
- Works with any LLM (not model-specific)
- Minimal changes to existing architecture
- Thought is tied directly to each tool call
- Can selectively exclude simple tools (ls, read_file)

**Cons**:
- Increases token usage (LLM must generate thought for each tool)
- Relies on LLM following instructions consistently
- Adds latency (more tokens to generate)

**Files to modify**:
- `services/tool_wrapper.py` (new) - Wrapping logic
- `services/stream_events.py` - Add `thought` to tool_start event
- `services/stream_trackers.py` - Extract thought from args
- `services/agent_runtime.py` - Apply wrapping at init
- `models.py` - Add `enable_tool_thoughts` config option

---

### Option 2: Claude Extended Thinking

**Approach**: Use Claude's native extended thinking feature.

**How it works**:
1. Enable thinking in model config: `thinking={"type": "enabled", "budget_tokens": 10000}`
2. Extract thinking blocks from `AIMessageChunk.content`
3. Stream as separate `thinking` SSE events

**Pros**:
- Native LLM reasoning, high quality
- No prompt engineering needed
- Shows overall thinking, not just per-tool

**Cons**:
- Only works with Claude models
- Significantly increases token usage/cost
- Thinking is model-level, not tied to specific tool calls

---

### Option 3: Leverage Todo List as Planning Signal

**Approach**: Use existing `write_todos` tool output as the planning mechanism.

**How it works**:
- Already implemented - `TODO_UPDATE` events stream to UI
- When LLM updates todos, it's showing its plan
- UI renders as "Agent's next steps"

**Pros**:
- Already working
- No additional implementation needed

**Cons**:
- Limited to task-list format
- Not free-form thinking
- Doesn't explain individual tool calls

---

### Option 4: Pre-Tool Content Parsing

**Approach**: Parse the LLM's text output before tool calls to extract reasoning.

**How it works**:
1. Modify system prompt to request chain-of-thought before tools
2. Parse content between tool calls to identify reasoning
3. Emit as `tool_intent` event before `tool_start`

**Pros**:
- Works with any model
- Natural language reasoning

**Cons**:
- Unreliable parsing (LLM may not follow format)
- Complex implementation
- Timing issues (content streams before tool calls)

---

## Recommended Approach

**Option 1 (Tool Wrapping)** is recommended because:
1. Model-agnostic - works with all LLM providers
2. Directly ties reasoning to specific tool calls
3. Clean integration with existing streaming architecture
4. Configurable per-agent via `enable_tool_thoughts`

Can be combined with **Option 3** (existing todo list) for overall planning visibility.

---

## Implementation Plan

### Phase 1: Core Infrastructure

1. **Create `tool_wrapper.py`**
   - `wrap_tools_with_thought(tools, exclude_tools)` function
   - Extends tool schemas with `thought` parameter
   - Wrapper extracts thought before invoking original tool

2. **Update `stream_events.py`**
   - Add `thought: str | None` to `make_tool_start_event()`

3. **Update `stream_trackers.py`**
   - Extract thought from args in `ToolTracker.start_tool()`

### Phase 2: Integration

4. **Update `agent_runtime.py`**
   - Apply wrapping conditionally based on config
   - Exclude simple tools: `ls`, `read_file`, `write_todos`

5. **Update `models.py`**
   - Add `enable_tool_thoughts: bool = False` to agent config

### Phase 3: UI

6. **Update UI components**
   - Handle `thought` field in `tool_start` events
   - Display in expandable "thinking" bubble
   - Style appropriately (italic, different color, etc.)

---

## SSE Event Format (After Implementation)

```json
{
  "type": "tool_start",
  "data": {
    "tool_name": "github_search_issues",
    "tool_call_id": "call_abc123",
    "args": {"query": "label:bug", "repo": "org/repo"},
    "agent": "platform-engineer",
    "is_builtin": false,
    "thought": "I need to search for open bug issues in the repository to understand the current bug backlog before making recommendations."
  }
}
```

---

## Configuration Example

```yaml
# Agent config
name: "Platform Engineer"
enable_tool_thoughts: true
model_id: "claude-sonnet-4-20250514"
model_provider: "anthropic-claude"
```

---

## Open Questions

1. **Token budget**: How much does this increase token usage? Need to measure.
2. **Excluded tools**: What's the right set of tools to exclude from thought wrapping?
3. **UI design**: How should thoughts be displayed? Inline? Collapsible? Separate panel?
4. **Caching**: Should thoughts be persisted in conversation history?

---

## Alternatives Not Pursued

- **OpenAI Reasoning Models (o1, o3)**: Reasoning is often encrypted, limited availability
- **Custom middleware**: More complex, harder to maintain
- **Separate planning step**: Adds latency, breaks flow
