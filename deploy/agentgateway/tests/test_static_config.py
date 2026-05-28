# assisted-by Codex Codex-sonnet-4-6

"""Regression tests for the checked-in standalone AgentGateway config."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


CONFIG_PATH = Path(__file__).resolve().parents[1] / "config.yaml"


def _mcp_target(config: dict[str, Any], server_id: str) -> dict[str, Any]:
    routes = config["binds"][0]["listeners"][0]["routes"]
    route = next(
        route
        for route in routes
        if route["matches"][0]["path"]["pathPrefix"] == f"/mcp/{server_id}"
    )
    return route["backends"][0]["mcp"]["targets"][0]


def test_github_mcp_target_injects_backend_pat() -> None:
    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))

    target = _mcp_target(config, "github")

    assert target["policies"]["backendAuth"]["key"] == "$GITHUB_PERSONAL_ACCESS_TOKEN"


def test_gitlab_mcp_target_injects_backend_pat() -> None:
    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))

    target = _mcp_target(config, "gitlab")

    assert target["policies"]["backendAuth"]["key"] == "$GITLAB_PERSONAL_ACCESS_TOKEN"
