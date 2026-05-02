# caipe-scheduler

Cron schedule registry + Kubernetes `CronJob` orchestrator. Receives schedule
requests from `dynamic-agents` (e.g. Pam's `schedule_prep` tool), validates
them, persists to Mongo (`schedules` collection), and creates per-schedule
`CronJob`s from a hard-coded podTemplate.

## Trust model

| Component        | Can do                                               | Cannot do                                  |
|------------------|------------------------------------------------------|--------------------------------------------|
| `dynamic-agents` | HTTP POST to scheduler-svc                           | Touch k8s API, mount secrets, choose image |
| `caipe-scheduler`| Create/delete `CronJob`s from hard-coded podTemplate | Run arbitrary containers (template baked)  |
| `caipe-cron-runner` (per fire) | Read its own chat-API-token Secret; POST chat API | Talk to Mongo or k8s API           |

The podTemplate lives in `caipe_scheduler/k8s.py` — only the `schedule`,
`timeZone`, and `SCHEDULE_ID` env are user-controlled.

## Endpoints

```
POST   /v1/schedules                  — create
GET    /v1/schedules?owner=&pod_id=…  — list
GET    /v1/schedules/{id}             — single
PATCH  /v1/schedules/{id}             — enable/disable, change cron/tz/msg
DELETE /v1/schedules/{id}             — remove (Mongo + CronJob)
POST   /v1/schedules/{id}/runs        — runner reports status (status/error/http_status)
GET    /healthz
```

All but `/healthz` require header `X-Scheduler-Token: <SCHEDULER_SERVICE_TOKEN>`.

## Run locally

```sh
uv sync
SCHEDULER_SERVICE_TOKEN=devtoken \
MONGODB_URI=mongodb://admin:changeme@localhost:27017/caipe?authSource=admin \
caipe-scheduler
```

For dev without a real cluster, `kubernetes.config.load_kube_config()` is
attempted — point your `KUBECONFIG` at a kind/minikube cluster.
