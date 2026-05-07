# Migration Guide: ai-platform-engineering 0.4.3 → 0.4.4

## Overview

0.4.4 adds Skills Builder integration to dynamic agents and fixes the 0.4.0 data migration script. No Helm values changes are required. If you have not yet run the 0.4.0 MongoDB migration, see the note below before upgrading.

## Helm Values Changes

No Helm values changes between 0.4.3 and 0.4.4. Drop-in upgrade — no `values.yaml` edits required.

## Data Migrations

### 0.4.0 Migration Script Fix

If you have not yet run the 0.4.0 A2A-to-turns migration (`scripts/migrations/0.4.0/migrate_messages_to_turns.py`), run the version shipped in 0.4.4 — it correctly handles stringified `repr()` artifact dicts that are present in real DocumentDB deployments. The 0.4.3 version would fail with `AttributeError: 'str' object has no attribute 'get'` on those documents.

No new migrations are introduced in 0.4.4.

## Upgrade Runbook

### 1. Update chart version

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.4 \
  -f your-values.yaml
```

### 2. Verify

```bash
kubectl get pods -n <namespace>
```

Dynamic agent editors should now show a "Skills" section for selecting from the `agent_skills` collection.
