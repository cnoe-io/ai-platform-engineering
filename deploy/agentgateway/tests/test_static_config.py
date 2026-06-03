# assisted-by Codex Codex-sonnet-4-6

"""Regression tests for the checked-in standalone AgentGateway config."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


CONFIG_PATH = Path(__file__).resolve().parents[1] / "config.yaml"


PROVIDER_TOKEN_TRANSFORM = (
    '"Bearer " + default(request.headers["x-caipe-provider-token"], "")'
)


def _mcp_route(config: dict[str, Any], server_id: str) -> dict[str, Any]:
    routes = config["binds"][0]["listeners"][0]["routes"]
    return next(
        route
        for route in routes
        if route["matches"][0]["path"]["pathPrefix"] == f"/mcp/{server_id}"
    )


def _mcp_target(config: dict[str, Any], server_id: str) -> dict[str, Any]:
    return _mcp_route(config, server_id)["backends"][0]["mcp"]["targets"][0]


def test_github_route_rewrites_provider_token_to_authorization() -> None:
    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))

    route = _mcp_route(config, "github")
    target = _mcp_target(config, "github")

    # No static PAT on the backend anymore; auth comes from the route-level
    # transformation reading X-CAIPE-Provider-Token.
    assert "policies" not in target
    transform = route["policies"]["transformations"]["request"]["set"]
    assert transform["authorization"] == PROVIDER_TOKEN_TRANSFORM
    assert "extAuthz" in route["policies"]
    assert "authorization" in route["policies"]


def test_gitlab_route_rewrites_provider_token_to_authorization() -> None:
    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))

    route = _mcp_route(config, "gitlab")
    target = _mcp_target(config, "gitlab")

    assert "policies" not in target
    transform = route["policies"]["transformations"]["request"]["set"]
    assert transform["authorization"] == PROVIDER_TOKEN_TRANSFORM
    assert "extAuthz" in route["policies"]
    assert "authorization" in route["policies"]


def test_knowledge_base_route_rewrites_provider_token_to_authorization() -> None:
    # The RAG server enforces its own OIDC auth, so the knowledge-base route must
    # rewrite the user-JWT/service-token (X-CAIPE-Provider-Token) into Authorization.
    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))

    route = _mcp_route(config, "knowledge-base")
    transform = route["policies"]["transformations"]["request"]["set"]
    assert transform["authorization"] == PROVIDER_TOKEN_TRANSFORM
    assert "extAuthz" in route["policies"]
    assert "authorization" in route["policies"]
