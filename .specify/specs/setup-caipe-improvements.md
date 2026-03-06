# Spec: setup-caipe.sh Signal Handling, UI Port-Forward Opt-Out, and Multi-Agent Mode

## Overview

Three improvements to `setup-caipe.sh` that address signal responsiveness, port-forwarding flexibility, and correct supervisor-to-agent wiring:

1. **Signal handling**: Add SIGQUIT (Ctrl+\) trap and replace all blocking `sleep` calls with an interruptible `isleep` helper so the script responds immediately to Ctrl+C and Ctrl+\.
2. **`--no-ui-port-forward` flag**: Allow skipping the CAIPE UI port-forward when the UI is exposed via Ingress, NodePort, or another mechanism.
3. **Multi-agent deployment mode**: Set `global.deploymentMode=multi-agent` in the Helm deploy args so the supervisor's ConfigMap includes `ENABLE_WEATHER`/`ENABLE_NETUTILS` env vars, resolving the "agent not visible in agent card" validation warnings.

## Motivation

- **SIGQUIT**: The script traps INT (Ctrl+C) and TERM but not QUIT (Ctrl+\). Pressing Ctrl+\ causes an unclean termination with a potential core dump and no cleanup.
- **Blocked signals**: Foreground `sleep` calls in wait loops (pods, Milvus, RAG, monitoring) can delay signal delivery on some bash versions. Users pressing Ctrl+C may wait 5-10 seconds before the script reacts.
- **UI port-forward**: In environments where the UI is already exposed (e.g., Ingress on a remote cluster), port-forwarding to localhost is unnecessary and can conflict.
- **Agent card warnings**: The Helm chart has auto-wiring via `import-values` and `supervisor-agent-env` ConfigMap, but this only activates when `global.deploymentMode=multi-agent`. Without it, the supervisor never gets `ENABLE_WEATHER`/`ENABLE_NETUTILS`, so sub-agents are deployed but invisible to the supervisor.

## Scope

### In Scope
- `setup-caipe.sh`: trap registration, `isleep` helper, `--no-ui-port-forward` flag and guards, helm args
- Integration test: `integration/test_setup_caipe.sh`

### Out of Scope
- Helm chart template changes (the existing `supervisor-agent-env.yaml` template already handles multi-agent mode)
- Python agent registry code
- UI code
- Adding a shell test framework (bats, etc.)

## Design

### Architecture

The changes are localized to `setup-caipe.sh`:

```
setup-caipe.sh
├── State vars:    + SKIP_UI_PORT_FORWARD=false
├── Traps:         + trap '...; exit 131' QUIT
├── Helpers:       + isleep() { sleep "$1" & wait $! 2>/dev/null || true; }
├── Arg parser:    + --no-ui-port-forward) SKIP_UI_PORT_FORWARD=true ;;
├── Helm args:     + --set global.deploymentMode=multi-agent
├── Guards:        if ! $SKIP_UI_PORT_FORWARD; then ... fi
│                  (monitor_port_forwards, cmd_validate, run_validation, run_sanity_tests, Services Ready output)
└── Sleep → isleep: 15 call sites in wait loops
```

The `isleep` pattern runs `sleep` in the background and `wait`s on the PID. Since `wait` is a bash builtin, it is interrupted immediately when a trapped signal arrives, unlike foreground `sleep` which is an external process.

### Components Affected
- [ ] Agents (`ai_platform_engineering/agents/`)
- [ ] Multi-Agents (`ai_platform_engineering/multi_agents/`)
- [ ] MCP Servers
- [ ] Knowledge Bases (`ai_platform_engineering/knowledge_bases/`)
- [ ] UI (`ui/`)
- [ ] Documentation (`docs/`)
- [x] Helm Charts (`charts/`) — indirectly; no template changes, but `global.deploymentMode` activates existing template logic

## Acceptance Criteria

- [x] Ctrl+C exits immediately during any wait loop (pods, RAG, monitoring)
- [x] Ctrl+\ exits immediately with clean cleanup (exit code 131)
- [x] `--no-ui-port-forward` skips UI port-forward, readiness checks, validation, and sanity tests
- [x] Services Ready output hides UI endpoint when `--no-ui-port-forward` is set
- [x] Weather and netutils agents appear in supervisor agent card (no validation warnings)
- [x] `integration/test_setup_caipe.sh` passes (7/7 tests)
- [x] Only one bare `sleep` remains (the trivial `sleep 1` in `restart_pf`)

## Implementation Plan

### Phase 1: Signal handling
- [x] Add `trap 'cleanup_on_exit; exit 131' QUIT`
- [x] Add `isleep()` helper function
- [x] Replace all `sleep` calls in wait loops with `isleep` (15 sites)

### Phase 2: UI port-forward opt-out
- [x] Add `SKIP_UI_PORT_FORWARD=false` state variable
- [x] Add `--no-ui-port-forward` to arg parser
- [x] Guard UI port-forward in `monitor_port_forwards()`, `cmd_validate()`
- [x] Guard UI checks in `run_validation()`, `run_sanity_tests()`
- [x] Guard Services Ready output
- [x] Add to usage text

### Phase 3: Multi-agent mode
- [x] Add `--set global.deploymentMode=multi-agent` to helm args in `deploy_caipe()`

### Phase 4: Tests and docs
- [x] Create `integration/test_setup_caipe.sh`
- [x] Create spec (this file)
- [x] Create ADR

## Testing Strategy

- **Automated**: `integration/test_setup_caipe.sh` — 7 test cases covering flag parsing, trap registration, isleep interruptibility, help output, helm args, and sleep replacement
- **Manual verification**:
  - Deploy with `--non-interactive` and verify agent card includes weather/netutils tags
  - Run with `--no-ui-port-forward` and verify UI is not forwarded
  - Press Ctrl+C and Ctrl+\ during pod wait loops and verify immediate exit
  - Run `port-forward --no-ui-port-forward` and verify only supervisor is forwarded

## Rollout Plan

Standard PR merge to `main`. The `prebuild/` branch prefix triggers CI Docker builds. No breaking changes — all new behavior is opt-in (`--no-ui-port-forward`) or backward-compatible (signal handling, multi-agent mode).

## Related

- ADR: `docs/docs/changes/2026-03-03-setup-caipe-signal-handling-and-multi-agent.md`
- PR: `prebuild/feat/setup-caipe-improvements`
