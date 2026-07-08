# caipe-cron-runner

Tiny one-shot pod that fires once per scheduled CronJob run. It is **not** a
daemon; it exits after a single attempt.

## Flow

```
SCHEDULE_ID env ->  GET scheduler-svc/v1/internal/schedules/<id>
                ->  exit 0 without chat if schedule.enabled is false and this is a recurring fire
                ->  POST <CAIPE_API_URL><CAIPE_CHAT_PATH>  (auth: X-Scheduler-Token only)
                    BFF resolves the owner from the schedule DB record, mints a
                    real owner bearer via Keycloak token exchange, runs agent#use
                    as the owner, and creates a Web UI conversation for History
                ->  POST scheduler-svc/v1/schedules/<id>/runs  (status report)
```

For delayed one-off fires, the copied Job also gets `ONE_OFF_RUN_ID` plus
optional retry/domain metadata. One-offs continue to run even if the parent
recurring schedule is paused, as long as the schedule/CronJob template still
exists. The runner appends `SCHEDULED_RUN_METADATA` to the chat message so the
target agent can schedule another delayed retry or honor domain-specific context.

## Env

| Var                      | Required | Notes                                         |
|--------------------------|----------|-----------------------------------------------|
| `SCHEDULE_ID`            | yes      | Set by caipe-scheduler when it creates the CronJob. |
| `SCHEDULER_INTERNAL_URL` | yes      | e.g. `http://caipe-scheduler:8080`            |
| `SCHEDULER_SERVICE_TOKEN`| yes      | Mounted from `caipe-scheduler-service-token` Secret. |
| `CAIPE_API_URL`          | yes      | e.g. `http://caipe-ui:3000`                   |
| `CAIPE_CHAT_PATH`        | no       | Default `/api/v1/chat/invoke`.                |
| `ONE_OFF_RUN_ID`         | no       | Set only for delayed one-off Jobs.            |
| `RETRY_NUM`              | no       | Optional retry attempt metadata.              |
| `RETRY_LIMIT`            | no       | Optional retry limit metadata.                |
| `RETRY_REASON`           | no       | Optional retry reason metadata.               |
| `ONE_OFF_METADATA_JSON`  | no       | Optional one-off context JSON for target agents. |
| `MESSAGE_TEMPLATE_OVERRIDE` | no    | Optional one-off message body override.       |
| `HTTP_TIMEOUT`           | no       | Seconds; default 300.                         |
| `LOG_LEVEL`              | no       | Default `INFO`.                               |

## Chat API contract

The runner POSTs `{ agent_id, message, conversation_id, trace_id,
client_context }` with **only** `X-Scheduler-Token:
<SCHEDULER_SERVICE_TOKEN>` and `X-Client-Source: caipe-cron-runner`. It sends no
`Authorization` bearer and no trusted owner header - the runner does not assert
the owner's identity.

The Next.js gateway (BFF) authenticates the call by the scheduler token, then:

1. resolves the immutable owner and agent from the schedule DB record (by
   `client_context.schedule_id`), ignoring runner-supplied identity fields;
2. mints a real owner-user bearer via Keycloak token exchange
   (`requested_subject` impersonation, using the scoped `caipe-scheduler-runner`
   client) and forwards it to Dynamic Agents as `Authorization: Bearer ...`;
3. enforces `agent#use` as the owner - the run fails closed if the owner has
   lost access, exactly like an interactive run;
4. rewrites the generated `scheduled-...` conversation id to a server UUID,
   upserts a Web UI conversation owned by the resolved owner, persists the
   user/assistant messages, and stores `client_context.schedule_id` in
   conversation metadata so the UI History list can label the run.
