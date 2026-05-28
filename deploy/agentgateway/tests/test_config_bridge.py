# assisted-by Codex Codex-sonnet-4-6

"""Tests for dynamic AgentGateway MCP config reconciliation."""

from __future__ import annotations

import copy
import importlib.util
import stat
import sys
from pathlib import Path


BRIDGE_PATH = Path(__file__).resolve().parents[1] / "config_bridge.py"
spec = importlib.util.spec_from_file_location("agentgateway_config_bridge", BRIDGE_PATH)
assert spec is not None and spec.loader is not None
bridge = importlib.util.module_from_spec(spec)
sys.modules["agentgateway_config_bridge"] = bridge
spec.loader.exec_module(bridge)


def _baseline_config() -> dict:
    return {
        "binds": [
            {
                "port": 4000,
                "listeners": [
                    {
                        "protocol": "HTTP",
                        "policies": {
                            "jwtAuth": {
                                "mode": "strict",
                                "issuer": "http://localhost:7080/realms/caipe",
                                "audiences": ["caipe-platform", "agentgateway"],
                                "jwks": {
                                    "url": "http://keycloak:7080/realms/caipe/protocol/openid-connect/certs"
                                },
                            }
                        },
                        "routes": [
                            {
                                "matches": [{"path": {"pathPrefix": "/mcp/rag"}}],
                                "policies": bridge.DEFAULT_MCP_ROUTE_POLICIES,
                                "backends": [
                                    {
                                        "mcp": {
                                            "targets": [
                                                {
                                                    "name": "rag",
                                                    "mcp": {"host": "http://rag-server:9446/mcp"},
                                                }
                                            ]
                                        }
                                    }
                                ],
                            }
                        ],
                    }
                ],
            }
        ],
        "config": {
            "adminAddr": "0.0.0.0:15000",
            "logging": {"level": "debug", "format": "json"},
        },
    }


def test_select_gateway_targets_uses_enabled_agentgateway_rows_only() -> None:
    targets = bridge.select_gateway_targets(
        [
            {
                "_id": "knowledge-base",
                "enabled": True,
                "source": "agentgateway",
                "agentgateway_target_endpoint": "http://rag-server:9446/mcp",
            },
            {
                "_id": "disabled-target",
                "enabled": False,
                "source": "agentgateway",
                "agentgateway_target_endpoint": "http://disabled:8000/mcp",
            },
            {
                "_id": "manual-target",
                "enabled": True,
                "source": "manual",
                "endpoint": "http://mcp-manual:8000/mcp",
            },
            {
                "_id": "bad target",
                "enabled": True,
                "source": "agentgateway",
                "agentgateway_target_endpoint": "http://bad:8000/mcp",
            },
            {
                "_id": "missing-upstream",
                "enabled": True,
                "source": "agentgateway",
            },
        ]
    )

    assert targets == [
        bridge.McpGatewayTarget(
            id="knowledge-base",
            upstream_url="http://rag-server:9446/mcp",
        )
    ]


def test_merge_agentgateway_mcp_routes_adds_missing_route_without_mutating_baseline() -> None:
    baseline = _baseline_config()
    original = copy.deepcopy(baseline)

    rendered = bridge.merge_agentgateway_mcp_routes(
        baseline,
        [
            bridge.McpGatewayTarget(
                id="knowledge-base",
                upstream_url="http://rag-server:9446/mcp",
            )
        ],
    )

    assert baseline == original
    routes = rendered["binds"][0]["listeners"][0]["routes"]
    route_paths = [route["matches"][0]["path"]["pathPrefix"] for route in routes]
    assert route_paths == ["/mcp/rag", "/mcp/knowledge-base"]
    assert routes[1]["backends"][0]["mcp"]["targets"][0] == {
        "name": "knowledge-base",
        "mcp": {"host": "http://rag-server:9446/mcp"},
    }
    assert routes[1]["policies"] == bridge.DEFAULT_MCP_ROUTE_POLICIES


def test_merge_agentgateway_mcp_routes_replaces_stale_route_target() -> None:
    baseline = _baseline_config()
    baseline["binds"][0]["listeners"][0]["routes"].append(
        {
            "matches": [{"path": {"pathPrefix": "/mcp/knowledge-base"}}],
            "policies": bridge.DEFAULT_MCP_ROUTE_POLICIES,
            "backends": [
                {
                    "mcp": {
                        "targets": [
                            {
                                "name": "knowledge-base",
                                "mcp": {"host": "http://old-rag:9446/mcp"},
                            }
                        ]
                    }
                }
            ],
        }
    )

    rendered = bridge.merge_agentgateway_mcp_routes(
        baseline,
        [
            bridge.McpGatewayTarget(
                id="knowledge-base",
                upstream_url="http://rag-server:9446/mcp",
            )
        ],
    )

    routes = rendered["binds"][0]["listeners"][0]["routes"]
    matching_routes = [
        route
        for route in routes
        if route["matches"][0]["path"]["pathPrefix"] == "/mcp/knowledge-base"
    ]
    assert len(matching_routes) == 1
    assert matching_routes[0]["backends"][0]["mcp"]["targets"][0]["mcp"]["host"] == (
        "http://rag-server:9446/mcp"
    )


def test_write_config_atomically_publishes_agentgateway_readable_file(tmp_path: Path) -> None:
    config_path = tmp_path / "config.yaml"

    changed = bridge.write_config_atomically(config_path, _baseline_config())

    mode = stat.S_IMODE(config_path.stat().st_mode)
    assert changed is True
    assert mode == 0o644


def test_write_config_atomically_repairs_existing_unreadable_file(tmp_path: Path) -> None:
    config_path = tmp_path / "config.yaml"
    bridge.write_config_atomically(config_path, _baseline_config())
    config_path.chmod(0o600)

    changed = bridge.write_config_atomically(config_path, _baseline_config())

    mode = stat.S_IMODE(config_path.stat().st_mode)
    assert changed is False
    assert mode == 0o644


def test_ensure_published_config_mode_skips_existing_readable_file(
    tmp_path: Path, monkeypatch
) -> None:
    config_path = tmp_path / "config.yaml"
    config_path.write_text('{"binds": []}\n', encoding="utf-8")
    config_path.chmod(0o644)

    def fail_chmod(_self: Path, _mode: int) -> None:
        raise AssertionError("chmod should not run when mode is already correct")

    monkeypatch.setattr(type(config_path), "chmod", fail_chmod)

    assert bridge._ensure_published_config_mode(config_path) is False


def test_seed_config_from_bootstrap_publishes_agentgateway_readable_file(tmp_path: Path) -> None:
    config_path = tmp_path / "generated" / "config.yaml"
    bootstrap_path = tmp_path / "bootstrap.yaml"
    bootstrap_path.write_text('{"binds": []}\n', encoding="utf-8")

    changed = bridge.seed_config_from_bootstrap(config_path, bootstrap_path)

    mode = stat.S_IMODE(config_path.stat().st_mode)
    assert changed is True
    assert mode == 0o644
