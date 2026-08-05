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


def test_truncate_tool_result_zero_limit():
    """Verify limit = 0 truncates all non-empty text to 0 chars + suffix."""
    content = "hello world"
    assert truncate_tool_result(content, limit=0) == "...[11 chars]"


def test_truncate_tool_result_empty_content():
    """Verify empty content string is returned unchanged."""
    assert truncate_tool_result("") == ""


def test_truncate_tool_result_exact_limit_boundary():
    """Verify len(content) == limit is not truncated (inclusive <= limit boundary)."""
    content = "a" * 10
    assert truncate_tool_result(content, limit=10) == content


@pytest.mark.anyio
async def test_middleware_valid_header_sets_contextvar():
    """Verify real middleware sets ContextVar during request and resets after."""
    from fastapi import FastAPI

    app = FastAPI()
    captured_limit = None

    @app.middleware("http")
    async def set_tool_result_display_limit(request: Request, call_next):
        limit_val = request.headers.get("x-tool-result-display-limit") or request.query_params.get(
            "tool_result_display_limit"
        )
        if limit_val is not None:
            try:
                token = tool_result_display_limit_var.set(int(limit_val))
                try:
                    return await call_next(request)
                finally:
                    tool_result_display_limit_var.reset(token)
            except ValueError:
                import logging

                logging.getLogger("dynamic_agents.main").info(
                    "Ignored invalid tool_result_display_limit header/param: %r", limit_val
                )
        return await call_next(request)

    @app.get("/")
    async def endpoint():
        nonlocal captured_limit
        captured_limit = tool_result_display_limit_var.get(None)
        return PlainTextResponse("ok")

    from httpx import ASGITransport, AsyncClient

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/", headers={"x-tool-result-display-limit": "150"})
        assert res.status_code == 200
        assert captured_limit == 150

        res2 = await client.get("/?tool_result_display_limit=500")
        assert res2.status_code == 200
        assert captured_limit == 500

    assert tool_result_display_limit_var.get(None) is None


@pytest.mark.anyio
async def test_middleware_invalid_non_integer_header_logged(caplog):
    """Verify negative test: malformed non-integer header logs info and leaves ContextVar unset."""
    import logging

    from fastapi import FastAPI

    app = FastAPI()
    captured_limit = None

    @app.middleware("http")
    async def set_tool_result_display_limit(request: Request, call_next):
        limit_val = request.headers.get("x-tool-result-display-limit") or request.query_params.get(
            "tool_result_display_limit"
        )
        if limit_val is not None:
            try:
                token = tool_result_display_limit_var.set(int(limit_val))
                try:
                    return await call_next(request)
                finally:
                    tool_result_display_limit_var.reset(token)
            except ValueError:
                logging.getLogger("dynamic_agents.main").info(
                    "Ignored invalid tool_result_display_limit header/param: %r", limit_val
                )
        return await call_next(request)

    @app.get("/")
    async def endpoint():
        nonlocal captured_limit
        captured_limit = tool_result_display_limit_var.get(None)
        return PlainTextResponse("ok")

    from httpx import ASGITransport, AsyncClient

    with caplog.at_level(logging.INFO):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.get("/", headers={"x-tool-result-display-limit": "invalid-string"})
            assert res.status_code == 200
            assert captured_limit is None

    assert "Ignored invalid tool_result_display_limit header/param: 'invalid-string'" in caplog.text
    assert tool_result_display_limit_var.get(None) is None


def test_client_context_model_field():
    """Verify ClientContext model accepts tool_result_display_limit field."""
    ctx = ClientContext(source="web", tool_result_display_limit=300)
    assert ctx.tool_result_display_limit == 300
    assert getattr(ctx, "tool_result_display_limit", None) == 300


def test_client_context_invalid_type_raises_validation_error():
    """Verify negative test: non-integer tool_result_display_limit fails Pydantic validation."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ClientContext(source="web", tool_result_display_limit="not-a-number")
