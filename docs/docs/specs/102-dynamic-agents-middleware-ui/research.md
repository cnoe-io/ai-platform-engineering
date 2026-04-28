# Research: Extended Middleware Registry for Dynamic Agents

## Constructor param analysis

### SummarizationMiddleware
- Requires: `model: str | BaseChatModel` (mandatory)
- `trigger`: `ContextSize | list[ContextSize]` — a ContextSize is `("tokens", int)`, `("messages", int)`, or `("fraction", float)`
- `keep`: `ContextSize` — how many messages to preserve after summarization
- `trim_tokens_to_summarize`: int (default 4000) — max tokens of history sent to the summarizer LLM
- **Flat representation**: `trigger_tokens=4000`, `trigger_messages=50`, `keep_messages=20` + model via `model_params=True`

### HumanInTheLoopMiddleware
- Requires: `interrupt_on: dict[str, bool | InterruptOnConfig]` (mandatory, no wildcard key)
- `description_prefix`: str (default "Tool execution requires approval")
- **Conclusion**: No "interrupt all" API. Must specify tool names explicitly.
- **Flat representation**: `tool_names` (comma-separated string), `description_prefix` (string)
- **Risk mitigation**: Builder returns `None` when `tool_names` is empty (logs warning, skips middleware)

### ShellToolMiddleware
- `workspace_root`: str | Path | None (optional, temp dir if None)
- `tool_name`: str (default "shell")
- `execution_policy`: defaults to `HostExecutionPolicy()` — not exposed
- `startup_commands`, `shutdown_commands`, `redaction_rules`, `env` — not exposed (advanced)
- **Flat representation**: `workspace_root` (string, empty = use temp dir), `tool_name` (string)

### FilesystemFileSearchMiddleware
- `root_path`: str (required)
- `use_ripgrep`: bool (default True)
- `max_file_size_mb`: int (default 10)
- **Flat representation**: 1:1 with constructor params

## UI impact analysis

The `MiddlewarePicker.tsx` fetches `/api/dynamic-agents/middleware` and renders definitions dynamically:
- `model_params: true` → renders model selector (works for summarization)
- `param_schema: { key: "boolean" }` → renders checkbox (works for `use_ripgrep`)
- `param_schema: { key: "string" }` → renders text input (works for `tool_names`, `root_path`, etc.)
- `param_schema: { key: "number" }` → renders number input

**Conclusion**: Zero UI code changes needed. All 4 new middleware will render correctly with existing param_schema types.

## Existing builder pattern reference

```python
def _build_llm_tool_selector(params):
    kwargs = {"max_tools": params.get("max_tools", 10)}
    model_id = params.get("model_id")
    model_provider = params.get("model_provider")
    if model_id and model_provider:
        kwargs["model"] = _instantiate_model(model_id, model_provider)
    return LLMToolSelectorMiddleware(**kwargs)
```

`_build_summarization` follows the same pattern, but returns `None` when no model is configured (same as `_build_model_fallback`).
