# Migration Guide: ai-platform-engineering 0.4.5 → 0.4.6

## Overview

0.4.6 simplifies the dynamic agents runtime (shared clients, lazy provider loading, single-flight init) and improves the setup installer. No Helm values changes and no data migrations are required.

## Helm Values Changes

No Helm values changes between 0.4.5 and 0.4.6. Drop-in upgrade — no `values.yaml` edits required.

## Data Migrations

No MongoDB schema or data migrations required.

## Upgrade Runbook

### 1. Update chart version

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.6 \
  -f your-values.yaml
```

### 2. Verify

```bash
kubectl get pods -n <namespace>
kubectl logs -n <namespace> deployment/ai-platform-engineering-dynamic-agents | grep -i "runtime\|init"
```

Dynamic agents should start without duplicate initialization log lines.
