# Migration Guide: ai-platform-engineering 0.4.1 → 0.4.2

## Overview

0.4.2 fixes a `caipe-skills.py` bootstrap issue and several CI pipeline bugs. No Helm values changes and no data migrations are required.

## Helm Values Changes

No Helm values changes between 0.4.1 and 0.4.2. Drop-in upgrade — no `values.yaml` edits required.

## Data Migrations

No MongoDB schema or data migrations required.

## Upgrade Runbook

### 1. Update chart version

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.2 \
  -f your-values.yaml
```

### 2. Verify

```bash
kubectl get pods -n <namespace>
```

Verify `GET /api/skills/helpers/caipe-skills.py` returns the actual helper script (not the error stub).
