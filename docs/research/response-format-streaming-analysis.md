# Research: `response_format` Strategies and Token Streaming

**Date**: 2026-04-08  
**Branch**: fix/1120-streaming-artifact-id-reset  
**Question**: Why does the final Slack message arrive all at once instead of token-by-token, and what is the correct fix?

---

## TL;DR

**`ToolStrategy` is the root cause.** It forces the model to produce the final answer as a JSON tool call argument. JSON tool call tokens cannot be rendered until the full JSON is assembled, so the final answer always arrives as one complete block.

**The `(instruction, Schema)` tuple form that worked in 0.2.41 is NOT officially supported by `deepagents`** — it only worked by accident because Python does not enforce type hints at runtime, and the tuple passed through to LangGraph's `create_react_agent`. But even that form **does not stream token-by-token** because the `generate_structured_response` node uses `ainvoke`, not `astream`.

**The old 0.2.41 streaming worked because `USE_STRUCTURED_RESPONSE=false` (the old default), which used the plain-text `[FINAL ANSWER]` marker.** In that mode, the model writes the final answer as normal content tokens — each token appears in `AIMessageChunk.content` and streams word-by-word.

---

## Evidence

### 1. `deepagents.create_deep_agent` — supported `response_format` types

Source: `.venv/lib/python3.13/site-packages/deepagents/graph.py:54`

```python
response_format: ResponseFormat | None = None
```

Where `ResponseFormat` is defined in `langchain.agents.structured_output`:

```python
ResponseFormat = ToolStrategy[SchemaT] | ProviderStrategy[SchemaT] | AutoStrategy[SchemaT]
```

**The tuple `(str, Schema)` is NOT in this union.** Python does not raise at runtime if you pass a tuple — but it is unsupported and will break on any version bump that adds a runtime type check.

---

### 2. The three supported strategies and their streaming behavior

| Strategy | How it works | Final answer tokens | Token-by-token streaming? |
|---|---|---|---|
| `ToolStrategy(schema=S)` | Model calls a fake tool. Answer is tool call JSON args. | `AIMessageChunk.tool_call_chunks` (JSON fragments) | ❌ No — JSON must be complete before parsing |
| `ProviderStrategy(schema=S)` | Model uses provider-native JSON mode (e.g., Anthropic JSON). Answer is JSON text. | `AIMessageChunk.content` (JSON text tokens) | ⚠️ Partial — tokens are visible but they're raw JSON, not human text |
| `AutoStrategy(schema=S)` | Selects "best" strategy automatically | Depends on selection | Unknown |
| `None` / `[FINAL ANSWER]` marker | Model writes plain text; marker separates thinking from answer | `AIMessageChunk.content` (plain text tokens) | ✅ Yes — fully readable tokens streamed word-by-word |

---

### 3. The `(instruction, Schema)` tuple — LangGraph `generate_structured_response` node

Source: `.venv/lib/python3.13/site-packages/langgraph/prebuilt/chat_agent_executor.py:758`

When `response_format` is a tuple, LangGraph creates a dedicated `generate_structured_response` node that runs AFTER the main agent loop. Its implementation:

```python
async def agenerate_structured_response(state, runtime, config):
    messages = _get_state_value(state, "messages")
    if isinstance(response_format, tuple):
        system_prompt, structured_response_schema = response_format
        messages = [SystemMessage(content=system_prompt)] + list(messages)
    model_with_structured_output = model.with_structured_output(schema)
    response = await model_with_structured_output.ainvoke(messages, config)  # ← ainvoke, not astream
    return {"structured_response": response}
```

**`ainvoke` blocks until the full response arrives. There is no token streaming from this node regardless of the schema or instruction string.**

The tuple form is also officially unsupported by deepagents — `deepagents.create_deep_agent` declares `response_format: ResponseFormat | None`, and `ResponseFormat` does not include `tuple`. This worked in the past only because Python type hints are not enforced at runtime.

---

### 4. Why 0.2.41 felt like token-by-token streaming

In 0.2.41:
- `USE_STRUCTURED_RESPONSE` defaulted to `false` (or the env var did not exist)
- `response_format=None` was passed to `create_deep_agent`
- The model generated plain text with a `[FINAL ANSWER]` marker
- The agent.py streaming loop accumulated `AIMessageChunk.content` tokens
- Each content token was yielded as a `STREAMING_RESULT` event
- Slack received tokens one-by-one and appended them progressively

This is true LLM token streaming — no JSON encoding, no tool call overhead.

---

### 5. Why `ToolStrategy` broke token streaming

With `ToolStrategy(schema=PlatformEngineerResponse)`:
1. The model is instructed to call `PlatformEngineerResponse(content="...", is_task_complete=True, ...)` as a tool
2. Individual tokens arrive as `AIMessageChunk.tool_call_chunks[0].args` — which is an incrementally-built JSON string: `'{"co'` → `'ntent": "Here'` → `' is the'` ...
3. These fragments are not processable until the closing `}` arrives
4. Only then can `content` be extracted and yielded as one complete string
5. Slack receives one `FINAL_RESULT` event with the entire answer

**The trade-off**: `ToolStrategy` guarantees `is_task_complete` and `require_user_input` are structured fields (not parsed from text), at the cost of losing token-by-token streaming.

---

## Options

### Option A: Revert to `[FINAL ANSWER]` marker (`USE_STRUCTURED_RESPONSE=false`)
- **Streaming**: ✅ Full token-by-token
- **`is_task_complete`**: Parsed from marker text (fragile; could fail if LLM doesn't follow the format exactly)
- **Complexity**: Low — just set the env var
- **Risk**: LLM may embed `[FINAL ANSWER]` in wrong place, expose it in output, or skip it

### Option B: `ToolStrategy` + stream Phase 2.5 via `astream` on plain text
- **Streaming**: ✅ Phase 2.5 (RAG hard-stop path) becomes token-by-token. ❌ Normal ResponseFormat tool path still arrives all at once.
- **`is_task_complete`**: Structured from tool call
- **Complexity**: Medium — change `_direct_structured_response` to use `llm.astream()` + default `is_task_complete=True`
- **Covers**: ~20-30% of queries (those that hit RAG cap / recursion limit)

### Option C: `ToolStrategy` + stream tool call partial JSON
- **Streaming**: ✅ Full token-by-token even for normal path — progressively extract `content` field from partial JSON as `tool_call_chunks` arrive
- **`is_task_complete`**: Structured from tool call
- **Complexity**: High — requires incremental JSON parser (or string prefix matching on `"content": "`)
- **Risk**: Fragile; field order in JSON not guaranteed across LLM providers/versions

### Option D: `ProviderStrategy(schema=PlatformEngineerResponse)` 
- **Streaming**: ⚠️ Tokens stream, but as raw JSON characters. Need to progressively extract `content` value from streaming JSON.
- **`is_task_complete`**: Structured from JSON
- **Complexity**: Medium-High — similar to Option C
- **AWS Bedrock**: Bedrock's Anthropic models do support native JSON mode

### Option E: Two-phase — stream plain text, then classify
1. Phase 1: Stream plain final answer as regular text (token-by-token)
2. Phase 2: Quick `ainvoke` to classify `is_task_complete` / `require_user_input` from the plain answer
- **Streaming**: ✅ Full token-by-token for the answer
- **`is_task_complete`**: Structured (from second call)
- **Complexity**: High — two LLM calls per turn; extra latency for classification
- **Cost**: Double LLM calls

---

## Recommendation

**Short-term (least risk)**: Option B — fix Phase 2.5 to use `astream` on plain text. Improves the RAG hard-stop path immediately. The normal path (ResponseFormat tool) is a separate problem.

**Medium-term (correct fix)**: Option A — revert to `[FINAL ANSWER]` marker (`USE_STRUCTURED_RESPONSE=false`) for true token streaming. Add a robust extraction fallback so `is_task_complete` is parsed correctly from the model output. This is what 0.2.41 was doing and what users experienced as "fast streaming".

**Do NOT use the tuple `(instruction, Schema)` form** — it is not in `deepagents.ResponseFormat`, it bypasses the type system, and it still doesn't stream because `generate_structured_response` uses `ainvoke`.

---

## Key Source References

| File | Line | What |
|---|---|---|
| `.venv/.../langchain/agents/structured_output.py:455` | `ResponseFormat = ToolStrategy \| ProviderStrategy \| AutoStrategy` | Canonical deepagents-compatible type |
| `.venv/.../langchain/agents/structured_output.py:192` | `class ToolStrategy` | Forces model to call a tool for structured output |
| `.venv/.../langgraph/prebuilt/chat_agent_executor.py:758` | `agenerate_structured_response` | Uses `ainvoke` — never streams |
| `.venv/.../deepagents/graph.py:54` | `response_format: ResponseFormat \| None` | Tuple not in type; unsupported |
| `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py:1542` | `ToolStrategy(schema=PlatformEngineerResponse)` | Current usage |
| `ai_platform_engineering/multi_agents/platform_engineer/prompts.py:212` | `response_format_instruction` | Used only in YAML template; not passed to deepagents currently |
