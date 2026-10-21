# Azure Cluster Ops MCP Server

Cluster visibility and node-pool scaling for customer AKS clusters
provisioned by [`infra`](https://github.com/Kendralabs/infra)'s
`envs/azure/<customer>` Terraform/OpenTofu.

Third of the Azure agent set, built on the same registry/runner split as
`azure_power_ops` and `azure_cost_ops`: a discovery-based registry
(`tools/registry.py`) resolves a customer name or `"all"` to AKS cluster(s)
in scope, and `tools/azure_runner.py` runs a fixed `az` command set after a
lazy service-principal login.

## Registry is discovered, not hand-maintained

`tools/registry.py` reads `AZURE_CLUSTER_OPS_INFRA_REPO_PATH`'s
`envs/azure/` directory at call time and includes a customer only if its
directory has both `terraform.tfvars` (names the customer) and
`backend.hcl` (actually `tofu apply`'d). `customer-template` itself is
always skipped. If no customer environment has been applied yet, the
registry is simply empty - the expected state today, not an error.

Component name follows `envs/azure/customer-template/main.tf`'s own
convention: AKS cluster `kendra-<customer>-aks` in resource group
`kendra-<customer>-rg`.

## Scope

- `cluster_get_status(scope)` - provisioning state, Kubernetes version,
  power state, and node pool summaries for a customer or `"all"`
  customers.
- `cluster_list_node_pools(scope)` - node pool name, VM size, node count,
  and autoscale bounds for a customer or `"all"` customers.
- `cluster_scale_node_pool(scope, pool_name, node_count, confirm)` - sets a
  fixed node count on one node pool via `az aks nodepool scale`. Always
  requires `confirm=True` (changes running cluster capacity); `scope="all"`
  is refused - scaling every customer's cluster to the same count in one
  call is never the intended action.

A scope that doesn't resolve to a registered customer is refused outright -
the registry, not the request, is the safety boundary.

## Deliberately out of scope

- **Power on/off** - that's `azure_power_ops`'s job; this server never
  stops or starts a cluster.
- **Kubernetes version upgrades** (`az aks upgrade`) - a longer-running,
  higher-risk operation than node pool scaling, left out of this first
  pass. Add a dedicated, more heavily guarded tool if this becomes needed.
- **Autoscale-enabled pools** - `cluster_scale_node_pool` only works on a
  pool provisioned with `enable_auto_scaling = false`
  (`envs/azure/customer-template/main.tf`'s `dev`-tier default); `az aks
  nodepool scale` refuses an autoscale-enabled pool, and that refusal is
  returned to the caller as-is rather than silently reinterpreted as a
  min/max change. Use `az aks nodepool update --update-cluster-autoscaler`
  directly for that case until a dedicated tool exists.

## Authentication

Reuses the same Azure service-principal credentials `azure_power_ops` and
`azure_cost_ops` already use:

| Variable | Description |
|---|---|
| `ARM_CLIENT_ID` | Service principal client ID |
| `ARM_CLIENT_SECRET` | Service principal secret |
| `ARM_TENANT_ID` | Azure AD tenant ID |
| `ARM_SUBSCRIPTION_ID` | Target subscription |

Scope this service principal to **Azure Kubernetes Service Cluster User
Role** (read) plus **Contributor on the specific AKS resource** (for node
pool scaling) on the target resource groups - not subscription-wide
Contributor.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AZURE_CLUSTER_OPS_INFRA_REPO_PATH` | Local path to the infra repo checkout to read `envs/azure/` from | (required to discover any environment) |
| `ARM_CLIENT_ID` / `ARM_CLIENT_SECRET` / `ARM_TENANT_ID` / `ARM_SUBSCRIPTION_ID` | Service principal credentials | (required for any action) |
| `AZURE_CLUSTER_OPS_AZ_TIMEOUT` | Per-`az`-command timeout (seconds) | `120` |
| `MCP_MODE` | `STDIO` or `http` | `STDIO` |
| `MCP_HOST` | Bind host in `http` mode | `localhost` |
| `MCP_PORT` | Bind port in `http` mode | `8000` |
| `SERVER_NAME` | Display name for the MCP server | `AzureClusterOps` |

## RBAC note

Run with its own `MCP_PDP_SCOPE` (see `mcp_agent_auth.middleware`),
distinct from `azure_power_ops` and `azure_cost_ops`, since this server's
write action (`cluster_scale_node_pool`) changes running compute capacity,
a different blast radius than power on/off or a budget alert.

## Not yet built

- `azure-core-services-ops`, `azure-scale-ops`, `azure-backup-ops`,
  `azure-policy-ops`, `azure-security-ops` - the rest of the Azure agent
  set, built in order after `azure-power-ops`, `azure-cost-ops`, and this
  server.
- No live customer environment has actually been `tofu apply`'d yet, so
  this server has not been run end-to-end against real Azure resources -
  only against an empty registry.
