# Implementation Plan: Extended Middleware Registry for Dynamic Agents

**Branch**: `102-dynamic-agents-middleware-ui` | **Date**: 2026-04-28 | **Spec**: [spec.md](./spec.md)

## Summary

Add four new middleware types (`SummarizationMiddleware`, `HumanInTheLoopMiddleware`, `ShellToolMiddleware`, `FilesystemFileSearchMiddleware`) to the dynamic_agents `MIDDLEWARE_REGISTRY`. Because the UI `MiddlewarePicker` is fully data-driven (fetches definitions from `/api/dynamic-agents/middleware` → `get_middleware_definitions()`), the UI automatically surfaces new registry entries — zero frontend changes are needed. Each middleware needs a `MiddlewareSpec` entry and a special-case builder function to translate flat registry params into the correct constructor arguments.

## Technical Context

**Language/Version**: Python 3.13, TypeScript (Next.js)  
**Primary Dependencies**: LangChain middleware (`langchain.agents.middleware`), LangGraph, `cnoe_agent_utils.LLMFactory`  
**Storage**: MongoDB (agent `FeaturesConfig.middleware` list)  
**Testing**: pytest  
**Target Platform**: Linux container (Kubernetes)  
**Project Type**: Backend service library + data-driven web UI  
**Performance Goals**: No impact on agent startup time (<100ms overhead per middleware instantiation)  
**Constraints**: Middleware params stored as flat `dict[str, Any]` in MongoDB — complex constructor args must be assembled by special builders, not stored nested  
**Scale/Scope**: 4 new registry entries, ~1 new file for tests, 1 modified file

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| Worse is Better | ✅ | Flat param representation trades elegance for simplicity; no new abstractions |
| YAGNI | ✅ | Only adding exactly what's requested; no speculative params |
| Rule of Three | ✅ | Builder pattern already used 4× in existing code — justified reuse |
| Composition over Inheritance | ✅ | Each middleware is a standalone class instance, no inheritance added |
| CI Gates | ✅ | New builders covered by unit tests |
| Security by Default | ✅ | `root_path` and `workspace_root` params are string-typed; no shell injection (passed to LangChain constructors, not eval'd) |

No violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/102-dynamic-agents-middleware-ui/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
└── tasks.md             ← Phase 2 output (/speckit.tasks)
```

### Source Code

```text
ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/
└── middleware.py                          ← MODIFY: add 4 MiddlewareSpec entries + 4 builders

ai_platform_engineering/dynamic_agents/src/dynamic_agents/tests/
└── test_middleware_builders.py            ← CREATE: unit tests for new builders
```

No UI file changes. The `MiddlewarePicker.tsx` and `/api/dynamic-agents/middleware` route are already fully data-driven.

## Phase 0: Research

### Decision: Flat param representation for complex constructors

**Decision**: Map complex constructor arguments to flat string/number/bool params in `default_params` and `param_schema`; reconstruct in special builder functions.

**Rationale**: `MiddlewareEntry.params` is stored as `dict[str, Any]` in MongoDB. Keeping all values scalar (string, int, bool) means no schema migration is needed, MongoDB queries stay simple, and the UI `param_schema` type system (number/boolean/string/select) handles them natively.

**Alternatives considered**:
- Store nested dicts in params — rejected: UI cannot render nested config; requires schema changes
- Add new param_schema types for complex inputs — rejected: YAGNI; overkill for 4 middleware

---

### Decision: SummarizationMiddleware param flattening

**Decision**: Expose `trigger_tokens` (int, default 4000) and `trigger_messages` (int, default 50) as separate params. Builder passes `trigger=[("tokens", trigger_tokens), ("messages", trigger_messages)]` so either threshold activates summarization. Expose `keep_messages` (int, default 20) mapped to `keep=("messages", keep_messages)`. Requires `model_id` + `model_provider` via `model_params=True`.

**Rationale**: Two separate trigger thresholds map cleanly to two number inputs in the UI. Neither threshold needs to be disabled individually in the common case — both act as a safety net.

---

### Decision: HumanInTheLoopMiddleware param flattening

**Decision**: Expose `interrupt_all` (bool, default True) and `tool_names` (string, default ""). Builder: if `interrupt_all=True`, constructs `interrupt_on` from all tools in agent context (falls back to `{"*": True}` sentinel handled at runtime); if False, splits `tool_names` by comma and constructs `{name: True for name in names}`. Also expose `description_prefix` (string).

**Rationale**: The most common use case is "interrupt on all tools" — a single toggle covers it. Per-tool configuration via comma-separated string keeps the UI simple without needing dynamic tool-name lookup at registry definition time.

**Note**: The `HumanInTheLoopMiddleware` constructor accepts `interrupt_on: dict[str, bool | InterruptOnConfig]`. The builder will construct this dict. When `interrupt_all=True`, it uses `{"__all__": True}` — this must be verified against the actual middleware behavior (or we pass an empty dict and rely on the middleware's default-approval behavior). This is the main implementation risk; see task notes.

---

### Decision: ShellToolMiddleware param flattening

**Decision**: Expose `workspace_root` (string, default ""), `tool_name` (string, default "shell"). When `workspace_root` is empty, pass `None` to the constructor (a temp dir will be created). `execution_policy` defaults to `HostExecutionPolicy()` — not exposed in the UI to keep it simple.

---

### Decision: FilesystemFileSearchMiddleware param flattening

**Decision**: Expose `root_path` (string, required), `use_ripgrep` (boolean, default True), `max_file_size_mb` (number, default 10). These map 1:1 to constructor params.

---

## Phase 1: Design & Contracts

### data-model.md

See [data-model.md](./data-model.md).

### API contract: GET /api/dynamic-agents/middleware

The existing endpoint already returns `get_middleware_definitions()`. After this feature, the response will include 4 additional entries. No API version bump needed — the response is an additive array.

**New entries (schema matches existing):**

```json
[
  {
    "key": "summarization",
    "label": "Conversation Summarization",
    "description": "Summarizes conversation history when token or message limits are approached",
    "enabled_by_default": false,
    "allow_multiple": false,
    "default_params": {
      "trigger_tokens": 4000,
      "trigger_messages": 50,
      "keep_messages": 20
    },
    "model_params": true,
    "param_schema": {
      "trigger_tokens": "number",
      "trigger_messages": "number",
      "keep_messages": "number"
    }
  },
  {
    "key": "human_in_the_loop",
    "label": "Human-in-the-Loop",
    "description": "Pauses agent execution for human approval before sensitive tool calls",
    "enabled_by_default": false,
    "allow_multiple": false,
    "default_params": {
      "interrupt_all": true,
      "tool_names": "",
      "description_prefix": "Tool execution requires approval"
    },
    "model_params": false,
    "param_schema": {
      "interrupt_all": "boolean",
      "tool_names": "string",
      "description_prefix": "string"
    }
  },
  {
    "key": "shell_tool",
    "label": "Shell Tool",
    "description": "Provides the agent with a persistent shell for executing bash commands",
    "enabled_by_default": false,
    "allow_multiple": false,
    "default_params": {
      "workspace_root": "",
      "tool_name": "shell"
    },
    "model_params": false,
    "param_schema": {
      "workspace_root": "string",
      "tool_name": "string"
    }
  },
  {
    "key": "filesystem_search",
    "label": "Filesystem File Search",
    "description": "Provides glob and grep search tools over a configured filesystem path",
    "enabled_by_default": false,
    "allow_multiple": false,
    "default_params": {
      "root_path": "",
      "use_ripgrep": true,
      "max_file_size_mb": 10
    },
    "model_params": false,
    "param_schema": {
      "root_path": "string",
      "use_ripgrep": "boolean",
      "max_file_size_mb": "number"
    }
  }
]
```

## Implementation Notes

### middleware.py changes

1. **Imports**: Add `SummarizationMiddleware`, `HumanInTheLoopMiddleware`, `ShellToolMiddleware`, `FilesystemFileSearchMiddleware` from `langchain.agents.middleware`.

2. **MIDDLEWARE_REGISTRY** — add 4 `MiddlewareSpec` entries after existing entries.

3. **Special builders** (4 new functions):
   - `_build_summarization(params)` → `SummarizationMiddleware(model=llm, trigger=[...], keep=(...), trim_tokens_to_summarize=...)`
   - `_build_human_in_the_loop(params)` → `HumanInTheLoopMiddleware(interrupt_on={...}, description_prefix=...)`
   - `_build_shell_tool(params)` → `ShellToolMiddleware(workspace_root=root or None, tool_name=name)`
   - `_build_filesystem_search(params)` → `FilesystemFileSearchMiddleware(root_path=path, use_ripgrep=bool, max_file_size_mb=int)`

4. **`_SPECIAL_BUILDERS` dict** — add the 4 new builder keys.

5. **`_build_summarization`** requires model instantiation via `_instantiate_model()` (same pattern as `_build_llm_tool_selector`). If `model_id`/`model_provider` not set, log warning and return `None` (skip middleware).

### Risk: HumanInTheLoop `interrupt_on` when `interrupt_all=True`

The `HumanInTheLoopMiddleware` constructor requires an explicit `interrupt_on` dict — there is no wildcard key. When `interrupt_all=True`, the builder must either:
- Pass an empty dict `{}` (no interrupts — wrong), or
- Return a sentinel that the runtime resolves to all tools (no such API exists)

**Resolution**: When `interrupt_all=True`, the builder will log a warning explaining that `tool_names` must be specified for HITL to be effective, and construct `interrupt_on` from `tool_names`. If `tool_names` is also empty, log a warning and skip the middleware (return `None`). This is consistent with `_build_model_fallback` which also returns `None` when required params are missing.

This means the UI must communicate that HITL requires tool names to be specified. The `interrupt_all` param may be removed in favor of just `tool_names` — the builder treats non-empty `tool_names` as the list to interrupt on.

**Updated HITL param design**: Remove `interrupt_all`, keep only `tool_names` (string, comma-separated, required) and `description_prefix`. When `tool_names` is empty, skip with warning.
