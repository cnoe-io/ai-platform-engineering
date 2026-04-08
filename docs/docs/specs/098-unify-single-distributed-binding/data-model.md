# Data Model: Per-Agent Distribution Control

**Date**: 2026-04-08  
**Spec**: `098-unify-single-distributed-binding`

## Entities

### Environment Variable Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DISTRIBUTED_AGENTS` | comma-separated string | `""` (empty) | Agent names to run as remote A2A subagents. `all` = every agent. |
| `DISTRIBUTED_MODE` | boolean string | `"false"` | Legacy toggle. `true` → equivalent to `DISTRIBUTED_AGENTS=all`. |
| `ENABLE_<NAME>` | boolean string | `"true"` | Per-agent enable/disable (orthogonal to distribution). |

### Resolution Logic

```
ENABLE_<NAME>=false  →  agent skipped (highest priority)
DISTRIBUTED_AGENTS set  →  per-agent routing
DISTRIBUTED_MODE=true  →  treated as DISTRIBUTED_AGENTS=all (legacy compat)
Neither set  →  all agents in-process
```

### `_get_distributed_agents()` Return Type

| Return value | Meaning |
|---|---|
| `set()` (empty) | All agents run in-process |
| `{"argocd", "aws"}` | Only named agents run remotely |
| `{"__all__"}` | Every agent runs remotely |

### State Changes on `PlatformEngineerDeepAgent`

| Field | Before | After |
|---|---|---|
| `self.distributed_mode` | `DISTRIBUTED_MODE` boolean | `True` if any agent is distributed (non-empty `distributed_set`) |
| `self._distributed_agents` | N/A (new) | `set[str]` from `_get_distributed_agents()` |

### Agent Routing in `_create_subagent_defs`

For each `(name, fn)` in `SINGLE_NODE_AGENTS` where `_is_agent_enabled(name)`:

| Condition | Action |
|---|---|
| `name in distributed_set` or `"__all__" in distributed_set` | `_create_remote_a2a_subagent_def(name, agent_prompts)` |
| Otherwise | `fn(prompt_config)` (in-process MCP, loaded in parallel) |
