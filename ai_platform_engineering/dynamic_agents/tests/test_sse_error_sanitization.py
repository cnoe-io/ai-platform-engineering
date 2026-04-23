# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6

"""Tests that SSE error events don't expose internal exception details."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _async_stream_stub_that_raises(exc: Exception):
    """Build a bound method replacement for ``runtime.stream`` / ``runtime.resume``.

    An ``AsyncMock`` used in ``async for`` is not a real async iterator, which
    produces 'coroutine was never awaited' warnings. The returned callable
    is an async generator function: the first ``__anext__`` runs ``raise exc``
    (same pattern as a real stream that fails before any frame).
    """

    async def _failing_stream(*_args, **_kwargs):
        raise exc
        if False:  # Mark async generator so ``async for`` is valid; never run.
            yield ""  # pragma: no cover

    return _failing_stream


async def _collect_sse_events(async_gen):
    events = []
    async for chunk in async_gen:
        events.append(chunk)
    return events


class TestSSEErrorSanitization:
    """Verify _generate_sse_events and _generate_resume_sse_events don't leak str(e)."""

    @pytest.mark.asyncio
    async def test_stream_error_does_not_expose_exception_message(self):
        from dynamic_agents.routes.chat import _generate_sse_events
        from dynamic_agents.services.encoders import get_encoder

        secret_message = "SECRET_TOKEN_abc123_should_not_appear"
        mock_runtime = MagicMock()
        mock_runtime.stream = _async_stream_stub_that_raises(RuntimeError(secret_message))

        mock_cache = MagicMock()
        mock_cache.get_or_create = AsyncMock(return_value=mock_runtime)

        agent_config = MagicMock()
        agent_config.name = "test-agent"
        user = MagicMock()
        user.email = "user@example.com"

        encoder = get_encoder("custom")
        with patch("dynamic_agents.routes.chat.get_runtime_cache", return_value=mock_cache):
            events = await _collect_sse_events(
                _generate_sse_events(agent_config, [], "hello", "sess-1", user, encoder)
            )

        error_events = [e for e in events if "event: error" in e]
        assert len(error_events) == 1
        error_data = json.loads(error_events[0].split("data: ", 1)[1].strip())
        assert secret_message not in error_data.get("error", "")
        assert "internal" in error_data.get("error", "").lower()

    @pytest.mark.asyncio
    async def test_resume_stream_error_does_not_expose_exception_message(self):
        from dynamic_agents.routes.chat import _generate_resume_sse_events
        from dynamic_agents.services.encoders import get_encoder

        secret_message = "SECRET_API_KEY_xyz789_should_not_appear"
        mock_runtime = MagicMock()
        mock_runtime.resume = _async_stream_stub_that_raises(RuntimeError(secret_message))

        mock_cache = MagicMock()
        mock_cache.get_or_create = AsyncMock(return_value=mock_runtime)

        agent_config = MagicMock()
        agent_config.name = "test-agent"
        user = MagicMock()
        user.email = "user@example.com"

        encoder = get_encoder("custom")
        with patch("dynamic_agents.routes.chat.get_runtime_cache", return_value=mock_cache):
            events = await _collect_sse_events(
                _generate_resume_sse_events(agent_config, [], "sess-1", user, "{}", encoder)
            )

        error_events = [e for e in events if "event: error" in e]
        assert len(error_events) == 1
        error_data = json.loads(error_events[0].split("data: ", 1)[1].strip())
        assert secret_message not in error_data.get("error", "")
        assert "internal" in error_data.get("error", "").lower()
