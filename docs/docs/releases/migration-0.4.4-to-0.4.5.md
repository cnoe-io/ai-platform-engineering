# Migration Guide: ai-platform-engineering 0.4.4 → 0.4.5

## Overview

0.4.5 is a bug-fix release focused on DocumentDB/CosmosDB compatibility and RAG server repairs. No Helm values changes and no data migrations are required.

## Helm Values Changes

No Helm values changes between 0.4.4 and 0.4.5. Drop-in upgrade — no `values.yaml` edits required.

## Data Migrations

No MongoDB schema or data migrations required.

## Notes for DocumentDB / CosmosDB Operators

The `$facet` aggregation stage has been removed from the conversation list and audit log APIs. If you were seeing `MongoServerError: Aggregation 'facet' is not supported` errors on the admin Conversations or Audit Logs pages, this release resolves them without any configuration changes.

## Upgrade Runbook

### 1. Update chart version

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.5 \
  -f your-values.yaml
```

### 2. Verify

```bash
kubectl get pods -n <namespace>
```

Verify admin Conversations and Audit Logs pages load without errors on DocumentDB/CosmosDB deployments.
