# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Read-only component/group listing and status (Phase 1).
"""

from typing import Any, Dict

from tools.registry import COMPONENTS, GROUPS, GUARDED_GROUPS
from tools.ssh_runner import PowerOpsConfigError, run_remote_command


async def power_list_components() -> Dict[str, Any]:
    """
    List every component and group this server can power on/off, and each
    VPS-backed component's current container state. Azure-backed components
    report "unknown" until this server's Azure control plane is configured.

    Returns:
        Dict with "components" (name -> backend/container/ssh_target/state)
        and "groups" (name -> member component list, flagging any guarded).
    """
    components: Dict[str, Any] = {}

    for name, spec in COMPONENTS.items():
        if spec["backend"] == "vps":
            try:
                result = await run_remote_command(
                    spec["ssh_target"],
                    ["podman", "inspect", "--format", "{{.State.Status}}", spec["container"]],
                )
                state = result["stdout"].strip() if result.get("success") else "unreachable"
            except PowerOpsConfigError:
                state = f"unknown - POWER_OPS_{spec['ssh_target'].upper()}_SSH_* not configured"
        else:
            state = "unknown - azure control plane not yet configured"

        components[name] = {
            "backend": spec["backend"],
            "container": spec["container"],
            "ssh_target": spec["ssh_target"],
            "state": state,
        }

    groups = {
        name: {"members": members, "guarded": name in GUARDED_GROUPS}
        for name, members in GROUPS.items()
    }

    return {"components": components, "groups": groups}
