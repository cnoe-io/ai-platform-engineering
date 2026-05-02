# scheduler

Helm chart for **caipe-scheduler** — the cron schedule registry + k8s
`CronJob` orchestrator.

## What this chart deploys

| Resource | Purpose |
|---|---|
| `Deployment` (caipe-scheduler) | The REST API. Mongo + k8s API client. |
| `Service` | Internal-cluster endpoint reached by `mcp-scheduler` and the cron-runner. |
| `Role` + `RoleBinding` | Grants the scheduler Deployment `cronjobs.*` (and `jobs` read) in the release namespace. **No other CAIPE component has these verbs.** |
| `ServiceAccount` (caipe-scheduler) | Used by the scheduler Deployment. RBAC bound. |
| `ServiceAccount` (caipe-cron-runner) | Used by every CronJob's runner pod. **No RBAC. No projected token.** |
| `ConfigMap` | Non-secret env (Mongo db, image refs, runner SA name, internal URL, limits). |
| `Secret` (service token) | Shared `X-Scheduler-Token` (skipped if `serviceToken.existingSecret` is set). |

## Trust boundary recap

- `dynamic-agents` and `mcp-scheduler` only reach k8s through this scheduler's REST API.
- This scheduler is the only component with `cronjobs.*` RBAC.
- The CronJob podTemplate is hard-coded inside `caipe_scheduler/k8s.py`. Callers can only set `schedule`, `timeZone`, and the `SCHEDULE_ID` env. Image, command, mounts, and SA are baked.
- cron-runner pods get zero RBAC.

## Required values

| Path | Notes |
|---|---|
| `serviceToken.existingSecret` *or* `serviceToken.value` | The chart will refuse to render without one. |
| `mongo.existingSecret` *or* `mongo.uri` | Pick one. Prefer the Secret in any non-dev. |
| `caipe.apiTokenSecret` | Pre-existing Secret holding the chat-API bearer used by cron-runner. The chart does **not** create this; create it out-of-band. |

## Notes

- `cronJobOwnerReferences=true` (default) sets the Pod's UID as `ownerReferences` on every CronJob. This gives cascade-delete on **scheduler-pod** restart. For true Deployment-scoped GC, an init step should look up the Deployment UID via the k8s API and pass it via `OWNER_DEPLOYMENT_UID`. Left as a future hardening; v1 cascade is good enough.
- The cron-runner image must be reachable by the cluster registry — the scheduler bakes the full `cronRunner.image.repository:tag` into every CronJob it creates.
