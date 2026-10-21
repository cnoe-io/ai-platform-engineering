# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Discovers customer Azure environments from the infra repo's envs/azure/
directory - same discovery mechanism as azure_power_ops/tools/registry.py
and azure_cost_ops/tools/registry.py. The unit here is one AKS cluster per
customer, since cluster-ops only ever acts on the cluster resource itself
(status, node pools), never on Postgres.

A customer directory without both terraform.tfvars and backend.hcl (not
actually applied - see envs/azure/customer-template/README.md) is never
included, and a name that doesn't resolve is refused, not attempted.
customer-template itself is always skipped - it has neither file by design.

Naming convention (see envs/azure/customer-template/main.tf):
  resource group:  kendra-<customer>-rg
  AKS cluster:     kendra-<customer>-aks

Set AZURE_CLUSTER_OPS_INFRA_REPO_PATH to the local infra repo checkout this
server should read from.
"""

import os
import re
from pathlib import Path
from typing import Dict, Optional, TypedDict

ALL_SCOPE = "all"


class ClusterSpec(TypedDict):
    resource_group: str
    cluster_name: str


def _envs_root() -> Optional[Path]:
    infra_repo_path = os.getenv("AZURE_CLUSTER_OPS_INFRA_REPO_PATH", "")
    if not infra_repo_path:
        return None
    root = Path(infra_repo_path) / "envs" / "azure"
    return root if root.is_dir() else None


def _parse_customer(tfvars_path: Path) -> Optional[str]:
    match = re.search(r'customer\s*=\s*"([^"]+)"', tfvars_path.read_text())
    return match.group(1) if match else None


def discover_clusters() -> Dict[str, ClusterSpec]:
    """
    Returns {customer: ClusterSpec} for every customer env that has both a
    terraform.tfvars (names the customer) and a backend.hcl (actually
    applied). Empty if AZURE_CLUSTER_OPS_INFRA_REPO_PATH isn't set, the path
    doesn't exist, or no environment has been applied yet - callers must
    treat an empty registry as "nothing to report on", not an error.
    """
    clusters: Dict[str, ClusterSpec] = {}
    root = _envs_root()
    if root is None:
        return clusters

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
        clusters[customer] = {
            "resource_group": f"kendra-{customer}-rg",
            "cluster_name": f"kendra-{customer}-aks",
        }
    return clusters


def resolve_scope(scope: str):
    """
    Resolve a customer name or the "all" scope to a list of (customer,
    ClusterSpec) pairs. Returns an empty list for anything not resolvable -
    callers must treat that as "refused", not "no-op success".
    """
    clusters = discover_clusters()
    if scope == ALL_SCOPE:
        return list(clusters.items())
    if scope in clusters:
        return [(scope, clusters[scope])]
    return []
