# Quickstart — Agentic SDLC Ship Loop UI (local pilot)

This walks an engineer through enabling the feature locally, onboarding one repo, and verifying a webhook flows end-to-end.

## Prerequisites

- The CAIPE UI is already running locally (`cd ui && npm run dev`).
- A MongoDB instance is reachable (`MONGODB_URI` in `ui/.env.local`).
- A GitHub account with admin (or maintainer) rights on the test repo (needed to register a webhook).
- The user account has a GitHub OAuth token in their session (existing CAIPE login flow).

## 1. Enable the toggle

In `ui/.env.local`:

```bash
SHIP_LOOP_ENABLED=true
GITHUB_WEBHOOK_SECRET=<generate-a-random-32+-byte-secret>
SHIP_LOOP_AGENT_BOT_LOGINS=app/<your-agent-bot>,app/dependabot
```

Restart the dev server (`npm run dev`).

## 2. Create the MongoDB collections + indexes

From the repo root:

```bash
npx ts-node ui/scripts/create-ship-loop-indexes.ts
```

The script is idempotent; safe to re-run.

## 3. Opt yourself in (per-user flag)

Open the UI, log in, then open Settings → Feature Flags → **Ship Loop (pilot)** and toggle it on. The toggle is persisted to your user preferences.

You should now see the **Ship Loop** tab in the top nav. (If you don't, double-check `SHIP_LOOP_ENABLED=true` in `ui/.env.local` and that you restarted the dev server.)

## 4. Onboard a repo

1. Click **Ship Loop → Onboard Repo**.
2. Pick a repo from the dropdown (populated from your GitHub OAuth scope).
3. Set **Sandbox environment** to whatever environment string GitHub `deployment` events for this repo will use (e.g., `sandbox-eks`, `staging`, `preview`).
4. Submit.

The UI will:
- Verify your `read` access via the GitHub API.
- Create or reuse a webhook on the repo, scoped to the events listed in [`contracts/github-webhook-events.md`](./contracts/github-webhook-events.md), pointed at `https://<your-host>/api/ship-loop/webhooks/github`.
- Insert a row in `ship_loop_repos`.

## 5. Verify the webhook

Trigger any of the subscribed events (open an issue, push a commit, open a PR, etc.). Within a few seconds:

- A row appears in `ship_loop_events` with `source: "github"`.
- The corresponding `ship_loop_artifacts` row is upserted with a derived `current_stage`.
- Any open Ship Loop UI session viewing this repo / Epic gets a live SSE update.

If nothing arrives, check the Ship Loop UI's webhook health banner on the repo's detail page; it will tell you which delivery failed (and offer a Reconnect action).

## 6. Try a HITL action

1. Open an Epic that has a PR awaiting your review.
2. Click **Approve** in the per-Epic view.
3. Confirm in GitHub that the approval was recorded under your account.
4. Confirm in MongoDB that a row was added to `ship_loop_events` with `source: "ui"` and `payload.action: "approve_pr"`.

## 7. Try the visualization modes

On the same Epic, switch the visualization picker between Pipeline, Kanban, and Timeline. (Dependency Graph and Ship-loop Radar ship after MVP per `plan.md`.)

## Disabling the feature

To kill the feature globally without removing data:

```bash
SHIP_LOOP_ENABLED=false
```

Restart. The nav tab disappears, the route returns 404, and every API endpoint returns 404. Existing data is untouched and reappears when re-enabled.

To roll back the schema entirely, see [`mongodb-migration.md`](./mongodb-migration.md) → "Rollback".

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| No "Ship Loop" tab in nav | Server toggle off, or user flag off, or session not authenticated | Set `SHIP_LOOP_ENABLED=true`, restart, log in, toggle the per-user flag |
| Webhook health "missing" | Webhook not registered on the repo, or wrong URL | Use Reconnect on the repo detail page |
| Webhook health "degraded" | Last delivery older than threshold | Check GitHub repo settings → Webhooks → Recent deliveries; redeliver and inspect any errors |
| `401` from `/api/ship-loop/webhooks/github` | Signature mismatch | Confirm `GITHUB_WEBHOOK_SECRET` matches the secret configured on the GitHub webhook |
| All routes return 404 | Server toggle off | `SHIP_LOOP_ENABLED=true` and restart |
