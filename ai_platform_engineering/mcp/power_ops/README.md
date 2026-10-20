# Power Ops MCP Server

Master on/off switch for Kendra Infra/CAIPE components: one place to power a
named component, a named group, or everything on or off, instead of
operators hand-toggling VPS containers and (eventually) AKS workloads
separately.

This is a composition layer, not a new primitive: on the VPS it shells out
to the same `podman stop`/`podman start` that
[`infra_ops`](../infra_ops/README.md)'s `infra_container_action` already
uses. It does not replace that tool - `infra_ops` stays the right choice for
a single ad-hoc container restart; this server is for switching named groups
of components together, with an explicit allowlist and confirmation guard.

## Scope

**Phase 1 - read-only:**
- `power_list_components` - lists every registered component and group
  (`tools/registry.py`), and each VPS-backed component's current container
  state. Azure-backed entries report "unknown" until that control plane is
  wired up (see below).

**Phase 2 - power actions:**
- `power_on` / `power_off` - power a component, a group, or the explicit
  `"all"` scope. Only names present in `tools/registry.py` resolve; anything
  else is refused, never attempted.

Guards, enforced in `tools/power.py`:
- The `"all"` scope always requires `confirm=True`.
- Groups listed in `registry.GUARDED_GROUPS` (currently `azure-core`, since
  powering off Keycloak/OpenFGA/KIAM takes every product namespace down
  with it) require `confirm=True` even though the group itself is a normal,
  discoverable registry entry.
- A component or group name not in the registry is refused outright - the
  registry, not the request, is the safety boundary. Add a component by
  editing `tools/registry.py` so the allowlist stays reviewable in a diff.

## Azure components are not live yet

`tools/registry.py` lists the intended Azure-backed components
(`azure-keycloak`, `azure-kcg`, etc.) with their target AKS
namespace/kind/name, but this server has no Azure control-plane credentials
configured. Calls against an Azure-backed component return a clear
"not configured" error - they never silently no-op or report false success.
Wiring the AKS side in is tracked against the agent build order in the
"Kendra Labs Multi-Cloud Deployment Plan" artifact §13.1: `azure-power-ops`
depends on `azure-cluster-ops` and `azure-core-services-ops` existing first.

## Two VPS SSH targets, not one

Verified live against the VPS (2026-10-14): the containers this server
manages are split across two rootless podman namespaces that cannot see
each other - `caipeadmin` owns the caipe-core stack, `root` owns the
KCG/Gemma/Korch stack. Each `ComponentSpec` in `tools/registry.py` names
which one it needs via `ssh_target`, and each target has its own
forced-command-restricted SSH key, installed the same way:

- `caipeadmin`: key in `/home/caipeadmin/.ssh/authorized_keys`, forced
  command `/usr/local/bin/power-ops-command`
- `root`: key in `/root/.ssh/authorized_keys`, forced command
  `/usr/local/bin/power-ops-root-command`

Both wrapper scripts only accept `podman start|stop|inspect` on the exact
container names each stack's registry entries use - no shell, no other
verbs, same pattern as the `kcg-deploy-command`/`jenkins` CI key already in
use on this VPS. Adding a component to the registry also means adding its
container name to the matching wrapper's allowlist on the VPS - the two
must agree, or the call is refused at the SSH layer even if the registry
allows it.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `POWER_OPS_SSH_HOST` | VPS host (shared by both targets) | (required for VPS actions) |
| `POWER_OPS_CAIPEADMIN_SSH_USER` | SSH user for the caipe-core stack | (required for those components) |
| `POWER_OPS_CAIPEADMIN_SSH_KEY_PATH` | Path to that target's private key | (required for those components) |
| `POWER_OPS_ROOT_SSH_USER` | SSH user for the KCG/Gemma/Korch stack | (required for those components) |
| `POWER_OPS_ROOT_SSH_KEY_PATH` | Path to that target's private key | (required for those components) |
| `POWER_OPS_SSH_PORT` | SSH port | `22` |
| `POWER_OPS_SSH_TIMEOUT` | Per-command timeout (seconds) | `20` |
| `MCP_MODE` | `STDIO` or `http` | `STDIO` |
| `MCP_HOST` | Bind host in `http` mode | `localhost` |
| `MCP_PORT` | Bind port in `http` mode | `8000` |
| `SERVER_NAME` | Display name for the MCP server | `PowerOps` |

## RBAC note

This server's blast radius is larger than `infra_ops`'s single-container
actions - a call here can take down a whole group at once. Run it with its
own `MCP_PDP_SCOPE` (see `mcp_agent_auth.middleware`), distinct from
`infra_ops`'s scope, so it can be granted to a narrower set of
users/agents independently.
