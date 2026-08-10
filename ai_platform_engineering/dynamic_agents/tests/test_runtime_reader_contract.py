"""Regression tests for Dynamic Agents runtime-reader boundaries."""

from __future__ import annotations

from dynamic_agents.routes.agents import router


def test_dynamic_agents_service_does_not_ship_agent_crud_router() -> None:
    """The BFF owns agent configuration writes; DA only serves runtime routes."""

    routes = {
        (method, route.path)
        for route in router.routes
        for method in (route.methods or set())
    }

    assert routes == {("GET", "/agents/{agent_id}/memory-namespaces")}
