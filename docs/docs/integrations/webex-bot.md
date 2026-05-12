---
sidebar_position: 3
---

# Webex Inbound Bridge

Translate in-thread Webex replies into follow-up runs of an autonomous task.

The Webex inbound bridge runs in-process inside the **autonomous-agents** service
(port `8002`). It receives Webex `messages.created` webhook deliveries on
`POST /api/v1/hooks/webex/events`, resolves the parent message to an autonomous
task via the `webex_thread_map` MongoDB collection, and re-fires that task with
the operator's reply as additional context.

:::note
Earlier prototypes ran the bridge as a separate `webex-bot` container on port
`8003`. The standalone service has been removed; all routing lives in the
autonomous-agents service now.
:::

## How it works

When an autonomous task posts a Webex message (e.g. "Build #1234 failed —
here's the diff"), the autonomous-agents service records the resulting
`messageId` in the `webex_thread_map` collection along with the `task_id` /
`run_id`.

The bridge then:

1. Registers an idempotent Webex `messages.created` webhook on startup pointing
   at `<WEBEX_BOT_PUBLIC_URL>/api/v1/hooks/webex/events`.
2. On every incoming Webex event:
   - Verifies `X-Spark-Signature` (HMAC-SHA1 of the raw body) when
     `WEBEX_WEBHOOK_SECRET` is configured.
   - Skips messages authored by the bot itself (loop guard).
   - Skips top-level messages (no `parentId`).
   - Looks up the `parentId` in `webex_thread_map`.
   - On a hit, schedules a follow-up run of the original task with the
     operator's reply injected as a `FollowUpContext`.

## Endpoint

| Method | Path                              | Purpose                                    |
| ------ | --------------------------------- | ------------------------------------------ |
| `POST` | `/api/v1/hooks/webex/events`      | Webex webhook delivery target.             |

The route is statically mounted on the autonomous-agents app. When
`WEBEX_BOT_TOKEN` is unset the route returns `503 Service Unavailable` with
`Retry-After: 30` — the feature is fully dormant and no Webex API calls are
made at startup.

## Configuration

All Webex settings are part of the **autonomous-agents** service configuration.

### Required (to enable Webex inbound)

| Variable               | Description                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `WEBEX_BOT_TOKEN`      | Bot access token from [developer.webex.com](https://developer.webex.com). Setting this enables the route. |
| `WEBEX_BOT_PUBLIC_URL` | Externally-reachable base URL of the autonomous-agents service. Webex POSTs to `<public_url>/api/v1/hooks/webex/events`. In dev, an ngrok / cloudflared tunnel; in prod, the real hostname. Localhost does **not** work. |

If `WEBEX_BOT_TOKEN` is set without `WEBEX_BOT_PUBLIC_URL`, startup fails fast
with a clear error rather than registering a broken webhook.

### Optional

| Variable                                   | Default                    | Description                                                                                                          |
| ------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `WEBEX_WEBHOOK_SECRET`                     | _none_                     | HMAC-SHA1 secret Webex signs every event with. Strongly recommended in production; an `INFO`-level warning is logged at startup if absent. |
| `WEBEX_API_BASE`                           | `https://webexapis.com/v1` | Override for testing or future tenant migrations.                                                                    |
| `WEBEX_HTTP_TIMEOUT_SECONDS`               | `15`                       | Timeout for outbound Webex API calls (`get_me`, `get_message`, webhook reconciliation).                              |
| `MONGODB_WEBEX_THREAD_MAP_COLLECTION`      | `webex_thread_map`         | Collection name override.                                                                                            |

## Running locally

The bridge ships as part of the autonomous-agents service, so no extra profile
is needed beyond `--profile autonomous-agents`.

```bash
# In .env
WEBEX_BOT_TOKEN=...
WEBEX_BOT_PUBLIC_URL=https://abcd.ngrok-free.app
WEBEX_WEBHOOK_SECRET=$(openssl rand -hex 32)

# Start the autonomous-agents service alongside the rest of the stack:
docker compose -f docker-compose.dev.yaml \
  --profile caipe-ui \
  --profile autonomous-agents \
  --profile caipe-supervisor \
  --profile caipe-mongodb \
  up --build
```

In a separate shell, expose port 8002 to the public internet so Webex can
deliver webhooks to your laptop:

```bash
docker run --rm -it \
  -e NGROK_AUTHTOKEN=... \
  -p 4040:4040 ngrok/ngrok:latest http host.docker.internal:8002
```

Set `WEBEX_BOT_PUBLIC_URL` in `.env` to the resulting `https://...ngrok-free.app`
URL and restart the `autonomous-agents` service.

## Verifying end-to-end

1. Create a webhook task in the Autonomous tab whose prompt produces a Webex
   message (use the Webex agent and tell it to post into a known room).
2. Trigger the task (`POST /api/v1/hooks/<task_id>`).
3. Confirm the bot's message arrived in the Webex room.
4. Reply in-thread (Webex client: hover over the bot's message and click
   "Reply in thread").
5. The autonomous-agents service logs a new run with `parent_run_id` set to
   the original.

## Failure-mode contract

| Condition                                          | Response                                              |
| -------------------------------------------------- | ----------------------------------------------------- |
| `WEBEX_BOT_TOKEN` unset                            | `503` with `Retry-After: 30`                          |
| Bad / missing `X-Spark-Signature` (when configured) | `401`                                                 |
| Webex API error fetching message body               | `502` (Webex retries)                                 |
| Mongo dedup store unreachable                       | `503` (Webex retries)                                 |
| Loopguard / not-a-reply / no mapping                | `200 {"status": "ignored", "verdict": "..."}`         |
| Duplicate delivery (same `X-Spark-Signature`)       | `200` with the original `run_id`                      |
| Successful forward                                  | `202` after the background follow-up task is scheduled |
