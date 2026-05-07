# Webex Inbound Bridge

Translate in-thread Webex replies into follow-up runs of an autonomous task.

## What it does

When an autonomous task posts a Webex message (e.g. "Build #1234 failed —
here's the diff"), the autonomous-agents service records the resulting
`messageId` in the `webex_thread_map` collection along with the
`task_id` / `run_id`.

This service:

1. Registers a Webex `messages.created` webhook on startup.
2. On every incoming message:
   - Verifies `X-Spark-Signature` (HMAC-SHA1, when a webhook secret is
     configured).
   - Skips messages authored by the bot itself (loop guard).
   - Skips top-level messages (no `parentId`).
   - Looks up the `parentId` in `webex_thread_map`.
   - On a hit, POSTs a follow-up to the autonomous-agents service:
     `POST /api/v1/hooks/<task_id>/follow-up`.

The autonomous-agents service then re-fires the original task with the
operator's reply injected as a `FollowUpContext`.

## Endpoints

| Method | Path             | Purpose                                     |
| ------ | ---------------- | ------------------------------------------- |
| GET    | `/healthz`       | Liveness (no Webex / Mongo touch).          |
| POST   | `/webex/events`  | Webex webhook delivery target.              |

## Configuration

Required (set in `.env` or compose environment):

| Variable               | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| `WEBEX_BOT_TOKEN`      | Bot access token from <https://developer.webex.com>.     |
| `WEBEX_BOT_PUBLIC_URL` | Externally-reachable base URL of THIS service. Webex POSTs to `<public_url>/webex/events`. In dev, an ngrok / cloudflared tunnel; in prod, the real hostname. Localhost does not work. |
| `AUTONOMOUS_AGENTS_URL`| URL of the autonomous-agents service (e.g. `http://autonomous-agents:8002`). |
| `MONGODB_URI`          | Connection string for the same MongoDB the autonomous-agents service writes to. |

Optional:

| Variable                                   | Default              | Description                                                                                                          |
| ------------------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_DATABASE`                         | `caipe`              | Database name. Override only if the autonomous-agents service was pointed at a different DB.                         |
| `MONGODB_WEBEX_THREAD_MAP_COLLECTION`      | `webex_thread_map`   | Override only if the autonomous-agents Settings of the same name was overridden.                                     |
| `WEBEX_WEBHOOK_SECRET`                     | _none_               | HMAC-SHA1 secret Webex signs every event with. Strongly recommended in production.                                   |
| `WEBHOOK_SECRET`                           | _none_               | Service-wide HMAC shared with autonomous-agents so the bot can sign its outbound `/follow-up` POSTs (HMAC-SHA256).   |
| `WEBEX_API_BASE`                           | `https://webexapis.com/v1` | Override for testing or future tenant migrations.                                                              |
| `HOST` / `PORT`                            | `0.0.0.0` / `8003`   | Bind address.                                                                                                        |
| `LOG_LEVEL`                                | `INFO`               | Standard Python logging level.                                                                                       |

> **Per-task secrets are NOT supported.** The autonomous-agents service lets
> you set a per-task `trigger.secret` on the original-fire path, but the
> bridge isn't part of the task-creation flow and so cannot know each task's
> secret. Configure the global `WEBHOOK_SECRET` on both sides instead.

## Running locally

```bash
# In .env
WEBEX_BOT_TOKEN=...
WEBEX_BOT_PUBLIC_URL=https://abcd.ngrok-free.app
WEBEX_WEBHOOK_SECRET=$(openssl rand -hex 32)
WEBHOOK_SECRET=$(openssl rand -hex 32)

# Start the bot alongside the rest of the stack:
docker compose -f docker-compose.dev.yaml \
  --profile caipe-ui \
  --profile autonomous-agents \
  --profile caipe-supervisor \
  --profile caipe-mongodb \
  --profile webex \
  --profile webex-bot \
  up --build
```

In a separate shell, expose port 8003 to the public internet so Webex can
deliver webhooks to your laptop:

```bash
docker run --rm -it \
  -e NGROK_AUTHTOKEN=... \
  -p 4040:4040 ngrok/ngrok:latest http host.docker.internal:8003
```

Set `WEBEX_BOT_PUBLIC_URL` in `.env` to the resulting `https://...ngrok-free.app`
URL and restart the `webex-bot` service.

## Verifying end-to-end

1. Create a webhook task in the Autonomous tab whose prompt produces a Webex
   message (use the Webex agent and tell it to post into a known room).
2. Trigger the task (`POST /api/v1/hooks/<task_id>`).
3. Confirm the bot's message arrived in the Webex room.
4. Reply in-thread (Webex client: hover over the bot's message and click
   "Reply in thread").
5. The bridge logs `Forwarded follow-up: task=... parent_run=... -> 202`.
6. The autonomous-agents service logs a new run with `parent_run_id` set
   to the original.

## Tests

```bash
cd ai_platform_engineering/integrations/webex_bot
uv venv --python python3.13 --clear .venv
# ``--group unittest`` pulls in pytest etc. -- they live under
# ``[dependency-groups]`` and are excluded from production images.
uv sync --group unittest
uv run pytest
```
