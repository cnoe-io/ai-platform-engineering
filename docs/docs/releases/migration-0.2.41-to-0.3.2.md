# Migration Guide: 0.2.41 → 0.3.2

This guide covers all breaking changes, MongoDB schema migrations, Helm value changes, and rollback considerations when upgrading from **0.2.41** to **0.3.2**.

**Version path:** 
- 0.2.41 → 0.2.42 → 0.2.43 → 0.3.0 → 0.3.1 → 0.3.2
- 0.2.41 → 0.3.2

---

## Breaking Changes Summary

| Area | Change | Severity |
|------|--------|----------|
| MongoDB | `agent_configs` → `agent_skills` collection rename | **High** |
| MongoDB | `messages.feedback` moved to standalone `feedback` collection | **High** |
| MongoDB | New `source` field on `conversations`, `users` | Medium |
| MongoDB | New `skill_hubs`, `feedback`, `catalog_api_keys` collections | Medium |
| Helm | `global.metrics.enabled` default `false` → `true` | Low |
| Helm | Slack MCP image changed to `korotovsky/slack-mcp-server` | **High** |
| Helm | Slack MCP port changed `8000` → `3001` | **High** |
| Helm | Langfuse config removed from slack-bot values | Medium |
| Helm | New `global.checkpointPersistence` section | Low |
| Helm | New `slack-bot.caipeUiUrl` required value | Medium |
| Env | `DISTRIBUTED_AGENTS` replaces implicit single/multi-node profiles | **High** |
| Env | `DISTRIBUTED_MODE` deprecated (backward compat shim exists) | Medium |
| RAG | `graph_entity` → `structured_entity` rename across all RAG code | **High** |
| RAG | `ExampleEntityMatch` → `ExampleStructuredEntityMatch` | Medium |
| Deps | `langgraph` 1.0.10 → 1.1.6 (minor but significant API surface) | Medium |
| Deps | `langchain-core` 1.2.6 → 1.2.15+ | Medium |
| A2A | All agents consolidated to shared `A2AServer` abstraction | Medium |
| Streaming | Orphaned tool call strategy changed (remove → synthetic inject) | Medium |

---

## MongoDB Schema Changes

### 1. Collection Rename: `agent_configs` → `agent_skills`

**Auto-migrated on startup** via `migrateAgentConfigsToAgentSkills()` in `ui/src/lib/mongodb.ts`.

What happens:
- Documents from `agent_configs` are copied to `agent_skills` (skipping duplicates by `id`)
- `agent_configs` is renamed to `agent_configs_migrated`
- Subsequent startups are a no-op

**No manual action required** — the UI app handles this on first boot.

Verify after deploy:
```bash
mongosh "$MONGODB_URI/$MONGODB_DATABASE" --eval '
  print("agent_skills: " + db.agent_skills.countDocuments());
  print("agent_configs exists: " + (db.getCollectionNames().includes("agent_configs")));
  print("agent_configs_migrated exists: " + (db.getCollectionNames().includes("agent_configs_migrated")));
'
```

### 2. Feedback Collection Extraction

**Auto-migrated on startup** via `migrateWebFeedback()` in `ui/src/lib/mongodb.ts`.

What happens:
- Embedded `messages.feedback` objects are copied to a new standalone `feedback` collection with `source: "web"`
- The embedded `feedback` field is `$unset` from messages
- Conversations without a `source` field are tagged `source: "web"`
- Users without a `source` field are tagged `source: "web"`

Verify:
```bash
mongosh "$MONGODB_URI/$MONGODB_DATABASE" --eval '
  print("feedback total: " + db.feedback.countDocuments());
  print("  web: " + db.feedback.countDocuments({source: "web"}));
  print("  slack: " + db.feedback.countDocuments({source: "slack"}));
  print("messages with embedded feedback: " + db.messages.countDocuments({"feedback.rating": {$exists: true}}));
'
```

### 3. New Collections

| Collection | Purpose | Created by |
|------------|---------|------------|
| `feedback` | Unified feedback from web + Slack | Auto-migration on UI startup |
| `skill_hubs` | Registered external skill hub sources | Skills middleware (supervisor) |
| `catalog_api_keys` | Hashed API keys for skill catalog access | Skills middleware |

### 4. New Indexes

Added automatically by `createIndexes()` on UI startup:

```
conversations.{source: 1}
conversations.{source: 1, created_at: -1}
conversations.{'slack_meta.channel_name': 1, created_at: -1}
conversations.{'slack_meta.escalated': 1, created_at: -1}
agent_skills.{id: 1}          (unique, replaces agent_configs index)
agent_skills.{owner_id: 1}
agent_skills.{category: 1}
agent_skills.{is_system: 1}
agent_skills.{name: 1}
agent_skills.{created_at: -1}
agent_skills.{'metadata.tags': 1}
skill_hubs.{id: 1}            (unique)
skill_hubs.{enabled: 1}
skill_hubs.{location: 1}
feedback.{created_at: -1}
feedback.{source: 1, created_at: -1}
feedback.{rating: 1, created_at: -1}
feedback.{channel_name: 1, created_at: -1}
feedback.{trace_id: 1}
```

### 5. New Fields on Existing Documents

| Collection | Field | Type | Default | Purpose |
|------------|-------|------|---------|---------|
| `conversations` | `source` | `"web"` \| `"slack"` | `"web"` (backfilled) | Distinguish web vs Slack conversations |
| `conversations` | `slack_meta` | object | absent for web | Slack thread metadata (channel, escalation, etc.) |
| `conversations` | `message_count` | number | absent for web | Slack message count tracking |
| `users` | `source` | `"web"` \| `"slack"` | `"web"` (backfilled) | Distinguish web vs Slack users |

### 6. Optional: Slack Backfill Scripts

If you use the Slack bot and want historical Slack data in the admin stats, run the one-time backfill scripts in `scripts/migrations/0.3.0/`:

```bash
# Step 1: Backfill Slack feedback from Langfuse → feedback collection
python scripts/migrations/0.3.0/backfill_feedback_from_langfuse.py \
  --dump-json /tmp/langfuse_scores.json
python scripts/migrations/0.3.0/backfill_feedback_from_langfuse.py \
  --from-json /tmp/langfuse_scores.json

# Step 2: Backfill Slack conversations, messages, and users
python scripts/migrations/0.3.0/backfill_slack_interactions.py \
  --dump-json /tmp/slack_interactions.json
python scripts/migrations/0.3.0/backfill_slack_interactions.py \
  --from-json /tmp/slack_interactions.json
```

See `scripts/migrations/0.3.0/RUN.md` for full prerequisites and verification queries.

---

## Helm Values Changes

### New Values

```yaml
global:
  metrics:
    enabled: true          # Was false — metrics now on by default

  # NEW: Global checkpoint persistence (all subcharts inherit)
  checkpointPersistence:
    type: "memory"         # Options: memory | redis | postgres | mongodb
    redis:
      url: ""
      existingSecret: {}
    postgres:
      dsn: ""
      existingSecret: {}
    mongodb:
      uri: ""
      existingSecret: {}
    ttlMinutes: 0

slack-bot:
  caipeUiUrl: "http://ai-platform-engineering-caipe-ui:3000"  # NEW required
  podDisruptionBudget:
    enabled: false         # NEW
    minAvailable: 1
```

### Changed Values

```yaml
# Slack MCP — image and port changed
agent-slack:
  mcp:
    image:
      # OLD: ghcr.io/cnoe-io/mcp-slack
      repository: "ghcr.io/korotovsky/slack-mcp-server"
      tag: "v1.2.3"        # Was "" (defaulted to Chart.AppVersion)
    port: 3001              # Was 8000
    command: ["--transport", "http"]
    env:
      SLACK_MCP_HOST: "0.0.0.0"
      SLACK_MCP_PORT: "3001"
```

### Removed Values

```yaml
slack-bot:
  env:
    # REMOVED — Langfuse scoring no longer used by slack-bot
    # LANGFUSE_SCORING_ENABLED: "true"
    # LANGFUSE_PUBLIC_KEY: ""
    # LANGFUSE_HOST: ""
  externalSecrets:
    # REMOVED reference:
    # LANGFUSE_SECRET_KEY → replaced by OAUTH2_CLIENT_SECRET
```

### Action Required

1. If you have custom `agent-slack.mcp` overrides, update to the new image/port
2. If you reference `LANGFUSE_SECRET_KEY` in slack-bot external secrets, replace with `OAUTH2_CLIENT_SECRET`
3. Add `slack-bot.caipeUiUrl` if you override slack-bot values

---

## Environment Variable Changes

### New Variables

| Variable | Component | Default | Purpose |
|----------|-----------|---------|---------|
| `DISTRIBUTED_AGENTS` | Supervisor | `""` (all-in-one) | Controls agent distribution mode: `""` = all-in-one, `"all"` = fully distributed, `"argocd,github"` = selective |
| `OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP` | Dynamic Agents | — | OIDC group restriction for dynamic agent access |
| `TASK_CONFIG_PATH` | Supervisor | `/app/task_config.yaml` | Self-service task config file path |
| `TASK_CONFIG_CACHE_TTL` | Supervisor | `0` | Cache TTL for task configs (0 = no cache) |
| `VICTOROPS_ORGS` | VictorOps agent | — | Comma-separated org list for multi-org support |
| `SLACK_MCP_HOST` | Slack MCP | `0.0.0.0` | New Slack MCP server host binding |
| `SLACK_MCP_PORT` | Slack MCP | `3001` | New Slack MCP server port |
| Various `*_MCP_HOST` vars | Supervisor | — | MCP server hostnames for all-in-one mode |

### Deprecated Variables

| Variable | Replacement |
|----------|-------------|
| `DISTRIBUTED_MODE` | `DISTRIBUTED_AGENTS=all` (backward compat shim exists) |
| `SKIP_AGENT_CONNECTIVITY_CHECK` | Derived automatically from `DISTRIBUTED_AGENTS` |
| `USE_STRUCTURED_RESPONSE` | Removed from docker-compose (still in code) |

---

## RAG Entity Rename

The RAG subsystem renamed "graph entity" to "structured entity" across all code:

| Old Name | New Name |
|----------|----------|
| `graph_entity` | `structured_entity` |
| `graph_entity_type` | `structured_entity_type` |
| `graph_entity_pk` | `structured_entity_pk` |
| `ExampleEntityMatch` | `ExampleStructuredEntityMatch` |
| `fetch_datasources_and_entity_types` | `list_datasources_and_entity_types` (in prompts) |

**Impact:** If you have custom RAG ingestors or tools referencing the old names, update them. The metadata field names stored in documents change from `graph_entity_type`/`graph_entity_pk` to `structured_entity_type`/`structured_entity_pk`.

---

## Dependency Upgrades

| Package | Old Version | New Version | Notes |
|---------|-------------|-------------|-------|
| `langgraph` | 1.0.10 | 1.1.6 | Minor version bump, checkpoint API unchanged |
| `langchain-core` | 1.2.6 | 1.2.15+ | Security fix for CVE-2025-68664 |
| `fastmcp` | — | 3.2.0 | Security CVE fixes |
| `beautifulsoup4` | — | 4.14.3 (pinned) | Pinned for reproducibility |

---

## Rollback Considerations

### Safe to Roll Back (reversible)

- **Streaming fixes** — behavioral changes only, no persisted state
- **A2A server consolidation** — code refactor, no schema changes
- **ModelRetryMiddleware** — additive middleware, no side effects on rollback
- **Skills middleware** — new module, old code ignores `skill_hubs`/`catalog_api_keys` collections
- **UI component changes** — frontend-only, no backend state

### Requires Care on Rollback

| Change | Risk | Mitigation |
|--------|------|------------|
| `agent_configs` → `agent_skills` rename | 0.2.41 code reads `agent_configs`, which is now renamed to `agent_configs_migrated` | Rename back: `db.agent_configs_migrated.renameCollection("agent_configs")` |
| `feedback` extraction from messages | 0.2.41 expects `messages.feedback` embedded field, which is `$unset` by migration | Re-embed from feedback collection (see script below) |
| `conversations.source` field | 0.2.41 doesn't use this field — harmless extra field | No action needed |
| `skill_hubs` / `catalog_api_keys` collections | 0.2.41 doesn't know about these — harmless | No action needed |
| Slack MCP image change | Rolling back requires reverting to `ghcr.io/cnoe-io/mcp-slack` on port 8000 | Update Helm values on rollback |

### Cannot Roll Back Without Data Loss

| Change | Why |
|--------|-----|
| Slack backfill data (`scripts/migrations/0.3.0/`) | Adds net-new documents to `conversations`, `messages`, `users` collections from Slack API. Rollback won't delete them, but 0.2.41 doesn't display them either — they are inert but present. |

### Rollback Script: Restore `agent_configs`

```javascript
// Run in mongosh if rolling back to 0.2.41
db.agent_configs_migrated.renameCollection("agent_configs");
```

### Rollback Script: Re-embed Feedback into Messages

```javascript
// Run in mongosh if rolling back to 0.2.41
db.feedback.find({source: "web"}).forEach(function(fb) {
  if (fb.message_id) {
    db.messages.updateOne(
      {_id: fb.message_id},
      {$set: {feedback: {rating: fb.rating, comment: fb.comment, submitted_by: fb.user_email, submitted_at: fb.created_at}}}
    );
  }
});
```

---

## Pre-Upgrade Checklist

- [ ] **Backup MongoDB** — take a full dump before upgrading
- [ ] **Review Helm values** — update `agent-slack.mcp` image/port if overridden
- [ ] **Set `DISTRIBUTED_AGENTS`** — replace `DISTRIBUTED_MODE` if used
- [ ] **Add `slack-bot.caipeUiUrl`** if you override slack-bot Helm values
- [ ] **Remove Langfuse refs** from slack-bot secrets/values if present
- [ ] **Deploy UI first** — auto-migrations run on UI startup
- [ ] **Verify collections** — run verification queries above after first UI boot
- [ ] **(Optional) Run Slack backfill** — see `scripts/migrations/0.3.0/RUN.md`

## Post-Upgrade Verification

```bash
mongosh "$MONGODB_URI/$MONGODB_DATABASE" --eval '
  print("=== Collection check ===");
  print("agent_skills: " + db.agent_skills.countDocuments());
  print("agent_configs exists: " + db.getCollectionNames().includes("agent_configs"));
  print("feedback: " + db.feedback.countDocuments());
  print("skill_hubs: " + db.skill_hubs.countDocuments());
  print("conversations with source: " + db.conversations.countDocuments({source: {$exists: true}}));
  print("messages with embedded feedback: " + db.messages.countDocuments({"feedback.rating": {$exists: true}}));
'
```

Expected: `agent_configs exists: false`, `messages with embedded feedback: 0`, all conversations have `source`.

---

## Notable Features in This Release

- **Skills Gateway**: Visual editor UI at `/skills/gateway` for managing skill catalog
- **Dynamic Agents**: Timeline UI, HITL (human-in-the-loop) cancellation, progressive turn loading
- **Admin Statistics**: Enhanced platform stats with Slack integration and unified filters
- **Jira Ingestor**: RAG ingestor for Jira issues with read-only datasource UI support
- **Slack Bot Escalation**: Automatic escalation detection and workflow routing
- **VictorOps Multi-Org**: Support for multiple VictorOps organizations via `VICTOROPS_ORGS`
- **GitHub MCP as Separate Pod**: Deployable as standalone HTTP pod instead of in-process
- **Global Checkpoint Persistence**: Set once in `global.checkpointPersistence`, all subcharts inherit
- **RAG Metadata Filtering**: Nested metadata filter support in search with filter chip UI
- **Data Freshness Visibility**: `fresh_until` / `reload_interval` tracking with cleanup controls
- **ModelRetryMiddleware**: Automatic retry with exponential backoff on LLM failures (supervisor + dynamic agents)
