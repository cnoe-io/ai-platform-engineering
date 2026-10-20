# Azure Power Ops MCP Server

Power on/off switch for customer Azure environments provisioned by
[`kendrainfra`](https://github.com/Kendralabs/kendrainfra)'s
`envs/azure/<customer>` Terraform/OpenTofu - AKS and Postgres Flexible
Server, the two resources in that stack that bill by the hour whether
anyone is using them or not.

This is a composition layer, not a new primitive: it runs the same two
`az` operations
[`scripts/platform-agent/kendra-platform-agent.sh`](https://github.com/Kendralabs/kendrainfra/blob/main/scripts/platform-agent/kendra-platform-agent.sh)
already validated (`az aks stop/start`, `az postgres flexible-server
stop/start`) in the same dependency-safe order, exposed as callable MCP
tools across every customer environment instead of one CLI invocation per
customer. It does not replace that script - it's the right tool for a
human operator working one environment interactively.

## Power order

```
SHUTDOWN:  AKS  ->  Postgres     (stop the consumer before the thing it consumes)
STARTUP:   Postgres  ->  AKS     (the dependency has to be ready before things reconnect to it)
```

`tools/power.py` enforces this ordering internally for any multi-component
scope - a caller never has to get the sequence right themselves.

## Registry is discovered, not hand-maintained

Unlike `power_ops`'s VPS container list (a fixed dict - containers rarely
change), `tools/registry.py` reads `AZURE_POWER_OPS_KENDRAINFRA_PATH`'s
`envs/azure/` directory at call time and includes a customer only if its
directory has both `terraform.tfvars` (names the customer) and
`backend.hcl` (actually `tofu apply`'d - see
`envs/azure/customer-template/README.md`). `customer-template` itself is
always skipped. If no customer environment has been applied yet, the
registry - and therefore `power_list_components` - is simply empty; this
is the expected state today, not an error.

Component names follow `envs/azure/customer-template/main.tf`'s own
convention: resource group `kendra-<customer>-rg`, AKS cluster
`kendra-<customer>-aks`, Postgres server `kendra-<customer>-pg`.

## Scope

**Phase 1 - read-only:**
- `power_list_components` - lists every customer environment currently
  registered and each component's live Azure power state (via `az aks
  show` / `az postgres flexible-server show`).

**Phase 2 - power actions:**
- `power_on` / `power_off` - power a component, a customer group (its
  `aks`+`postgres` pair), or the explicit `"all"` scope.

Guards, enforced in `tools/power.py`:
- The `"all"` scope always requires `confirm=True`.
- **Every** customer group requires `confirm=True` - unlike `power_ops`'s
  `GUARDED_GROUPS` subset, there is no ungated customer group here, since
  powering a customer's AKS+Postgres is always a real production action.
- A component or group name that doesn't resolve is refused outright - the
  registry, not the request, is the safety boundary.

## Authentication

Reuses the same Azure service-principal credentials `kendrainfra`'s own
`Jenkinsfile` already sets for Terraform - no new credential mechanism:

| Variable | Description |
|---|---|
| `ARM_CLIENT_ID` | Service principal client ID |
| `ARM_CLIENT_SECRET` | Service principal secret |
| `ARM_TENANT_ID` | Azure AD tenant ID |
| `ARM_SUBSCRIPTION_ID` | Target subscription |

Unlike the Terraform AzureRM provider, the `az` CLI doesn't pick these up
automatically - `tools/azure_runner.py` runs `az login
--service-principal` once per process the first time a command is needed,
then reuses that session. A missing variable returns a clear
"not configured" error rather than a cryptic `az` failure.

Scope this service principal to **Reader + the specific
start/stop/deallocate actions** on the target resource groups, not
Contributor - it should be able to power resources on/off and read their
state, nothing else.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AZURE_POWER_OPS_KENDRAINFRA_PATH` | Local path to the `kendrainfra` checkout to read `envs/azure/` from | (required to discover any environment) |
| `ARM_CLIENT_ID` / `ARM_CLIENT_SECRET` / `ARM_TENANT_ID` / `ARM_SUBSCRIPTION_ID` | Service principal credentials | (required for any action) |
| `AZURE_POWER_OPS_AZ_TIMEOUT` | Per-`az`-command timeout (seconds) | `120` |
| `MCP_MODE` | `STDIO` or `http` | `STDIO` |
| `MCP_HOST` | Bind host in `http` mode | `localhost` |
| `MCP_PORT` | Bind port in `http` mode | `8000` |
| `SERVER_NAME` | Display name for the MCP server | `AzurePowerOps` |

## RBAC note

This server's blast radius is a whole customer environment's compute and
database - bigger, costlier, and slower to reverse than `power_ops`'s
single-container VPS actions. Run it with its own `MCP_PDP_SCOPE` (see
`mcp_agent_auth.middleware`), distinct from both `infra_ops` and
`power_ops`, so it can be granted to a narrower set of users/agents
independently.

## Known limitation

Azure auto-starts a stopped Postgres Flexible Server after 7 days
regardless of anything this server does (a hard Azure platform behavior -
see `kendra-platform-agent.sh`'s own README). If an environment needs to
stay down longer than a week, re-run `power_off` periodically.

## Not yet built

- `azure-cost-ops`, `azure-cluster-ops`, `azure-core-services-ops`,
  `azure-scale-ops`, `azure-backup-ops`, `azure-policy-ops`,
  `azure-security-ops` - the rest of the Azure agent set this one was built
  first from (direct cost-reduction lever, most prior art). See this
  server's commit history / the "Kendra Labs Multi-Cloud Deployment Plan"
  artifact for the full set and build order.
- No live customer environment has actually been `tofu apply`'d yet, so
  this server has not been run end-to-end against real Azure resources -
  only against an empty registry. Run `power_list_components` first
  against a real environment once one exists, before trusting
  `power_on`/`power_off` on it.
