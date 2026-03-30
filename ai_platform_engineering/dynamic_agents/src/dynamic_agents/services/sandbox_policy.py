"""Sandbox policy templates and mutation helpers.

Provides default policy YAML templates and functions to programmatically
add/remove network rules for the OpenShell sandbox policy.
"""

from __future__ import annotations

import copy
import uuid
from typing import Any

import yaml

PERMISSIVE_POLICY_TEMPLATE: dict[str, Any] = {
    "version": 1,
    "filesystem_policy": {
        "include_workdir": True,
        "read_only": [
            "/usr",
            "/lib",
            "/proc",
            "/dev/urandom",
            "/app",
            "/etc",
            "/var/log",
        ],
        "read_write": [
            "/sandbox",
            "/tmp",
            "/workspace",
            "/dev/null",
        ],
    },
    "landlock": {"compatibility": "best_effort"},
    "process": {
        "run_as_user": "sandbox",
        "run_as_group": "sandbox",
    },
    "network_policies": {
        "pypi": {
            "name": "pypi",
            "endpoints": [
                {"host": "pypi.org", "port": 443},
                {"host": "files.pythonhosted.org", "port": 443},
                {"host": "downloads.python.org", "port": 443},
            ],
            "binaries": [
                {"path": "/sandbox/.venv/bin/python"},
                {"path": "/sandbox/.venv/bin/python3"},
                {"path": "/sandbox/.venv/bin/pip"},
                {"path": "/usr/local/bin/uv"},
                {"path": "/sandbox/.uv/python/**"},
            ],
        },
        "npm": {
            "name": "npm",
            "endpoints": [
                {"host": "registry.npmjs.org", "port": 443},
            ],
            "binaries": [
                {"path": "/usr/bin/node"},
                {"path": "/usr/local/bin/npm"},
            ],
        },
        "github": {
            "name": "github",
            "endpoints": [
                {"host": "api.github.com", "port": 443, "protocol": "rest", "tls": "terminate", "enforcement": "enforce", "access": "full"},
                {"host": "github.com", "port": 443},
                {"host": "raw.githubusercontent.com", "port": 443},
                {"host": "objects.githubusercontent.com", "port": 443},
            ],
            "binaries": [
                {"path": "/usr/bin/git"},
                {"path": "/usr/bin/gh"},
                {"path": "/usr/bin/curl"},
            ],
        },
        "aws_bedrock": {
            "name": "aws-bedrock",
            "endpoints": [
                {"host": "**.amazonaws.com", "port": 443},
            ],
            "binaries": [
                {"path": "/usr/bin/curl"},
                {"path": "/bin/bash"},
                {"path": "/sandbox/.venv/bin/python"},
                {"path": "/sandbox/.venv/bin/python3"},
            ],
        },
        "azure_openai": {
            "name": "azure-openai",
            "endpoints": [
                {"host": "**.openai.azure.com", "port": 443, "protocol": "rest", "tls": "terminate", "enforcement": "enforce", "access": "full"},
                {"host": "login.microsoftonline.com", "port": 443},
            ],
            "binaries": [
                {"path": "/usr/bin/curl"},
                {"path": "/bin/bash"},
                {"path": "/sandbox/.venv/bin/python"},
                {"path": "/sandbox/.venv/bin/python3"},
            ],
        },
    },
}

RESTRICTIVE_POLICY_TEMPLATE: dict[str, Any] = {
    "version": 1,
    "filesystem_policy": {
        "include_workdir": True,
        "read_only": [
            "/usr",
            "/lib",
            "/proc",
            "/dev/urandom",
            "/etc",
        ],
        "read_write": [
            "/sandbox",
            "/tmp",
            "/dev/null",
        ],
    },
    "landlock": {"compatibility": "best_effort"},
    "process": {
        "run_as_user": "sandbox",
        "run_as_group": "sandbox",
    },
    "network_policies": {},
}


def build_policy_from_template(
    template: str,
    custom_yaml: str | None = None,
) -> dict[str, Any]:
    """Build a policy dict from a template name or custom YAML.

    Args:
        template: One of 'permissive', 'restrictive', 'custom'.
        custom_yaml: Raw YAML string when template is 'custom'.

    Returns:
        Policy dict ready for serialization or gRPC UpdateConfig.
    """
    if template == "custom" and custom_yaml:
        return yaml.safe_load(custom_yaml)
    if template == "restrictive":
        return copy.deepcopy(RESTRICTIVE_POLICY_TEMPLATE)
    return copy.deepcopy(PERMISSIVE_POLICY_TEMPLATE)


def serialize_policy(policy: dict[str, Any]) -> str:
    """Serialize a policy dict to YAML string."""
    return yaml.dump(policy, default_flow_style=False, sort_keys=False)


def add_network_rule_to_policy(
    policy: dict[str, Any],
    *,
    host: str,
    port: int = 443,
    binary: str | None = None,
    rule_name: str | None = None,
    temporary: bool = False,
) -> tuple[dict[str, Any], str]:
    """Add a network endpoint rule to the policy.

    Args:
        policy: Mutable policy dict.
        host: Hostname to allow.
        port: Port number.
        binary: Optional binary path to scope the rule to.
        rule_name: Optional rule name. Auto-generated if not provided.
        temporary: If True, marks the rule with _temporary metadata.

    Returns:
        Tuple of (updated policy, rule_id).
    """
    policies = policy.setdefault("network_policies", {})

    rule_id = rule_name or f"user_{uuid.uuid4().hex[:8]}"
    endpoint: dict[str, Any] = {"host": host, "port": port}

    rule_entry: dict[str, Any] = {
        "name": rule_id,
        "endpoints": [endpoint],
    }

    if binary:
        rule_entry["binaries"] = [{"path": binary}]

    if temporary:
        rule_entry["_temporary"] = True

    policies[rule_id] = rule_entry
    return policy, rule_id


def remove_network_rule_from_policy(
    policy: dict[str, Any],
    rule_id: str,
) -> dict[str, Any]:
    """Remove a network rule from the policy by its ID.

    Args:
        policy: Mutable policy dict.
        rule_id: The rule key to remove.

    Returns:
        Updated policy dict.
    """
    policies = policy.get("network_policies", {})
    policies.pop(rule_id, None)
    return policy


def remove_temporary_rules(policy: dict[str, Any]) -> dict[str, Any]:
    """Remove all rules marked as temporary from the policy.

    Args:
        policy: Mutable policy dict.

    Returns:
        Updated policy dict.
    """
    policies = policy.get("network_policies", {})
    temp_keys = [k for k, v in policies.items() if isinstance(v, dict) and v.get("_temporary")]
    for key in temp_keys:
        del policies[key]
    return policy
