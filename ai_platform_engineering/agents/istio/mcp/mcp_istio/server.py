# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Istio MCP Server - Provides tools for managing Istio service mesh resources."""

import os
import yaml
from dotenv import load_dotenv
from fastmcp import FastMCP
from kubernetes import client, config

load_dotenv()

# Initialize FastMCP server
mcp = FastMCP("Istio MCP Server")

# Load Kubernetes configuration
try:
    config.load_incluster_config()
except config.ConfigException:
    config.load_kube_config()


def get_custom_api() -> client.CustomObjectsApi:
    """Get Kubernetes Custom Objects API client."""
    return client.CustomObjectsApi()


def get_core_api() -> client.CoreV1Api:
    """Get Kubernetes Core API client."""
    return client.CoreV1Api()


# ============================================
# VIRTUAL SERVICE TOOLS
# ============================================

@mcp.tool()
def list_virtual_services(namespace: str = "default") -> dict:
    """List all VirtualServices in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_custom_api()
    return api.list_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="virtualservices"
    )


@mcp.tool()
def get_virtual_service(name: str, namespace: str = "default") -> dict:
    """Get a specific VirtualService.

    Args:
        name: Name of the VirtualService
        namespace: Kubernetes namespace (default: default)
    """
    api = get_custom_api()
    return api.get_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="virtualservices",
        name=name
    )


@mcp.tool()
def create_virtual_service(name: str, namespace: str, hosts: list, http_routes: list) -> dict:
    """Create a VirtualService.

    Args:
        name: Name of the VirtualService
        namespace: Kubernetes namespace
        hosts: List of hosts to match
        http_routes: List of HTTP route configurations
    """
    api = get_custom_api()
    body = {
        "apiVersion": "networking.istio.io/v1",
        "kind": "VirtualService",
        "metadata": {"name": name, "namespace": namespace},
        "spec": {"hosts": hosts, "http": http_routes}
    }
    return api.create_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="virtualservices",
        body=body
    )


@mcp.tool()
def delete_virtual_service(name: str, namespace: str = "default") -> dict:
    """Delete a VirtualService.

    Args:
        name: Name of the VirtualService
        namespace: Kubernetes namespace (default: default)
    """
    api = get_custom_api()
    return api.delete_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="virtualservices",
        name=name
    )


# ============================================
# DESTINATION RULE TOOLS
# ============================================

@mcp.tool()
def list_destination_rules(namespace: str = "default") -> dict:
    """List all DestinationRules in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_custom_api()
    return api.list_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="destinationrules"
    )


@mcp.tool()
def get_destination_rule(name: str, namespace: str = "default") -> dict:
    """Get a specific DestinationRule.

    Args:
        name: Name of the DestinationRule
        namespace: Kubernetes namespace (default: default)
    """
    api = get_custom_api()
    return api.get_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="destinationrules",
        name=name
    )


@mcp.tool()
def create_destination_rule(name: str, namespace: str, host: str, traffic_policy: dict = None, subsets: list = None) -> dict:
    """Create a DestinationRule.

    Args:
        name: Name of the DestinationRule
        namespace: Kubernetes namespace
        host: Target host for the rule
        traffic_policy: Traffic policy configuration (optional)
        subsets: Service subsets configuration (optional)
    """
    api = get_custom_api()
    spec = {"host": host}
    if traffic_policy:
        spec["trafficPolicy"] = traffic_policy
    if subsets:
        spec["subsets"] = subsets

    body = {
        "apiVersion": "networking.istio.io/v1",
        "kind": "DestinationRule",
        "metadata": {"name": name, "namespace": namespace},
        "spec": spec
    }
    return api.create_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="destinationrules",
        body=body
    )


# ============================================
# GATEWAY TOOLS
# ============================================

@mcp.tool()
def list_gateways(namespace: str = "default") -> dict:
    """List all Gateways in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_custom_api()
    return api.list_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="gateways"
    )


@mcp.tool()
def get_gateway(name: str, namespace: str = "default") -> dict:
    """Get a specific Gateway.

    Args:
        name: Name of the Gateway
        namespace: Kubernetes namespace (default: default)
    """
    api = get_custom_api()
    return api.get_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="gateways",
        name=name
    )


@mcp.tool()
def create_gateway(name: str, namespace: str, hosts: list, port: int = 80, protocol: str = "HTTP") -> dict:
    """Create a Gateway.

    Args:
        name: Name of the Gateway
        namespace: Kubernetes namespace
        hosts: List of hosts to serve
        port: Port number (default: 80)
        protocol: Protocol (HTTP, HTTPS, GRPC, etc.)
    """
    api = get_custom_api()
    body = {
        "apiVersion": "networking.istio.io/v1",
        "kind": "Gateway",
        "metadata": {"name": name, "namespace": namespace},
        "spec": {
            "selector": {"istio": "ingressgateway"},
            "servers": [{
                "port": {"number": port, "name": protocol.lower(), "protocol": protocol},
                "hosts": hosts
            }]
        }
    }
    return api.create_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="gateways",
        body=body
    )


# ============================================
# SERVICE ENTRY TOOLS
# ============================================

@mcp.tool()
def list_service_entries(namespace: str = "default") -> dict:
    """List all ServiceEntries in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_custom_api()
    return api.list_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="serviceentries"
    )


@mcp.tool()
def create_service_entry(name: str, namespace: str, hosts: list, ports: list, resolution: str = "DNS") -> dict:
    """Create a ServiceEntry for external services.

    Args:
        name: Name of the ServiceEntry
        namespace: Kubernetes namespace
        hosts: List of external hosts
        ports: List of port configurations
        resolution: Resolution mode (DNS, STATIC, NONE)
    """
    api = get_custom_api()
    body = {
        "apiVersion": "networking.istio.io/v1",
        "kind": "ServiceEntry",
        "metadata": {"name": name, "namespace": namespace},
        "spec": {
            "hosts": hosts,
            "ports": ports,
            "resolution": resolution,
            "location": "MESH_EXTERNAL"
        }
    }
    return api.create_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="serviceentries",
        body=body
    )


# ============================================
# AUTHORIZATION POLICY TOOLS
# ============================================

@mcp.tool()
def list_authorization_policies(namespace: str = "default") -> dict:
    """List all AuthorizationPolicies in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_custom_api()
    return api.list_namespaced_custom_object(
        group="security.istio.io",
        version="v1",
        namespace=namespace,
        plural="authorizationpolicies"
    )


@mcp.tool()
def get_authorization_policy(name: str, namespace: str = "default") -> dict:
    """Get a specific AuthorizationPolicy.

    Args:
        name: Name of the AuthorizationPolicy
        namespace: Kubernetes namespace (default: default)
    """
    api = get_custom_api()
    return api.get_namespaced_custom_object(
        group="security.istio.io",
        version="v1",
        namespace=namespace,
        plural="authorizationpolicies",
        name=name
    )


# ============================================
# PEER AUTHENTICATION TOOLS
# ============================================

@mcp.tool()
def list_peer_authentications(namespace: str = "default") -> dict:
    """List all PeerAuthentication policies in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_custom_api()
    return api.list_namespaced_custom_object(
        group="security.istio.io",
        version="v1",
        namespace=namespace,
        plural="peerauthentications"
    )


@mcp.tool()
def create_peer_authentication(name: str, namespace: str, mtls_mode: str = "STRICT") -> dict:
    """Create a PeerAuthentication policy.

    Args:
        name: Name of the PeerAuthentication
        namespace: Kubernetes namespace
        mtls_mode: mTLS mode (STRICT, PERMISSIVE, DISABLE)
    """
    api = get_custom_api()
    body = {
        "apiVersion": "security.istio.io/v1",
        "kind": "PeerAuthentication",
        "metadata": {"name": name, "namespace": namespace},
        "spec": {"mtls": {"mode": mtls_mode}}
    }
    return api.create_namespaced_custom_object(
        group="security.istio.io",
        version="v1",
        namespace=namespace,
        plural="peerauthentications",
        body=body
    )


# ============================================
# SIDECAR TOOLS
# ============================================

@mcp.tool()
def list_sidecars(namespace: str = "default") -> dict:
    """List all Sidecar configurations in a namespace.

    Args:
        namespace: Kubernetes namespace (default: default)
    """
    api = get_custom_api()
    return api.list_namespaced_custom_object(
        group="networking.istio.io",
        version="v1",
        namespace=namespace,
        plural="sidecars"
    )


# ============================================
# MESH STATUS TOOLS
# ============================================

@mcp.tool()
def get_istio_proxies() -> dict:
    """List all Istio proxy pods in the mesh."""
    api = get_core_api()
    pods = api.list_pod_for_all_namespaces(label_selector="istio-proxy")
    return {
        "count": len(pods.items),
        "proxies": [
            {
                "name": pod.metadata.name,
                "namespace": pod.metadata.namespace,
                "status": pod.status.phase,
                "node": pod.spec.node_name
            }
            for pod in pods.items
        ]
    }


@mcp.tool()
def check_namespace_injection(namespace: str) -> dict:
    """Check if a namespace has Istio sidecar injection enabled.

    Args:
        namespace: Kubernetes namespace to check
    """
    api = get_core_api()
    ns = api.read_namespace(namespace)
    labels = ns.metadata.labels or {}
    injection_enabled = labels.get("istio-injection") == "enabled"
    return {
        "namespace": namespace,
        "injection_enabled": injection_enabled,
        "labels": labels
    }
