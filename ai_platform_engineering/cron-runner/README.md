# caipe-cron-runner

Tiny one-shot pod that fires once per scheduled CronJob run. It is **not** a
daemon; it exits after a single attempt.

## Flow

```
SCHEDULE_ID env ──▶ GET scheduler-svc/v1/schedules/<id>
                ──▶ POST <CAIPE_API_URL>/api/chat/stream  (as schedule.owner_user_id)
                ──▶ POST scheduler-svc/v1/schedules/<id>/runs  (status report)
```

## Env

| Var                      | Required | Notes                                         |
|--------------------------|----------|-----------------------------------------------|
| `SCHEDULE_ID`            | yes      | Set by caipe-scheduler when it creates the CronJob. |
| `SCHEDULER_INTERNAL_URL` | yes      | e.g. `http://caipe-scheduler:8080`            |
| `SCHEDULER_SERVICE_TOKEN`| yes      | Mounted from `caipe-scheduler-service-token` Secret. |
| `CAIPE_API_URL`          | yes      | e.g. `http://caipe-ui:3000`                   |
| `CAIPE_API_TOKEN`        | yes      | Mounted from `caipe-cron-runner-token` Secret. |
| `CAIPE_CHAT_PATH`        | no       | Default `/api/chat/stream`.                   |
| `HTTP_TIMEOUT`           | no       | Seconds; default 60.                          |
| `LOG_LEVEL`              | no       | Default `INFO`.                               |

## Chat API contract (open issue)

The runner POSTs `{ agent_id, message, owner_user_id, pod_id? }` with
`Authorization: Bearer <CAIPE_API_TOKEN>` and `X-CAIPE-User:
<owner_user_id>`. The exact CAIPE auth + payload schema for service-token-
attributed chat sends needs to be confirmed against the chat backend; the
fields above are the working assumption.
