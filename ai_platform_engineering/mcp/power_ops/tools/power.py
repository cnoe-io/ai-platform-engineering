# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Power on/off actions (Phase 2).

Scope is deliberately narrow: a caller names a component, a group, or the
explicit "all" scope (see tools/registry.py); this module resolves that
name against the fixed registry and acts only on what resolves. A name that
isn't in the registry is refused, not attempted. Guarded groups and the
"all" scope require confirm=True - see registry.GUARDED_GROUPS.

Access control: this server should run with MCP_PDP_ENABLED=true and its
own MCP_PDP_SCOPE (see mcp_agent_auth.middleware), distinct from infra_ops's
scope - this tool has broader blast radius (whole components/groups, not a
single named container) and should be grantable independently.

Azure-backed components are listed in the registry for target shape but are
not wired to a control plane yet - calls against them return a clear error
instead of silently no-op'ing or faking success.
"""

from typing import Any, Dict

from tools.registry import ALL_SCOPE, GUARDED_GROUPS, resolve_scope, COMPONENTS
from tools.ssh_runner import PowerOpsConfigError, run_remote_command

_ACTION_TO_PODMAN = {"power_on": "start", "power_off": "stop"}


async def _apply(action: str, scope: str, confirm: bool) -> Dict[str, Any]:
    if scope == ALL_SCOPE and not confirm:
        return {"error": "scope \"all\" requires confirm=True"}
    if scope in GUARDED_GROUPS and not confirm:
        return {
            "error": f"{scope!r} is a guarded group (powering it down takes "
                     "dependent components with it) - requires confirm=True"
        }

    names = resolve_scope(scope)
    if not names:
        return {"error": f"Unknown component, group, or scope: {scope!r}"}

    results: Dict[str, Any] = {}
    for name in names:
        spec = COMPONENTS[name]
        if spec["backend"] == "vps":
            try:
                results[name] = await run_remote_command(
                    spec["ssh_target"],
                    ["podman", _ACTION_TO_PODMAN[action], spec["container"]],
                )
            except PowerOpsConfigError as e:
                results[name] = {"success": False, "error": str(e)}
        else:
            results[name] = {
                "success": False,
                "error": "azure control plane not configured for this server yet "
                         f"(target: {spec['container']})",
            }

    return {"scope": scope, "action": action, "results": results}


async def power_on(scope: str, confirm: bool = False) -> Dict[str, Any]:
    """
    Power on a named component, group, or the "all" scope.

    Args:
        scope: A component name, a group name, or "all" (see
            power_list_components for the current registry).
        confirm: Must be True to act on "all" or a guarded group
            (see registry.GUARDED_GROUPS). Ignored for an individual
            component or an unguarded group.

    Returns:
        Dict with the per-component result, or an error if scope didn't
        resolve or confirm was required and missing.
    """
    return await _apply("power_on", scope, confirm)


async def power_off(scope: str, confirm: bool = False) -> Dict[str, Any]:
    """
    Power off a named component, group, or the "all" scope.

    Args:
        scope: A component name, a group name, or "all" (see
            power_list_components for the current registry).
        confirm: Must be True to act on "all" or a guarded group
            (see registry.GUARDED_GROUPS). Ignored for an individual
            component or an unguarded group.

    Returns:
        Dict with the per-component result, or an error if scope didn't
        resolve or confirm was required and missing.
    """
    return await _apply("power_off", scope, confirm)
