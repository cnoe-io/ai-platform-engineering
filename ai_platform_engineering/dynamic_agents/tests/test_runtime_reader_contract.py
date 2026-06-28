"""Regression tests for Dynamic Agents runtime-reader boundaries."""

from __future__ import annotations

import importlib.util


def test_dynamic_agents_service_does_not_ship_agent_crud_router() -> None:
    """The BFF owns agent configuration writes; DA only serves runtime routes."""

    assert importlib.util.find_spec("dynamic_agents.routes.agents") is None
