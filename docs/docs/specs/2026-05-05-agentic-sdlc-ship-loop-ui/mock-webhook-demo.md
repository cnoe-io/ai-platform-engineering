# Mock-Webhook Demo Loop — End-to-End

This walkthrough drives the full Ship Loop UI from a **fully mocked GitHub webhook stream**, with no GitHub OAuth, no real repository, and no public callback URL required. It is the primary MVP demo path until full GitHub integration ships.

You will:

1. One-time configure the dev server.
2. Seed a mock repo into MongoDB.
3. Open the per-Epic page in your browser.
4. Run a single shell script that posts ~8 signed webhook deliveries.
5. Watch the Pipeline / Kanban / Timeline views update live, in real time.

The whole thing takes about **two minutes**.

---

## 1. Prerequisites

- The repo is checked out and `cd ui/` works.
- MongoDB is running locally (the existing dev setup — `docker-compose up mongodb`).
- Node 20+ and `python3` on `PATH` (the demo script uses Python's `hmac` module to sign payloads).
- `npm install` has been run in `ui/`.

---

## 2. One-time dev-server configuration

Edit `ui/.env.local` and add (or update) these three lines:

```ini
SHIP_LOOP_ENABLED=true
SHIP_LOOP_ALLOW_NO_AUTH=true
GITHUB_WEBHOOK_SECRET=ship-loop-mock-secret
```

Why each one matters:

| Variable | Purpose | Production behaviour |
|---|---|---|
| `SHIP_LOOP_ENABLED` | Server-side feature gate. Without this, every `/ship-loop` route returns 404. | Same — required to expose the feature at all. |
| `SHIP_LOOP_ALLOW_NO_AUTH` | Bypasses the NextAuth session requirement on **GET** APIs in non-production. The mock script can't easily hold a session, and the receiver itself is HMAC-authenticated, so the GET surface is what needs the bypass. | **Forbidden in production** — `Config.isProduction` short-circuits this flag. Asserted by `ship-loop-auth.test.ts`. |
| `GITHUB_WEBHOOK_SECRET` | Per-repo HMAC secret. Must match the secret hash that the seed script writes onto the mock repo, otherwise the receiver rejects every delivery with `digest_mismatch`. | Same — but rotated per-repo via the GitHub App's secret API once that lands. |

Then **restart the Next.js dev server** so the env vars take effect:

```bash
# from ui/
npm run dev
```

---

## 3. Seed the mock repo and indexes

From `ui/`:

```bash
npm run ship-loop:create-indexes
npm run ship-loop:seed-mock-repo
```

The seed script is idempotent. It will print:

```
Mock repo seeded:
  repo_id            : 99000001
  full_name          : demoorg/agentic-demo
  webhook secret     : ship-loop-mock-secret

Add this to ui/.env.local so the receiver verifies HMAC against the same secret:
  GITHUB_WEBHOOK_SECRET=ship-loop-mock-secret
```

If you change the defaults, the demo script accepts overrides via `SHIP_LOOP_MOCK_REPO_ID`, `SHIP_LOOP_MOCK_FULL_NAME`, `SHIP_LOOP_MOCK_EPIC_ID`, `SHIP_LOOP_MOCK_SUBTASK_ID`, `SHIP_LOOP_MOCK_PR_ID`, `SHIP_LOOP_MOCK_DEPLOY_ID`, `SHIP_LOOP_MOCK_PAUSE_S`.

---

## 4. Open the per-Epic page

In your browser, **before running the script**:

```
http://localhost:3000/ship-loop/demoorg/agentic-demo/epics/I_42
```

You will initially see "Epic not found" — that's expected. As soon as the first webhook lands, the SSE stream will populate the view.

The home page (`/ship-loop`) and the per-repo page (`/ship-loop/demoorg/agentic-demo`) will also start populating once events arrive.

---

## 5. Run the demo

From `ui/`:

```bash
./scripts/mock-webhook-flow.sh
```

The script runs a pre-flight check first. If anything is misconfigured you'll see a coloured FAIL with an actionable hint — see the [troubleshooting matrix](#7-troubleshooting) below.

On success it walks through the following deliveries with a 2-second pause between each (override with `SHIP_LOOP_MOCK_PAUSE_S=0` for a fire-hose run):

| # | Event | What happens in the UI |
|---|---|---|
| 1 | `issues.opened` (Epic `I_42`, label `agent:specify`) | Epic card appears under the Specify column. Pipeline view shows it lit up. Stage badge: `specify`. |
| 2 | `issues.labeled` (`agent:plan`) | Epic moves from Specify → Plan. Stage transition animates. Timeline gets a new entry. |
| 3 | `issues.opened` (sub-task `T_a`, label `epic:I_42`) | Sub-task token appears under the Epic, linked via `extractEpicId`. Kanban "Implement" lane now has a card. |
| 4 | `pull_request.opened` (`PR_1`) | PR token appears under the Code column. Kanban "Review" lane gets a card. "Needs reviewer" callout lights up if a reviewer was requested. |
| 5 | `pull_request_review.submitted` (approved) | PR transitions to Review-approved. Timeline shows the approver. |
| 6 | `pull_request.closed` (merged) | PR token transitions to "merged". Stage advances toward Deploy. |
| 7 | `deployment_status` (`in_progress`) | Deploy token appears under the Deploy stage with a spinner. Kanban "Deploy" lane gets a card. |
| 8 | `deployment_status` (`success`) | Deploy transitions to success. Epic flips to the Observe stage. Timeline shows the full deploy ladder. |
| 9 | `GET /epics/I_42` | Final assertion: `subtasks=1`, `pull_requests=1`, `deploys=1`. Script exits 0. |

Each step prints `OK <step> (got 202)` on success. The final line is either `Demo flow complete.` or `Demo flow had failures.` so you can chain this into CI later.

---

## 6. What to look at in the UI

While the script is running, switch tabs/views without losing state:

- **Pipeline** (default) — eight stage columns, artifacts grouped under their current stage. Watch sub-tasks and PRs migrate columns as labels change.
- **Kanban** — three lanes (Implement / Review / Deploy). Cards re-shuffle live. The Deploy lane intentionally swallows both `deploy` and `observe` stages because deploy → observe is too short-lived to warrant its own lane and the operator instinctively expects rolled-out services to live there.
- **Timeline** — chronological event stream. Each entry shows the actor (agent vs human icon), the kind, and the relative timestamp.
- **Per-repo page** (`/ship-loop/demoorg/agentic-demo`) — Epic list with stage / `needs_human` / `stalled` filters and cursor pagination.
- **Home** (`/ship-loop`) — repo grid with rolled-up counts (open epics, in-flight sub-tasks, PRs awaiting review, deploys in last 24h).

---

## 7. Troubleshooting

The pre-flight check covers the two most common misconfigurations directly. For everything else:

| Symptom | Likely cause | Fix |
|---|---|---|
| `FAIL pre-flight: GET /repos returned 401` | `SHIP_LOOP_ALLOW_NO_AUTH=true` is missing from `.env.local` or the dev server wasn't restarted after editing it. | Add it, restart `npm run dev`. |
| `FAIL pre-flight: GET /repos returned 404` | Server flag (`SHIP_LOOP_ENABLED`) is off. | Set `SHIP_LOOP_ENABLED=true`, restart. |
| `FAIL pre-flight: mock repo not found in /repos` | Seed script hasn't run, or it ran against a different MongoDB. | Run `npm run ship-loop:seed-mock-repo` from `ui/`. |
| Every step returns 401 | `GITHUB_WEBHOOK_SECRET` in `.env.local` differs from what the seed wrote. | Re-run the seed script and copy the `GITHUB_WEBHOOK_SECRET=...` line into `.env.local`, restart. |
| Every step returns 404 | Receiver can't find the repo by `repository.id`. | Re-run the seed script — the `repo_id` defaults to `99000001` and the demo script defaults to the same value. |
| Step 9 says `subtasks=0` even though step 3 returned 202 | Async worker hasn't drained yet. | Re-run with `SHIP_LOOP_MOCK_PAUSE_S=4` to give the worker more breathing room, or just wait 1–2 seconds and refresh the per-Epic page. |
| Browser shows "Epic not found" forever | The `epicId` in the URL doesn't match what the script is sending. | Either match the URL to the script's defaults (`I_42`) or set `SHIP_LOOP_MOCK_EPIC_ID` to whatever your URL says. |

If you hit something the table doesn't cover, the most useful next step is to tail the dev-server console while running the script — every webhook delivery is logged with delivery id, repo id, and projection outcome.

---

## 8. Cleaning up

The seed script's collections are repo-id-scoped and will not interfere with anything outside the `99_000_000+` range. To wipe just the demo state:

```bash
SHIP_LOOP_MOCK_FORCE=true npm run ship-loop:seed-mock-repo
```

(That re-creates the mock repo cleanly and removes any events / artifacts left over from previous runs.)

---

## 9. What this demo does **not** cover

- Real GitHub OAuth, repo permission checks, webhook auto-registration. Tracked under T014, T029, T033.
- Cost / token-usage tiles. Tracked under T084 onward (the `agent_runs` collection isn't populated by the mock flow).
- HITL action round-trips (approve / request-changes / comment / retry-deploy). Tracked under T071–T080.
- Cross-repo portfolio dashboard. Tracked under T060–T066.

These all build on the same SSE bus, projector, and stage resolver that this demo exercises end-to-end, so the demo is a strong correctness signal even though it's only the MVP slice.
