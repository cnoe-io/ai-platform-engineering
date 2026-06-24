# assisted-by Codex Codex-sonnet-4-6
"""Helm template tests for AgentGateway provider-token passthrough."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
CHART_PATH = REPO_ROOT / "charts" / "ai-platform-engineering"


def _require_helm() -> None:
    if shutil.which("helm") is None:
        pytest.skip("helm is required for AgentGateway chart tests")


def _helm_template(*extra_set_args: str) -> list[dict[str, Any]]:
    _require_helm()
    cmd = ["helm", "template", "test", str(CHART_PATH), "--dependency-update"]
    for arg in extra_set_args:
        cmd.extend(["--set", arg])
    rendered = subprocess.run(cmd, check=True, text=True, capture_output=True).stdout
    return [
        doc
        for doc in yaml.safe_load_all(rendered)
        if isinstance(doc, dict) and doc
    ]


def _static_config(docs: list[dict[str, Any]]) -> dict[str, Any]:
    config_map = next(
        doc
        for doc in docs
        if doc.get("kind") == "ConfigMap"
        and doc.get("metadata", {}).get("name") == "test-agentgateway-static-config"
    )
    return yaml.safe_load(config_map["data"]["config.yaml"])


def _static_route(config: dict[str, Any], path_prefix: str) -> dict[str, Any]:
    routes = config["binds"][0]["listeners"][0]["routes"]
    return next(
        route
        for route in routes
        if route["matches"][0]["path"]["pathPrefix"] == path_prefix
    )


def _policy_names(docs: list[dict[str, Any]]) -> set[str]:
    return {
        doc.get("metadata", {}).get("name")
        for doc in docs
        if doc.get("kind") == "AgentgatewayPolicy"
    }


def test_static_extra_mcp_target_can_opt_into_provider_token_auth() -> None:
    docs = _helm_template(
        "global.agentgateway.routingMode=static",
        "global.agentgateway.knowledgeBaseTarget.enabled=false",
        "global.agentgateway.extraMcpTargets[0].id=custom-provider",
        "global.agentgateway.extraMcpTargets[0].host=custom-provider.default.svc.cluster.local",
        "global.agentgateway.extraMcpTargets[0].port=8080",
        "global.agentgateway.extraMcpTargets[0].providerTokenAuth=true",
    )

    route = _static_route(_static_config(docs), "/mcp/custom-provider")

    assert route["policies"]["transformations"]["request"]["set"][
        "authorization"
    ] == '"Bearer " + default(request.headers["x-caipe-provider-token"], "")'


def test_static_extra_mcp_target_derives_provider_token_auth_from_credentials() -> None:
    docs = _helm_template(
        "global.agentgateway.routingMode=static",
        "global.agentgateway.knowledgeBaseTarget.enabled=false",
        "global.agentgateway.extraMcpTargets[0].id=custom-provider",
        "global.agentgateway.extraMcpTargets[0].host=custom-provider.default.svc.cluster.local",
        "global.agentgateway.extraMcpTargets[0].port=8080",
        "global.agentgateway.extraMcpTargets[0].credential_sources[0].kind=caller_token",
        "global.agentgateway.extraMcpTargets[0].credential_sources[0].name=X-CAIPE-Provider-Token",
        "global.agentgateway.extraMcpTargets[0].credential_sources[0].target=header",
    )

    route = _static_route(_static_config(docs), "/mcp/custom-provider")

    assert route["policies"]["transformations"]["request"]["set"][
        "authorization"
    ] == '"Bearer " + default(request.headers["x-caipe-provider-token"], "")'


def test_gateway_api_provider_token_policy_follows_declarative_flag() -> None:
    docs = _helm_template(
        "global.agentgateway.routingMode=gateway-api",
        "global.agentgateway.knowledgeBaseTarget.enabled=false",
        "tags.mcp-github=true",
        "global.enabledSubAgents.github.enabled=true",
        "mcp-github.mcp.agentgateway.enabled=true",
        "mcp-github.mcp.agentgateway.providerTokenAuth=false",
        "global.agentgateway.extraMcpTargets[0].id=custom-provider",
        "global.agentgateway.extraMcpTargets[0].host=custom-provider.default.svc.cluster.local",
        "global.agentgateway.extraMcpTargets[0].port=8080",
        "global.agentgateway.extraMcpTargets[0].credential_sources[0].kind=provider_connection",
        "global.agentgateway.extraMcpTargets[0].credential_sources[0].name=X-CAIPE-Provider-Token",
        "global.agentgateway.extraMcpTargets[0].credential_sources[0].provider=custom",
        "global.agentgateway.extraMcpTargets[0].credential_sources[0].target=header",
    )

    names = _policy_names(docs)

    assert "github-provider-token-auth" not in names
    assert "custom-provider-provider-token-auth" in names
