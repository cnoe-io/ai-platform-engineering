# Migration Guide: ai-platform-engineering 0.4.7 → 0.4.8

## Overview

0.4.8 adds the AWS MCP server, supervisor call-limit middlewares, and Kubernetes PSS Baseline security contexts across all charts. No Helm values changes are required for existing deployments — the new middlewares default to disabled and PSS security contexts are applied automatically.

## Helm Values Changes

No breaking Helm values changes between 0.4.7 and 0.4.8. Drop-in upgrade — no `values.yaml` edits required.

### New Optional: Supervisor Call Limits

Two new environment variables (configurable via `supervisor-agent.config` in your values file) control per-run limits:

| Env Var | Default | Description |
|---------|---------|-------------|
| `TOOL_CALL_LIMIT` | `0` (disabled) | Max tool invocations per run; `0` = unlimited |
| `MODEL_CALL_LIMIT` | `0` (disabled) | Max LLM inference calls per run; `0` = unlimited |
| `SUMMARIZATION_ENABLED` | `false` | Enable history summarization when approaching token limits |

To enable limits in your `values.yaml`:

```yaml
supervisor-agent:
  config:
    TOOL_CALL_LIMIT: "50"
    MODEL_CALL_LIMIT: "20"
```

### PSS Baseline Security Contexts

All chart subcharts now set default `securityContext` values satisfying the Kubernetes PSS Baseline profile. For operators running `readOnlyRootFilesystem: true` in a custom policy, note that this is intentionally left `false` because several agents write to the filesystem at runtime. No `values.yaml` changes are needed.

## Data Migrations

No MongoDB schema or data migrations required.

## Upgrade Runbook

### 1. Update chart version

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.8 \
  -f your-values.yaml
```

### 2. (Optional) Enable call limits

Add `TOOL_CALL_LIMIT` and/or `MODEL_CALL_LIMIT` to your `supervisor-agent.config` block if you want to cap agent run lengths.

### 3. Verify

```bash
kubectl get pods -n <namespace>

# Confirm mcp-aws is running (if you include it in your agent config)
kubectl get deploy -n <namespace> | grep mcp-aws
```

Check that no pods are blocked by PSS admission — existing charts already have compatible defaults.
