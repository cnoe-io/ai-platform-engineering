# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for EKSKubectlTool secret restriction and output sanitization.

Run with: PYTHONPATH=. uv run pytest tests/test_aws_agent_tools.py -v
"""

import json
import sys
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))

import ai_platform_engineering.agents.aws.agent_aws.tools as tools_module
from ai_platform_engineering.agents.aws.agent_aws.tools import EKSKubectlTool


@pytest.fixture
def tool() -> EKSKubectlTool:
    return EKSKubectlTool()


@pytest.fixture
def tool_secrets_unrestricted(monkeypatch) -> EKSKubectlTool:
    """Tool instance with RESTRICT_KUBECTL_SECRETS=false."""
    monkeypatch.setattr(tools_module, "RESTRICT_KUBECTL_SECRETS", False)
    return EKSKubectlTool()


@pytest.fixture
def tool_proxy_unrestricted(monkeypatch) -> EKSKubectlTool:
    """Tool instance with RESTRICT_KUBECTL_PROXY=false."""
    monkeypatch.setattr(tools_module, "RESTRICT_KUBECTL_PROXY", False)
    return EKSKubectlTool()


# ---------------------------------------------------------------------------
# Input validation — secrets restriction
# ---------------------------------------------------------------------------

class TestValidateKubectlSecretsRestriction:
    @pytest.mark.parametrize("command", [
        "get secrets",
        "get secret",
        "get secrets -n kube-system",
        "get secret my-secret",
        "get secret/my-secret",
        "get secrets --all-namespaces",
        "get secrets -o json",
        "get secrets -o yaml",
        "describe secret my-secret",
        "describe secrets",
        "describe secret/my-secret -n production",
        "  get secrets  ",          # leading/trailing whitespace
        "GET SECRETS",              # case-insensitive
        "Get Secret/foo",
    ])
    def test_blocked_by_default(self, tool, command):
        is_valid, msg = tool._validate_kubectl_command(command)
        assert not is_valid, f"Expected '{command}' to be blocked"
        assert "not allowed" in msg.lower()

    @pytest.mark.parametrize("command", [
        "get secrets",
        "get secret my-secret",
        "describe secrets",
    ])
    def test_allowed_when_disabled(self, tool_secrets_unrestricted, command):
        """RESTRICT_KUBECTL_SECRETS=false allows secret commands through."""
        is_valid, _ = tool_secrets_unrestricted._validate_kubectl_command(command)
        assert is_valid, f"Expected '{command}' to be allowed when restriction is off"


# ---------------------------------------------------------------------------
# Input validation — proxy restriction
# ---------------------------------------------------------------------------

class TestValidateKubectlProxyRestriction:
    @pytest.mark.parametrize("command", [
        "proxy",
        "proxy --port=8001",
        "  proxy  ",                # leading/trailing whitespace
        "PROXY",                    # case-insensitive
    ])
    def test_blocked_by_default(self, tool, command):
        is_valid, msg = tool._validate_kubectl_command(command)
        assert not is_valid, f"Expected '{command}' to be blocked"
        assert "not allowed" in msg.lower()

    @pytest.mark.parametrize("command", [
        "proxy",
        "proxy --port=8001",
    ])
    def test_allowed_when_disabled(self, tool_proxy_unrestricted, command):
        """RESTRICT_KUBECTL_PROXY=false allows proxy through."""
        is_valid, _ = tool_proxy_unrestricted._validate_kubectl_command(command)
        assert is_valid, f"Expected '{command}' to be allowed when proxy restriction is off"


# ---------------------------------------------------------------------------
# Input validation — exec/attach/cp/port-forward (opt-in, default off)
# ---------------------------------------------------------------------------

class TestValidateKubectlOptInRestrictions:
    """exec, attach, cp, port-forward are off by default and only blocked when enabled."""

    @pytest.mark.parametrize("flag,commands,message_fragment", [
        ("RESTRICT_KUBECTL_EXEC",
         ["exec my-pod -- bash", "exec -it my-pod -- sh", "EXEC my-pod -- ls"],
         "exec"),
        ("RESTRICT_KUBECTL_ATTACH",
         ["attach my-pod", "attach -it my-pod", "ATTACH my-pod"],
         "attach"),
        ("RESTRICT_KUBECTL_CP",
         ["cp my-pod:/etc/passwd /tmp/passwd", "cp /tmp/file my-pod:/tmp/", "CP my-pod:/data ."],
         "cp"),
        ("RESTRICT_KUBECTL_PORT_FORWARD",
         ["port-forward my-pod 8080:80", "port-forward svc/my-svc 8080", "PORT-FORWARD my-pod 3000"],
         "port-forward"),
    ])
    def test_allowed_by_default(self, tool, flag, commands, message_fragment):
        """Commands are allowed when the restriction flag is off (default)."""
        for command in commands:
            is_valid, _ = tool._validate_kubectl_command(command)
            assert is_valid, f"Expected '{command}' to be allowed when {flag}=false"

    @pytest.mark.parametrize("flag,commands,message_fragment", [
        ("RESTRICT_KUBECTL_EXEC",
         ["exec my-pod -- bash", "exec -it my-pod -- sh"],
         "exec"),
        ("RESTRICT_KUBECTL_ATTACH",
         ["attach my-pod", "attach -it my-pod"],
         "attach"),
        ("RESTRICT_KUBECTL_CP",
         ["cp my-pod:/etc/passwd /tmp/passwd", "cp /tmp/file my-pod:/tmp/"],
         "cp"),
        ("RESTRICT_KUBECTL_PORT_FORWARD",
         ["port-forward my-pod 8080:80", "port-forward svc/my-svc 8080"],
         "port-forward"),
    ])
    def test_blocked_when_enabled(self, monkeypatch, flag, commands, message_fragment):
        """Commands are blocked when the corresponding restriction flag is true."""
        monkeypatch.setattr(tools_module, flag, True)
        tool = EKSKubectlTool()
        for command in commands:
            is_valid, msg = tool._validate_kubectl_command(command)
            assert not is_valid, f"Expected '{command}' to be blocked when {flag}=true"
            assert message_fragment in msg.lower()


# ---------------------------------------------------------------------------
# Input validation — non-sensitive commands always allowed
# ---------------------------------------------------------------------------

class TestValidateKubectlAllowedCommands:
    @pytest.mark.parametrize("command", [
        "get pods",
        "get pods -n kube-system",
        "get nodes",
        "get deployments",
        "get services",
        "describe pod my-pod -n production",
        "describe node my-node",
        "logs my-pod -n default",
        "top nodes",
        "get all",
        "get configmap my-config",
        # sealedsecrets and externalsecrets are CRDs, not core Secrets
        "get sealedsecrets",
        "get externalsecrets",
    ])
    def test_allowed_commands(self, tool, command):
        is_valid, msg = tool._validate_kubectl_command(command)
        assert is_valid, f"Expected '{command}' to be allowed, got: {msg}"


# ---------------------------------------------------------------------------
# Output sanitization — JSON
# ---------------------------------------------------------------------------

class TestSanitizeJsonOutput:
    def test_single_secret_data_redacted(self, tool):
        secret = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": "my-secret", "namespace": "default"},
            "data": {
                "username": "YWRtaW4=",
                "password": "c3VwZXJzZWNyZXQ=",  # gitleaks:allow
            },
        }
        result = tool._sanitize_output(json.dumps(secret))
        parsed = json.loads(result)
        assert parsed["data"]["username"] == "[REDACTED]"
        assert parsed["data"]["password"] == "[REDACTED]"
        # Metadata should be untouched
        assert parsed["metadata"]["name"] == "my-secret"

    def test_secret_list_all_items_redacted(self, tool):
        secret_list = {
            "apiVersion": "v1",
            "kind": "SecretList",
            "items": [
                {
                    "kind": "Secret",
                    "metadata": {"name": "s1"},
                    "data": {"key": "dmFsdWU="},
                },
                {
                    "kind": "Secret",
                    "metadata": {"name": "s2"},
                    "data": {"token": "dG9rZW4="},
                },
            ],
        }
        result = tool._sanitize_output(json.dumps(secret_list))
        parsed = json.loads(result)
        assert parsed["items"][0]["data"]["key"] == "[REDACTED]"
        assert parsed["items"][1]["data"]["token"] == "[REDACTED]"

    def test_non_secret_object_untouched(self, tool):
        pod = {
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {"name": "my-pod"},
            "spec": {"containers": [{"name": "app", "image": "nginx"}]},
        }
        original = json.dumps(pod)
        result = tool._sanitize_output(original)
        assert result == original

    def test_mixed_list_only_secrets_redacted(self, tool):
        mixed = {
            "apiVersion": "v1",
            "kind": "List",
            "items": [
                {"kind": "Pod", "metadata": {"name": "my-pod"}, "spec": {}},
                {
                    "kind": "Secret",
                    "metadata": {"name": "my-secret"},
                    "data": {"key": "dmFsdWU="},
                },
                {"kind": "Service", "metadata": {"name": "my-svc"}, "spec": {}},
            ],
        }
        result = tool._sanitize_output(json.dumps(mixed))
        parsed = json.loads(result)
        assert parsed["items"][1]["data"]["key"] == "[REDACTED]"
        assert parsed["items"][0]["kind"] == "Pod"
        assert parsed["items"][2]["kind"] == "Service"

    def test_secret_without_data_field_untouched(self, tool):
        secret = {
            "kind": "Secret",
            "metadata": {"name": "empty"},
            "type": "Opaque",
        }
        original = json.dumps(secret)
        result = tool._sanitize_output(original)
        assert result == original

    def test_empty_output_untouched(self, tool):
        assert tool._sanitize_output("") == ""
        assert tool._sanitize_output("   ") == "   "


# ---------------------------------------------------------------------------
# Output sanitization — YAML
# ---------------------------------------------------------------------------

YAML_SECRET = """\
apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: default
data:
  username: YWRtaW4=
  password: c3VwZXJzZWNyZXQ=  # gitleaks:allow
type: Opaque
"""

YAML_SECRET_REDACTED_EXPECTED_KEYS = {"username", "password"}


class TestSanitizeYamlOutput:
    def test_secret_data_values_redacted(self, tool):
        result = tool._sanitize_yaml_output(YAML_SECRET)
        for key in YAML_SECRET_REDACTED_EXPECTED_KEYS:
            assert f"{key}: [REDACTED]" in result
        assert "YWRtaW4=" not in result
        assert "c3VwZXJzZWNyZXQ=" not in result

    def test_metadata_preserved(self, tool):
        result = tool._sanitize_yaml_output(YAML_SECRET)
        assert "name: my-secret" in result
        assert "namespace: default" in result

    def test_type_field_preserved(self, tool):
        result = tool._sanitize_yaml_output(YAML_SECRET)
        assert "type: Opaque" in result

    def test_non_secret_yaml_untouched(self, tool):
        pod_yaml = """\
apiVersion: v1
kind: Pod
metadata:
  name: my-pod
spec:
  containers:
  - name: app
    image: nginx
"""
        result = tool._sanitize_yaml_output(pod_yaml)
        assert result == pod_yaml

    def test_multiple_secrets_in_yaml_list(self, tool):
        yaml_list = """\
---
kind: Secret
metadata:
  name: s1
data:
  key1: dmFsdWUx
---
kind: Secret
metadata:
  name: s2
data:
  key2: dmFsdWUy
"""
        result = tool._sanitize_yaml_output(yaml_list)
        assert "dmFsdWUx" not in result
        assert "dmFsdWUy" not in result
        assert "key1: [REDACTED]" in result
        assert "key2: [REDACTED]" in result

    def test_sanitize_output_dispatches_to_yaml_for_non_json(self, tool):
        result = tool._sanitize_output(YAML_SECRET)
        assert "YWRtaW4=" not in result
        assert "username: [REDACTED]" in result
