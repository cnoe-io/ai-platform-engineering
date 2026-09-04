"""Regression tests for Dynamic Agents runtime-reader boundaries."""

from __future__ import annotations

from dynamic_agents.routes.agents import router


def test_dynamic_agents_service_only_exposes_agent_probe() -> None:
    """The BFF owns writes; DA only exposes the read-only reachability probe."""

    agent_routes = [route for route in router.routes if getattr(route, "path", "").startswith("/agents/")]
    assert len(agent_routes) == 1
    assert agent_routes[0].path == "/agents/{agent_id}/probe"
    assert agent_routes[0].methods == {"GET"}
