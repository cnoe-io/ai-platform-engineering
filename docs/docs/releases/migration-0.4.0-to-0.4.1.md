# Migration Guide: ai-platform-engineering 0.4.0 → 0.4.1

## Overview

0.4.1 fixes a Skills API Gateway UX issue where XML comment markers leaked into skill content, breaking agent metadata recognition. No Helm values changes and no data migrations are required.

## Helm Values Changes

No Helm values changes between 0.4.0 and 0.4.1. Drop-in upgrade — no `values.yaml` edits required.

## Data Migrations

No MongoDB schema or data migrations required.

## Upgrade Runbook

### 1. Update chart version

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.1 \
  -f your-values.yaml
```

### 2. Verify

```bash
kubectl get pods -n <namespace>
```

Skills catalog responses should no longer include `<!-- caipe-skill: ... -->` XML comment prefixes.
