# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Discovers customer Azure environments from kendrainfra's envs/azure/
directory - same discovery mechanism as azure_power_ops/tools/registry.py,
but the unit here is a resource group, not an aks/postgres pair: cost is
tracked per resource group, not per individual resource.

A customer directory without both terraform.tfvars and backend.hcl (not
actually applied - see envs/azure/customer-template/README.md) is never
included, and a name that doesn't resolve is refused, not attempted.
customer-template itself is always skipped - it has neither file by design.

Naming convention (see envs/azure/customer-template/main.tf):
  resource group:  kendra-<customer>-rg

Set AZURE_COST_OPS_KENDRAINFRA_PATH to the local kendrainfra checkout this
server should read from.
"""

import os
import re
from pathlib import Path
from typing import Dict, Optional

ALL_SCOPE = "all"


def _envs_root() -> Optional[Path]:
    kendrainfra_path = os.getenv("AZURE_COST_OPS_KENDRAINFRA_PATH", "")
    if not kendrainfra_path:
        return None
    root = Path(kendrainfra_path) / "envs" / "azure"
    return root if root.is_dir() else None


def _parse_customer(tfvars_path: Path) -> Optional[str]:
    match = re.search(r'customer\s*=\s*"([^"]+)"', tfvars_path.read_text())
    return match.group(1) if match else None


def discover_resource_groups() -> Dict[str, str]:
    """
    Returns {customer: resource_group} for every customer env that has both
    a terraform.tfvars (names the customer) and a backend.hcl (actually
    applied). Empty if AZURE_COST_OPS_KENDRAINFRA_PATH isn't set, the path
    doesn't exist, or no environment has been applied yet - callers must
    treat an empty registry as "nothing to report on", not an error.
    """
    groups: Dict[str, str] = {}
    root = _envs_root()
    if root is None:
        return groups

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
        groups[customer] = f"kendra-{customer}-rg"
    return groups


def resolve_scope(scope: str):
    """
    Resolve a customer name or the "all" scope to a list of (customer,
    resource_group) pairs. Returns an empty list for anything not
    resolvable - callers must treat that as "refused", not "no-op success".
    """
    groups = discover_resource_groups()
    if scope == ALL_SCOPE:
        return list(groups.items())
    if scope in groups:
        return [(scope, groups[scope])]
    return []
