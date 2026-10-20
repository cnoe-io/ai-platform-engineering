# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Fixed allowlist of components and groups this server is allowed to power
on/off, and the backend each one maps to. This registry - not the request
arguments - is the actual safety boundary: a component or group name that
isn't listed here is simply refused, never passed through to a backend call.

Container names and ssh_target below were verified live against the VPS
(2026-10-14), not assumed: `podman ps` run as each account showed the VPS
actually splits its rootless podman containers across two namespaces that
cannot see each other -

  caipeadmin: the caipe-core stack (caipe-ui, keycloak, openfga, ...)
  root:       the KCG / Gemma / Korch stack (kcg-backend, gemma-llm-nginx, ...)

so a component's ssh_target says which forced-command-restricted key this
server needs to reach it - see this server's README for the two wrapper
scripts and where each key is installed.

Backends:
- "vps": a podman container on the VPS, switched via the same stop/start
  primitive infra_ops already exposes for its own namespace (tools/power.py
  shells out over SSH to the component's ssh_target).
- "azure": an AKS Deployment/StatefulSet, scaled to 0 replicas and back.
  NOT YET IMPLEMENTED - no Azure control-plane credentials are configured
  for this server yet. Listed here so the registry already reflects the
  target shape; tools/power.py returns a clear "not configured" error for
  any azure-backed entry rather than silently doing nothing.

Edit this file to add a component. Do not accept component/group names from
configuration or environment variables - the allowlist must be reviewable
in a diff, the same way infra_ops's ALLOWED_ACTIONS is. Adding a VPS
component also requires adding its container name to the matching wrapper
script's ALLOWED_CONTAINERS on the VPS - the registry alone does not grant
reach; the two must agree.
"""

from typing import Dict, List, TypedDict


class ComponentSpec(TypedDict):
    backend: str      # "vps" | "azure"
    container: str    # podman container name (vps) or "namespace/kind/name" (azure)
    ssh_target: str   # "caipeadmin" | "root" | "" (unused for azure)


# Individual components. Keys are the names callers pass to power_on/power_off.
COMPONENTS: Dict[str, ComponentSpec] = {
    # --- VPS: caipe-core stack, owned by caipeadmin ---
    "caipe-ui": {"backend": "vps", "container": "caipe-ui", "ssh_target": "caipeadmin"},
    "dynamic-agents": {"backend": "vps", "container": "dynamic-agents", "ssh_target": "caipeadmin"},
    "keycloak": {"backend": "vps", "container": "keycloak", "ssh_target": "caipeadmin"},
    "openfga": {"backend": "vps", "container": "openfga", "ssh_target": "caipeadmin"},

    # --- VPS: KCG / Gemma / Korch stack, owned by root ---
    "gemma-llm-nginx": {"backend": "vps", "container": "gemma-llm-nginx", "ssh_target": "root"},
    "kcg-backend": {"backend": "vps", "container": "kcg-backend", "ssh_target": "root"},
    "kcg-dashboard": {"backend": "vps", "container": "kcg-dashboard", "ssh_target": "root"},
    "kcg-redis": {"backend": "vps", "container": "kcg-redis", "ssh_target": "root"},
    "kcg-clickhouse": {"backend": "vps", "container": "kcg-clickhouse", "ssh_target": "root"},
    "korch-api": {"backend": "vps", "container": "korch-api", "ssh_target": "root"},
    "korch-keycloak": {"backend": "vps", "container": "korch-keycloak", "ssh_target": "root"},
    "korch-worker": {"backend": "vps", "container": "korch-worker", "ssh_target": "root"},

    # --- Azure (target shape only - backend not connected yet) ---
    "azure-keycloak": {"backend": "azure", "container": "core/deployment/keycloak", "ssh_target": ""},
    "azure-openfga": {"backend": "azure", "container": "core/deployment/openfga", "ssh_target": ""},
    "azure-kiam": {"backend": "azure", "container": "core/deployment/kiam", "ssh_target": ""},
    "azure-kcg": {"backend": "azure", "container": "customer/deployment/kcg", "ssh_target": ""},
    "azure-korchestrator": {"backend": "azure", "container": "customer/deployment/korchestrator", "ssh_target": ""},
}

# Named groups. A group expands to the component list below it - never to
# "everything currently running", so adding a new component never silently
# joins an existing group.
GROUPS: Dict[str, List[str]] = {
    "caipe-core": ["caipe-ui", "dynamic-agents", "keycloak", "openfga"],
    "kcg-prod": ["kcg-backend", "kcg-dashboard", "kcg-redis", "kcg-clickhouse"],
    "korch-prod": ["korch-api", "korch-keycloak", "korch-worker"],
    "azure-core": ["azure-keycloak", "azure-openfga", "azure-kiam"],
    "azure-customer-demo": ["azure-kcg", "azure-korchestrator"],
}

# Groups that power other things down as a side effect and therefore require
# the caller to pass confirm=True even when the group itself is in GROUPS.
# "caipe-core" and "azure-core" are here because taking down Keycloak/OpenFGA
# takes every dependent product namespace down with it - see artifact
# "Kendra Labs Multi-Cloud Deployment Plan" §13.1 for the reasoning.
GUARDED_GROUPS = frozenset({"caipe-core", "azure-core"})

# The special "all" scope must be requested explicitly - it is never a group
# name a caller can discover by accident, and it always requires confirm=True.
ALL_SCOPE = "all"


def resolve_scope(name: str) -> List[str]:
    """
    Resolve a component name, group name, or the "all" scope to a list of
    component names. Returns an empty list for anything not in the registry
    - callers must treat that as "refused", not "no-op success".
    """
    if name == ALL_SCOPE:
        return list(COMPONENTS.keys())
    if name in GROUPS:
        return list(GROUPS[name])
    if name in COMPONENTS:
        return [name]
    return []
