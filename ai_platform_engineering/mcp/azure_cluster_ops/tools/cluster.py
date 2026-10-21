# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Cluster visibility and node-pool scaling tools for customer AKS clusters.

This is a narrower surface than azure_power_ops: it never powers a cluster
on/off (that's azure_power_ops's job) and never upgrades Kubernetes
versions (az aks upgrade is a higher-risk, longer-running operation left
out of this first pass - see README.md's "Known limitations"). It only
reports cluster/node-pool state and resizes a node pool's fixed node count.

cluster_scale_node_pool only works on a node pool that has autoscaling
disabled (enable_auto_scaling=false in Terraform) - `az aks nodepool scale`
refuses to act on an autoscale-enabled pool, and that refusal is surfaced
to the caller verbatim rather than silently reinterpreted as a min/max
change.
"""

import json
import logging
from typing import Any, Dict

from .azure_runner import AzureConfigError, run_az_command
from .registry import resolve_scope

logger = logging.getLogger(__name__)


def _parse_json(raw_stdout: str):
    try:
        return json.loads(raw_stdout) if raw_stdout.strip() else None
    except json.JSONDecodeError:
        return None


def _summarize_pool(pool: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": pool.get("name"),
        "vm_size": pool.get("vmSize"),
        "node_count": pool.get("count"),
        "autoscaling_enabled": pool.get("enableAutoScaling"),
        "min_count": pool.get("minCount"),
        "max_count": pool.get("maxCount"),
        "provisioning_state": pool.get("provisioningState"),
    }


async def cluster_get_status(scope: str) -> dict:
    """
    Get cluster status (provisioning state, Kubernetes version, power state,
    node pools) for a customer's AKS cluster, or every registered customer
    when scope="all".

    Args:
        scope: A customer name (e.g. "acme"), as registered under
            envs/azure/<customer>/, or "all" for every registered customer.
    """
    pairs = resolve_scope(scope)
    if not pairs:
        return {"error": f"Unknown customer or scope: {scope!r}. No registered Azure environment matches."}

    clusters: Dict[str, Any] = {}
    for customer, spec in pairs:
        try:
            result = await run_az_command([
                "aks", "show", "-g", spec["resource_group"], "-n", spec["cluster_name"],
            ])
        except AzureConfigError as e:
            return {"scope": scope, "error": str(e)}

        if not result.get("success"):
            clusters[customer] = {"error": result.get("stderr") or result.get("error")}
            continue

        data = _parse_json(result.get("stdout", ""))
        if data is None:
            clusters[customer] = {"error": "Could not parse az aks show output"}
            continue

        clusters[customer] = {
            "cluster_name": spec["cluster_name"],
            "resource_group": spec["resource_group"],
            "provisioning_state": data.get("provisioningState"),
            "kubernetes_version": data.get("currentKubernetesVersion"),
            "power_state": (data.get("powerState") or {}).get("code"),
            "node_pools": [_summarize_pool(p) for p in data.get("agentPoolProfiles", [])],
        }

    return {"scope": scope, "clusters": clusters}


async def cluster_list_node_pools(scope: str) -> dict:
    """
    List node pools (name, size, count, autoscale bounds) for a customer's
    AKS cluster, or every registered customer when scope="all".

    Args:
        scope: A customer name or "all".
    """
    pairs = resolve_scope(scope)
    if not pairs:
        return {"error": f"Unknown customer or scope: {scope!r}. No registered Azure environment matches."}

    node_pools: Dict[str, Any] = {}
    for customer, spec in pairs:
        try:
            result = await run_az_command([
                "aks", "nodepool", "list", "-g", spec["resource_group"], "--cluster-name", spec["cluster_name"],
            ])
        except AzureConfigError as e:
            return {"scope": scope, "error": str(e)}

        if not result.get("success"):
            node_pools[customer] = {"error": result.get("stderr") or result.get("error")}
            continue

        data = _parse_json(result.get("stdout", ""))
        if data is None:
            node_pools[customer] = {"error": "Could not parse az aks nodepool list output"}
            continue

        node_pools[customer] = [_summarize_pool(p) for p in data]

    return {"scope": scope, "node_pools": node_pools}


async def cluster_scale_node_pool(scope: str, pool_name: str, node_count: int, confirm: bool = False) -> dict:
    """
    Set a fixed node count on one node pool of a customer's AKS cluster.
    Always guarded - requires confirm=True regardless of scope, same guard
    discipline as azure_power_ops's power_on/power_off. Only works on a
    pool with autoscaling disabled; az refuses otherwise and that refusal
    is returned as-is.

    Args:
        scope: A single customer name - "all" is refused for this tool,
            since scaling every customer's cluster to the same node count
            in one call is never the intended action.
        pool_name: The node pool to scale (e.g. "default", "user").
        node_count: The fixed node count to set.
        confirm: Must be True to actually scale the pool.
    """
    if scope == "all":
        return {"error": "scope \"all\" is not supported for cluster_scale_node_pool - scale one customer's pool at a time"}
    if not confirm:
        return {"error": "cluster_scale_node_pool always requires confirm=True - it changes running cluster capacity"}

    pairs = resolve_scope(scope)
    if not pairs:
        return {"error": f"Unknown customer: {scope!r}. No registered Azure environment matches."}
    _, spec = pairs[0]

    try:
        result = await run_az_command([
            "aks", "nodepool", "scale",
            "-g", spec["resource_group"],
            "--cluster-name", spec["cluster_name"],
            "-n", pool_name,
            "--node-count", str(node_count),
        ])
    except AzureConfigError as e:
        return {"scope": scope, "error": str(e)}

    return {
        "scope": scope,
        "cluster_name": spec["cluster_name"],
        "pool_name": pool_name,
        "node_count": node_count,
        "result": result,
    }
