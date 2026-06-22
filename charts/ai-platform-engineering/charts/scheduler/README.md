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
- Pausing is native Kubernetes CronJob suspend: the scheduler patches `spec.suspend=true` when a schedule is disabled, and `spec.suspend=false` when resumed. Mongo `enabled` is updated in the same API call; cron-runner also no-ops if it fetches a disabled schedule.

## Required values

| Path | Notes |
|---|---|
| `serviceToken.existingSecret` *or* `serviceToken.value` | The chart will refuse to render without one. |
| `mongo.existingSecret` *or* `mongo.uri` | Pick one. Prefer the Secret in any non-dev. |

The cron-runner no longer carries a chat-API bearer. It authenticates to the
BFF with the shared `X-Scheduler-Token`; the BFF mints the schedule owner's
bearer via Keycloak token exchange (scheduled-job-auth Approach 2). Enable that
on the BFF side via `keycloak.schedulerTokenExchange` +
`caipe-ui.schedulerRunnerClient.secretName`.

## Notes

- `cronJobOwnerReferences=false` by default. Do not enable it unless `OWNER_DEPLOYMENT_UID` is a real scheduler Deployment UID; using the scheduler Pod UID as a Deployment owner UID makes CronJobs eligible for Kubernetes garbage collection.
- The cron-runner image must be reachable by the cluster registry — the scheduler bakes the full `cronRunner.image.repository:tag` into every CronJob it creates.
