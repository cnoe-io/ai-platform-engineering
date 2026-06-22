"""Regression tests for LiteLLM MCP FastMCP startup compatibility."""

from __future__ import annotations

import ast
from pathlib import Path


SERVER_PATH = Path(__file__).resolve().parents[1] / "mcp_litellm" / "server.py"


def _call_name(node: ast.Call) -> str:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return ""


def test_fastmcp_constructor_does_not_receive_transport_binding_kwargs() -> None:
    """FastMCP 3.x rejects host/port constructor kwargs."""
    tree = ast.parse(SERVER_PATH.read_text())

    fastmcp_calls = [
        node for node in ast.walk(tree) if isinstance(node, ast.Call) and _call_name(node) == "FastMCP"
    ]

    assert fastmcp_calls, "expected LiteLLM MCP server to construct FastMCP"
    for call in fastmcp_calls:
        keyword_names = {keyword.arg for keyword in call.keywords}
        assert "host" not in keyword_names
        assert "port" not in keyword_names


def test_http_server_run_receives_transport_binding_kwargs() -> None:
    """HTTP mode should bind host/port when the server is run."""
    tree = ast.parse(SERVER_PATH.read_text())

    run_calls = [
        node for node in ast.walk(tree) if isinstance(node, ast.Call) and _call_name(node) == "run"
    ]

    assert any(
        {"transport", "host", "port"}.issubset({keyword.arg for keyword in call.keywords})
        for call in run_calls
    )
