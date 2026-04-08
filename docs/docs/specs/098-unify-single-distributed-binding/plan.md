# Implementation Plan: Per-Agent Distribution Control via `DISTRIBUTED_AGENTS`

**Branch**: `098-unify-single-distributed-binding` | **Date**: 2026-04-08 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `docs/docs/specs/098-unify-single-distributed-binding/spec.md` (User Story 5)

## Summary

Add per-agent distribution control to the unified supervisor codebase. A single `DISTRIBUTED_AGENTS` env var (comma-separated agent names) replaces the binary `DISTRIBUTED_MODE` toggle, allowing operators to progressively migrate individual agents to remote A2A containers while keeping others in-process. The change is ~20 lines in `deep_agent.py` plus a test file.

## Technical Context

**Language/Version**: Python 3.11+  
**Primary Dependencies**: LangGraph, deepagents, LangChain, FastAPI  
**Storage**: MongoDB/Redis (checkpointer/store — unchanged by this feature)  
**Testing**: pytest (synchronous tests), pytest-asyncio (async tests)  
**Target Platform**: Linux containers (Docker/Kubernetes)  
**Project Type**: Multi-agent backend service  
**Performance Goals**: No measurable impact — env var parsed once at startup  
**Constraints**: Backward compatible with `DISTRIBUTED_MODE=true` deployments  
**Scale/Scope**: ~20 lines of code change in `deep_agent.py`, ~50 lines of tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Specs as Source of Truth | PASS | spec.md updated with User Story 5, FR-013/014, SC-007/008 |
| II. Agent-First Architecture | PASS | No change to agent architecture; configuration only |
| III. MCP Server Pattern | PASS | MCP tools still loaded in-process for local agents |
| IV. LangGraph-Based Agents | PASS | No change to graph construction |
| V. A2A Protocol Compliance | PASS | Remote A2A subagent creation unchanged |
| VI. Skills over Ad-Hoc Prompts | N/A | Not applicable to this feature |
| VII. Test-First Quality Gates | PASS | Unit tests cover all resolution scenarios |
| VIII. Structured Documentation | PASS | Plan, research, data-model, quickstart produced |
| IX. Security and Compliance | PASS | No secrets in source; env var injection only |
| X. Simplicity / YAGNI | PASS | Single helper function + modified branch; no new abstractions |

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/098-unify-single-distributed-binding/
├── spec.md              # Feature specification (updated with User Story 5)
├── plan.md              # This file
├── research.md          # Phase 0: design decisions and alternatives
├── data-model.md        # Phase 1: entity model and resolution logic
└── quickstart.md        # Phase 1: usage examples and verification
```

### Source Code (repository root)

```text
ai_platform_engineering/
└── multi_agents/
    └── platform_engineer/
        ├── deep_agent.py          # MODIFIED: _get_distributed_agents(), _create_subagent_defs()
        └── tests/
            └── test_distributed_agents.py  # NEW: unit tests for per-agent distribution

tests/                             # Existing tests — no modification needed
```

**Structure Decision**: Single file modification (`deep_agent.py`) plus one new test file. No new modules, packages, or abstractions.

## Implementation Design

### New Helper: `_get_distributed_agents()`

```python
def _get_distributed_agents() -> set[str]:
    """Parse DISTRIBUTED_AGENTS env var into a set of agent names.
    
    Returns {"__all__"} when all agents should be distributed,
    a specific set of names for selective distribution,
    or an empty set when all agents should run in-process.
    """
    raw = os.getenv("DISTRIBUTED_AGENTS", "").strip()
    if not raw:
        if DISTRIBUTED_MODE:
            return {"__all__"}
        return set()
    tokens = {t.strip().lower() for t in raw.split(",") if t.strip()}
    if "all" in tokens:
        return {"__all__"}
    return tokens


def _agent_is_distributed(name: str, distributed_set: set[str]) -> bool:
    """Check if a specific agent should run in distributed (remote A2A) mode."""
    return name in distributed_set or "__all__" in distributed_set
```

### Modified: `__init__` on `PlatformEngineerDeepAgent`

```python
self._distributed_agents = _get_distributed_agents()
self.distributed_mode = bool(self._distributed_agents)
```

### Modified: `_create_subagent_defs`

Replace the binary `if self.distributed_mode:` / `else:` with per-agent routing:

```python
agent_prompts = prompt_config.get("agent_prompts", {})
local_agents = []

for name, fn in enabled_agents:
    if _agent_is_distributed(name, self._distributed_agents):
        try:
            remote_def = _create_remote_a2a_subagent_def(name, agent_prompts)
            subagent_defs.append(remote_def)
            logger.info(f"📡 {name} → remote A2A subagent")
        except Exception as e:
            logger.warning(f"Failed to create remote subagent '{name}': {e}")
    else:
        local_agents.append((name, fn))
        logger.info(f"🏠 {name} → in-process MCP tools")

# Load local MCP tools in parallel
if local_agents:
    results = await asyncio.gather(
        *[fn(prompt_config) for _, fn in local_agents],
        return_exceptions=True,
    )
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            logger.warning(f"Failed to create subagent '{local_agents[i][0]}': {result}")
        else:
            subagent_defs.append(result)

# Also pick up extra registry agents (unchanged)
if self._platform_registry:
    ...
```

## Complexity Tracking

No constitution violations. No complexity justification needed.

| Metric | Value |
|--------|-------|
| Lines changed in `deep_agent.py` | ~25 |
| New files | 1 (test file) |
| New abstractions | 0 (two module-level helper functions) |
| New env vars | 1 (`DISTRIBUTED_AGENTS`) |
| Breaking changes | 0 (`DISTRIBUTED_MODE` remains supported) |
