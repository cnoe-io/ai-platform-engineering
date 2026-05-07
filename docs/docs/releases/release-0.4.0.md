# Release Notes — ai-platform-engineering 0.4.0

> Released: 2026-04-23
> Chart: `oci://ghcr.io/cnoe-io/charts/ai-platform-engineering:0.4.0`
> Previous release: 0.3.x

## Highlights

0.4.0 is a major release that fundamentally restructures the platform around the **AG-UI protocol**, unifying streaming across the web UI, Slack bot, and dynamic agents under a single event model. All traffic now routes through the Next.js gateway, dynamic agents no longer own OIDC auth, and a shared conversation API replaces scattered per-client storage. Helm values for all three components have been restructured — see the [Migration Guide](migration-0.3.x-to-0.4.0.md) for the full before/after mapping.

## What's New

### AG-UI Protocol
- **Unified streaming** — AG-UI event model replaces legacy A2A streaming across dynamic agents, Slack bot, and UI; stream events are now persisted server-side
- **Stream encoder abstraction** — `AGUIStreamEncoder` and `CustomStreamEncoder` implementations via a `StreamEncoder` ABC
- **Slack bot AG-UI rewrite** — typing indicators with live thoughts, todo-aware streaming, subagent suppression ([#1259](https://github.com/cnoe-io/ai-platform-engineering/pull/1259))

### Next.js Gateway Architecture
- **All traffic routes through the Next.js gateway** — flat `/api/v1/chat/` routes with `X-User-Context` auth; dynamic agents no longer validate tokens or accept direct browser requests
- Config ownership moved from dynamic-agents to UI (agent CRUD, MCP servers, models endpoint in local MongoDB)
- Bearer token auth added for service accounts (Slack bot) ([#1259](https://github.com/cnoe-io/ai-platform-engineering/pull/1259))

### Shared Conversation API
- Server-owned ID generation with `idempotency_key` for cross-client dedup
- `client_type` enum (`webui` | `slack`) on all conversations; all 10 Slack handlers migrated
- **Delta thread context** — follow-ups embed only new messages since `last_processed_ts`, eliminating quadratic checkpoint growth
- `PATCH /api/chat/conversations/[id]/metadata` with MongoDB dot-notation `$set` ([#1259](https://github.com/cnoe-io/ai-platform-engineering/pull/1259))

### Dynamic Agents Runtime
- `ClientContext` and Jinja2 system prompt rendering
- `wait` and `agent_info` tools, configurable middlewares
- `NAMESPACE_CONTEXT` emitted only on change; `UserContext` made opaque; RBAC removed from chat routes
- Metrics endpoint exposed ([#1259](https://github.com/cnoe-io/ai-platform-engineering/pull/1259))

### UI Enhancements
- Streaming markdown: rAF throttle, block animations, cursor improvements
- Jinja2 syntax highlighting in system prompt editor
- Turns collection — decoupled `stream_events` from messages
- Admin: platform statistics with Slack integration, unified filters, user detail panels, conversations pagination
- LLM model config page: add/remove models through UI
- New theme: System (follow OS theme) ([#1259](https://github.com/cnoe-io/ai-platform-engineering/pull/1259))

## Bug Fixes

- **slack**: add `escalation_policy` field to VictorOps escalation config; fix humble followup prompt when agent has no record of prior reply ([#1277](https://github.com/cnoe-io/ai-platform-engineering/pull/1277))
- **admin**: fix feedback dedup by `(permalink, user_email)` instead of permalink-only; fix Slack feedback upsert key to `(message_id, user_id)`; fix top-user linkage ([#1273](https://github.com/cnoe-io/ai-platform-engineering/pull/1273))

## Data Migrations Required

> ⚠️ 0.4.0 introduces a new `turns` + `stream_events` schema. Run the four migration scripts **once** after deploying before using the platform. See the [Migration Guide](migration-0.3.x-to-0.4.0.md#data-migrations) for the full runbook.

| Script | What it does |
|--------|-------------|
| `migrate_messages_to_turns.py` | Converts `messages` collection to paired `turns` + `stream_events` |
| `migrate_conversations_schema.py` | Sets `client_type` (`webui`/`slack`) on all conversations |
| `migrate_slack_sessions.py` | Merges `slack_sessions` metadata into `conversations` |
| `migrate_slack_meta_to_metadata.py` | Flattens `slack_meta` sub-document into `metadata.*` keys |

All scripts support `--dry-run` and are idempotent (safe to re-run).

## Breaking Changes

> ⚠️ This release contains significant breaking Helm value changes. See the [Migration Guide](migration-0.3.x-to-0.4.0.md) for the complete before/after mapping.

- `env:` block removed from all components — use `config:` flat map
- `caipe-ui.seedConfig.*` renamed to `caipe-ui.appConfig.*`
- `slack-bot` values completely restructured to flat `config:` map
- `slack-bot.slack.tokenSecretRef` replaced by `existingSecret`
- Dynamic-agents OIDC/CORS config keys removed (auth handled by gateway)

## Known Issues

- Admin Statistics page under-reports Slack conversation counts until `InteractionTracker` equivalent is re-implemented in the new AG-UI Slack bot.

## Upgrade

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.0 \
  -f your-values.yaml
```

Full upgrade instructions: [Migration Guide: 0.3.x → 0.4.0](migration-0.3.x-to-0.4.0.md)
