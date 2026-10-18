# Infra Ops MCP Server

MCP server providing infrastructure health, container-visibility, and
scoped container-lifecycle tools for a CAIPE-managed VPS tenant, over an
allowlisted SSH command set.

## Scope

**Phase 1 - read-only:**
- `infra_health` - host load average, memory, and disk usage
- `infra_list_containers` - `podman ps -a` for the SSH user's own containers,
  optionally filtered by name prefix
- `infra_container_logs` - tail a named container's logs

**Phase 2 - lifecycle actions:**
- `infra_container_action` - `stop` / `start` / `restart` a named container.
  No other actions are exposed (no `rm`, no `prune`, no volume operations).
  See `tools/actions.py` for the RBAC caveat: this repo's `mcp-agent-auth`
  middleware gates access at the whole-MCP-server level (`MCP_PDP_SCOPE`),
  not per-tool. If read-only and action tools need independent RBAC, split
  `infra_container_action` into its own MCP server rather than granting one
  scope that covers both.

Only a fixed, allowlisted set of remote commands is ever executed - no
arbitrary shell input from tool arguments reaches the SSH connection, and
container names/actions are validated before being passed to `podman`.

This server only sees/acts on containers owned by the SSH user it connects
as - on a shared multi-tenant host, other tenants' rootless containers are
neither visible nor reachable.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `INFRA_OPS_SSH_HOST` | Target host to manage | (required) |
| `INFRA_OPS_SSH_USER` | SSH user (e.g. `caipeadmin`) | (required) |
| `INFRA_OPS_SSH_KEY_PATH` | Path to the SSH private key | (required) |
| `INFRA_OPS_SSH_PORT` | SSH port | `22` |
| `INFRA_OPS_SSH_TIMEOUT` | Per-command timeout (seconds) | `20` |
| `INFRA_OPS_CONTAINER_HOST` | Podman API socket to target (e.g. `unix:///run/podman/podman.sock`) when the SSH user must reach a rootful podman store it doesn't own. Leave unset when the SSH user's own (rootless) storage is where the workload runs - a bare `podman` call otherwise silently sees nothing instead of erroring. | (unset) |
| `MCP_MODE` | `STDIO` or `http` | `STDIO` |
| `MCP_HOST` | Bind host in `http` mode | `localhost` |
| `MCP_PORT` | Bind port in `http` mode | `8000` |
| `SERVER_NAME` | Display name for the MCP server | `InfraOps` |

## Monitoring loop (`monitor.py`)

Alert-only background loop (`infra-ops-monitor` in `docker-compose.dev.yaml`,
profile `infra-ops-agent`) that polls the same read-only tools on an interval
and posts a webhook message on threshold breach. It never takes remediation
action itself.

Detects: disk usage above threshold, 1-minute load average above threshold,
and containers whose reported uptime stays below one poll interval across
several consecutive polls (crash-loop signature). Each alert key has its own
cooldown to avoid repeat-notifying on a sustained condition.

| Variable | Description | Default |
|---|---|---|
| `INFRA_OPS_ALERT_WEBHOOK_URL` | Webhook URL (Slack-compatible `{"text": ...}` payload) | unset - alerts are logged only |
| `INFRA_OPS_CHECK_INTERVAL_SECONDS` | Poll interval | `60` |
| `INFRA_OPS_DISK_THRESHOLD_PERCENT` | Disk-use alert threshold | `90` |
| `INFRA_OPS_LOAD_THRESHOLD` | 1-minute load average alert threshold | `6.0` |
| `INFRA_OPS_CRASH_LOOP_CHECKS` | Consecutive short-uptime polls before alerting | `3` |
| `INFRA_OPS_ALERT_COOLDOWN_SECONDS` | Minimum time between repeat alerts for the same key | `1800` |
