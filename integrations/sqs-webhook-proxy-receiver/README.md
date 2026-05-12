# SQS Webhook Proxy Receiver

A long-running SQS poller that forwards webhook deliveries parked in an
operator-managed queue to a CAIPE webhook endpoint.

This service is packaged so that it lives inside CAIPE's
`docker-compose.dev.yaml` and starts/stops with the rest of the stack.

## Where it sits

```
Webhook provider
        │
        ▼  HTTPS webhook
   Public webhook gateway / verifier
        │
        ▼  verified raw delivery
   AWS SQS (webhook-deliveries)
        │
        ▼  long-poll (this service)
   sqs-webhook-proxy-receiver  ──── HTTP POST ────▶  caipe-ui webhook route
                                                       → event persistence
                                                       → projection worker
                                                       → UI updates
```

Two entrypoints are shipped:

- `server.py` — legacy forwarder entrypoint, kept for parity testing.
- `caipe_forwarder.py` — preferred CAIPE entrypoint: long polling, JSON logs,
  no-delete-on-failure (so retries are durable), and pretty event summaries.

The Docker image uses `caipe_forwarder.py` by default.

## Required environment

| Variable | Default | Description |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | _from environment_ | Base identity used to read the SQS queue or assume a queue-reader role. |
| `AWS_SECRET_ACCESS_KEY` | _from `.env`_ | – |
| `AWS_SESSION_TOKEN` | _optional_ | Only required when running with assumed-role credentials. |
| `AWS_REGION` | `us-east-1` | SQS queue region. |
| `SQS_QUEUE_NAME` | `webhook-deliveries` | Queue name (not URL). |
| `CAIPE_WEBHOOK_URL` | `http://caipe-ui:3000/api/agentic-sdlc/webhooks/github` | Where the receiver POSTs forwarded payloads. |
| `RECEIVER_BATCH_SIZE` | `10` | SQS messages to pull per long poll (max 10). |
| `RECEIVER_WAIT_SECONDS` | `20` | SQS long-poll wait. |
| `RECEIVER_REQUEST_TIMEOUT` | `15` | HTTPS POST timeout in seconds. |
| `LOG_PAYLOAD` | `0` | Set to `1` to log the full GitHub payload (verbose). |

## Locally (outside docker)

```bash
cd integrations/sqs-webhook-proxy-receiver
python3 -m venv .venv && . .venv/bin/activate
pip install -r app/requirements.txt
AWS_REGION=us-east-1 \
SQS_QUEUE_NAME=webhook-deliveries \
  CAIPE_WEBHOOK_URL=http://localhost:3000/api/agentic-sdlc/webhooks/github \
  python3 app/src/caipe_forwarder.py
```

## In docker-compose

```bash
docker compose -f docker-compose.dev.yaml --profile agentic-sdlc up sqs-webhook-proxy-receiver
```

The service is gated behind the `agentic-sdlc` profile so it only spins up
when you actually want live webhook events flowing.

## Verifying it works

1. Send a test event from the provider.
2. `docker logs -f sqs-webhook-proxy-receiver` should show a `[forward]` line.
3. `docker exec caipe-mongodb-dev mongosh -u admin -p changeme --authenticationDatabase admin caipe --eval 'db.ship_loop_events.find({}, {github_event_type:1, github_action:1, occurred_at:1}).sort({occurred_at:-1}).limit(3).toArray()'`

## Provenance

The CAIPE forwarder entrypoint is maintained in this repository.
