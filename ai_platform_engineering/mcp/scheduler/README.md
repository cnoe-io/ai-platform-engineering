# mcp-scheduler

Generic MCP for cron-style scheduled chat fires. Wraps `caipe-scheduler`'s
REST API. Any dynamic agent that's allowed this MCP can register, list,
patch, and delete schedules.

## Tools

- `create_schedule(agent_id, title, message_template, cron, tz, attributes?, edit_agent_id?)`
- `list_schedules(owner_user_id?, agent_id?)`
- `get_schedule(schedule_id)`
- `update_schedule(schedule_id, [enabled|cron|tz|message_template|title|attributes|edit_agent_id])`
- `pause_schedule(schedule_id)` - set `enabled=false` and suspend the underlying Kubernetes CronJob
- `resume_schedule(schedule_id)` - set `enabled=true` and unsuspend the underlying Kubernetes CronJob
- `restart_schedule(schedule_id)` - alias for resume; resumes future fires, does not immediately create a Job
- `schedule_one_off(schedule_id, run_at? | delay_minutes?, message_template?, reason?, metadata?, retry_num?, retry_limit?)` - one-offs run even when the parent recurring schedule is paused, as long as the parent schedule/CronJob template still exists
- `list_one_off_runs(schedule_id, status?)`
- `delete_schedule(schedule_id)`

## Env

| Var                       | Required | Notes                                  |
|---------------------------|----------|----------------------------------------|
| `SCHEDULER_URL`           | yes      | e.g. `http://caipe-scheduler:8080`     |
| `SCHEDULER_SERVICE_TOKEN` | yes      | Shared with caipe-scheduler            |
| `MCP_MODE`                | no       | `streamable-http` (default) or `stdio` |
| `MCP_PORT`                | no       | Default 8000                           |
| `MCP_AUTH_MODE`           | no       | Set to `oauth2` in the Helm chart      |
| `JWKS_URI`                | oauth2   | Keycloak realm signing keys            |
| `ISSUER`                  | oauth2   | Expected caller token issuer           |
| `AUDIENCE`                | oauth2   | Expected caller token audience         |
| `SCHEDULER_REQUIRE_CALLER_IDENTITY` | no | Require an email-bearing caller JWT |

## Trust

Dynamic Agents forwards the validated caller bearer through AgentGateway. The
MCP validates that JWT, derives the owner email from it, and scopes every list,
read, update, one-off, and delete operation to that owner. The optional
`owner_user_id` argument is only a local-development fallback when caller
identity enforcement is explicitly disabled.
