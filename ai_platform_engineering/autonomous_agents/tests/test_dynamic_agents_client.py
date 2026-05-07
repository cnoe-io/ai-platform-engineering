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
