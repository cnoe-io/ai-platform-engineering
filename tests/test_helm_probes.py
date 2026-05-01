# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Helm template unit tests for readiness/liveness/startup probe configuration.

Runs `helm template` for each subchart and asserts that the rendered
Deployment manifests contain the correct probe types, paths, and thresholds.
No cluster required.
"""

import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
CHARTS = REPO_ROOT / "charts"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _helm_template(chart_path: Path, set_values: dict[str, str] | None = None) -> list[dict]:
    """Run helm template and return parsed YAML documents."""
    cmd = ["helm", "template", "test", str(chart_path)]
    for k, v in (set_values or {}).items():
        cmd += ["--set", f"{k}={v}"]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def _deployments(docs: list[dict]) -> list[dict]:
    return [d for d in docs if d.get("kind") == "Deployment"]


def _main_container(deployment: dict) -> dict:
    return deployment["spec"]["template"]["spec"]["containers"][0]


def _deployment_named(docs: list[dict], suffix: str) -> dict:
    """Find a deployment whose name ends with the given suffix."""
    for d in _deployments(docs):
        if d["metadata"]["name"].endswith(suffix):
            return d
    raise AssertionError(f"No Deployment with name suffix {suffix!r} found")


# Shorthand probe extractors
def _startup(container: dict) -> dict:
    return container["startupProbe"]

def _liveness(container: dict) -> dict:
    return container["livenessProbe"]

def _readiness(container: dict) -> dict:
    return container["readinessProbe"]


# Common --set flags needed to satisfy subchart templates
_GLOBAL_BASE = {
    "global.vpa.enabled": "false",
    "global.image.tag": "",
}


# ---------------------------------------------------------------------------
# agent subchart
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def agent_docs():
    return _helm_template(
        CHARTS / "ai-platform-engineering/charts/agent",
        {
            **_GLOBAL_BASE,
            "global.mcp.vpa.enabled": "false",
            "image.repository": "ghcr.io/cnoe-io/agent-test",
            "mcp.image.repository": "ghcr.io/cnoe-io/mcp-test",
        },
    )


@pytest.fixture(scope="module")
def agent_main_container(agent_docs):
    deps = _deployments(agent_docs)
    # agent deployment is the one NOT ending in -mcp
    dep = next(d for d in deps if not d["metadata"]["name"].endswith("-mcp"))
    return _main_container(dep)


@pytest.fixture(scope="module")
def agent_mcp_container(agent_docs):
    dep = _deployment_named(agent_docs, "-mcp")
    return _main_container(dep)


class TestAgentProbes:
    def test_startup_uses_httpget(self, agent_main_container):
        assert "httpGet" in _startup(agent_main_container)

    def test_startup_path_is_health(self, agent_main_container):
        assert _startup(agent_main_container)["httpGet"]["path"] == "/health"

    def test_startup_failure_threshold_is_30(self, agent_main_container):
        assert _startup(agent_main_container)["failureThreshold"] == 30

    def test_liveness_uses_httpget(self, agent_main_container):
        assert "httpGet" in _liveness(agent_main_container)

    def test_liveness_path_is_health(self, agent_main_container):
        assert _liveness(agent_main_container)["httpGet"]["path"] == "/health"

    def test_liveness_failure_threshold_is_3(self, agent_main_container):
        assert _liveness(agent_main_container)["failureThreshold"] == 3

    def test_readiness_uses_httpget(self, agent_main_container):
        assert "httpGet" in _readiness(agent_main_container)

    def test_readiness_path_is_ready(self, agent_main_container):
        assert _readiness(agent_main_container)["httpGet"]["path"] == "/ready"

    def test_readiness_failure_threshold_is_3(self, agent_main_container):
        assert _readiness(agent_main_container)["failureThreshold"] == 3


class TestAgentMcpProbes:
    def test_mcp_startup_uses_tcpsocket(self, agent_mcp_container):
        assert "tcpSocket" in _startup(agent_mcp_container)

    def test_mcp_startup_failure_threshold_is_30(self, agent_mcp_container):
        assert _startup(agent_mcp_container)["failureThreshold"] == 30

    def test_mcp_liveness_uses_tcpsocket(self, agent_mcp_container):
        assert "tcpSocket" in _liveness(agent_mcp_container)

    def test_mcp_readiness_uses_tcpsocket(self, agent_mcp_container):
        assert "tcpSocket" in _readiness(agent_mcp_container)

    def test_mcp_no_httpget(self, agent_mcp_container):
        assert "httpGet" not in _startup(agent_mcp_container)
        assert "httpGet" not in _liveness(agent_mcp_container)
        assert "httpGet" not in _readiness(agent_mcp_container)


class TestAgentSlimSuppressesProbes:
    """Probes must be omitted when SLIM transport is active (agent cannot self-probe)."""

    def test_slim_mode_omits_startup_probe(self):
        docs = _helm_template(
            CHARTS / "ai-platform-engineering/charts/agent",
            {
                **_GLOBAL_BASE,
                "global.mcp.vpa.enabled": "false",
                "global.slim.enabled": "true",
                "global.slim.endpoint": "http://slim:46357",
                "image.repository": "ghcr.io/cnoe-io/agent-test",
                "mcp.image.repository": "ghcr.io/cnoe-io/mcp-test",
            },
        )
        deps = _deployments(docs)
        dep = next(d for d in deps if not d["metadata"]["name"].endswith("-mcp"))
        c = _main_container(dep)
        assert "startupProbe" not in c
        assert "livenessProbe" not in c
        assert "readinessProbe" not in c


# ---------------------------------------------------------------------------
# supervisor-agent subchart
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def supervisor_container():
    docs = _helm_template(
        CHARTS / "ai-platform-engineering/charts/supervisor-agent",
        {
            **_GLOBAL_BASE,
            "global.deploymentMode": "multi-node",
            "image.repository": "ghcr.io/cnoe-io/supervisor",
        },
    )
    return _main_container(_deployments(docs)[0])


class TestSupervisorProbes:
    def test_startup_uses_httpget(self, supervisor_container):
        assert "httpGet" in _startup(supervisor_container)

    def test_startup_path_is_health(self, supervisor_container):
        assert _startup(supervisor_container)["httpGet"]["path"] == "/health"

    def test_startup_failure_threshold_is_30(self, supervisor_container):
        assert _startup(supervisor_container)["failureThreshold"] == 30

    def test_liveness_path_is_health(self, supervisor_container):
        assert _liveness(supervisor_container)["httpGet"]["path"] == "/health"

    def test_readiness_path_is_health(self, supervisor_container):
        assert _readiness(supervisor_container)["httpGet"]["path"] == "/health"

    def test_no_tcpsocket(self, supervisor_container):
        assert "tcpSocket" not in _startup(supervisor_container)
        assert "tcpSocket" not in _liveness(supervisor_container)
        assert "tcpSocket" not in _readiness(supervisor_container)


# ---------------------------------------------------------------------------
# dynamic-agents subchart
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def dynamic_agents_container():
    docs = _helm_template(
        CHARTS / "ai-platform-engineering/charts/dynamic-agents",
        _GLOBAL_BASE,
    )
    return _main_container(_deployments(docs)[0])


class TestDynamicAgentsProbes:
    def test_startup_path_is_healthz(self, dynamic_agents_container):
        assert _startup(dynamic_agents_container)["httpGet"]["path"] == "/healthz"

    def test_startup_failure_threshold_is_30(self, dynamic_agents_container):
        assert _startup(dynamic_agents_container)["failureThreshold"] == 30

    def test_liveness_path_is_healthz(self, dynamic_agents_container):
        assert _liveness(dynamic_agents_container)["httpGet"]["path"] == "/healthz"

    def test_readiness_path_is_readyz(self, dynamic_agents_container):
        # readiness uses /readyz which checks MongoDB connectivity
        assert _readiness(dynamic_agents_container)["httpGet"]["path"] == "/readyz"

    def test_liveness_and_readiness_use_different_paths(self, dynamic_agents_container):
        liveness_path = _liveness(dynamic_agents_container)["httpGet"]["path"]
        readiness_path = _readiness(dynamic_agents_container)["httpGet"]["path"]
        assert liveness_path != readiness_path


# ---------------------------------------------------------------------------
# caipe-ui subchart
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def caipe_ui_container():
    docs = _helm_template(
        CHARTS / "ai-platform-engineering/charts/caipe-ui",
        _GLOBAL_BASE,
    )
    return _main_container(_deployments(docs)[0])


class TestCaipeUiProbes:
    def test_startup_path_is_api_health(self, caipe_ui_container):
        assert _startup(caipe_ui_container)["httpGet"]["path"] == "/api/health"

    def test_startup_failure_threshold_is_30(self, caipe_ui_container):
        assert _startup(caipe_ui_container)["failureThreshold"] == 30

    def test_liveness_path_is_api_health(self, caipe_ui_container):
        assert _liveness(caipe_ui_container)["httpGet"]["path"] == "/api/health"

    def test_readiness_path_is_api_health(self, caipe_ui_container):
        assert _readiness(caipe_ui_container)["httpGet"]["path"] == "/api/health"


# ---------------------------------------------------------------------------
# rag-server subchart
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def rag_server_container():
    docs = _helm_template(
        CHARTS / "rag-stack/charts/rag-server",
        _GLOBAL_BASE,
    )
    return _main_container(_deployments(docs)[0])


class TestRagServerProbes:
    def test_startup_path_is_healthz(self, rag_server_container):
        assert _startup(rag_server_container)["httpGet"]["path"] == "/healthz"

    def test_startup_failure_threshold_is_30(self, rag_server_container):
        assert _startup(rag_server_container)["failureThreshold"] == 30

    def test_liveness_path_is_healthz(self, rag_server_container):
        assert _liveness(rag_server_container)["httpGet"]["path"] == "/healthz"

    def test_readiness_path_is_healthz(self, rag_server_container):
        assert _readiness(rag_server_container)["httpGet"]["path"] == "/healthz"


# ---------------------------------------------------------------------------
# agent-ontology subchart
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def agent_ontology_container():
    docs = _helm_template(
        CHARTS / "rag-stack/charts/agent-ontology",
        _GLOBAL_BASE,
    )
    return _main_container(_deployments(docs)[0])


class TestAgentOntologyProbes:
    def test_startup_path_is_status_endpoint(self, agent_ontology_container):
        assert _startup(agent_ontology_container)["httpGet"]["path"] == "/v1/graph/ontology/agent/status"

    def test_startup_failure_threshold_is_30(self, agent_ontology_container):
        assert _startup(agent_ontology_container)["failureThreshold"] == 30

    def test_liveness_path_is_status_endpoint(self, agent_ontology_container):
        assert _liveness(agent_ontology_container)["httpGet"]["path"] == "/v1/graph/ontology/agent/status"

    def test_readiness_path_is_status_endpoint(self, agent_ontology_container):
        assert _readiness(agent_ontology_container)["httpGet"]["path"] == "/v1/graph/ontology/agent/status"

    def test_no_tcpsocket(self, agent_ontology_container):
        assert "tcpSocket" not in _startup(agent_ontology_container)


# ---------------------------------------------------------------------------
# rag-redis subchart
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def rag_redis_container():
    docs = _helm_template(
        CHARTS / "rag-stack/charts/rag-redis",
        {"global.image.tag": ""},
    )
    return _main_container(_deployments(docs)[0])


class TestRagRedisProbes:
    def test_startup_uses_exec(self, rag_redis_container):
        assert "exec" in _startup(rag_redis_container)

    def test_startup_command_is_redis_cli_ping(self, rag_redis_container):
        cmd = _startup(rag_redis_container)["exec"]["command"]
        assert "redis-cli" in cmd
        assert "ping" in cmd

    def test_startup_failure_threshold_is_12(self, rag_redis_container):
        # Redis starts quickly — 12×5s = 60s window is sufficient
        assert _startup(rag_redis_container)["failureThreshold"] == 12

    def test_liveness_uses_exec(self, rag_redis_container):
        assert "exec" in _liveness(rag_redis_container)

    def test_readiness_uses_exec(self, rag_redis_container):
        assert "exec" in _readiness(rag_redis_container)

    def test_no_httpget(self, rag_redis_container):
        assert "httpGet" not in _startup(rag_redis_container)
        assert "httpGet" not in _liveness(rag_redis_container)
        assert "httpGet" not in _readiness(rag_redis_container)
