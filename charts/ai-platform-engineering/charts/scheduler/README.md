# scheduler

Helm chart for **caipe-scheduler** - the cron schedule registry + k8s
`CronJob` orchestrator.

## What this chart deploys

| Resource | Purpose |
|---|---|
| `Deployment` (caipe-scheduler) | The REST API. Mongo + k8s API client. |
| `Service` | Internal-cluster endpoint reached by `mcp-scheduler` and the cron-runner. |
| `Role` + `RoleBinding` | Grants the scheduler Deployment `cronjobs.*` plus one-off `Job` create/read in the release namespace. **No other CAIPE component has these verbs.** |
| `ServiceAccount` (caipe-scheduler) | Used by the scheduler Deployment. RBAC bound. |
| `ServiceAccount` (caipe-cron-runner) | Used by every CronJob's runner pod. **No RBAC. No projected token.** |
| `ConfigMap` | Non-secret env (Mongo db, caller JWT validation, image refs, runner SA name, internal URL, limits). |
| `Secret` (service token) | Shared `X-Scheduler-Token` (skipped if `serviceToken.existingSecret` is set). |

## Trust boundary recap

- `dynamic-agents` and `mcp-scheduler` only reach k8s through this scheduler's REST API.
- This scheduler is the only component with `cronjobs.*` RBAC.
- The CronJob podTemplate is hard-coded inside `caipe_scheduler/k8s.py`. Callers can only set `schedule`, `timeZone`, and the `SCHEDULE_ID` env. Image, command, mounts, and SA are baked.
- Scheduler startup always reconciles existing CronJob runner images to the configured image.
- The Deployment pod template includes a checksum of the scheduler ConfigMap, so changing the desired runner image rolls the scheduler and triggers reconciliation.
- cron-runner pods get zero RBAC.
- Pausing is native Kubernetes CronJob suspend: the scheduler patches `spec.suspend=true` when a schedule is disabled, and `spec.suspend=false` when resumed. Mongo `enabled` is updated in the same API call; cron-runner also no-ops if it fetches a disabled schedule.

## Required values

| Path | Notes |
|---|---|
| `mongo.existingSecret` *or* `mongo.uri` | Pick one. Prefer the Secret in any non-dev. |
| `auth.jwksUrl` | JWKS endpoint used to verify caller JWT signatures. |
| `auth.issuer` | Exact issuer expected in caller JWTs. |

`auth.audiences` defaults to `caipe-platform` and `auth.algorithms` defaults to
`RS256`. User-facing schedule operations fail closed when caller JWT validation
is not configured.

The chart generates and preserves a scheduler service token when no
`serviceToken.existingSecret` or explicit `serviceToken.value` is provided.

The cron-runner no longer carries a chat-API bearer. It authenticates to the
BFF with the shared `X-Scheduler-Token`; the BFF mints the schedule owner's
bearer via Keycloak token exchange. Enable that on the BFF side via
`keycloak.schedulerTokenExchange` + `caipe-ui.schedulerRunnerClient.secretName`.

## Notes

- The cron-runner image must be reachable by the cluster registry - the scheduler bakes the full `cronRunner.image.repository:tag` into every CronJob it creates.
