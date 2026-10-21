# Azure Cost Ops MCP Server

Cost visibility and budget-alert tool for customer Azure environments
provisioned by [`kendrainfra`](https://github.com/Kendralabs/kendrainfra)'s
`envs/azure/<customer>` Terraform/OpenTofu.

This is a composition layer over `az consumption`, in the same shape as
`azure_power_ops`: a discovery-based registry (`tools/registry.py`)
resolves a customer name or `"all"` to the resource group(s) in scope, and
`tools/azure_runner.py` runs a fixed `az` command set after a lazy
service-principal login.

## Registry is discovered, not hand-maintained

`tools/registry.py` reads `AZURE_COST_OPS_KENDRAINFRA_PATH`'s `envs/azure/`
directory at call time and includes a customer only if its directory has
both `terraform.tfvars` (names the customer) and `backend.hcl` (actually
`tofu apply`'d). `customer-template` itself is always skipped. If no
customer environment has been applied yet, the registry is simply empty -
the expected state today, not an error.

Unlike `azure_power_ops`'s per-resource (`aks`/`postgres`) registry, the
unit here is one resource group per customer (`kendra-<customer>-rg`),
since Azure Cost Management's `az consumption` surface reports cost at the
subscription level, not per-resource.

## Scope

- `cost_get_current_spend(scope)` - month-to-date spend for a customer or
  `"all"` customers, filtered from subscription-wide usage records by
  resource group membership.
- `cost_list_top_resources(scope, top_n=10)` - the highest-cost resources
  (month-to-date) for a customer or `"all"` customers.
- `cost_set_budget_alert(scope, amount, confirm)` - creates a monthly
  budget alert on a customer's resource group via `az consumption budget
  create-with-rg`. Always requires `confirm=True` (writes real subscription
  state); `scope="all"` is refused - one budget per resource group is the
  only shape the underlying `az` command supports.

A scope that doesn't resolve to a registered customer is refused outright -
the registry, not the request, is the safety boundary.

## Known limitations

- **No native per-resource-group filter.** `az consumption usage list` is
  subscription/billing-period scoped; there is no `--resource-group` flag.
  Per-customer numbers are produced by filtering each usage record's
  `instanceId` client-side for membership in that customer's resource
  group. This is a real limitation of the installed `az consumption`
  surface, not a design choice - a resource that Azure doesn't tag with a
  resolvable `instanceId` (some marketplace/SaaS line items) won't be
  attributed to any customer.
- **No forecast tool.** A true cost forecast would use `az costmanagement
  query --type ActualCost`, but the `costmanagement` extension version
  available while building this server only confirmed `export` and
  `show-operation-result` locally - `query` was not verified. Rather than
  ship an unverified command, forecasting is deliberately left unimplemented
  until that's confirmed (or an `az rest` call against the Cost Management
  REST API is validated as a fallback).
- No live customer environment has actually been `tofu apply`'d yet, so
  this server has not been run end-to-end against real Azure resources -
  only against an empty registry.

## Authentication

Reuses the same Azure service-principal credentials `azure_power_ops` and
`kendrainfra`'s own `Jenkinsfile` already use:

| Variable | Description |
|---|---|
| `ARM_CLIENT_ID` | Service principal client ID |
| `ARM_CLIENT_SECRET` | Service principal secret |
| `ARM_TENANT_ID` | Azure AD tenant ID |
| `ARM_SUBSCRIPTION_ID` | Target subscription |

Scope this service principal to **Cost Management Reader** (for
`cost_get_current_spend` / `cost_list_top_resources`) and **Cost Management
Contributor** (for `cost_set_budget_alert`) on the target subscription or
resource groups - distinct roles from the plain Reader role
`azure_power_ops` needs for AKS/Postgres state.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AZURE_COST_OPS_KENDRAINFRA_PATH` | Local path to the `kendrainfra` checkout to read `envs/azure/` from | (required to discover any environment) |
| `ARM_CLIENT_ID` / `ARM_CLIENT_SECRET` / `ARM_TENANT_ID` / `ARM_SUBSCRIPTION_ID` | Service principal credentials | (required for any action) |
| `AZURE_COST_OPS_AZ_TIMEOUT` | Per-`az`-command timeout (seconds) | `120` |
| `MCP_MODE` | `STDIO` or `http` | `STDIO` |
| `MCP_HOST` | Bind host in `http` mode | `localhost` |
| `MCP_PORT` | Bind port in `http` mode | `8000` |
| `SERVER_NAME` | Display name for the MCP server | `AzureCostOps` |

## RBAC note

Run with its own `MCP_PDP_SCOPE` (see `mcp_agent_auth.middleware`),
distinct from `azure_power_ops` and `infra_ops`/`power_ops`, since this
server's write action (`cost_set_budget_alert`) has a different blast
radius (budget/notification config, not compute) than power on/off.

## Not yet built

- `azure-cluster-ops`, `azure-core-services-ops`, `azure-scale-ops`,
  `azure-backup-ops`, `azure-policy-ops`, `azure-security-ops` - the rest
  of the Azure agent set, built in order after `azure-power-ops` and this
  server.
