# mcp-scheduler

Generic MCP for cron-style scheduled chat fires. Wraps `caipe-scheduler`'s
REST API. Any dynamic agent that's allowed this MCP can register, list,
patch, and delete schedules.

## Tools

- `create_schedule(agent_id, message_template, cron, tz, owner_user_id, pod_id?)`
- `list_schedules(owner_user_id?, pod_id?, agent_id?)`
- `get_schedule(schedule_id)`
- `update_schedule(schedule_id, [enabled|cron|tz|message_template])`
- `delete_schedule(schedule_id)`

## Env

| Var                       | Required | Notes                                  |
|---------------------------|----------|----------------------------------------|
| `SCHEDULER_URL`           | yes      | e.g. `http://caipe-scheduler:8080`     |
| `SCHEDULER_SERVICE_TOKEN` | yes      | Shared with caipe-scheduler            |
| `MCP_MODE`                | no       | `streamable-http` (default) or `stdio` |
| `MCP_PORT`                | no       | Default 8000                           |

## Trust

This MCP runs server-to-server; it does **not** receive per-user OAuth.
Per-user attribution flows through the `owner_user_id` field on each
schedule, which the cron-runner forwards to the chat API on fire.
