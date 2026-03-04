# setup-caipe.sh: Signal Handling, UI Port-Forward Opt-Out, and Multi-Agent Mode

**Status**: In-use
**Category**: Developer Experience
**Date**: March 3, 2026

## Overview

Three improvements to `setup-caipe.sh` that fix signal responsiveness, add port-forwarding flexibility, and enable correct supervisor-to-agent wiring via the Helm chart's multi-agent deployment mode.

## Problem Statement

### 1. SIGQUIT not handled; sleep blocks signals

The script trapped INT (Ctrl+C) and TERM but not QUIT (Ctrl+\). Pressing Ctrl+\ caused an unclean termination with potential core dump and no cleanup of port-forward processes.

Additionally, all wait loops used foreground `sleep` calls. On some bash versions, signals are deferred until the foreground `sleep` process completes, meaning Ctrl+C during a `sleep 10` could take up to 10 seconds to respond.

### 2. UI port-forward not optional

The script always port-forwarded the CAIPE UI to localhost:3000. In environments where the UI is exposed via Ingress, NodePort, or LoadBalancer, this is unnecessary and can conflict with local processes using port 3000.

### 3. Supervisor missing sub-agent ENABLE_* environment variables

The Helm chart has a built-in auto-wiring mechanism:
- Each agent subchart exports `agentExports.data.enabled: true` via `import-values` in `Chart.yaml`
- The parent chart's `supervisor-agent-env` ConfigMap template iterates `global.enabledSubAgents` and generates `ENABLE_WEATHER=true`, `WEATHER_AGENT_HOST=...`, etc.
- The supervisor deployment mounts this ConfigMap via `envFrom`

However, this mechanism is gated by `global.deploymentMode == "multi-agent"`, which defaults to `"single-node"`. Since `setup-caipe.sh` never set this value, the ConfigMap was not created, and the supervisor had no knowledge of deployed weather and netutils agents. This caused the validation warnings:

```
⚠ weather agent not visible in agent card
⚠ netutils agent not visible in agent card
```

## Decision

### 1. Interruptible sleep + QUIT trap

Added a SIGQUIT trap with the standard exit code 131 (128 + signal 3):

```bash
trap 'cleanup_on_exit; exit 131' QUIT
```

Introduced an `isleep` helper that runs `sleep` in the background and `wait`s on the PID:

```bash
isleep() { sleep "$1" & wait $! 2>/dev/null || true; }
```

Since `wait` is a bash builtin, it is interrupted immediately when a trapped signal arrives. All 15 `sleep` calls in wait loops were replaced with `isleep`. Only a trivial `sleep 1` in `restart_pf` (between kill and restart) was left unchanged.

### 2. `--no-ui-port-forward` flag

Added a `SKIP_UI_PORT_FORWARD` state variable (default `false`) and `--no-ui-port-forward` CLI flag. When set, the script skips:
- Port-forwarding `caipe-caipe-ui` service
- UI readiness check (`curl localhost:3000`)
- UI HTTP endpoint validation
- CAIPE UI HTML sanity test (T3)
- UI and RAG-proxied-by-UI lines in the "Services Ready" output

### 3. `global.deploymentMode=multi-agent`

Added `--set global.deploymentMode=multi-agent` to the helm install/upgrade args in `deploy_caipe()`. This activates the chart's existing auto-wiring:

1. Tags (`tags.agent-weather=true`) enable agent subcharts
2. Agent subcharts export `agentExports.data.enabled: true`
3. `Chart.yaml` `import-values` maps these to `global.enabledSubAgents.weather`, etc.
4. `supervisor-agent-env` ConfigMap template (now active) generates `ENABLE_WEATHER=true` and `WEATHER_AGENT_HOST=caipe-agent-weather`
5. Supervisor deployment mounts the ConfigMap, `AgentRegistry` discovers the agents

## Alternatives Considered

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| Trap QUIT without isleep | Simpler change | Signals still delayed during foreground sleep | Rejected |
| Manually set `ENABLE_WEATHER`/`ENABLE_NETUTILS` via `kubectl set env` in `post_deploy_patches()` | Works without chart changes | Bypasses chart auto-wiring, fragile, duplicates logic | Rejected |
| Set `global.deploymentMode=multi-agent` in helm args (chosen) | Leverages existing chart mechanism, zero template changes | None | Selected |

## Files Changed

- `setup-caipe.sh` (56 insertions, 34 deletions)

## Testing

- Automated: `integration/test_setup_caipe.sh` (7 test cases)
- Manual: Deploy with `--non-interactive`, verify agent card, test Ctrl+C/Ctrl+\ responsiveness

## Related

- Spec: `.specify/specs/setup-caipe-improvements.md`
- Chart template: `charts/ai-platform-engineering/templates/supervisor-agent-env.yaml`
- Supervisor deployment: `charts/ai-platform-engineering/charts/supervisor-agent/templates/deployment.yaml` (lines 74-78)
