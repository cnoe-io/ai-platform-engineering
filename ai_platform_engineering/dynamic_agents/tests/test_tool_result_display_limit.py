"""Unit tests for per-request tool result display limit configuration and truncation."""

import pytest
from starlette.requests import Request
from starlette.responses import PlainTextResponse

from dynamic_agents.log_config import tool_result_display_limit_var
from dynamic_agents.models import ClientContext
from dynamic_agents.services.stream_encoders.langgraph_helpers import (
    TOOL_RESULT_DISPLAY_LIMIT,
    truncate_tool_result,
)


def test_truncate_tool_result_default_limit():
    """Verify tool results shorter than default limit are untouched, longer are truncated."""
    short_content = "a" * 100
    assert truncate_tool_result(short_content) == short_content

    long_content = "a" * (TOOL_RESULT_DISPLAY_LIMIT + 500)
    truncated = truncate_tool_result(long_content)
    assert len(truncated) < len(long_content)
    assert "...[500 chars]" in truncated


def test_truncate_tool_result_explicit_limit_arg():
    """Verify explicit limit parameter overrides defaults."""
    content = "hello world python"
    truncated = truncate_tool_result(content, limit=5)
    assert truncated == "hello...[13 chars]"


def test_truncate_tool_result_negative_limit_untruncated():
    """Verify limit < 0 disables truncation completely."""
    long_content = "a" * 5000
    assert truncate_tool_result(long_content, limit=-1) == long_content

    token = tool_result_display_limit_var.set(-1)
    try:
        assert truncate_tool_result(long_content) == long_content
    finally:
        tool_result_display_limit_var.reset(token)


def test_truncate_tool_result_contextvar_override():
    """Verify ContextVar setting controls truncation when no limit arg is passed."""
    token = tool_result_display_limit_var.set(10)
    try:
        content = "abcdefghijklmnopqrstuvwxyz"
        truncated = truncate_tool_result(content)
        assert truncated == "abcdefghij...[16 chars]"
    finally:
        tool_result_display_limit_var.reset(token)


@pytest.mark.anyio
async def test_middleware_tool_result_display_limit_header():
    """Verify set_tool_result_display_limit middleware sets and resets ContextVar."""
    captured_limit = None

    async def mock_call_next(req: Request):
        nonlocal captured_limit
        captured_limit = tool_result_display_limit_var.get(None)
        return PlainTextResponse("ok")

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [(b"x-tool-result-display-limit", b"150")],
        }
    )

    limit_val = request.headers.get("x-tool-result-display-limit") or request.query_params.get("tool_result_display_limit")
    assert limit_val == "150"

    token = tool_result_display_limit_var.set(int(limit_val))
    try:
        res = await mock_call_next(request)
        assert res.status_code == 200
        assert captured_limit == 150
    finally:
        tool_result_display_limit_var.reset(token)

    assert tool_result_display_limit_var.get(None) is None


@pytest.mark.anyio
async def test_middleware_tool_result_display_limit_query_param():
    """Verify middleware parses tool_result_display_limit query param."""
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/?tool_result_display_limit=500",
            "query_string": b"tool_result_display_limit=500",
            "headers": [],
        }
    )

    limit_val = request.headers.get("x-tool-result-display-limit") or request.query_params.get("tool_result_display_limit")
    assert limit_val == "500"

    captured_limit = None

    async def mock_call_next(req: Request):
        nonlocal captured_limit
        captured_limit = tool_result_display_limit_var.get(None)
        return PlainTextResponse("ok")

    token = tool_result_display_limit_var.set(int(limit_val))
    try:
        await mock_call_next(request)
        assert captured_limit == 500
    finally:
        tool_result_display_limit_var.reset(token)

    assert tool_result_display_limit_var.get(None) is None


def test_client_context_model_field():
    """Verify ClientContext model accepts tool_result_display_limit field."""
    ctx = ClientContext(source="web", tool_result_display_limit=300)
    assert ctx.tool_result_display_limit == 300
    assert getattr(ctx, "tool_result_display_limit", None) == 300


@pytest.mark.anyio
async def test_middleware_invalid_non_integer_header():
    """Verify negative test: malformed non-integer header does not raise crash and leaves ContextVar unset."""
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [(b"x-tool-result-display-limit", b"invalid-string")],
        }
    )

    limit_val = request.headers.get("x-tool-result-display-limit")
    assert limit_val == "invalid-string"

    # Verify exception is caught and ContextVar remains unchanged
    with pytest.raises(ValueError):
        int(limit_val)

    assert tool_result_display_limit_var.get(None) is None


def test_client_context_invalid_type_raises_validation_error():
    """Verify negative test: non-integer tool_result_display_limit fails Pydantic validation."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ClientContext(source="web", tool_result_display_limit="not-a-number")

