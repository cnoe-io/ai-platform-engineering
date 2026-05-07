# Migration Guide: ai-platform-engineering 0.4.6 → 0.4.7

## Overview

0.4.7 overhauled the Skills platform (new scanner microservice, multi-source hubs, ZIP export, AI Assist) and added an unsaved-changes guard to the agent editor. No Helm values changes are required. The Skills scanner runs as a new internal service — no extra configuration is needed for default deployments.

## Helm Values Changes

No Helm values changes between 0.4.6 and 0.4.7. Drop-in upgrade — no `values.yaml` edits required.

## Data Migrations

No MongoDB schema or data migrations required.

## Upgrade Runbook

### 1. Update chart version

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.7 \
  -f your-values.yaml
```

### 2. Verify

```bash
kubectl get pods -n <namespace>
```

The admin Skills page should show the new Workspace view with unified multi-hub browsing and the Live Crawl console.
