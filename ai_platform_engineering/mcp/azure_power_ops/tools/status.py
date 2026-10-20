# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Read-only component/group listing and status (Phase 1).
"""

from typing import Any, Dict

from tools.azure_runner import AzureConfigError, run_az_command
from tools.registry import discover_components, discover_groups, guarded_groups

_STATE_QUERY = {
    "aks": ["aks", "show", "--query", "powerState.code", "-o", "tsv"],
    "postgres": ["postgres", "flexible-server", "show", "--query", "state", "-o", "tsv"],
}


async def power_list_components() -> Dict[str, Any]:
    """
    List every customer Azure environment's AKS/Postgres components and
    groups this server can power on/off, with each component's current
    state. Empty if no environment has been applied yet - see
    envs/azure/customer-template/README.md.

    Returns:
        Dict with "components" (name -> kind/resource_group/name/state) and
        "groups" (customer -> member component list; every group is
        guarded, see registry.guarded_groups).
    """
    components_spec = discover_components()
    groups = discover_groups(components_spec)
    guarded = guarded_groups(groups)

    components: Dict[str, Any] = {}
    for name, spec in components_spec.items():
        try:
            argv = _STATE_QUERY[spec["kind"]] + ["-g", spec["resource_group"], "-n", spec["name"]]
            result = await run_az_command(argv)
            if result.get("success"):
                state = result["stdout"].strip()
            else:
                state = f"unreachable - {result.get('stderr') or result.get('error')}"
        except AzureConfigError as e:
            state = f"unknown - {e}"

        components[name] = {**spec, "state": state}

    return {
        "components": components,
        "groups": {
            name: {"members": members, "guarded": name in guarded}
            for name, members in groups.items()
        },
    }
