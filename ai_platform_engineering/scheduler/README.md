# caipe-scheduler

Cron schedule registry + Kubernetes `CronJob` orchestrator. Receives schedule
requests from `dynamic-agents` (e.g. Pam's `schedule_prep` tool), validates
them, persists to Mongo, and creates per-schedule `CronJob`s from a hard-coded
podTemplate. It also dispatches delayed one-off `Job`s for retry-style fires.

## Trust model

| Component        | Can do                                               | Cannot do                                  |
|------------------|------------------------------------------------------|--------------------------------------------|
| `dynamic-agents` | HTTP POST to scheduler-svc                           | Touch k8s API, mount secrets, choose image |
| `caipe-scheduler`| Create/delete `CronJob`s and delayed one-off `Job`s from hard-coded podTemplate | Run arbitrary containers (template baked)  |
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
POST   /v1/schedules/{id}/one-off-runs — create delayed one-off fire
GET    /v1/schedules/{id}/one-off-runs — list delayed one-off fires
POST   /v1/schedules/{id}/runs        — runner reports status (status/error/http_status)
GET    /healthz
```

New schedules require a human-readable `title`. They may also include an
`attributes` JSON object for small UI display labels and an optional
`edit_agent_id` that tells UIs which agent should handle user-initiated edits.
`pod_id` remains a first-class filter field for Pam-style pod schedules, but
generic callers should use `attributes` for display-only context.

All but `/healthz` require header `X-Scheduler-Token: <SCHEDULER_SERVICE_TOKEN>`.

`PATCH /v1/schedules/{id}` with `{"enabled": false}` pauses a schedule by
setting Mongo `enabled=false` and Kubernetes `CronJob.spec.suspend=true`.
`{"enabled": true}` resumes future fires with `spec.suspend=false`. The
cron-runner also checks `enabled` after fetching the schedule and exits without
posting chat if the schedule is disabled, which protects against manual k8s/Mongo
drift. Pausing does not kill a Job that is already running.

`POST /v1/schedules/{id}/one-off-runs` stores a UTC `run_at` (or
`delay_minutes`) in Mongo. The scheduler pod wakes near the due time, claims
pending one-offs atomically, and creates a normal Kubernetes `Job` by copying
the parent CronJob's `jobTemplate`. This is meant for domain retries like
"transcript not ready; try again in 10 minutes" and does not modify the
recurring schedule.

## Run locally

```sh
uv sync
SCHEDULER_SERVICE_TOKEN=devtoken \
MONGODB_URI=mongodb://admin:changeme@localhost:27017/caipe?authSource=admin \
caipe-scheduler
```

For dev without a real cluster, `kubernetes.config.load_kube_config()` is
attempted — point your `KUBECONFIG` at a kind/minikube cluster.
