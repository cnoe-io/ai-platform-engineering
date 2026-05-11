"""Tests for the Agentic SDLC read-only built-in tool."""

from dynamic_agents.models import AgenticSdlcQueryToolConfig, BuiltinToolsConfig
from dynamic_agents.services.builtin_tools import get_builtin_tool_definitions


def test_agentic_sdlc_query_is_discoverable_and_configurable():
    tool_ids = {tool.id for tool in get_builtin_tool_definitions()}

    assert "agentic_sdlc_query" in tool_ids

    config = BuiltinToolsConfig(agentic_sdlc_query=AgenticSdlcQueryToolConfig(enabled=True))
    assert config.agentic_sdlc_query
    assert config.agentic_sdlc_query.enabled is True
