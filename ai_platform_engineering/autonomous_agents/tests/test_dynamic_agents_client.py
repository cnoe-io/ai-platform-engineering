# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for ``services.dynamic_agents_client``.

Covers ``invoke_dynamic_agent`` (sync), ``preflight_dynamic_agent``,
and ``invoke_dynamic_agent_streaming`` (SSE). The network is mocked
at the ``httpx.AsyncClient`` boundary so request shaping and response
parsing run end-to-end without booting the dynamic-agents service.
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


@pytest.fixture(autouse=True)
def _reset_settings_cache():
    """Clear ``get_settings`` lru_cache so per-test env changes win."""
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
    """Mock ``httpx.AsyncClient`` as an async context manager whose post/get returns ``response``."""
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


class TestSystemUserContextHeader:
    """The forged system user context header carries autonomous-system credentials."""

    def test_is_decodable(self, configured):
        """Header is base64(JSON) of the autonomous@system principal."""
        raw = _build_system_user_context_header()
        decoded = json.loads(base64.b64decode(raw))
        assert decoded["email"] == "autonomous@system"
        assert decoded["is_admin"] is True
        assert decoded["is_authorized"] is True


class TestInvokeDynamicAgent:
    """``invoke_dynamic_agent`` (non-streaming) request and response handling."""

    @pytest.mark.asyncio
    async def test_unconfigured_raises_not_configured(self, unconfigured):
        """Missing ``DYNAMIC_AGENTS_URL`` raises ``DynamicAgentsNotConfiguredError``."""
        with pytest.raises(DynamicAgentsNotConfiguredError):
            await invoke_dynamic_agent(
                prompt="hi",
                task_id="t1",
                agent_id="agent-x",
            )

    @pytest.mark.asyncio
    async def test_happy_path_returns_content_and_empty_events(self, configured):
        """200 with ``success=True`` returns ``(content, [])`` and posts to ``/api/v1/chat/invoke``."""
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
        call_url = client.post.await_args.args[0]
        assert call_url.endswith("/api/v1/chat/invoke")
        body = client.post.await_args.kwargs["json"]
        assert body["message"] == "hi"

    @pytest.mark.asyncio
    async def test_appends_context_to_message(self, configured):
        """``context`` is inlined under a ``Context:\\n{json}`` block (no routing directive)."""
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
    async def test_404_raises_typed_error(self, configured):
        """404 raises ``DynamicAgentsClientError`` with ``no agent with id ...``."""
        factory, _ = _mock_async_client(_resp(404, {"detail": "Agent not found"}))
        with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
            with pytest.raises(DynamicAgentsClientError, match="no agent with id 'agent-x'"):
                await invoke_dynamic_agent(prompt="hi", task_id="t1", agent_id="agent-x")

    @pytest.mark.asyncio
    async def test_500_raises_typed_error(self, configured):
        """500 raises ``DynamicAgentsClientError`` with ``HTTP 500``."""
        factory, _ = _mock_async_client(_resp(500, {"detail": "boom"}))
        with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
            with pytest.raises(DynamicAgentsClientError, match="HTTP 500"):
                await invoke_dynamic_agent(prompt="hi", task_id="t1", agent_id="agent-x")

    @pytest.mark.asyncio
    async def test_success_false_raises_with_error_message(self, configured):
        """``success=False`` body raises ``DynamicAgentsClientError`` carrying the error string."""
        factory, _ = _mock_async_client(
            _resp(200, {"success": False, "error": "Agent rejected the prompt"})
        )
        with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
            with pytest.raises(DynamicAgentsClientError, match="Agent rejected the prompt"):
                await invoke_dynamic_agent(prompt="hi", task_id="t1", agent_id="agent-x")

    @pytest.mark.asyncio
    async def test_transport_failure_raises_typed_error(self, configured):
        """Transport failure raises ``DynamicAgentsClientError`` with ``did not respond``."""
        factory, _ = _mock_async_client(httpx.ConnectError("refused"))
        with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
            with pytest.raises(DynamicAgentsClientError, match="did not respond"):
                await invoke_dynamic_agent(prompt="hi", task_id="t1", agent_id="agent-x")


class TestPreflightDynamicAgent:
    """``preflight_dynamic_agent`` returns an ``Acknowledgement`` for every outcome."""

    @pytest.mark.asyncio
    async def test_unconfigured_returns_application_failure(self, unconfigured):
        """Unconfigured returns an ``ack_status=failed`` Acknowledgement."""
        ack = await preflight_dynamic_agent(agent_id="agent-x")
        assert ack.ack_status == "failed"
        assert "DYNAMIC_AGENTS_URL is not configured" in (ack.ack_detail or "")

    @pytest.mark.asyncio
    async def test_happy_path_returns_ok(self, configured):
        """Probe returning enabled agent yields ``ack_status=ok``."""
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
    async def test_disabled_agent_returns_warn(self, configured):
        """Probe returning ``enabled=False`` yields ``ack_status=warn``."""
        factory, _ = _mock_async_client(
            _resp(200, {"id": "agent-x", "name": "Off", "enabled": False})
        )
        with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
            ack = await preflight_dynamic_agent(agent_id="agent-x")
        assert ack.ack_status == "warn"

    @pytest.mark.asyncio
    async def test_404_returns_application_failure(self, configured):
        """404 yields ``ack_status=failed`` carrying the error detail."""
        factory, _ = _mock_async_client(_resp(404, {"detail": "not found"}))
        with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
            ack = await preflight_dynamic_agent(agent_id="agent-x")
        assert ack.ack_status == "failed"
        assert "not found" in (ack.ack_detail or "").lower()

    @pytest.mark.asyncio
    async def test_transport_failure_returns_pending_ack(self, configured):
        """Transport failure yields ``ack_status=pending`` so the UI retries on next touch."""
        factory, _ = _mock_async_client(httpx.ConnectError("refused"))
        with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
            ack = await preflight_dynamic_agent(agent_id="agent-x")
        assert ack.ack_status == "pending"


def _stream_response(status: int, sse_lines: list[str]):
    """Mock ``httpx.Response`` whose ``aiter_lines`` yields ``sse_lines``."""
    response = MagicMock(spec=httpx.Response)
    response.status_code = status
    response.aread = AsyncMock(return_value=b"")

    async def _aiter():
        for line in sse_lines:
            yield line

    response.aiter_lines = MagicMock(return_value=_aiter())
    return response


def _mock_streaming_client(response):
    """Patch ``httpx.AsyncClient`` so ``client.stream(...)`` returns ``response``."""
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
    """Render a single SSE frame (``event:`` / ``data:`` / blank line)."""
    return [
        f"event: {event_type}",
        f"data: {json.dumps(data or {})}",
        "",
    ]


class TestInvokeDynamicAgentStreaming:
    """``invoke_dynamic_agent_streaming`` translates SSE events into A2A artifact-update events."""

    @pytest.mark.asyncio
    async def test_unconfigured_raises_not_configured(self, unconfigured):
        """Missing ``DYNAMIC_AGENTS_URL`` raises ``DynamicAgentsNotConfiguredError``."""
        with pytest.raises(DynamicAgentsNotConfiguredError):
            await invoke_dynamic_agent_streaming(
                prompt="hi", task_id="t1", agent_id="agent-x"
            )

    @pytest.mark.asyncio
    async def test_happy_path_translates_tools_and_content(self, configured):
        """SSE tool/content events translate into A2A ``artifact-update`` events with the UI's expected shape."""
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

        assert content == "Found 3 PRs."

        call_args = client.stream.call_args
        assert call_args.args[0] == "POST"
        assert call_args.args[1].endswith("/api/v1/chat/stream/start")
        body = call_args.kwargs["json"]
        assert body["agent_id"] == "agent-x"
        assert body["protocol"] == "custom"
        assert body["trace_id"] == "t1"

        assert len(events) == 3
        assert events[0]["kind"] == "artifact-update"
        assert events[0]["artifact"]["name"] == "tool_notification_start"
        assert events[0]["artifact"]["description"] == "Tool call started: search_repos"
        assert events[1]["artifact"]["name"] == "tool_notification_end"
        assert events[1]["artifact"]["description"] == "Tool call completed: search_repos"
        assert events[2]["artifact"]["name"] == "final_result"
        assert events[2]["artifact"]["parts"][0]["text"] == "Found 3 PRs."

    @pytest.mark.asyncio
    async def test_no_content_returns_placeholder_text(self, configured):
        """No content events => placeholder text in the synthetic ``final_result``."""
        sse = _sse("done", {})
        response = _stream_response(200, sse)
        factory, _ = _mock_streaming_client(response)
        with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
            content, events = await invoke_dynamic_agent_streaming(
                prompt="hi", task_id="t1", agent_id="agent-x",
            )
        assert content == "(dynamic agent returned no text content)"
        assert len(events) == 1
        assert events[0]["artifact"]["name"] == "final_result"

    @pytest.mark.asyncio
    async def test_tool_end_with_error_is_translated(self, configured):
        """Failed tool surfaces the error string in the artifact and ``metadata.error=True``."""
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
    async def test_error_event_raises_typed_error(self, configured):
        """SSE ``error`` event raises ``DynamicAgentsClientError`` with the upstream error message."""
        sse = _sse("error", {"error": "agent runtime crashed"}) + _sse("done", {})
        response = _stream_response(200, sse)
        factory, _ = _mock_streaming_client(response)
        with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
            with pytest.raises(DynamicAgentsClientError, match="agent runtime crashed"):
                await invoke_dynamic_agent_streaming(
                    prompt="hi", task_id="t1", agent_id="agent-x",
                )

    @pytest.mark.asyncio
    async def test_404_raises_typed_error(self, configured):
        """404 raises ``DynamicAgentsClientError`` with ``no agent with id ...``."""
        response = _stream_response(404, [])
        factory, _ = _mock_streaming_client(response)
        with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
            with pytest.raises(DynamicAgentsClientError, match="no agent with id 'agent-x'"):
                await invoke_dynamic_agent_streaming(
                    prompt="hi", task_id="t1", agent_id="agent-x",
                )

    @pytest.mark.asyncio
    async def test_500_raises_typed_error(self, configured):
        """500 raises ``DynamicAgentsClientError`` with ``HTTP 500``."""
        response = _stream_response(500, [])
        factory, _ = _mock_streaming_client(response)
        with patch("autonomous_agents.services.dynamic_agents_client.httpx.AsyncClient", factory):
            with pytest.raises(DynamicAgentsClientError, match="HTTP 500"):
                await invoke_dynamic_agent_streaming(
                    prompt="hi", task_id="t1", agent_id="agent-x",
                )

    @pytest.mark.asyncio
    async def test_transport_failure_raises_typed_error(self, configured):
        """Transport failure mid-open-stream raises ``DynamicAgentsClientError``."""
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
    async def test_skips_malformed_sse_chunks(self, configured):
        """Malformed JSON ``data:`` lines are skipped without crashing the stream."""
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
        assert content == "ok"

    @pytest.mark.asyncio
    async def test_appends_context_block_to_message(self, configured):
        """``context`` is inlined under ``Context:\\n{json}`` (no routing directive)."""
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
