# Migration Guide: ai-platform-engineering 0.4.2 → 0.4.3

## Overview

0.4.3 completes the Slack bot `botConfig` schema migration that was described in the 0.3.x → 0.4.0 guide. If you were running 0.4.0–0.4.2 with the old `qanda`/`ai_alerts`/`ai_enabled` channel config keys, you must update your `botConfig` before upgrading to 0.4.3 — the bot rejects the old format with a clear error.

## Helm Values Changes

### Breaking: Slack Bot `botConfig` Schema

The `qanda`, `ai_alerts`, and `ai_enabled` channel keys are replaced by a flat `agents` list.

**Before (0.4.0–0.4.2):**
```yaml
slack-bot:
  botConfig:
    C012345678:
      name: "#my-channel"
      ai_enabled: true
      qanda:
        enabled: true
        overthink: false
        include_bots:
          enabled: true
          bot_list: ["AlertBot"]
      ai_alerts:
        enabled: false
```

**After (0.4.3+):**
```yaml
slack-bot:
  botConfig:
    C012345678:
      name: "#my-channel"
      agents:
        - agent_id: "my-agent"
          users:
            enabled: true
            listen: "mention"     # "mention" | "message" | "all"
            overthink:
              enabled: false
          bots:
            enabled: true
            listen: "message"
            bot_list: ["AlertBot"]
```

**Action:** Update all channel entries in `botConfig`. If left unchanged, the bot will log a schema validation error and apply no channel configuration.

See the [Slack Bot docs](../integrations/slack-bot.md#channel-configuration) for the full field reference.

## Data Migrations

No MongoDB schema or data migrations required.

## Upgrade Runbook

### 1. Update `botConfig` in `values.yaml`

Apply the schema change shown above for each channel.

### 2. Update chart version

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.3 \
  -f your-values.yaml
```

### 3. Verify

```bash
kubectl logs -n <namespace> deployment/ai-platform-engineering-slack-bot | grep -i "config\|agent\|channel"
```

Confirm the bot logs show channels loading successfully with the new `agents` list format.
