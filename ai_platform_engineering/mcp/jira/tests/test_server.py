"""Unit tests for Jira MCP server registration."""

import importlib
import sys
import types


def test_server_registers_internal_comment_tool(monkeypatch):
    """The MCP server should expose the dedicated JSM internal comment tool."""
    instances = []

    class FakeMCP:
        def __init__(self, name):
            self.name = name
            self.registered_tools = []
            self.run_kwargs = None
            instances.append(self)

        def tool(self):
            def register(func):
                self.registered_tools.append(func.__name__)
                return func

            return register

        def run(self, **kwargs):
            self.run_kwargs = kwargs

    monkeypatch.setitem(sys.modules, "fastmcp", types.SimpleNamespace(FastMCP=FakeMCP))
    monkeypatch.setenv("MCP_MODE", "stdio")

    server = importlib.import_module("server")
    importlib.reload(server)
    server.main()

    assert instances
    assert "add_internal_comment" in instances[-1].registered_tools
    assert instances[-1].run_kwargs == {"transport": "stdio"}
