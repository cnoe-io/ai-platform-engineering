# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Power on/off actions for Azure customer environments (AKS + Postgres).

Order matters and differs by direction - see this server's README:
  shutdown: aks stop, then postgres stop (stop the consumer before what it
            consumes, so nothing is left talking to Postgres when it stops)
  startup:  postgres start, then aks start (the dependency has to be ready
            before workloads reconnect to it on boot)
A scope's components are reordered to the correct sequence internally -
this is the one real behavioral difference from power_ops, which just loops
over a group's members with no ordering, since VPS containers there don't
have this dependency.

Access control: this server should run with MCP_PDP_ENABLED=true and its
own MCP_PDP_SCOPE (see mcp_agent_auth.middleware), distinct from both
infra_ops's and power_ops's scopes - stopping/starting a whole customer's
AKS+Postgres is a bigger, costlier, and slower-to-reverse action than
either.
"""

from typing import Any, Dict, List

from tools.azure_runner import AzureConfigError, run_az_command
from tools.registry import ALL_SCOPE, ComponentSpec, discover_components, discover_groups, guarded_groups, resolve_scope

_ACTION_VERB = {"power_on": "start", "power_off": "stop"}

# Shutdown stops AKS first; startup starts Postgres first - see module docstring.
_KIND_ORDER = {"power_off": ("aks", "postgres"), "power_on": ("postgres", "aks")}


def _ordered(action: str, names: List[str], components_spec: Dict[str, ComponentSpec]) -> List[str]:
    order = _KIND_ORDER[action]
    return sorted(names, key=lambda n: order.index(components_spec[n]["kind"]))


def _az_argv(verb: str, spec: ComponentSpec) -> List[str]:
    if spec["kind"] == "aks":
        return ["aks", verb, "-g", spec["resource_group"], "-n", spec["name"]]
    return ["postgres", "flexible-server", verb, "-g", spec["resource_group"], "-n", spec["name"]]


async def _apply(action: str, scope: str, confirm: bool) -> Dict[str, Any]:
    components_spec = discover_components()
    if not components_spec:
        return {
            "error": "No customer Azure environments registered - none applied yet "
                     "(see envs/azure/customer-template/README.md), or "
                     "AZURE_POWER_OPS_KENDRAINFRA_PATH is not set."
        }

    groups = discover_groups(components_spec)
    guarded = guarded_groups(groups)

    if scope == ALL_SCOPE and not confirm:
        return {"error": "scope \"all\" requires confirm=True"}
    if scope in guarded and not confirm:
        return {
            "error": f"{scope!r} is a guarded customer group (powers a whole "
                     "environment's AKS+Postgres) - requires confirm=True"
        }

    names = resolve_scope(scope)
    if not names:
        return {"error": f"Unknown component, group, or scope: {scope!r}"}

    verb = _ACTION_VERB[action]
    ordered_names = _ordered(action, names, components_spec)

    results: Dict[str, Any] = {}
    for name in ordered_names:
        spec = components_spec[name]
        try:
            results[name] = await run_az_command(_az_argv(verb, spec))
        except AzureConfigError as e:
            results[name] = {"success": False, "error": str(e)}

    return {"scope": scope, "action": action, "order": ordered_names, "results": results}


async def power_on(scope: str, confirm: bool = False) -> Dict[str, Any]:
    """
    Power on a named component, a customer group (its aks+postgres pair), or
    the "all" scope. Starts Postgres before AKS.

    Args:
        scope: A component name, a customer group name, or "all" (see
            power_list_components for the current registry).
        confirm: Must be True to act on "all" or any customer group (every
            customer group is guarded - see registry.guarded_groups).
            Ignored for an individual component.

    Returns:
        Dict with the per-component result and the order actions ran in, or
        an error if scope didn't resolve, confirm was required and missing,
        or no environments are registered.
    """
    return await _apply("power_on", scope, confirm)


async def power_off(scope: str, confirm: bool = False) -> Dict[str, Any]:
    """
    Power off a named component, a customer group (its aks+postgres pair),
    or the "all" scope. Stops AKS before Postgres.

    Args:
        scope: A component name, a customer group name, or "all" (see
            power_list_components for the current registry).
        confirm: Must be True to act on "all" or any customer group (every
            customer group is guarded - see registry.guarded_groups).
            Ignored for an individual component.

    Returns:
        Dict with the per-component result and the order actions ran in, or
        an error if scope didn't resolve, confirm was required and missing,
        or no environments are registered.
    """
    return await _apply("power_off", scope, confirm)
