# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Discovers customer Azure environments from the infra repo's envs/azure/
directory and builds the allowlist of AKS/Postgres resources this server
may power on/off.

Unlike power_ops's registry (a fixed, hand-maintained dict - VPS containers
rarely change), this one is *derived* at call time from
envs/azure/*/terraform.tfvars, because customer environments come and go.
The registry is still the actual safety boundary, same as power_ops: a
customer directory without both terraform.tfvars and backend.hcl (not
actually applied - see envs/azure/customer-template/README.md) is never
included, and a name that doesn't resolve is refused, not attempted.
customer-template itself is always skipped - it has neither file by design.

Naming convention (see envs/azure/customer-template/main.tf):
  resource group:  kendra-<customer>-rg
  AKS cluster:     kendra-<customer>-aks
  Postgres server: kendra-<customer>-pg

Set AZURE_POWER_OPS_INFRA_REPO_PATH to the local infra repo checkout this
server should read from.
"""

import os
import re
from pathlib import Path
from typing import Dict, List, Optional, TypedDict

ALL_SCOPE = "all"


class ComponentSpec(TypedDict):
    kind: str  # "aks" | "postgres"
    resource_group: str
    name: str


def _envs_root() -> Optional[Path]:
    infra_repo_path = os.getenv("AZURE_POWER_OPS_INFRA_REPO_PATH", "")
    if not infra_repo_path:
        return None
    root = Path(infra_repo_path) / "envs" / "azure"
    return root if root.is_dir() else None


def _parse_customer(tfvars_path: Path) -> Optional[str]:
    match = re.search(r'customer\s*=\s*"([^"]+)"', tfvars_path.read_text())
    return match.group(1) if match else None


def discover_components() -> Dict[str, ComponentSpec]:
    """
    Returns the AKS/Postgres components for every customer env that has both
    a terraform.tfvars (names the customer) and a backend.hcl (actually
    applied). Empty if AZURE_POWER_OPS_INFRA_REPO_PATH isn't set, the path
    doesn't exist, or no environment has been applied yet - callers must
    treat an empty registry as "nothing to act on", not an error.
    """
    components: Dict[str, ComponentSpec] = {}
    root = _envs_root()
    if root is None:
        return components

    for env_dir in sorted(root.iterdir()):
        if not env_dir.is_dir() or env_dir.name == "customer-template":
            continue
        tfvars = env_dir / "terraform.tfvars"
        backend = env_dir / "backend.hcl"
        if not (tfvars.exists() and backend.exists()):
            continue
        customer = _parse_customer(tfvars)
        if not customer:
            continue
        rg = f"kendra-{customer}-rg"
        components[f"{customer}-aks"] = {
            "kind": "aks",
            "resource_group": rg,
            "name": f"kendra-{customer}-aks",
        }
        components[f"{customer}-postgres"] = {
            "kind": "postgres",
            "resource_group": rg,
            "name": f"kendra-{customer}-pg",
        }
    return components


def discover_groups(components: Dict[str, ComponentSpec]) -> Dict[str, List[str]]:
    """One group per customer - its aks + postgres components together."""
    groups: Dict[str, List[str]] = {}
    for key in components:
        customer = key.rsplit("-", 1)[0]
        groups.setdefault(customer, []).append(key)
    return groups


def guarded_groups(groups: Dict[str, List[str]]) -> frozenset:
    """
    Every customer group is guarded - taking down a customer's AKS/Postgres
    is a real production action, not a side-effect-free toggle. Unlike
    power_ops's GUARDED_GROUPS (a fixed subset), there is no ungated
    customer group here.
    """
    return frozenset(groups.keys())


def resolve_scope(scope: str) -> List[str]:
    """
    Resolve a component name, customer group name, or the "all" scope to a
    list of component names. Returns an empty list for anything not
    resolvable - callers must treat that as "refused", not "no-op success".
    """
    components = discover_components()
    if scope == ALL_SCOPE:
        return list(components.keys())
    groups = discover_groups(components)
    if scope in groups:
        return list(groups[scope])
    if scope in components:
        return [scope]
    return []
