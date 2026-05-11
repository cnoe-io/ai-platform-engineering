# MongoDB Migration — Agentic SDLC Ship Loop UI

**Required**: Yes — three new collections must exist before the feature is enabled in any environment. **No data backfill** is required (the feature starts empty). Migration is forward-compatible: deploying the code with `SHIP_LOOP_ENABLED=false` produces zero DB activity, so collections can be created at any time before flipping the flag.

This file aligns with [`data-model.md`](./data-model.md). Index choices are justified by the read-paths described in [`contracts/http-api.md`](./contracts/http-api.md) and [`contracts/sse-channels.md`](./contracts/sse-channels.md).

## Summary table

| Collection | Purpose | Approx scale (12-mo) | Sharded? |
|------------|---------|----------------------|----------|
| `ship_loop_repos` | Onboarded repos | 100 docs | No |
| `ship_loop_events` | Append-only event log | ~50K events / day, 90-day TTL ⇒ ~4.5M docs steady state | No (pilot scale) |
| `ship_loop_artifacts` | Derived current state | 10K–50K docs | No |

## Collection: `ship_loop_repos`

Schema fields: see `data-model.md → OnboardedRepo`.

### Indexes

| Name | Keys | Unique | Justification |
|------|------|--------|---------------|
| `repo_id_unique` | `{ repo_id: 1 }` | yes | Lookup by GitHub numeric id is O(1); guards against double-onboarding the same repo |
| `full_name_unique_active` | `{ full_name: 1 }` | yes (partial: `offboarded_at: null`) | Friendly-name lookup; only enforce uniqueness for active onboardings |
| `webhook_id_unique` | `{ webhook_id: 1 }` | yes (sparse) | Used by the webhook router to find the repo for an inbound delivery |
| `onboarded_at_desc` | `{ onboarded_at: -1 }` | no | Recent-first listing on the portfolio dashboard |

## Collection: `ship_loop_events`

Schema fields: see `data-model.md → ShipLoopEvent`.

### Indexes

| Name | Keys | Unique | Justification |
|------|------|--------|---------------|
| `github_idempotency` | `{ repo_id: 1, github_delivery_id: 1 }` | yes (partial: `source: "github"`) | Hard-prevents duplicate ingestion under GitHub redelivery |
| `epic_timeline` | `{ repo_id: 1, epic_id: 1, occurred_at: 1 }` | no | Powers the per-Epic timeline view and stage resolver replay |
| `artifact_timeline` | `{ repo_id: 1, artifact_kind: 1, artifact_id: 1, occurred_at: 1 }` | no | Per-artifact event lookup |
| `recent_per_repo` | `{ repo_id: 1, delivered_at: -1 }` | no | Dashboard "recent activity" widgets |
| `deferred_projection` | `{ projection_status: 1, delivered_at: 1 }` | no, partial: `projection_status: { $in: ["deferred", "failed"] }` | Lets the async projector pick up rows the receiver had to bypass (queue overflow) and the operator surface poison events |
| `ttl_90d` | `{ delivered_at: 1 }` | no, TTL = 7,776,000 s (90 days) | Automatic cleanup of raw event log; derived state in `ship_loop_artifacts` retains the summary |

> Note: The 90-day TTL is a default; operators can raise it (e.g., for compliance) by adjusting the index. We retain the derived artifact summary indefinitely so historical reporting still works.

## Collection: `ship_loop_artifacts`

Schema fields: see `data-model.md → ShipLoopArtifact`.

### Indexes

| Name | Keys | Unique | Justification |
|------|------|--------|---------------|
| `artifact_unique` | `{ repo_id: 1, kind: 1, artifact_id: 1 }` | yes | One row per logical artifact; upserts on event projection |
| `epic_children` | `{ repo_id: 1, epic_id: 1, kind: 1 }` | no | Per-Epic view assembly |
| `repo_stage_index` | `{ repo_id: 1, current_stage: 1, last_event_at: -1 }` | no | Portfolio dashboard "by stage" counts and recency ordering |
| `needs_human_index` | `{ needs_human: 1, requested_reviewers: 1, last_event_at: -1 }` | no | "Needs you" inbox query |
| `stalled_index` | `{ repo_id: 1, stalled_since: 1 }` | no, partial: `stalled_since: { $type: "date" }` | Stalled-Epic highlighting on the dashboard |

## Creation script (idempotent)

A one-shot Node script `ui/scripts/create-ship-loop-indexes.ts` runs `createIndex` for each of the indexes above. It uses the existing `getCollection` from `ui/src/lib/mongodb.ts`. The script is idempotent — re-running it is a no-op once indexes exist.

The script is invoked manually by ops at deploy time:

```bash
npx ts-node ui/scripts/create-ship-loop-indexes.ts
```

(No automatic auto-creation on app start, to keep DDL controlled and observable.)

## Rollback

To roll back the feature:

1. Set `SHIP_LOOP_ENABLED=false` and redeploy. **All read/write paths to these collections close immediately**; the rest of the app is unaffected.
2. (Optional) Drop the three collections:
   ```js
   db.ship_loop_repos.drop();
   db.ship_loop_events.drop();
   db.ship_loop_artifacts.drop();
   ```
3. (Optional) Remove the `ship_loop_enabled` value from the `preferences` documents in the existing user-preferences collection. This is cosmetic — the app simply ignores unknown preference keys.

No other collections in the application are modified by this feature. Rollback has zero blast radius outside of `ship_loop_*`.

## Environment differences

| Env | Notes |
|-----|-------|
| dev | Indexes created on first manual run of the script; TTL = 7 days for fast iteration |
| staging / pilot | Full indexes; TTL = 90 days |
| prod (post-pilot) | Full indexes; TTL configurable via env (default 90 days); consider sharding `ship_loop_events` by `repo_id` if event rate exceeds 10× pilot |
