# Research: Per-Agent Distribution Control via `DISTRIBUTED_AGENTS`

**Date**: 2026-04-08  
**Spec**: `098-unify-single-distributed-binding`

## Research Tasks

### 1. How should per-agent distribution interact with the existing `DISTRIBUTED_MODE` toggle?

**Decision**: `DISTRIBUTED_AGENTS` env var takes precedence when set; `DISTRIBUTED_MODE=true` is treated as `DISTRIBUTED_AGENTS=all` for backward compatibility.

**Rationale**: The existing binary toggle (`DISTRIBUTED_MODE`) forced all agents into either local or remote mode. Deployments need finer control — e.g., ArgoCD in its own container (high memory use) while lightweight agents run in-process. A single comma-separated list is the simplest mechanism that provides per-agent control without a proliferation of env vars.

**Alternatives considered**:
- **Option B: `AGENT_MODE_<NAME>` per-agent overrides** — More flexible (each agent has its own env var defaulting to the global `DISTRIBUTED_MODE`), but creates N extra env vars. Rejected for unnecessary complexity at this stage.
- **Option C: Separate `ENABLE_<NAME>` + `DISTRIBUTED_<NAME>` flags** — Doubles the env var surface. Conflates enable/disable with distribution mode. Rejected.

### 2. What is the resolution order when multiple env vars are set?

**Decision**: Three-level resolution:

1. `ENABLE_<NAME>=false` → agent is **skipped entirely** (highest priority)
2. `DISTRIBUTED_AGENTS` is set → controls per-agent distribution mode
3. `DISTRIBUTED_MODE=true` (legacy) → treated as `DISTRIBUTED_AGENTS=all`
4. Neither set → all agents run in-process (single-node / all-in-one)

**Rationale**: Enable/disable is orthogonal to distribution mode and should always win. The `DISTRIBUTED_AGENTS` list is the primary mechanism; `DISTRIBUTED_MODE` is legacy backward compat only.

### 3. How does `_create_subagent_defs` need to change?

**Decision**: Replace the binary `if self.distributed_mode:` branch with per-agent logic:

```python
distributed_set = _get_distributed_agents()  # parses DISTRIBUTED_AGENTS env var

for name, fn in enabled_agents:
    if name in distributed_set:
        # remote A2A subagent
        subagent_defs.append(_create_remote_a2a_subagent_def(name, agent_prompts))
    else:
        # in-process MCP tools (gathered for parallel loading)
        local_agents.append((name, fn))

# Load local MCP tools in parallel
results = await asyncio.gather(...)
```

**Rationale**: This preserves the existing parallel MCP loading for local agents (performance) while allowing individual agents to be switched to remote mode. The `_get_distributed_agents()` helper centralizes env var parsing and backward compat logic.

### 4. Should `self.distributed_mode` remain on the class?

**Decision**: Keep `self.distributed_mode` as a boolean that means "at least one agent is distributed" (i.e., `distributed_set` is non-empty). This preserves the existing platform_registry initialization and dynamic monitoring logic that only needs to run when any agent is remote.

**Rationale**: The platform_registry and dynamic agent monitoring are only useful when remote agents exist. A boolean flag is the simplest way to gate that initialization.

### 5. What about agents discovered via `platform_registry` that aren't in `SINGLE_NODE_AGENTS`?

**Decision**: Extra registry agents (e.g., weather, gitlab) are always treated as remote — they have no in-process MCP implementation. No change needed; existing logic already handles this correctly.

**Rationale**: These agents don't appear in `SINGLE_NODE_AGENTS` and are only available via their own A2A containers. The per-agent distribution feature only affects agents that *have* both local and remote implementations.

### 6. How should the `DISTRIBUTED_AGENTS` value be parsed?

**Decision**: Parse as comma-separated, case-insensitive, trimmed tokens. The special value `all` means every agent in `SINGLE_NODE_AGENTS` is distributed.

```python
def _get_distributed_agents() -> set[str]:
    raw = os.getenv("DISTRIBUTED_AGENTS", "").strip()
    if not raw:
        if DISTRIBUTED_MODE:
            return {"__all__"}
        return set()
    tokens = {t.strip().lower() for t in raw.split(",") if t.strip()}
    if "all" in tokens:
        return {"__all__"}
    return tokens
```

Use `"__all__"` as a sentinel to mean "every agent". The check becomes `name in distributed_set or "__all__" in distributed_set`.

**Rationale**: Simple to implement, easy to read in `docker-compose.yaml` or Helm values, and avoids parsing ambiguity.
