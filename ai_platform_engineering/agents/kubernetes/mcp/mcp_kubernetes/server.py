# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Kubernetes MCP Server - Provides tools for managing Kubernetes cluster resources."""

import os
import json
from dotenv import load_dotenv
from fastmcp import FastMCP
from kubernetes import client, config
from kubernetes.client.rest import ApiException

load_dotenv()

# Initialize FastMCP server
mcp = FastMCP("Kubernetes MCP Server")

# Load Kubernetes configuration
try:
    config.load_incluster_config()
except config.ConfigException:
    config.load_kube_config()


def get_core_api() -> client.CoreV1Api:
    """Get Kubernetes Core API client."""
    return client.CoreV1Api()


def get_apps_api() -> client.AppsV1Api:
    """Get Kubernetes Apps API client."""
    return client.AppsV1Api()


def get_batch_api() -> client.BatchV1Api:
    """Get Kubernetes Batch API client."""
    return client.BatchV1Api()


def get_custom_api() -> client.CustomObjectsApi:
    """Get Kubernetes Custom Objects API client."""
    return client.CustomObjectsApi()


# ============================================
# NAMESPACE TOOLS
# ============================================

@mcp.tool()
def list_namespaces() -> dict:
    """List all namespaces in the cluster."""
    api = get_core_api()
    namespaces = api.list_namespace()
    return {
        "count": len(namespaces.items),
        "namespaces": [
            {
                "name": ns.metadata.name,
                "status": ns.status.phase,
                "labels": ns.metadata.labels or {},
                "creation_time": ns.metadata.creation_timestamp.isoformat() if ns.metadata.creation_timestamp else None
            }
            for ns in namespaces.items
        ]
    }


@mcp.tool()
def get_namespace(name: str) -> dict:
    """Get details of a specific namespace.

    Args:
        name: Name of the namespace
    """
    api = get_core_api()
    ns = api.read_namespace(name)
    return {
        "name": ns.metadata.name,
        "status": ns.status.phase,
        "labels": ns.metadata.labels or {},
        "annotations": ns.metadata.annotations or {},
        "creation_time": ns.metadata.creation_timestamp.isoformat() if ns.metadata.creation_timestamp else None
    }


# ============================================
# POD TOOLS
# ============================================

@mcp.tool()
def list_pods(namespace: str = "default", label_selector: str = None) -> dict:
    """List all pods in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
        label_selector: Optional label selector (e.g., "app=nginx")
    """
    api = get_core_api()
    kwargs = {"namespace": namespace}
    if label_selector:
        kwargs["label_selector"] = label_selector

    pods = api.list_namespaced_pod(**kwargs)
    return {
        "count": len(pods.items),
        "namespace": namespace,
        "pods": [
            {
                "name": pod.metadata.name,
                "namespace": pod.metadata.namespace,
                "status": pod.status.phase,
                "ready": _get_pod_ready_status(pod),
                "restarts": _get_pod_restarts(pod),
                "node": pod.spec.node_name,
                "ip": pod.status.pod_ip,
                "containers": [c.name for c in pod.spec.containers],
                "creation_time": pod.metadata.creation_timestamp.isoformat() if pod.metadata.creation_timestamp else None
            }
            for pod in pods.items
        ]
    }


@mcp.tool()
def list_pods_all_namespaces(label_selector: str = None) -> dict:
    """List all pods across all namespaces.

    Args:
        label_selector: Optional label selector (e.g., "app=nginx")
    """
    api = get_core_api()
    kwargs = {}
    if label_selector:
        kwargs["label_selector"] = label_selector

    pods = api.list_pod_for_all_namespaces(**kwargs)
    return {
        "count": len(pods.items),
        "pods": [
            {
                "name": pod.metadata.name,
                "namespace": pod.metadata.namespace,
                "status": pod.status.phase,
                "ready": _get_pod_ready_status(pod),
                "restarts": _get_pod_restarts(pod),
                "node": pod.spec.node_name,
                "ip": pod.status.pod_ip
            }
            for pod in pods.items
        ]
    }


@mcp.tool()
def get_pod(name: str, namespace: str = "default") -> dict:
    """Get detailed information about a specific pod.

    Args:
        name: Name of the pod
        namespace: Kubernetes namespace (default: default)
    """
    api = get_core_api()
    pod = api.read_namespaced_pod(name, namespace)

    containers_status = []
    if pod.status.container_statuses:
        for cs in pod.status.container_statuses:
            status = {
                "name": cs.name,
                "ready": cs.ready,
                "restart_count": cs.restart_count,
                "image": cs.image,
            }
            if cs.state.running:
                status["state"] = "running"
                status["started_at"] = cs.state.running.started_at.isoformat() if cs.state.running.started_at else None
            elif cs.state.waiting:
                status["state"] = "waiting"
                status["reason"] = cs.state.waiting.reason
            elif cs.state.terminated:
                status["state"] = "terminated"
                status["reason"] = cs.state.terminated.reason
            containers_status.append(status)

    return {
        "name": pod.metadata.name,
        "namespace": pod.metadata.namespace,
        "status": pod.status.phase,
        "conditions": [
            {"type": c.type, "status": c.status, "reason": c.reason}
            for c in (pod.status.conditions or [])
        ],
        "node": pod.spec.node_name,
        "ip": pod.status.pod_ip,
        "host_ip": pod.status.host_ip,
        "containers": containers_status,
        "labels": pod.metadata.labels or {},
        "annotations": pod.metadata.annotations or {},
        "creation_time": pod.metadata.creation_timestamp.isoformat() if pod.metadata.creation_timestamp else None
    }


@mcp.tool()
def get_pod_logs(name: str, namespace: str = "default", container: str = None, tail_lines: int = 100, previous: bool = False) -> dict:
    """Get logs from a pod.

    Args:
        name: Name of the pod
        namespace: Kubernetes namespace (default: default)
        container: Container name (required if pod has multiple containers)
        tail_lines: Number of lines from the end of the logs (default: 100)
        previous: Get logs from previous container instance (default: False)
    """
    api = get_core_api()
    kwargs = {
        "name": name,
        "namespace": namespace,
        "tail_lines": tail_lines,
        "previous": previous
    }
    if container:
        kwargs["container"] = container

    try:
        logs = api.read_namespaced_pod_log(**kwargs)
        return {
            "pod": name,
            "namespace": namespace,
            "container": container,
            "tail_lines": tail_lines,
            "previous": previous,
            "logs": logs
        }
    except ApiException as e:
        return {
            "pod": name,
            "namespace": namespace,
            "error": str(e),
            "logs": None
        }


@mcp.tool()
def delete_pod(name: str, namespace: str = "default") -> dict:
    """Delete a pod.

    Args:
        name: Name of the pod
        namespace: Kubernetes namespace (default: default)
    """
    api = get_core_api()
    api.delete_namespaced_pod(name, namespace)
    return {
        "deleted": True,
        "pod": name,
        "namespace": namespace
    }


# ============================================
# DEPLOYMENT TOOLS
# ============================================

@mcp.tool()
def list_deployments(namespace: str = "default") -> dict:
    """List all deployments in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_apps_api()
    deployments = api.list_namespaced_deployment(namespace)
    return {
        "count": len(deployments.items),
        "namespace": namespace,
        "deployments": [
            {
                "name": dep.metadata.name,
                "replicas": dep.spec.replicas,
                "ready_replicas": dep.status.ready_replicas or 0,
                "available_replicas": dep.status.available_replicas or 0,
                "updated_replicas": dep.status.updated_replicas or 0,
                "strategy": dep.spec.strategy.type if dep.spec.strategy else None,
                "creation_time": dep.metadata.creation_timestamp.isoformat() if dep.metadata.creation_timestamp else None
            }
            for dep in deployments.items
        ]
    }


@mcp.tool()
def get_deployment(name: str, namespace: str = "default") -> dict:
    """Get detailed information about a specific deployment.

    Args:
        name: Name of the deployment
        namespace: Kubernetes namespace (default: default)
    """
    api = get_apps_api()
    dep = api.read_namespaced_deployment(name, namespace)
    return {
        "name": dep.metadata.name,
        "namespace": dep.metadata.namespace,
        "replicas": dep.spec.replicas,
        "ready_replicas": dep.status.ready_replicas or 0,
        "available_replicas": dep.status.available_replicas or 0,
        "updated_replicas": dep.status.updated_replicas or 0,
        "strategy": dep.spec.strategy.type if dep.spec.strategy else None,
        "selector": dep.spec.selector.match_labels if dep.spec.selector else {},
        "containers": [
            {
                "name": c.name,
                "image": c.image,
                "ports": [{"name": p.name, "port": p.container_port} for p in (c.ports or [])]
            }
            for c in dep.spec.template.spec.containers
        ],
        "conditions": [
            {"type": c.type, "status": c.status, "reason": c.reason, "message": c.message}
            for c in (dep.status.conditions or [])
        ],
        "labels": dep.metadata.labels or {},
        "annotations": dep.metadata.annotations or {},
        "creation_time": dep.metadata.creation_timestamp.isoformat() if dep.metadata.creation_timestamp else None
    }


@mcp.tool()
def scale_deployment(name: str, replicas: int, namespace: str = "default") -> dict:
    """Scale a deployment to a specific number of replicas.

    Args:
        name: Name of the deployment
        replicas: Desired number of replicas
        namespace: Kubernetes namespace (default: default)
    """
    api = get_apps_api()
    body = {"spec": {"replicas": replicas}}
    result = api.patch_namespaced_deployment_scale(name, namespace, body)
    return {
        "deployment": name,
        "namespace": namespace,
        "replicas": replicas,
        "scaled": True
    }


@mcp.tool()
def restart_deployment(name: str, namespace: str = "default") -> dict:
    """Restart a deployment by triggering a rolling restart.

    Args:
        name: Name of the deployment
        namespace: Kubernetes namespace (default: default)
    """
    import datetime
    api = get_apps_api()

    # Patch the deployment with a restart annotation
    now = datetime.datetime.utcnow().isoformat() + "Z"
    body = {
        "spec": {
            "template": {
                "metadata": {
                    "annotations": {
                        "kubectl.kubernetes.io/restartedAt": now
                    }
                }
            }
        }
    }
    api.patch_namespaced_deployment(name, namespace, body)
    return {
        "deployment": name,
        "namespace": namespace,
        "restarted": True,
        "restart_time": now
    }


# ============================================
# SERVICE TOOLS
# ============================================

@mcp.tool()
def list_services(namespace: str = "default") -> dict:
    """List all services in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_core_api()
    services = api.list_namespaced_service(namespace)
    return {
        "count": len(services.items),
        "namespace": namespace,
        "services": [
            {
                "name": svc.metadata.name,
                "type": svc.spec.type,
                "cluster_ip": svc.spec.cluster_ip,
                "external_ips": svc.spec.external_i_ps,
                "ports": [
                    {"name": p.name, "port": p.port, "target_port": p.target_port, "protocol": p.protocol}
                    for p in (svc.spec.ports or [])
                ],
                "selector": svc.spec.selector or {}
            }
            for svc in services.items
        ]
    }


@mcp.tool()
def get_service(name: str, namespace: str = "default") -> dict:
    """Get detailed information about a specific service.

    Args:
        name: Name of the service
        namespace: Kubernetes namespace (default: default)
    """
    api = get_core_api()
    svc = api.read_namespaced_service(name, namespace)
    return {
        "name": svc.metadata.name,
        "namespace": svc.metadata.namespace,
        "type": svc.spec.type,
        "cluster_ip": svc.spec.cluster_ip,
        "external_ips": svc.spec.external_i_ps,
        "load_balancer_ip": svc.status.load_balancer.ingress[0].ip if svc.status.load_balancer and svc.status.load_balancer.ingress else None,
        "ports": [
            {"name": p.name, "port": p.port, "target_port": p.target_port, "node_port": p.node_port, "protocol": p.protocol}
            for p in (svc.spec.ports or [])
        ],
        "selector": svc.spec.selector or {},
        "labels": svc.metadata.labels or {},
        "annotations": svc.metadata.annotations or {},
        "creation_time": svc.metadata.creation_timestamp.isoformat() if svc.metadata.creation_timestamp else None
    }


# ============================================
# NODE TOOLS
# ============================================

@mcp.tool()
def list_nodes() -> dict:
    """List all nodes in the cluster."""
    api = get_core_api()
    nodes = api.list_node()
    return {
        "count": len(nodes.items),
        "nodes": [
            {
                "name": node.metadata.name,
                "status": _get_node_status(node),
                "roles": _get_node_roles(node),
                "taints": [{"key": t.key, "effect": t.effect} for t in (node.spec.taints or [])],
                "capacity": {
                    "cpu": node.status.capacity.get("cpu"),
                    "memory": node.status.capacity.get("memory"),
                    "pods": node.status.capacity.get("pods")
                },
                "allocatable": {
                    "cpu": node.status.allocatable.get("cpu"),
                    "memory": node.status.allocatable.get("memory"),
                    "pods": node.status.allocatable.get("pods")
                },
                "kernel_version": node.status.node_info.kernel_version if node.status.node_info else None,
                "os_image": node.status.node_info.os_image if node.status.node_info else None,
                "container_runtime": node.status.node_info.container_runtime_version if node.status.node_info else None,
                "kubelet_version": node.status.node_info.kubelet_version if node.status.node_info else None
            }
            for node in nodes.items
        ]
    }


@mcp.tool()
def get_node(name: str) -> dict:
    """Get detailed information about a specific node.

    Args:
        name: Name of the node
    """
    api = get_core_api()
    node = api.read_node(name)
    return {
        "name": node.metadata.name,
        "status": _get_node_status(node),
        "roles": _get_node_roles(node),
        "labels": node.metadata.labels or {},
        "annotations": node.metadata.annotations or {},
        "taints": [{"key": t.key, "value": t.value, "effect": t.effect} for t in (node.spec.taints or [])],
        "conditions": [
            {"type": c.type, "status": c.status, "reason": c.reason, "message": c.message}
            for c in (node.status.conditions or [])
        ],
        "capacity": dict(node.status.capacity) if node.status.capacity else {},
        "allocatable": dict(node.status.allocatable) if node.status.allocatable else {},
        "node_info": {
            "kernel_version": node.status.node_info.kernel_version,
            "os_image": node.status.node_info.os_image,
            "container_runtime": node.status.node_info.container_runtime_version,
            "kubelet_version": node.status.node_info.kubelet_version,
            "architecture": node.status.node_info.architecture
        } if node.status.node_info else {},
        "addresses": [{"type": a.type, "address": a.address} for a in (node.status.addresses or [])],
        "creation_time": node.metadata.creation_timestamp.isoformat() if node.metadata.creation_timestamp else None
    }


# ============================================
# EVENT TOOLS
# ============================================

@mcp.tool()
def list_events(namespace: str = "default", field_selector: str = None, limit: int = 50) -> dict:
    """List events in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
        field_selector: Optional field selector (e.g., "involvedObject.name=my-pod")
        limit: Maximum number of events to return (default: 50)
    """
    api = get_core_api()
    kwargs = {"namespace": namespace, "limit": limit}
    if field_selector:
        kwargs["field_selector"] = field_selector

    events = api.list_namespaced_event(**kwargs)
    return {
        "count": len(events.items),
        "namespace": namespace,
        "events": [
            {
                "type": event.type,
                "reason": event.reason,
                "message": event.message,
                "involved_object": {
                    "kind": event.involved_object.kind,
                    "name": event.involved_object.name,
                    "namespace": event.involved_object.namespace
                },
                "count": event.count,
                "first_timestamp": event.first_timestamp.isoformat() if event.first_timestamp else None,
                "last_timestamp": event.last_timestamp.isoformat() if event.last_timestamp else None
            }
            for event in sorted(events.items, key=lambda e: e.last_timestamp or e.first_timestamp or "", reverse=True)
        ]
    }


@mcp.tool()
def get_pod_events(pod_name: str, namespace: str = "default") -> dict:
    """Get events related to a specific pod.

    Args:
        pod_name: Name of the pod
        namespace: Kubernetes namespace (default: default)
    """
    return list_events(
        namespace=namespace,
        field_selector=f"involvedObject.name={pod_name},involvedObject.kind=Pod"
    )


# ============================================
# CONFIGMAP AND SECRET TOOLS
# ============================================

@mcp.tool()
def list_configmaps(namespace: str = "default") -> dict:
    """List all ConfigMaps in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_core_api()
    cms = api.list_namespaced_config_map(namespace)
    return {
        "count": len(cms.items),
        "namespace": namespace,
        "configmaps": [
            {
                "name": cm.metadata.name,
                "data_keys": list(cm.data.keys()) if cm.data else [],
                "creation_time": cm.metadata.creation_timestamp.isoformat() if cm.metadata.creation_timestamp else None
            }
            for cm in cms.items
        ]
    }


@mcp.tool()
def get_configmap(name: str, namespace: str = "default") -> dict:
    """Get a specific ConfigMap.

    Args:
        name: Name of the ConfigMap
        namespace: Kubernetes namespace (default: default)
    """
    api = get_core_api()
    cm = api.read_namespaced_config_map(name, namespace)
    return {
        "name": cm.metadata.name,
        "namespace": cm.metadata.namespace,
        "data": cm.data or {},
        "labels": cm.metadata.labels or {},
        "annotations": cm.metadata.annotations or {},
        "creation_time": cm.metadata.creation_timestamp.isoformat() if cm.metadata.creation_timestamp else None
    }


@mcp.tool()
def list_secrets(namespace: str = "default") -> dict:
    """List all Secrets in a namespace (keys only, not values).

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_core_api()
    secrets = api.list_namespaced_secret(namespace)
    return {
        "count": len(secrets.items),
        "namespace": namespace,
        "secrets": [
            {
                "name": secret.metadata.name,
                "type": secret.type,
                "data_keys": list(secret.data.keys()) if secret.data else [],
                "creation_time": secret.metadata.creation_timestamp.isoformat() if secret.metadata.creation_timestamp else None
            }
            for secret in secrets.items
        ]
    }


# ============================================
# STATEFULSET AND DAEMONSET TOOLS
# ============================================

@mcp.tool()
def list_statefulsets(namespace: str = "default") -> dict:
    """List all StatefulSets in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_apps_api()
    sts = api.list_namespaced_stateful_set(namespace)
    return {
        "count": len(sts.items),
        "namespace": namespace,
        "statefulsets": [
            {
                "name": s.metadata.name,
                "replicas": s.spec.replicas,
                "ready_replicas": s.status.ready_replicas or 0,
                "current_replicas": s.status.current_replicas or 0,
                "service_name": s.spec.service_name,
                "creation_time": s.metadata.creation_timestamp.isoformat() if s.metadata.creation_timestamp else None
            }
            for s in sts.items
        ]
    }


@mcp.tool()
def list_daemonsets(namespace: str = "default") -> dict:
    """List all DaemonSets in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_apps_api()
    ds = api.list_namespaced_daemon_set(namespace)
    return {
        "count": len(ds.items),
        "namespace": namespace,
        "daemonsets": [
            {
                "name": d.metadata.name,
                "desired": d.status.desired_number_scheduled,
                "current": d.status.current_number_scheduled,
                "ready": d.status.number_ready,
                "available": d.status.number_available or 0,
                "creation_time": d.metadata.creation_timestamp.isoformat() if d.metadata.creation_timestamp else None
            }
            for d in ds.items
        ]
    }


# ============================================
# JOB AND CRONJOB TOOLS
# ============================================

@mcp.tool()
def list_jobs(namespace: str = "default") -> dict:
    """List all Jobs in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_batch_api()
    jobs = api.list_namespaced_job(namespace)
    return {
        "count": len(jobs.items),
        "namespace": namespace,
        "jobs": [
            {
                "name": job.metadata.name,
                "completions": job.spec.completions,
                "succeeded": job.status.succeeded or 0,
                "failed": job.status.failed or 0,
                "active": job.status.active or 0,
                "start_time": job.status.start_time.isoformat() if job.status.start_time else None,
                "completion_time": job.status.completion_time.isoformat() if job.status.completion_time else None
            }
            for job in jobs.items
        ]
    }


@mcp.tool()
def list_cronjobs(namespace: str = "default") -> dict:
    """List all CronJobs in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_batch_api()
    cjs = api.list_namespaced_cron_job(namespace)
    return {
        "count": len(cjs.items),
        "namespace": namespace,
        "cronjobs": [
            {
                "name": cj.metadata.name,
                "schedule": cj.spec.schedule,
                "suspend": cj.spec.suspend,
                "active_jobs": len(cj.status.active) if cj.status.active else 0,
                "last_schedule_time": cj.status.last_schedule_time.isoformat() if cj.status.last_schedule_time else None,
                "last_successful_time": cj.status.last_successful_time.isoformat() if cj.status.last_successful_time else None
            }
            for cj in cjs.items
        ]
    }


# ============================================
# RESOURCE SUMMARY TOOLS
# ============================================

@mcp.tool()
def get_cluster_summary() -> dict:
    """Get a summary of cluster resources across all namespaces."""
    core_api = get_core_api()
    apps_api = get_apps_api()

    namespaces = core_api.list_namespace()
    nodes = core_api.list_node()
    pods = core_api.list_pod_for_all_namespaces()
    deployments = apps_api.list_deployment_for_all_namespaces()
    services = core_api.list_service_for_all_namespaces()

    # Count pods by status
    pod_status_counts = {}
    for pod in pods.items:
        status = pod.status.phase
        pod_status_counts[status] = pod_status_counts.get(status, 0) + 1

    # Count nodes by status
    ready_nodes = sum(1 for node in nodes.items if _get_node_status(node) == "Ready")

    return {
        "namespaces": len(namespaces.items),
        "nodes": {
            "total": len(nodes.items),
            "ready": ready_nodes,
            "not_ready": len(nodes.items) - ready_nodes
        },
        "pods": {
            "total": len(pods.items),
            "by_status": pod_status_counts
        },
        "deployments": len(deployments.items),
        "services": len(services.items)
    }


@mcp.tool()
def get_namespace_summary(namespace: str) -> dict:
    """Get a summary of resources in a specific namespace.

    Args:
        namespace: Kubernetes namespace
    """
    core_api = get_core_api()
    apps_api = get_apps_api()

    pods = core_api.list_namespaced_pod(namespace)
    deployments = apps_api.list_namespaced_deployment(namespace)
    services = core_api.list_namespaced_service(namespace)
    configmaps = core_api.list_namespaced_config_map(namespace)
    secrets = core_api.list_namespaced_secret(namespace)

    # Count pods by status
    pod_status_counts = {}
    for pod in pods.items:
        status = pod.status.phase
        pod_status_counts[status] = pod_status_counts.get(status, 0) + 1

    return {
        "namespace": namespace,
        "pods": {
            "total": len(pods.items),
            "by_status": pod_status_counts
        },
        "deployments": len(deployments.items),
        "services": len(services.items),
        "configmaps": len(configmaps.items),
        "secrets": len(secrets.items)
    }


# ============================================
# HELPER FUNCTIONS
# ============================================

def _get_pod_ready_status(pod) -> str:
    """Get the ready status of a pod."""
    if pod.status.container_statuses:
        ready_count = sum(1 for cs in pod.status.container_statuses if cs.ready)
        total = len(pod.status.container_statuses)
        return f"{ready_count}/{total}"
    return "0/0"


def _get_pod_restarts(pod) -> int:
    """Get total restarts for a pod."""
    if pod.status.container_statuses:
        return sum(cs.restart_count for cs in pod.status.container_statuses)
    return 0


def _get_node_status(node) -> str:
    """Get the status of a node."""
    if node.status.conditions:
        for condition in node.status.conditions:
            if condition.type == "Ready":
                return "Ready" if condition.status == "True" else "NotReady"
    return "Unknown"


def _get_node_roles(node) -> list:
    """Get the roles of a node from its labels."""
    roles = []
    if node.metadata.labels:
        for label, value in node.metadata.labels.items():
            if label.startswith("node-role.kubernetes.io/"):
                role = label.split("/")[1]
                roles.append(role)
    return roles if roles else ["worker"]
