# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for ``services.dynamic_agents_client``.

Network is mocked at the ``httpx.AsyncClient`` boundary so the tests
exercise our request shaping + response parsing without booting the
dynamic-agents service. The boundary choice is deliberate: anything
deeper would just retest httpx, anything shallower would miss the
header / URL / payload contracts the client is responsible for.
"""

from __future__ import annotations

import base64
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from autonomous_agents.config import get_settings
from autonomous_agents.services.dynamic_agents_client import (
    DynamicAgentsClientError,
    DynamicAgentsNotConfiguredError,
    _build_system_user_context_header,
    invoke_dynamic_agent,
    invoke_dynamic_agent_streaming,
    preflight_dynamic_agent,
)

# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_settings_cache():
    """Clear the lru_cache on get_settings so per-test env changes win.

    Without this, the first test to call ``get_settings()`` would
    capture whichever env vars happened to be set at that moment and
    every subsequent test would see the same snapshot. Since these
    tests deliberately flip ``DYNAMIC_AGENTS_URL`` on and off, an
    uncached lookup is required.
    """
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def configured(monkeypatch):
    """Set DYNAMIC_AGENTS_URL to a fake host."""
    monkeypatch.setenv("DYNAMIC_AGENTS_URL", "http://dynamic-agents-test:8001")
    get_settings.cache_clear()
    yield


@pytest.fixture
def unconfigured(monkeypatch):
    """Clear DYNAMIC_AGENTS_URL so the not-configured branch fires."""
    monkeypatch.delenv("DYNAMIC_AGENTS_URL", raising=False)
    get_settings.cache_clear()
    yield


def _mock_async_client(response: httpx.Response | Exception):
    """Return a MagicMock that mimics ``httpx.AsyncClient`` as a context
    manager whose ``post``/``get`` returns or raises ``response``."""
    instance = MagicMock()
    if isinstance(response, Exception):
        instance.post = AsyncMock(side_effect=response)
        instance.get = AsyncMock(side_effect=response)
    else:
        instance.post = AsyncMock(return_value=response)
        instance.get = AsyncMock(return_value=response)
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=instance)
    cm.__aexit__ = AsyncMock(return_value=False)
    factory = MagicMock(return_value=cm)
    return factory, instance


def _resp(status: int, body: Any) -> httpx.Response:
    return httpx.Response(
        status_code=status,
        content=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        request=httpx.Request("POST", "http://test"),
    )


# ---------------------------------------------------------------------------
# Header construction
# ---------------------------------------------------------------------------

def test_system_user_context_header_is_decodable(configured):
    raw = _build_system_user_context_header()
    decoded = json.loads(base64.b64decode(raw))
    assert decoded["email"] == "autonomous@system"
    assert decoded["is_admin"] is True
    assert decoded["is_authorized"] is True


# ---------------------------------------------------------------------------
# invoke_dynamic_agent
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_invoke_unconfigured_raises_not_configured(unconfigured):
    with pytest.raises(DynamicAgentsNotConfiguredError):
        await invoke_dynamic_agent(
            prompt="hi",
            task_id="t1",
            agent_id="agent-x",
        )


@pytest.mark.asyncio
async def test_invoke_happy_path_returns_content_and_empty_events(configured):
    factory, client = _mock_async_client(
        _resp(200, {"success": True, "content": "hello world"})
    )
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        content, events = await invoke_dynamic_agent(
            prompt="hi",
            task_id="t1",
            agent_id="agent-x",
        )
    assert content == "hello world"
    assert events == []
    # URL must include the /api/v1 prefix the dynamic-agents service uses.
    call_url = client.post.await_args.args[0]
    assert call_url.endswith("/api/v1/chat/invoke")
    body = client.post.await_args.kwargs["json"]
    assert body["message"] == "hi"


@pytest.mark.asyncio
async def test_invoke_appends_context_to_message(configured):
    factory, client = _mock_async_client(
        _resp(200, {"success": True, "content": "hello world"})
    )
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        await invoke_dynamic_agent(
            prompt="inspect event",
            task_id="t1",
            agent_id="agent-x",
            context={"event": "message.created", "roomId": "room-123"},
        )

    body = client.post.await_args.kwargs["json"]
    assert body["message"].startswith("inspect event\n\nContext:\n")
    assert '"event": "message.created"' in body["message"]
    assert '"roomId": "room-123"' in body["message"]
    assert "Routing directive" not in body["message"]


@pytest.mark.asyncio
async def test_invoke_404_raises_typed_error(configured):
    factory, _ = _mock_async_client(_resp(404, {"detail": "Agent not found"}))
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        with pytest.raises(DynamicAgentsClientError, match="no agent with id 'agent-x'"):
            await invoke_dynamic_agent(prompt="hi", task_id="t1", agent_id="agent-x")


@pytest.mark.asyncio
async def test_invoke_500_raises_typed_error(configured):
    factory, _ = _mock_async_client(_resp(500, {"detail": "boom"}))
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        with pytest.raises(DynamicAgentsClientError, match="HTTP 500"):
            await invoke_dynamic_agent(prompt="hi", task_id="t1", agent_id="agent-x")


@pytest.mark.asyncio
async def test_invoke_success_false_raises_with_error_message(configured):
    factory, _ = _mock_async_client(
        _resp(200, {"success": False, "error": "Agent rejected the prompt"})
    )
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        with pytest.raises(DynamicAgentsClientError, match="Agent rejected the prompt"):
            await invoke_dynamic_agent(prompt="hi", task_id="t1", agent_id="agent-x")


@pytest.mark.asyncio
async def test_invoke_transport_failure_raises_typed_error(configured):
    factory, _ = _mock_async_client(httpx.ConnectError("refused"))
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        with pytest.raises(DynamicAgentsClientError, match="did not respond"):
            await invoke_dynamic_agent(prompt="hi", task_id="t1", agent_id="agent-x")


# ---------------------------------------------------------------------------
# preflight_dynamic_agent
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_preflight_unconfigured_returns_application_failure(unconfigured):
    ack = await preflight_dynamic_agent(agent_id="agent-x")
    assert ack.ack_status == "failed"
    assert "DYNAMIC_AGENTS_URL is not configured" in (ack.ack_detail or "")


@pytest.mark.asyncio
async def test_preflight_happy_path_returns_ok(configured):
    factory, client = _mock_async_client(
        _resp(200, {"id": "agent-x", "name": "My Agent", "enabled": True})
    )
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        ack = await preflight_dynamic_agent(agent_id="agent-x")
    assert ack.ack_status == "ok"
    assert ack.routed_to == "agent-x"
    assert "My Agent" in (ack.dry_run_summary or "")
    call_url = client.get.await_args.args[0]
    assert call_url.endswith("/api/v1/agents/agent-x/probe")


@pytest.mark.asyncio
async def test_preflight_disabled_agent_returns_warn(configured):
    factory, _ = _mock_async_client(
        _resp(200, {"id": "agent-x", "name": "Off", "enabled": False})
    )
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        ack = await preflight_dynamic_agent(agent_id="agent-x")
    assert ack.ack_status == "warn"


@pytest.mark.asyncio
async def test_preflight_404_returns_application_failure(configured):
    factory, _ = _mock_async_client(_resp(404, {"detail": "not found"}))
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        ack = await preflight_dynamic_agent(agent_id="agent-x")
    assert ack.ack_status == "failed"
    assert "not found" in (ack.ack_detail or "").lower()


@pytest.mark.asyncio
async def test_preflight_transport_failure_returns_pending_ack(configured):
    factory, _ = _mock_async_client(httpx.ConnectError("refused"))
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        ack = await preflight_dynamic_agent(agent_id="agent-x")
    # Acknowledgement.transport_failure -> "pending" so the UI knows
    # to retry on next task touch rather than show a hard failure.
    assert ack.ack_status == "pending"


# ---------------------------------------------------------------------------
# invoke_dynamic_agent_streaming (ux-3 / spec #099 chat-replay parity)
# ---------------------------------------------------------------------------
#
# These tests stub the SSE transport at the ``httpx.AsyncClient.stream``
# context manager boundary and verify three things:
#
#   1. The right URL / body / headers go on the wire (``/chat/stream/start``,
#      ``protocol=custom``, system-user-context header).
#   2. The SSE event types we care about (``content`` / ``tool_start`` /
#      ``tool_end`` / ``done`` / ``error``) are correctly parsed.
#   3. The translated A2A ``artifact-update`` events have the exact
#      ``artifact.name`` / ``artifact.description`` shape that the UI's
#      ``buildTimelineSegmentsFromEvents`` keys off (anything else and
#      the chat thread silently renders blank).


def _stream_response(status: int, sse_lines: list[str]):
    """Build a mock httpx.Response that yields ``sse_lines`` from aiter_lines.

    httpx's ``response.aiter_lines()`` returns a sync-callable that
    produces an async iterator. The mock mirrors that shape so the
    consumer's ``async for line in response.aiter_lines():`` works
    without any awaits beyond the iterator step itself.
    """
    response = MagicMock(spec=httpx.Response)
    response.status_code = status
    response.aread = AsyncMock(return_value=b"")

    async def _aiter():
        for line in sse_lines:
            yield line

    # ``aiter_lines`` is a method, not a property, so it must be a
    # callable that returns the async generator on each call.
    response.aiter_lines = MagicMock(return_value=_aiter())
    return response


def _mock_streaming_client(response):
    """Patch httpx.AsyncClient so ``client.stream(...)`` returns ``response``.

    Returns ``(factory_mock, client_mock)`` so tests can assert on the
    URL / body / headers via ``client_mock.stream.call_args``.
    """
    instance = MagicMock()

    stream_cm = MagicMock()
    stream_cm.__aenter__ = AsyncMock(return_value=response)
    stream_cm.__aexit__ = AsyncMock(return_value=False)

    instance.stream = MagicMock(return_value=stream_cm)

    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=instance)
    cm.__aexit__ = AsyncMock(return_value=False)

    factory = MagicMock(return_value=cm)
    return factory, instance


def _sse(event_type: str, data: dict | None = None) -> list[str]:
    """Render a single SSE frame as the line list ``aiter_lines`` would yield.

    Wire shape (from custom_sse.py):
        event: <type>
        data: <json>
        <empty line>
    """
    return [
        f"event: {event_type}",
        f"data: {json.dumps(data or {})}",
        "",
    ]


@pytest.mark.asyncio
async def test_invoke_streaming_unconfigured_raises_not_configured(unconfigured):
    with pytest.raises(DynamicAgentsNotConfiguredError):
        await invoke_dynamic_agent_streaming(
            prompt="hi", task_id="t1", agent_id="agent-x"
        )


@pytest.mark.asyncio
async def test_invoke_streaming_happy_path_translates_tools_and_content(configured):
    sse = (
        _sse("tool_start", {
            "tool_name": "search_repos",
            "tool_call_id": "tc-1",
            "args": {"query": "open prs"},
            "namespace": [],
        })
        + _sse("content", {"text": "Found ", "namespace": []})
        + _sse("tool_end", {
            "tool_call_id": "tc-1",
            "result": "[{\"id\": 1}]",
            "namespace": [],
        })
        + _sse("content", {"text": "3 PRs.", "namespace": []})
        + _sse("done", {})
    )
    response = _stream_response(200, sse)
    factory, client = _mock_streaming_client(response)
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        content, events = await invoke_dynamic_agent_streaming(
            prompt="list open PRs", task_id="t1", agent_id="agent-x",
        )

    # Final text accumulates from content chunks.
    assert content == "Found 3 PRs."

    # URL and body shape must match what the dynamic-agents service exposes.
    call_args = client.stream.call_args
    assert call_args.args[0] == "POST"
    assert call_args.args[1].endswith("/api/v1/chat/stream/start")
    body = call_args.kwargs["json"]
    assert body["agent_id"] == "agent-x"
    assert body["protocol"] == "custom"
    assert body["trace_id"] == "t1"

    # The events list must contain (in order):
    #   1. tool_notification_start (for tc-1)
    #   2. tool_notification_end   (for tc-1, with the same tool name)
    #   3. final_result            (synthetic; carries accumulated text)
    assert len(events) == 3
    assert events[0]["kind"] == "artifact-update"
    assert events[0]["artifact"]["name"] == "tool_notification_start"
    assert events[0]["artifact"]["description"] == "Tool call started: search_repos"
    assert events[1]["artifact"]["name"] == "tool_notification_end"
    # The UI extracts the tool name from this description via regex --
    # the cached tool_call_id -> tool_name mapping must produce the
    # exact same name as the start event.
    assert events[1]["artifact"]["description"] == "Tool call completed: search_repos"
    assert events[2]["artifact"]["name"] == "final_result"
    assert events[2]["artifact"]["parts"][0]["text"] == "Found 3 PRs."


@pytest.mark.asyncio
async def test_invoke_streaming_no_content_returns_placeholder_text(configured):
    """When the agent emits no content events the run still completes
    cleanly and the synthetic final_result carries an explicit
    placeholder so the chat thread isn't a confusingly empty bubble."""
    sse = _sse("done", {})
    response = _stream_response(200, sse)
    factory, _ = _mock_streaming_client(response)
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        content, events = await invoke_dynamic_agent_streaming(
            prompt="hi", task_id="t1", agent_id="agent-x",
        )
    assert content == "(dynamic agent returned no text content)"
    # Just the synthetic final_result, no tool events.
    assert len(events) == 1
    assert events[0]["artifact"]["name"] == "final_result"


@pytest.mark.asyncio
async def test_invoke_streaming_tool_end_with_error_is_translated(configured):
    """A failed tool reports the error string as the artifact body so
    the UI's error rendering pulls a useful message instead of an
    empty bubble. ``metadata.error: True`` is set so future UI
    affordances can style the segment differently."""
    sse = (
        _sse("tool_start", {
            "tool_name": "list_pull_requests",
            "tool_call_id": "tc-2",
            "args": {},
            "namespace": [],
        })
        + _sse("tool_end", {
            "tool_call_id": "tc-2",
            "error": "ERROR: 401 Unauthorized",
            "namespace": [],
        })
        + _sse("done", {})
    )
    response = _stream_response(200, sse)
    factory, _ = _mock_streaming_client(response)
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        _, events = await invoke_dynamic_agent_streaming(
            prompt="hi", task_id="t1", agent_id="agent-x",
        )
    end_event = events[1]
    assert end_event["artifact"]["name"] == "tool_notification_end"
    assert end_event["artifact"]["metadata"]["error"] is True
    body_text = end_event["artifact"]["parts"][0]["text"]
    assert "401 Unauthorized" in body_text


@pytest.mark.asyncio
async def test_invoke_streaming_error_event_raises_typed_error(configured):
    """An ``error`` SSE event from the dynamic-agents side must surface
    as ``DynamicAgentsClientError`` so the scheduler records the run
    as FAILED with the underlying error message visible in the UI."""
    sse = _sse("error", {"error": "agent runtime crashed"}) + _sse("done", {})
    response = _stream_response(200, sse)
    factory, _ = _mock_streaming_client(response)
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        with pytest.raises(DynamicAgentsClientError, match="agent runtime crashed"):
            await invoke_dynamic_agent_streaming(
                prompt="hi", task_id="t1", agent_id="agent-x",
            )


@pytest.mark.asyncio
async def test_invoke_streaming_404_raises_typed_error(configured):
    response = _stream_response(404, [])
    factory, _ = _mock_streaming_client(response)
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        with pytest.raises(DynamicAgentsClientError, match="no agent with id 'agent-x'"):
            await invoke_dynamic_agent_streaming(
                prompt="hi", task_id="t1", agent_id="agent-x",
            )


@pytest.mark.asyncio
async def test_invoke_streaming_500_raises_typed_error(configured):
    response = _stream_response(500, [])
    factory, _ = _mock_streaming_client(response)
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        with pytest.raises(DynamicAgentsClientError, match="HTTP 500"):
            await invoke_dynamic_agent_streaming(
                prompt="hi", task_id="t1", agent_id="agent-x",
            )


@pytest.mark.asyncio
async def test_invoke_streaming_transport_failure_raises_typed_error(configured):
    """A connect/read timeout while the stream is opening must raise
    ``DynamicAgentsClientError`` with a useful message so the scheduler
    records the run as FAILED with diagnostic context."""
    instance = MagicMock()
    instance.stream = MagicMock(side_effect=httpx.ConnectError("refused"))
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=instance)
    cm.__aexit__ = AsyncMock(return_value=False)
    factory = MagicMock(return_value=cm)
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        with pytest.raises(DynamicAgentsClientError, match="did not respond"):
            await invoke_dynamic_agent_streaming(
                prompt="hi", task_id="t1", agent_id="agent-x",
            )


@pytest.mark.asyncio
async def test_invoke_streaming_skips_malformed_sse_chunks(configured):
    """A malformed JSON ``data:`` line must not crash the stream --
    the supervisor's A2A consumer has the same tolerance, and a single
    bad chunk shouldn't waste a run that otherwise has good events."""
    sse = (
        ["event: content", "data: {not valid json", ""]
        + _sse("content", {"text": "ok"})
        + _sse("done", {})
    )
    response = _stream_response(200, sse)
    factory, _ = _mock_streaming_client(response)
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        content, _ = await invoke_dynamic_agent_streaming(
            prompt="hi", task_id="t1", agent_id="agent-x",
        )
    # The malformed chunk was skipped; the good chunk's text survived.
    assert content == "ok"


@pytest.mark.asyncio
async def test_invoke_streaming_appends_context_block_to_message(configured):
    """Same context-block contract as the sync variant: webhook payloads
    are inlined into the prompt under a ``Context:\\n{json}`` header so
    the dynamic agent sees the exact same text the supervisor path
    would produce. No routing directive (only supervisor needs that)."""
    sse = _sse("done", {})
    response = _stream_response(200, sse)
    factory, client = _mock_streaming_client(response)
    with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
        await invoke_dynamic_agent_streaming(
            prompt="inspect event",
            task_id="t1",
            agent_id="agent-x",
            context={"event": "message.created", "roomId": "room-123"},
        )
    body = client.stream.call_args.kwargs["json"]
    assert body["message"].startswith("inspect event\n\nContext:\n")
    assert '"event": "message.created"' in body["message"]
    assert "Routing directive" not in body["message"]
